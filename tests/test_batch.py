"""Offline regression checks: checkpoint safety and human-label diagnostics."""
import argparse
import contextlib
import copy
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import batch
import engine


ANSWERS = dict(greeting="yes", needs="na", identity="na", consultation=15,
               empathy="yes", management=7, closing="yes", critical="no")


def result_for(conversation, answers=None):
    judgments = {key: {"answer": value, "reason": "Synthetic test judgment, not a model benchmark.",
                       "evidence": [{"start": 1, "end": len(conversation["transcript"])}]}
                 for key, value in (answers or ANSWERS).items()}
    response = {"model": engine.model_name(), "message": {"content": json.dumps(judgments)}}
    return engine.score_conversation(conversation, engine.DEFAULT_RUBRIC, chat=lambda *_: copy.deepcopy(response))


class BatchTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        root = Path(self.folder.name)
        self.records = engine.extract_records(engine.read_json(engine.ROOT / "examples" / "synthetic.json"))
        self.input = root / "data.json"
        self.output = root / "run.json"
        batch.write_json(self.input, self.records)
        self.args = argparse.Namespace(input=str(self.input), output=str(self.output), rubric=None, resume=False)
        self.stdout = contextlib.redirect_stdout(io.StringIO())
        self.stdout.__enter__()
        self.addCleanup(self.stdout.__exit__, None, None, None)

    def test_interrupted_run_resumes_without_repeating_success(self):
        first = result_for(self.records[0])
        with patch.object(batch, "score_conversation", side_effect=[first, KeyboardInterrupt]):
            with self.assertRaises(KeyboardInterrupt):
                batch.run_batch(self.args)
        checkpoint = engine.read_json(self.output)
        self.assertEqual([row["conversation_id"] for row in checkpoint["results"]], [self.records[0]["conversation_id"]])
        self.args.resume = True
        with patch.object(batch, "score_conversation", side_effect=lambda row, _: result_for(row)) as score:
            self.assertEqual(batch.run_batch(self.args), 0)
        self.assertEqual(score.call_count, 2)
        self.assertEqual(len(engine.read_json(self.output)["results"]), 3)

    def test_resume_retries_failures_and_removes_old_error(self):
        with patch.object(batch, "score_conversation", side_effect=[result_for(self.records[0]), engine.ModelError("Unavailable"), result_for(self.records[2])]):
            self.assertEqual(batch.run_batch(self.args), 1)
        checkpoint = engine.read_json(self.output)
        self.assertEqual(len(checkpoint["errors"]), 1)
        self.args.resume = True
        with patch.object(batch, "score_conversation", side_effect=lambda row, _: result_for(row)) as score:
            self.assertEqual(batch.run_batch(self.args), 0)
        self.assertEqual(score.call_count, 1)
        self.assertEqual(engine.read_json(self.output)["errors"], [])

    def test_resume_rejects_changed_input_model_and_old_checkpoint(self):
        with patch.object(batch, "score_conversation", side_effect=lambda row, _: result_for(row)):
            batch.run_batch(self.args)
        self.args.resume = True
        before = self.output.read_bytes()
        with patch.dict("os.environ", {"CQA_MODEL": "a-different-local-model"}):
            with self.assertRaisesRegex(ValueError, "Cannot resume"):
                batch.run_batch(self.args)
        changed = copy.deepcopy(self.records)
        changed[0]["transcript"][0]["text"] += " New input"
        batch.write_json(self.input, changed)
        with self.assertRaisesRegex(ValueError, "Cannot resume"):
            batch.run_batch(self.args)
        self.assertEqual(self.output.read_bytes(), before)
        batch.write_json(self.input, self.records)
        batch.write_json(self.output, {"results": [], "errors": []})
        with self.assertRaisesRegex(ValueError, "no resume manifest"):
            batch.run_batch(self.args)

    def test_resume_recalculates_total_but_rejects_tampered_judgment_or_duplicate_id(self):
        with patch.object(batch, "score_conversation", side_effect=lambda row, _: result_for(row)):
            batch.run_batch(self.args)
        checkpoint = engine.read_json(self.output)
        checkpoint["results"][0]["score"]["total"] = -999
        batch.write_json(self.output, checkpoint)
        self.args.resume = True
        with patch.object(batch, "score_conversation") as score:
            self.assertEqual(batch.run_batch(self.args), 0)
            score.assert_not_called()
        self.assertEqual(engine.read_json(self.output)["results"][0]["score"]["total"], 85.38)
        checkpoint = engine.read_json(self.output)
        checkpoint["results"][0]["judgments"]["management"]["answer"] = 5
        batch.write_json(self.output, checkpoint)
        with self.assertRaises(ValueError):
            batch.run_batch(self.args)
        checkpoint["results"][0] = result_for(self.records[0])
        checkpoint["results"].append(copy.deepcopy(checkpoint["results"][0]))
        batch.write_json(self.output, checkpoint)
        with self.assertRaises(ValueError):
            batch.run_batch(self.args)

    def test_resume_requires_importable_audit_model_timestamp_and_settings(self):
        with patch.object(batch, "score_conversation", side_effect=lambda row, _: result_for(row)):
            batch.run_batch(self.args)
        original = engine.read_json(self.output)
        self.args.resume = True
        for key, value in (("model", ""), ("created_at", "2026-11-07"), ("settings", {"wrong": True})):
            checkpoint = copy.deepcopy(original)
            checkpoint["results"][0]["audit"][key] = value
            batch.write_json(self.output, checkpoint)
            with self.assertRaises(ValueError):
                batch.run_batch(self.args)
        checkpoint = copy.deepcopy(original)
        checkpoint["results"][0]["conversation_id"] = ["unhashable"]
        batch.write_json(self.output, checkpoint)
        with self.assertRaises(ValueError):
            batch.run_batch(self.args)

    def test_output_cannot_overwrite_source(self):
        self.args.output = str(self.input)
        with self.assertRaisesRegex(ValueError, "different files"):
            batch.run_batch(self.args)

    def test_diagnostics_report_coverage_confusion_critical_and_review_queue(self):
        rows = [result_for(self.records[0], {**ANSWERS, "critical": "yes", "consultation": 10}),
                result_for(self.records[1], {**ANSWERS, "needs": "no"})]
        labels = {row["conversation_id"]: dict(ANSWERS) for row in self.records}
        report = batch.compare(rows, labels, engine.DEFAULT_RUBRIC, self.records)
        self.assertEqual(report["coverage"], 2 / 3)
        self.assertEqual(report["missing_ids"], [self.records[2]["conversation_id"]])
        self.assertEqual(report["criteria"]["needs"]["confusion_matrix"]["na"]["no"], 1)
        critical = report["criteria"]["critical"]["detection"]
        self.assertEqual(critical["false_positive"], 1)
        self.assertEqual(critical["precision"], 0)
        self.assertIsNone(critical["recall"])
        self.assertTrue(report["review_queue"][0]["critical_mismatch"])
        self.assertEqual(report["breakdowns"]["language"]["EN"]["matched"], 0)
        self.assertIsNone(report["breakdowns"]["language"]["EN"]["total_mae"])

    def test_diagnostics_dont_trust_saved_score_and_undefined_metrics_stay_null(self):
        row = result_for(self.records[0])
        row["score"]["total"] = -999
        report = batch.compare([row], {row["conversation_id"]: dict(ANSWERS)}, engine.DEFAULT_RUBRIC)
        self.assertEqual(report["total_mae"], 0)
        self.assertIsNone(report["criteria"]["critical"]["detection"]["precision"])
        self.assertIsNone(report["criteria"]["critical"]["detection"]["recall"])
        self.assertEqual(report["review_queue"], [])
        empty = batch.compare([], {row["conversation_id"]: dict(ANSWERS)}, engine.DEFAULT_RUBRIC)
        self.assertIsNone(empty["total_mae"])
        self.assertIsNone(empty["criterion_exact_rate"])
        self.assertEqual(empty["coverage"], 0)

    def test_dataset_protects_evidence_and_input_identity(self):
        row = result_for(self.records[0])
        altered = copy.deepcopy(self.records)
        altered[0]["transcript"][0]["text"] += " changed"
        with self.assertRaisesRegex(ValueError, "transcript differs"):
            batch.compare([row], {row["conversation_id"]: dict(ANSWERS)}, engine.DEFAULT_RUBRIC, altered)
        row["judgments"]["greeting"]["evidence"][0]["end"] = 500
        with self.assertRaises(ValueError):
            batch.compare([row], {row["conversation_id"]: dict(ANSWERS)}, engine.DEFAULT_RUBRIC, self.records)


if __name__ == "__main__":
    unittest.main()
