"""End-to-end local HTTP checks with a mocked model, never cloud inference."""
import copy
import json
import tempfile
import threading
import unittest
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

import app
from engine import ModelError
from test_workflow import run_fixture
from workflow import WorkflowStore


class QuietHandler(app.Handler):
    def log_message(self, *_):
        pass


class APITests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), QuietHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = WorkflowStore(Path(self.tmp.name) / "test.sqlite3")
        self.store_patch = patch.object(app.Handler, "store", lambda handler: self.store)
        self.store_patch.start()
        self.conversation, self.run = run_fixture()

    def tearDown(self):
        self.store_patch.stop()
        self.tmp.cleanup()

    def request(self, path, body=None, headers=None):
        conn = HTTPConnection("127.0.0.1", self.server.server_port, timeout=5)
        request_headers = {"Content-Type": "application/json"}
        request_headers.update(headers or {})
        conn.request("GET" if body is None else "POST", path,
                     body=None if body is None else json.dumps(body), headers=request_headers)
        response = conn.getresponse()
        status = response.status
        result = json.loads(response.read())
        conn.close()
        return status, result

    def score(self):
        with patch.object(app, "score_conversation", return_value=copy.deepcopy(self.run)):
            status, scored = self.request("/api/score", {"conversation": self.conversation, "rubric": self.run["rubric"]})
        self.assertEqual(status, 200)
        return scored

    def test_old_score_shape_and_durable_workflow(self):
        scored = self.score()
        self.assertTrue({"judgments", "score", "rubric", "audit", "conversation_id"} <= scored.keys())
        rid = scored["run_id"]
        status, original = self.request("/api/runs/" + rid)
        self.assertEqual(status, 200)
        self.assertEqual(original["revision"], 0)
        status, appealed = self.request("/api/appeals", {"run_id": rid, "criterion_id": "closing", "message": "Проверить.", "expected_revision": 0})
        self.assertEqual(status, 200)
        status, final = self.request("/api/reviews", {"run_id": rid, "appeal_id": appealed["appeals"][0]["appeal_id"],
                                                    "answer": "yes", "reason": "Есть итог и прощание.", "expected_revision": 1})
        self.assertEqual(status, 200)
        self.assertEqual(final["original"]["score"]["total"], 77.69)
        self.assertEqual(final["final_score"]["total"], 85.38)
        status, critical = self.request("/api/runs?filter=critical")
        self.assertEqual(status, 200)
        self.assertEqual(critical["total"], 1)
        self.assertTrue(critical["results"][0]["critical_reasons"])
        status, _ = self.request("/api/appeals", {"run_id": rid, "criterion_id": "empathy", "message": "Проверить.", "expected_revision": 0})
        self.assertEqual(status, 409)

    def test_import_works_recomputes_and_rejects_tampered_input(self):
        payload = {"results": [copy.deepcopy(self.run)], "errors": []}
        payload["results"][0]["score"]["total"] = 999
        status, imported = self.request("/api/import-results", {"records": [self.conversation], "payload": payload})
        self.assertEqual(status, 200)
        self.assertEqual(imported["results"][0]["score"]["total"], 77.69)
        self.assertEqual(len(imported["run_ids"]), 1)
        payload["results"][0]["audit"]["input_sha256"] = "0" * 64
        status, _ = self.request("/api/import-results", {"records": [self.conversation], "payload": payload})
        self.assertEqual(status, 400)
        self.assertEqual(self.store.list_runs(latest=False)["total"], 1)

    def test_export_routes_missing_results_as_errors(self):
        records = []
        for i in range(10):
            record = copy.deepcopy(self.conversation)
            record["conversation_id"] = f"control-{i}"
            record["channel"] = "agent chat"
            records.append(record)
        status, exported = self.request("/api/export-results", {"records": records, "payload": {"results": [], "errors": []},
                                                               "group": "prod", "team_name": "Test team"})
        self.assertEqual(status, 200)
        self.assertEqual(exported["schema_version"], "1.0")
        self.assertEqual(len(exported["results"]), 10)
        self.assertTrue(all(row["status"] == "error" and row["score"] is None for row in exported["results"]))

    def test_original_validation_and_model_failure_remain_visible(self):
        status, records = self.request("/api/import", {"payload": [self.conversation]})
        self.assertEqual(status, 200)
        self.assertEqual(records[0]["conversation_id"], self.conversation["conversation_id"])
        with patch.object(app, "score_conversation", side_effect=ModelError("Модель недоступна.")):
            status, result = self.request("/api/score", {"conversation": self.conversation, "rubric": self.run["rubric"]})
        self.assertEqual(status, 502)
        self.assertIn("недоступна", result["error"])
        self.assertEqual(self.store.list_runs()["total"], 0)

    def test_health_does_not_claim_model_is_available_and_blocks_foreign_origins(self):
        status, health = self.request("/api/health")
        self.assertEqual(status, 200)
        self.assertEqual(health["model"]["availability"], "not_checked")
        status, config = self.request("/api/config")
        self.assertEqual(status, 200)
        self.assertIn("appeals", config["features"])
        self.assertIn("rubric", config)
        status, _ = self.request("/api/config", headers={"Origin": "https://example.invalid"})
        self.assertEqual(status, 403)
        status, _ = self.request("/api/config", headers={"Host": "example.invalid"})
        self.assertEqual(status, 403)

    def test_invalid_filters_are_400(self):
        for query in ("latest=maybe", "limit=zero", "filter=unknown", "filter=all&filter=critical"):
            status, result = self.request("/api/runs?" + query)
            self.assertEqual(status, 400)
            self.assertIn("error", result)


if __name__ == "__main__":
    unittest.main()
