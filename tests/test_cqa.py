import copy
import json
import unittest

from batch import compare
from engine import DEFAULT_RUBRIC, ModelError, calculate, extract_records, read_json, score_conversation, validate_rubric

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
        judgments = {key: {"answer": value, "reason": "Проверено.", "evidence": [{"start": 1, "end": 2}]}
                     for key, value in ANSWERS.items()}

        def chat(messages, schema):
            calls.append(json.loads(messages[1]["content"]))
            self.assertEqual(set(schema["required"]), set(ANSWERS))
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
        self.assertNotEqual(calls[0]["messages"][0]["text"], calls[-1]["messages"][0]["text"])
        self.assertEqual(result["score"]["total"], 77.69)
        metrics = compare([result], {sample["conversation_id"]: {**ANSWERS, "closing": "yes"}, "missing": ANSWERS}, DEFAULT_RUBRIC)
        self.assertEqual(metrics["total_mae"], 7.69)
        self.assertEqual(metrics["missing_ids"], ["missing"])
        self.assertEqual(metrics["criteria"]["closing"]["exact_rate"], 0)

    def test_model_failure_is_visible(self):
        with self.assertRaises(ModelError):
            score_conversation(extract_records(SAMPLE)[0], DEFAULT_RUBRIC, lambda *_: {"message": {"content": "{}"}})


if __name__ == "__main__":
    unittest.main()
