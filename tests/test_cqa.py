import copy
import io
import json
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch

from batch import compare, reserve_checkpoint, run_batch, write_json
from engine import (DEFAULT_RUBRIC, ModelError, calculate, extract_records, local_json_post, model_transcript, numbered_turns, read_json,
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
            self.assertEqual(set(schema["required"]), set(ANSWERS))
            consultation = schema["properties"]["consultation"]
            self.assertEqual(consultation["required"], ["evidence", "reason", "answer"])
            self.assertEqual(consultation["properties"]["answer"]["enum"], ["0", "5", "10", "15", "20", "na"])
            self.assertNotIn("conversation_id", calls[-1])
            bad = copy.deepcopy(judgments)
            bad["greeting"]["evidence"][0]["end"] = 100
            value = bad if len(calls) == 1 else judgments
            return {"message": {"content": json.dumps(value)}, "prompt_eval_count": 100, "eval_count": 30}

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
        with patch.dict("os.environ", {"CQA_TIMEOUT_SECONDS": "420"}), patch("engine.urlopen", side_effect=TimeoutError) as send:
            with self.assertRaisesRegex(ModelError, "420"):
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
            first, second, third = ({"conversation_id": cid} for cid in ids)
            with patch("batch.score_conversation", side_effect=[first, ModelError("unavailable"), third]):
                self.assertEqual(run_batch(args), 1)
            self.assertEqual(read_json(output_path)["errors"][0]["conversation_id"], ids[1])
            args.resume = True
            with patch("batch.score_conversation", return_value=second) as score:
                self.assertEqual(run_batch(args), 0)
                score.assert_called_once_with(records[1], DEFAULT_RUBRIC)
            checkpoint = read_json(output_path)
            self.assertEqual(checkpoint["results"], [first, second, third])
            self.assertEqual(checkpoint["errors"], [])
            args.model_revision = "changed"
            with self.assertRaisesRegex(ValueError, "provenance differs"):
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


if __name__ == "__main__":
    unittest.main()
