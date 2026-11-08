"""Local HTTP entry point for the browser workflow."""
import argparse
import json
import os
import sqlite3
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlsplit

from engine import DEFAULT_RUBRIC, ROOT, ModelError, calculate, extract_records, model_name, provider_name, score_conversation, validate_rubric
from results_io import make_submission, validate_runs
from workflow import ConflictError, WorkflowStore

WEB = ROOT / "web"
MAX_BODY = 8 * 1024 * 1024
FILES = {
    "/": (WEB / "index.html", "text/html; charset=utf-8"),
    "/app.js": (WEB / "app.js", "text/javascript; charset=utf-8"),
    "/presentation.js": (WEB / "presentation.js", "text/javascript; charset=utf-8"),
    "/welcome.js": (WEB / "welcome.js", "text/javascript; charset=utf-8"),
    "/brand-ascii.js": (WEB / "brand-ascii.js", "text/javascript; charset=utf-8"),
    "/ascii-titles.js": (WEB / "ascii-titles.js", "text/javascript; charset=utf-8"),
    "/brand-orbit.js": (WEB / "brand-orbit.js", "text/javascript; charset=utf-8"),
    "/f-mark.svg": (WEB / "f-mark.svg", "image/svg+xml"),
    "/f-model.json": (WEB / "f-model.json", "application/json"),
    "/f-model.glb": (WEB / "f-model.glb", "model/gltf-binary"),
    "/coin-models.json": (WEB / "coin-models.json", "application/json"),
    "/coin-tenge.glb": (WEB / "coin-tenge.glb", "model/gltf-binary"),
    "/coin-dollar.glb": (WEB / "coin-dollar.glb", "model/gltf-binary"),
    "/coin-euro.glb": (WEB / "coin-euro.glb", "model/gltf-binary"),
    "/favicon.svg": (WEB / "favicon.svg", "image/svg+xml"),
    "/style.css": (WEB / "style.css", "text/css; charset=utf-8"),
    "/synthetic.json": (ROOT / "examples" / "synthetic.json", "application/json"),
}


class Handler(BaseHTTPRequestHandler):
    def store(self):
        return WorkflowStore()

    def send_body(self, status, body, mime):
        self.send_response(status)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", "default-src 'self'; frame-ancestors 'none'; object-src 'none'")
        self.end_headers()
        self.wfile.write(body)

    def send_json(self, status, value):
        self.send_body(status, json.dumps(value, ensure_ascii=False).encode("utf-8"), "application/json; charset=utf-8")

    def local_request(self):
        host = self.headers.get("Host")
        expected = f"127.0.0.1:{self.server.server_port}"
        return host in (expected, f"localhost:{self.server.server_port}") and self.headers.get("Origin") in (None, f"http://{host}")

    def do_GET(self):
        if not self.local_request():
            self.send_json(403, {"error": "Запрос разрешён только с локального адреса."})
            return
        url = urlsplit(self.path)
        path = url.path
        try:
            if path == "/api/config":
                self.send_json(200, {"rubric": DEFAULT_RUBRIC, "model": model_name(), "provider": provider_name(),
                                     "features": ["run_history", "appeals", "critical_filter", "batch_import", "submission_export", "partial_review"]})
            elif path == "/api/health":
                self.send_json(200, {"server": "ok", "model": {"name": model_name(), "provider": provider_name(),
                                                               "availability": "not_checked"}})
            elif path == "/api/runs":
                query = parse_qs(url.query, keep_blank_values=True)
                if any(len(values) != 1 for values in query.values()):
                    raise ValueError("Параметры запроса не должны повторяться.")
                latest = query.get("latest", ["true"])[0]
                if latest not in ("true", "false"):
                    raise ValueError("latest должен быть true или false.")
                self.send_json(200, self.store().list_runs(
                    query.get("filter", ["all"])[0], query.get("conversation_id", [None])[0], latest == "true",
                    int(query.get("limit", ["100"])[0]), int(query.get("offset", ["0"])[0])))
            elif path.startswith("/api/runs/"):
                self.send_json(200, self.store().get_run(path.removeprefix("/api/runs/")))
            elif path in FILES:
                file, mime = FILES[path]
                self.send_body(200, file.read_bytes(), mime)
            else:
                self.send_json(404, {"error": "Страница не найдена."})
        except (ValueError, UnicodeError) as error:
            self.send_json(400, {"error": str(error)})
        except (OSError, sqlite3.Error):
            self.send_json(503, {"error": "Не удалось открыть локальное хранилище. Проверьте доступ к папке data."})

    def do_POST(self):
        if not self.local_request():
            self.send_json(403, {"error": "Запрос разрешён только с локального адреса."})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= MAX_BODY or self.headers.get_content_type() != "application/json":
                raise ValueError("Ожидается JSON размером до 8 МБ.")
            body = json.loads(self.rfile.read(length))
            if not isinstance(body, dict):
                raise ValueError("Ожидается объект JSON.")
            path = urlsplit(self.path).path
            if path == "/api/import":
                result = extract_records(body.get("payload"))
            elif path == "/api/rubric":
                result = validate_rubric(body.get("rubric"))
            elif path == "/api/score":
                result = score_conversation(body.get("conversation"), body.get("rubric"))
                result["run_id"] = self.store().save_run(body.get("conversation"), result)
            elif path == "/api/recalculate":
                result = calculate(validate_rubric(body.get("rubric")), body.get("answers"))
            elif path == "/api/import-results":
                records = extract_records(body.get("records"))
                result = validate_runs(body.get("payload"), records)
                result["run_ids"] = self.store().save_runs(records, body.get("payload"))
            elif path == "/api/export-results":
                result = make_submission(body.get("payload"), body.get("records"), body.get("group"), body.get("team_name"))
            elif path == "/api/appeals":
                result = self.store().open_appeal(body.get("run_id"), body.get("criterion_id"),
                                                body.get("message"), body.get("expected_revision"))
            elif path == "/api/reviews":
                result = self.store().decide(body.get("run_id"), body.get("appeal_id"), body.get("answer"),
                                           body.get("reason"), body.get("expected_revision"), body.get("reviewer", "Проверяющий"))
            else:
                self.send_json(404, {"error": "Маршрут не найден."})
                return
        except ConflictError as error:
            self.send_json(409, {"error": str(error)})
        except (ValueError, UnicodeError) as error:
            self.send_json(400, {"error": str(error)})
        except ModelError as error:
            self.send_json(502, {"error": str(error)})
        except (OSError, sqlite3.Error):
            self.send_json(503, {"error": "Не удалось сохранить результат локально. Проверьте доступ к папке data."})
        else:
            self.send_json(200, result)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=int(os.environ.get("CQA_PORT", "8765")))
    args = parser.parse_args()
    with ThreadingHTTPServer(("127.0.0.1", args.port), Handler) as server:
        print(f"Open http://127.0.0.1:{server.server_port}", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
