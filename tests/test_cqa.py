import copy
import io
import json
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch

from batch import compare, reserve_checkpoint, run_batch, submission_payload, write_json
from engine import (DEFAULT_RUBRIC, ModelError, calculate, extract_records, fingerprint, local_json_post, model_transcript, numbered_turns, read_json,
                    score_conversation, validate_batch_results, validate_rubric)

SAMPLE = read_json("examples/synthetic.json")
ANSWERS = dict(greeting="yes", needs="na", identity="na", consultation=15,
               empathy="yes", management=7, closing="no", critical="yes")


class ChecklistTests(unittest.TestCase):
    def test_weights_na_scale_and_separate_flag(self):
        result = calculate(DEFAULT_RUBRIC, ANSWERS)
        self.assertEqual(result["total"], 77.69)
        self.assertEqual(result["criteria"]["management"], {"effective_weight": 23.08, "points": 16.15})
        self.assertIsNone(result["criteria"]["identity"]["points"])
        self.assertEqual(result["flags"], {"critical": True})
        self.assertEqual(len(result["sections"]), 3)

    def test_review_uses_same_calculation(self):
        self.assertEqual(calculate(DEFAULT_RUBRIC, {**ANSWERS, "closing": "yes"})["total"], 85.38)

    def test_all_weight_na(self):
        item = next(row for row in DEFAULT_RUBRIC if row["id"] == "needs")
        self.assertIsNone(calculate([item], {"needs": "na"})["total"])

    def test_illegal_answers_and_changed_rubric(self):
        for illegal in ({"management": 5}, {"greeting": "na"}, {"consultation": True}):
            with self.assertRaises(ValueError):
                calculate(DEFAULT_RUBRIC, {**ANSWERS, **illegal})
        replacement = {"id": "new", "title": "Новый критерий", "weight": 5, "type": "binary",
                       "rule": "Оператор предложил письменное подтверждение."}
        self.assertEqual(calculate(validate_rubric([replacement]), {"new": "yes"})["total"], 100.0)

    def test_import_has_language_roles_and_ids(self):
        records = extract_records(SAMPLE)
        self.assertEqual({row["language"] for row in records}, {"RU", "KZ", "EN"})
        with self.assertRaises(ValueError):
            extract_records([records[0], records[0]])
        with self.assertRaises(ValueError):
            extract_records({"isSuccess": False, "data": SAMPLE["data"]})

    def test_fresh_transcript_and_repaired_evidence(self):
        records = extract_records(SAMPLE)
        sample = records[0]
        calls = []
        judgments = {key: {"answer": str(value), "reason": "Проверено.", "evidence": [{"start": 1, "end": 2}]}
                     for key, value in ANSWERS.items()}

        def chat(messages, schema):
            calls.append(json.loads(messages[1]["content"]))
            self.assertIn(set(schema["required"]), (set(ANSWERS), {"greeting"}))
            if "consultation" in schema["properties"]:
                consultation = schema["properties"]["consultation"]
                self.assertEqual(consultation["required"], ["evidence", "reason", "answer"])
                self.assertEqual(consultation["properties"]["answer"]["enum"], ["0", "5", "10", "15", "20", "na"])
            self.assertNotIn("conversation_id", calls[-1])
            bad = copy.deepcopy(judgments)
            bad["greeting"]["evidence"][0]["end"] = 100
            value = bad if len(calls) == 1 else judgments
            return {"message": {"content": json.dumps({key: value[key] for key in schema['required']})}, "prompt_eval_count": 100, "eval_count": 30}

        result = score_conversation(sample, DEFAULT_RUBRIC, chat)
        changed = copy.deepcopy(sample)
        changed["transcript"][0]["text"] += " Другая реплика."
        newer = score_conversation(changed, DEFAULT_RUBRIC, chat)
        self.assertEqual(result["audit"]["attempts"], 2)
        self.assertEqual(result["audit"]["prompt_tokens"], 200)
        self.assertNotEqual(newer["audit"]["input_sha256"], result["audit"]["input_sha256"])
        self.assertNotEqual(calls[0]["messages"][0][3], calls[-1]["messages"][0][3])
        self.assertEqual(result["score"]["total"], 77.69)
        self.assertIs(type(result["judgments"]["consultation"]["answer"]), int)
        labels = {**ANSWERS, "closing": "yes", "needs": "yes", "consultation": "na"}
        metrics = compare([result], {sample["conversation_id"]: labels, "missing": ANSWERS}, DEFAULT_RUBRIC)
        self.assertEqual(metrics["total_mae"], 14.81)
        self.assertEqual(metrics["missing_ids"], ["missing"])
        self.assertEqual(metrics["criteria"]["closing"]["exact_rate"], 0)
        self.assertEqual(metrics["criteria"]["needs"]["false_na"], 1)
        self.assertEqual(metrics["criteria"]["consultation"]["missed_na"], 1)

    def test_model_failure_is_visible(self):
        with self.assertRaises(ModelError):
            score_conversation(extract_records(SAMPLE)[0], DEFAULT_RUBRIC, lambda *_: {"message": {"content": "{}"}})

    def test_model_timeout_is_configurable(self):
        with patch.dict("os.environ", {"CQA_TIMEOUT_SECONDS": "420"}), patch("engine.build_opener") as opener:
            send = opener.return_value.open
            send.side_effect = TimeoutError
            with self.assertRaises(ModelError):
                local_json_post("http://127.0.0.1:8080", "/score", {}, "Test")
            self.assertEqual(send.call_args.kwargs["timeout"], 420)

    def test_resume_retries_only_failed_records_and_checks_provenance(self):
        records = extract_records(SAMPLE)
        ids = [record["conversation_id"] for record in records]
        with TemporaryDirectory(dir=".") as scratch, redirect_stdout(io.StringIO()):
            input_path = Path(scratch) / "input.json"
            output_path = Path(scratch) / "out.json"
            write_json(input_path, records)
            args = SimpleNamespace(input=input_path, output=output_path, rubric=None, resume=False,
                                   expect_count=3, model_revision="model-test")
            from test_batch import result_for
            import os
            os.environ["CQA_MODEL_REVISION"] = args.model_revision
            self.addCleanup(os.environ.pop, "CQA_MODEL_REVISION", None)
            first, second, third = (result_for(record) for record in records)
            with patch("batch.score_conversation", side_effect=[first, ModelError("unavailable"), third]):
                self.assertEqual(run_batch(args), 1)
            self.assertEqual(read_json(output_path)["errors"][0]["conversation_id"], ids[1])
            args.resume = True
            with patch("batch.score_conversation", return_value=second) as score:
                self.assertEqual(run_batch(args), 0)
                score.assert_called_once_with(records[1], DEFAULT_RUBRIC)
            checkpoint = read_json(output_path)
            self.assertEqual({row["conversation_id"] for row in checkpoint["results"]}, set(ids))
            self.assertEqual(checkpoint["errors"], [])
            args.model_revision = "changed"
            with self.assertRaisesRegex(ValueError, "Cannot resume"):
                run_batch(args)
            args.expect_count = 10
            with self.assertRaisesRegex(ValueError, "Expected 10"):
                run_batch(args)
            self.assertEqual(read_json(output_path), checkpoint)

    def test_batch_checkpoint_has_one_writer(self):
        with TemporaryDirectory(dir=".") as scratch:
            output = Path(scratch) / "out.json"
            with reserve_checkpoint(output), self.assertRaisesRegex(ValueError, "Another batch"):
                with reserve_checkpoint(output):
                    self.fail("A second writer acquired the lock")
            with reserve_checkpoint(output):
                pass

    def test_batch_import_checks_transcript_scores_and_evidence(self):
        sample = extract_records(SAMPLE)[0]
        judgments = {key: {"answer": str(value), "reason": "Проверено.", "evidence": [{"start": 1, "end": 2}]}
                     for key, value in ANSWERS.items()}
        result = score_conversation(sample, DEFAULT_RUBRIC, lambda *_: {"message": {"content": json.dumps(judgments)}})
        payload = {"results": [result], "errors": [{"conversation_id": "incomplete"}]}
        self.assertEqual(validate_batch_results(payload, [sample]), {"results": [result], "failed": 1})
        changed = copy.deepcopy(sample)
        changed["transcript"][0]["text"] += " Дополнение."
        with self.assertRaisesRegex(ValueError, "хеш"):
            validate_batch_results(payload, [changed])
        invalid = copy.deepcopy(payload)
        invalid["results"][0]["score"]["total"] = 100
        with self.assertRaisesRegex(ValueError, "баллы"):
            validate_batch_results(invalid, [sample])
        invalid = copy.deepcopy(payload)
        invalid["results"][0]["judgments"]["greeting"]["evidence"][0]["end"] = 99
        with self.assertRaisesRegex(ValueError, "пределы"):
            validate_batch_results(invalid, [sample])

    def test_compact_call_keeps_turns_and_original_source_times(self):
        turns = numbered_turns({"transcript": [
            {"timestamp": "2026-11-07T12:00:00Z", "speaker": "client", "text": "Question"},
            {"timestamp": "2026-11-07T17:00:07.500+05:00", "speaker": "operator", "text": "Answer"},
        ]})
        kind, rows = model_transcript(turns, "voice call")
        self.assertEqual(kind, "elapsed seconds since turn 1")
        self.assertEqual(rows, [[1, 0, "client", "Question"], [2, 7.5, "operator", "Answer"]])
        self.assertEqual(turns[0]["timestamp"], "2026-11-07T12:00:00Z")
        kind, rows = model_transcript(list(reversed(turns)), "voice call")
        self.assertEqual(kind, "source timestamps")
        self.assertEqual(rows[0][1], "2026-11-07T17:00:07.500+05:00")

    def test_official_export_preserves_ids_types_and_error_rows(self):
        example = extract_records(SAMPLE)[0]
        answers = {**ANSWERS, "closing": "yes", "critical": "no"}
        judgments = {key: {"answer": str(value), "reason": "Проверено.", "evidence": [{"start": 1, "end": 2}, {"start": 2, "end": 3}]}
                     for key, value in answers.items()}
        judgments['closing']['evidence'] = [{'start': 4, 'end': 4}]
        template = score_conversation(example, DEFAULT_RUBRIC, lambda *_: {"message": {"content": json.dumps(judgments)}})
        records = [{**example, "conversation_id": f"synthetic-{n:02d}"} for n in range(10)]
        checkpoint = {
            "run": {"dataset_sha256": fingerprint(records), "record_count": 10, "rubric_sha256": fingerprint(DEFAULT_RUBRIC),
                    "provider": template["audit"]["provider"], "model": template["audit"]["model"], "prompt": template["audit"]["prompt"]},
            "results": [{**template, "conversation_id": record["conversation_id"]} for record in records[:-1]],
            "errors": [{"conversation_id": records[-1]["conversation_id"], "error": "Model unavailable."}],
        }
        exported = submission_payload(records, checkpoint, "Example Team", "prod")
        self.assertEqual(set(exported), {"schema_version", "team_name", "model", "results"})
        self.assertEqual(exported["schema_version"], "1.0")
        self.assertEqual([row["conversation_id"] for row in exported["results"]], [r["conversation_id"] for r in records])
        first = exported["results"][0]
        self.assertEqual([row["criterion_id"] for row in first["criteria"]],
                         ["contact", "discovery", "identification", "consultation", "empathy", "dialogue", "closure", "critical"])
        self.assertEqual([row["value"] for row in first["criteria"]], [True, None, None, 15, True, 7, True, False])
        self.assertIs(first["criteria"][0]["value"], True)
        self.assertIs(type(first["criteria"][3]["value"]), int)
        self.assertEqual(first["criteria"][0]["evidence_turns"], [1, 2, 3])
        self.assertEqual(first["score"], {"final_score": 85.38, "critical_flag": False})
        self.assertEqual(exported["results"][-1], {"conversation_id": records[-1]["conversation_id"], "status": "error",
                                                   "criteria": [], "score": None, "error": "Model unavailable."})
        incomplete = submission_payload(records, {**checkpoint, "errors": []}, "Example Team", "prod")
        self.assertEqual(incomplete["results"][-1]["status"], "error")
        with self.assertRaisesRegex(ValueError, "65"):
            submission_payload(records, checkpoint, "Example Team", "dev")


if __name__ == "__main__":
    unittest.main()
