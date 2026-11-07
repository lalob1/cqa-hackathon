"""Local HTTP entry point for the browser workflow."""
import argparse
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

from engine import (DEFAULT_RUBRIC, ROOT, ModelError, calculate, extract_records, model_name,
                    score_conversation, validate_batch_results, validate_rubric)

WEB = ROOT / "web"
MAX_BODY = 8 * 1024 * 1024
FILES = {
    "/": (WEB / "index.html", "text/html; charset=utf-8"),
    "/app.js": (WEB / "app.js", "text/javascript; charset=utf-8"),
    "/presentation.js": (WEB / "presentation.js", "text/javascript; charset=utf-8"),
    "/brand-orbit.js": (WEB / "brand-orbit.js", "text/javascript; charset=utf-8"),
    "/f-mark.svg": (WEB / "f-mark.svg", "image/svg+xml"),
    "/f-model.json": (WEB / "f-model.json", "application/json"),
    "/f-model.glb": (WEB / "f-model.glb", "model/gltf-binary"),
    "/favicon.svg": (WEB / "favicon.svg", "image/svg+xml"),
    "/style.css": (WEB / "style.css", "text/css; charset=utf-8"),
    "/synthetic.json": (ROOT / "examples" / "synthetic.json", "application/json"),
}


class Handler(BaseHTTPRequestHandler):
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
        path = urlsplit(self.path).path
        if path == "/api/config":
            self.send_json(200, {"rubric": DEFAULT_RUBRIC, "model": model_name()})
        elif path in FILES:
            file, mime = FILES[path]
            self.send_body(200, file.read_bytes(), mime)
        else:
            self.send_json(404, {"error": "Страница не найдена."})

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
            elif path == "/api/import-results":
                result = validate_batch_results(body.get("payload"), body.get("records"))
            elif path == "/api/rubric":
                result = validate_rubric(body.get("rubric"))
            elif path == "/api/score":
                result = score_conversation(body.get("conversation"), body.get("rubric"))
            elif path == "/api/recalculate":
                result = calculate(validate_rubric(body.get("rubric")), body.get("answers"))
            else:
                self.send_json(404, {"error": "Маршрут не найден."})
                return
        except (ValueError, UnicodeError) as error:
            self.send_json(400, {"error": str(error)})
        except ModelError as error:
            self.send_json(502, {"error": str(error)})
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
