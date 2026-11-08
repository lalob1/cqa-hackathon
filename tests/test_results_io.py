import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import engine
from fixture_runs import stored_prediction
from results_io import CANONICAL_IDS, OFFICIAL_RUBRIC_SHA256, make_submission, validate_runs

ANSWERS = dict(greeting="yes", needs="na", identity="na", consultation=15,
               empathy="yes", management=7, closing="yes", critical="yes")


def conversation(cid="prod-001", channel="agent chat"):
    sample = copy.deepcopy(engine.extract_records(engine.read_json("examples/synthetic.json"))[0])
    sample["conversation_id"] = cid
    sample["channel"] = channel
    return sample


def saved_run(record, rubric=None):
    rubric = copy.deepcopy(rubric or engine.DEFAULT_RUBRIC)
    first_operator = next((n for n, turn in enumerate(record["transcript"], 1) if turn["speaker"] == "operator"), 1)
    judgments = {item["id"]: {"answer": ANSWERS.get(item["id"], "yes"),
                  "reason": "Контролируемый тест, не результат реальной модели.",
                  "evidence": [{"start": 1, "end": max(2, first_operator)}, {"start": 2, "end": 2}]}
                 for item in rubric}
    with patch.dict("os.environ", {"CQA_PROVIDER": "ollama"}):
        return stored_prediction(record, rubric, judgments)


class RunImportTests(unittest.TestCase):
    def setUp(self):
        self.record = conversation()
        self.run = saved_run(self.record)
        self.payload = {"results": [self.run], "errors": []}

    def test_scores_are_recomputed_without_mutating_source(self):
        self.run["score"] = {"total": -999}
        checked = validate_runs(self.payload, [self.record])
        self.assertEqual(checked["results"][0]["score"]["total"], 85.38)
        self.assertEqual(self.run["score"]["total"], -999)
        self.assertTrue(checked["results"][0]["score"]["flags"]["critical"])

    def test_prompt_provenance_is_required_and_consistent(self):
        missing = copy.deepcopy(self.payload)
        missing["results"][0]["audit"].pop("prompt")
        with self.assertRaisesRegex(ValueError, "промпта"):
            validate_runs(missing, [self.record])
        changed = copy.deepcopy(self.payload)
        changed["results"][0]["audit"]["prompt"] = "unrelated-prompt"
        with self.assertRaisesRegex(ValueError, "промпта"):
            validate_runs(changed, [self.record])

    def test_hash_mismatch_unknown_ids_and_duplicate_ids_are_rejected(self):
        mutations = [
            lambda p: p["results"][0]["audit"].update(input_sha256="0" * 64),
            lambda p: p["results"][0]["audit"].update(rubric_sha256="0" * 64),
            lambda p: p["results"][0].update(conversation_id="unknown"),
            lambda p: p["results"].append(copy.deepcopy(p["results"][0])),
            lambda p: p["errors"].append({"conversation_id": self.record["conversation_id"], "error": "failed"}),
            lambda p: p.update(rubric_sha256="0" * 64),
        ]
        for mutate in mutations:
            payload = copy.deepcopy(self.payload)
            mutate(payload)
            with self.subTest(payload=payload), self.assertRaises(ValueError):
                validate_runs(payload, [self.record])

    def test_evidence_type_provider_and_missing_audit_are_rejected(self):
        mutations = [
            lambda r: r["judgments"]["management"].update(answer=True),
            lambda r: r["judgments"]["greeting"]["evidence"][0].update(end=999),
            lambda r: r["audit"].update(provider="unknown"),
            lambda r: r["audit"].update(provider=[]),
            lambda r: r["audit"].update(model=""),
            lambda r: r.pop("audit"),
        ]
        for mutate in mutations:
            payload = copy.deepcopy(self.payload)
            mutate(payload["results"][0])
            with self.subTest(payload=payload), self.assertRaises(ValueError):
                validate_runs(payload, [self.record])

    def test_errors_are_retained_and_empty_import_is_rejected(self):
        checked = validate_runs({"results": [], "errors": [{"conversation_id": "prod-001", "error": "Timeout"}]}, [self.record])
        self.assertEqual(checked["results"], [])
        self.assertEqual(checked["errors"][0]["error"], "Timeout")
        with self.assertRaises(ValueError):
            validate_runs({"results": [], "errors": []}, [self.record])

    def test_custom_rubric_can_be_imported_for_live_review(self):
        rubric = [{"id": "new", "title": "Письменное подтверждение", "section": "Дополнительно",
                   "weight": 10, "type": "binary", "rule": "Предложил письменное подтверждение.", "na": None}]
        result = saved_run(self.record, rubric)
        checked = validate_runs({"results": [result]}, [self.record])
        self.assertEqual(checked["results"][0]["score"]["total"], 100)

    def test_optional_context_hash_rejects_changed_language(self):
        turns = [{"n": n, **turn} for n, turn in enumerate(self.record["transcript"], 1)]
        self.run["audit"]["context_sha256"] = engine.fingerprint({"channel": self.record["channel"],
                                                                   "language": self.record["language"],
                                                                   "messages": turns})
        record = copy.deepcopy(self.record)
        record["language"] = "EN"
        with self.assertRaises(ValueError):
            validate_runs(self.payload, [record])

    def test_optional_settings_hash_rejects_tampering(self):
        settings = {"provider": "ollama", "temperature": 0}
        self.run["audit"].update(settings=settings, settings_sha256=engine.fingerprint(settings))
        validate_runs(self.payload, [self.record])
        settings["temperature"] = 1
        with self.assertRaises(ValueError):
            validate_runs(self.payload, [self.record])

    def test_invalid_timestamp_and_nonfinite_metadata_are_rejected(self):
        for value in ("yesterday", "2026-11-07T12:00:00"):
            payload = copy.deepcopy(self.payload)
            payload["results"][0]["audit"]["created_at"] = value
            with self.subTest(value=value), self.assertRaises(ValueError):
                validate_runs(payload, [self.record])
        payload = copy.deepcopy(self.payload)
        payload["unexpected"] = float("nan")
        with self.assertRaises(ValueError):
            validate_runs(payload, [self.record])


class SubmissionTests(unittest.TestCase):
    def setUp(self):
        self.records = [conversation(f"prod-{i:03}") for i in range(1, 11)]
        self.payload = {"results": [saved_run(c) for c in self.records], "errors": []}

    def test_canonical_ids_values_and_evidence_are_exact(self):
        output = make_submission(self.payload, self.records, "prod", "Test Team")
        self.assertEqual(set(output), {"schema_version", "team_name", "model", "results"})
        self.assertEqual(output["schema_version"], "1.0")
        self.assertEqual(output["model"], {"mode": "local", "name": "unit-test-model"})
        self.assertEqual(len(output["results"]), 10)
        row = output["results"][0]
        self.assertEqual([c["criterion_id"] for c in row["criteria"]], list(CANONICAL_IDS.values()))
        values = {c["criterion_id"]: c["value"] for c in row["criteria"]}
        self.assertIs(values["contact"], True)
        self.assertIsNone(values["identification"])
        self.assertEqual(values["dialogue"], 7)
        self.assertIs(type(values["dialogue"]), int)
        self.assertEqual(row["criteria"][0]["evidence_turns"], [1, 2])
        self.assertEqual(row["score"], {"final_score": 85.38, "critical_flag": True})

    def test_failed_and_missing_results_remain_in_dataset_order(self):
        self.payload["results"] = self.payload["results"][:1]
        self.payload["errors"] = [{"conversation_id": "prod-002", "error": "Timeout"}]
        output = make_submission(self.payload, self.records, "PROD", "Test")
        self.assertEqual([r["conversation_id"] for r in output["results"]], [c["conversation_id"] for c in self.records])
        self.assertEqual(output["results"][1], {"conversation_id": "prod-002", "status": "error", "criteria": [], "score": None, "error": "Timeout"})
        self.assertEqual(output["results"][2]["status"], "error")

    def test_evidence_numbers_cover_original_bot_system_and_client_turns(self):
        record = self.records[0]
        record["transcript"] = [
            {"speaker": "system", "timestamp": "00:00", "text": "Начало диалога"},
            {"speaker": "bot", "timestamp": "00:01", "text": "Соединяю с оператором"},
            {"speaker": "client", "timestamp": "00:02", "text": "Какой тариф?"},
            {"speaker": "operator", "timestamp": "00:03", "text": "Здравствуйте, я Анна. Сейчас объясню."},
        ]
        run = saved_run(record)
        run["judgments"]["greeting"]["evidence"] = [{"start": 3, "end": 4}]
        self.payload["results"][0] = run
        output = make_submission(self.payload, self.records, "prod", "Test")
        self.assertEqual(output["results"][0]["criteria"][0]["evidence_turns"], [3, 4])

    def test_all_missing_results_have_error_not_zero(self):
        with patch.dict("os.environ", {"CQA_MODEL": "configured-test", "CQA_PROVIDER": "ollama"}):
            output = make_submission({"results": []}, self.records, "prod", "Test")
        self.assertEqual(output["model"]["name"], "configured-test")
        self.assertTrue(all(r["status"] == "error" and r["score"] is None for r in output["results"]))

    def test_control_counts_calls_and_synthetic_envelope_are_rejected(self):
        with self.assertRaises(ValueError):
            make_submission(self.payload, self.records[:9], "prod", "Test")
        calls = copy.deepcopy(self.records)
        calls[0]["channel"] = "voice call"
        with self.assertRaises(ValueError):
            make_submission(self.payload, calls, "prod", "Test")
        samples = {"isSuccess": True, "data": {"dataset_group_id": "SYNTHETIC", "records": self.records}}
        with self.assertRaises(ValueError):
            make_submission(self.payload, samples, "prod", "Test")

    def test_official_baseline_does_not_follow_modified_default_file(self):
        self.assertEqual(engine.fingerprint(engine.DEFAULT_RUBRIC), OFFICIAL_RUBRIC_SHA256)
        rubric = copy.deepcopy(engine.DEFAULT_RUBRIC)
        rubric[0]["weight"] = 11
        self.payload["results"][0] = saved_run(self.records[0], rubric)
        with patch("results_io.DEFAULT_RUBRIC", rubric), self.assertRaises(ValueError):
            make_submission(self.payload, self.records, "prod", "Test")

    def test_mixed_local_models_remain_local_not_hybrid(self):
        audit = self.payload["results"][1]["audit"]
        audit.update(provider="llamacpp", model="another-local-model")
        if "settings" in audit:
            audit["settings"].update(provider="llamacpp", model="another-local-model")
            audit["settings_sha256"] = engine.fingerprint(audit["settings"])
        output = make_submission(self.payload, self.records, "prod", "Test")
        self.assertEqual(output["model"]["mode"], "local")
        self.assertIn("another-local-model", output["model"]["name"])
        self.assertIn("unit-test-model", output["model"]["name"])

    def test_cli_writes_explicit_errors_with_nonzero_exit_code(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "predictions.json").write_text(json.dumps({"results": []}), encoding="utf-8")
            (root / "dataset.json").write_text(json.dumps(self.records), encoding="utf-8")
            target = root / "results" / "prod" / "results.json"
            result = subprocess.run([sys.executable, "results_io.py", "--input", str(root / "predictions.json"),
                                     "--dataset", str(root / "dataset.json"), "--group", "prod", "--team", "Test",
                                     "--output", str(target)], capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, 1, result.stderr)
            output = json.loads(target.read_text(encoding="utf-8"))
            self.assertTrue(all(row["status"] == "error" and row["score"] is None for row in output["results"]))

    def test_cli_refuses_overwriting_inputs_and_resolved_aliases(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            predictions, dataset = root / "predictions.json", root / "dataset.json"
            predictions.write_text(json.dumps({"results": []}), encoding="utf-8")
            dataset.write_text(json.dumps(self.records), encoding="utf-8")
            original_predictions, original_dataset = predictions.read_bytes(), dataset.read_bytes()
            (root / "alias").mkdir()
            for target in (predictions, dataset, root / "alias" / ".." / "dataset.json"):
                with self.subTest(target=target):
                    result = subprocess.run([sys.executable, "results_io.py", "--input", str(predictions),
                                             "--dataset", str(dataset), "--group", "prod", "--team", "Test",
                                             "--output", str(target)], capture_output=True, text=True, timeout=10)
                    self.assertEqual(result.returncode, 2, result.stderr)
                    self.assertIn("--output", result.stderr)
                    self.assertEqual(predictions.read_bytes(), original_predictions)
                    self.assertEqual(dataset.read_bytes(), original_dataset)

    def test_cli_temporary_file_cannot_overwrite_dataset(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            predictions = root / "predictions.json"
            # A predictable output+'.tmp' would destroy this input before the
            # final replace. Export uses a separately created unique file.
            dataset, target = root / "results.json.tmp", root / "results.json"
            predictions.write_text(json.dumps({"results": []}), encoding="utf-8")
            dataset.write_text(json.dumps(self.records), encoding="utf-8")
            original_dataset = dataset.read_bytes()
            result = subprocess.run([sys.executable, "results_io.py", "--input", str(predictions),
                                     "--dataset", str(dataset), "--group", "prod", "--team", "Test",
                                     "--output", str(target)], capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, 1, result.stderr)
            self.assertEqual(dataset.read_bytes(), original_dataset)
            self.assertEqual(len(json.loads(target.read_text(encoding="utf-8"))["results"]), 10)

    def test_edited_rubric_is_rejected_for_competition_export(self):
        rubric = copy.deepcopy(engine.DEFAULT_RUBRIC)
        rubric[0]["rule"] += " Дополнительное условие."
        self.payload["results"][0] = saved_run(self.records[0], rubric)
        with self.assertRaises(ValueError):
            make_submission(self.payload, self.records, "prod", "Test")

    def test_dev_65_contains_60_chats_and_5_calls(self):
        records = [conversation(f"dev-{i:03}", "voice call" if i > 60 else "agent chat") for i in range(1, 66)]
        with patch.dict("os.environ", {"CQA_PROVIDER": "llamacpp"}):
            output = make_submission({"results": []}, records, "dev", "Test")
        self.assertEqual(len(output["results"]), 65)


if __name__ == "__main__":
    unittest.main()
