"""Durability, original/final separation and stale-review protection."""
import copy
import json
import sqlite3
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from engine import DEFAULT_RUBRIC, extract_records, read_json, score_conversation
from workflow import ConflictError, WorkflowStore


ANSWERS = dict(greeting="yes", needs="na", identity="na", consultation=15,
               empathy="yes", management=7, closing="no", critical="yes")


def run_fixture(answers=None, conversation=None):
    conversation = conversation or extract_records(read_json("examples/synthetic.json"))[0]
    judgments = {key: {"answer": value, "reason": "Основание из тестового диалога.",
                       "evidence": [{"start": 1, "end": 2}]} for key, value in (answers or ANSWERS).items()}
    run = score_conversation(conversation, DEFAULT_RUBRIC,
                             chat=lambda *_: {"model": "test-model", "message": {"content": json.dumps(judgments)}})
    return conversation, run


class WorkflowTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / "history.sqlite3"
        self.store = WorkflowStore(self.path)
        self.conversation, self.original = run_fixture()
        self.run_id = self.store.save_run(self.conversation, self.original)

    def tearDown(self):
        self.tmp.cleanup()

    def test_persists_after_reopen_and_recalculates_imported_score(self):
        wrong = copy.deepcopy(self.original)
        wrong["score"]["total"] = 100
        run_id = self.store.save_run(self.conversation, wrong)
        restored = WorkflowStore(self.path).get_run(run_id)
        self.assertEqual(restored["original"]["score"]["total"], 77.69)
        self.assertEqual(restored["final_score"]["total"], 77.69)

    def test_review_recalculates_without_overwriting_model(self):
        run = self.store.open_appeal(self.run_id, "closing", "Прошу проверить завершение.", 0)
        self.assertEqual(run["revision"], 1)
        appeal = run["appeals"][0]
        reviewed = self.store.decide(self.run_id, appeal["appeal_id"], "yes", "В конце есть итог и прощание.", 1)
        self.assertEqual(reviewed["final_score"]["total"], 85.38)
        self.assertEqual(reviewed["original"]["judgments"]["closing"]["answer"], "no")
        self.assertEqual(reviewed["original"]["score"]["total"], 77.69)
        self.assertEqual(reviewed["appeals"][0]["decision"]["answer"], "yes")

    def test_critical_filter_preserves_original_after_review(self):
        run = self.store.open_appeal(self.run_id, "critical", "Это цитата клиента.", 0)
        self.assertEqual(self.store.list_runs("appeal")["total"], 1)
        self.store.decide(self.run_id, run["appeals"][0]["appeal_id"], "no", "Оператор нарушения не совершал.", 1)
        self.assertEqual(self.store.list_runs("critical")["total"], 1)
        self.assertEqual(self.store.list_runs("final-critical")["total"], 0)
        self.assertEqual(self.store.list_runs("appeal")["total"], 0)

    def test_filters_select_latest_before_matching_older_flags_or_appeals(self):
        self.store.open_appeal(self.run_id, "critical", "Старая апелляция.", 0)
        conversation, newer = run_fixture({**ANSWERS, "critical": "no"})
        # Model clocks must not reorder server insertions.
        newer["audit"]["created_at"] = "2020-01-01T00:00:00+00:00"
        new_id = self.store.save_run(conversation, newer)
        self.assertEqual(self.store.list_runs()["results"][0]["run_id"], new_id)
        for name in ("critical", "final-critical", "appeal"):
            with self.subTest(filter=name):
                self.assertEqual(self.store.list_runs(name)["total"], 0)
                self.assertEqual(self.store.list_runs(name, latest=False)["total"], 1)

    def test_review_can_add_flag_and_list_its_own_explanation(self):
        conversation, original = run_fixture({**ANSWERS, "critical": "no"})
        run_id = self.store.save_run(conversation, original)
        run = self.store.open_appeal(run_id, "critical", "Пропущено предложение частной услуги.", 0)
        self.store.decide(run_id, run["appeals"][0]["appeal_id"], "yes", "Оператор предложил платную услугу в обход компании.", 1)
        report = self.store.list_runs("final-critical")["results"][0]
        self.assertFalse(report["original_critical"])
        self.assertTrue(report["final_critical"])
        self.assertEqual(report["final_critical_reasons"][0]["source"], "reviewer")
        self.assertIn("платную услугу", report["final_critical_reasons"][0]["reason"])
        self.assertEqual(report["final_critical_reasons"][0]["evidence"], [])
        self.assertTrue(report["final_critical_reasons"][0]["original_model_evidence"])

    def test_stale_revision_duplicate_and_invalid_decision_cannot_mutate(self):
        run = self.store.open_appeal(self.run_id, "closing", "Проверить.", 0)
        aid = run["appeals"][0]["appeal_id"]
        with self.assertRaises(ConflictError):
            self.store.open_appeal(self.run_id, "empathy", "Проверить.", 0)
        with self.assertRaises(ConflictError):
            self.store.open_appeal(self.run_id, "closing", "Повтор.", 1)
        with self.assertRaises(ValueError):
            self.store.decide(self.run_id, aid, True, "Причина.", 1)
        self.assertEqual(self.store.get_run(self.run_id)["revision"], 1)
        self.store.decide(self.run_id, aid, "yes", "Причина.", 1)
        with self.assertRaises(ConflictError):
            self.store.decide(self.run_id, aid, "no", "Перезапись.", 2)

    def test_concurrent_review_only_one_wins(self):
        run = self.store.open_appeal(self.run_id, "closing", "Проверить.", 0)
        aid = run["appeals"][0]["appeal_id"]
        def decide(answer):
            try:
                WorkflowStore(self.path).decide(self.run_id, aid, answer, "Причина.", 1)
                return "saved"
            except ConflictError:
                return "conflict"
        with ThreadPoolExecutor(max_workers=2) as pool:
            self.assertEqual(sorted(pool.map(decide, ("yes", "no"))), ["conflict", "saved"])

    def test_reopen_creates_new_history_entry_and_latest_filter(self):
        run = self.store.open_appeal(self.run_id, "closing", "Первая.", 0)
        self.store.decide(self.run_id, run["appeals"][0]["appeal_id"], "yes", "Согласен.", 1)
        newer = self.store.open_appeal(self.run_id, "closing", "Вторая.", 2)
        reviewed = self.store.decide(self.run_id, newer["appeals"][1]["appeal_id"], "no", "Второй пересмотр.", 3)
        self.assertEqual(len(reviewed["appeals"]), 2)
        self.assertEqual(reviewed["final_answers"]["closing"], "no")
        self.store.save_run(*run_fixture())
        self.assertEqual(self.store.list_runs()["total"], 1)
        self.assertEqual(self.store.list_runs(latest=False)["total"], 2)

    def test_reimport_keeps_existing_review_and_server_handle_is_not_identity(self):
        run = self.store.open_appeal(self.run_id, "closing", "Проверить.", 0)
        self.store.decide(self.run_id, run["appeals"][0]["appeal_id"], "yes", "Подтверждено.", 1)
        imported = copy.deepcopy(self.original)
        imported["run_id"] = "client-supplied-handle"
        same_id = self.store.save_run(self.conversation, imported)
        self.assertEqual(same_id, self.run_id)
        latest = self.store.list_runs()["results"][0]
        self.assertEqual(latest["final_score"], 85.38)
        self.assertEqual(latest["revision"], 2)
        self.assertEqual(self.store.list_runs(latest=False)["total"], 1)

    def test_read_uses_one_snapshot_even_if_review_commits_between_selects(self):
        # WAL allows a committed writer while this read snapshot remains open.
        with sqlite3.connect(self.path) as db:
            db.execute("PRAGMA journal_mode=WAL")
        db.close()
        with self.store.connection() as db:
            self.assertTrue(db.in_transaction)
            self.assertEqual(db.execute("SELECT revision FROM runs WHERE run_id=?", (self.run_id,)).fetchone()[0], 0)
            self.store.open_appeal(self.run_id, "closing", "Новая апелляция.", 0)
            old_snapshot = self.store._load(db, self.run_id)
            self.assertEqual(old_snapshot["revision"], 0)
            self.assertEqual(old_snapshot["appeals"], [])
        self.assertEqual(self.store.get_run(self.run_id)["revision"], 1)

    def test_bad_import_has_no_partial_writes(self):
        bad = copy.deepcopy(self.original)
        bad["audit"]["input_sha256"] = "0" * 64
        with self.assertRaises(ValueError):
            self.store.save_runs([self.conversation], {"results": [bad]})
        self.assertEqual(self.store.list_runs(latest=False)["total"], 1)

    def test_same_conversation_id_cannot_replace_saved_transcript(self):
        changed = copy.deepcopy(self.conversation)
        changed["transcript"].append({"timestamp": "09:00", "speaker": "client", "text": "Другая переписка."})
        _, result = run_fixture(conversation=changed)
        with self.assertRaisesRegex(ValueError, "другим содержимым"):
            self.store.save_run(changed, result)
        self.assertEqual(self.store.get_run(self.run_id)["conversation"], self.conversation)
        self.assertEqual(self.store.list_runs(latest=False)["total"], 1)

    def test_conversation_collision_rolls_back_other_imported_runs(self):
        added = copy.deepcopy(self.conversation)
        added["conversation_id"] = "new-imported-conversation"
        _, added_result = run_fixture(conversation=added)
        changed = copy.deepcopy(self.conversation)
        changed["language"] = "EN"
        _, changed_result = run_fixture(conversation=changed)
        with self.assertRaisesRegex(ValueError, "другим содержимым"):
            self.store.save_runs([added, changed], {"results": [added_result, changed_result]})
        self.assertEqual(self.store.list_runs(latest=False)["total"], 1)


if __name__ == "__main__":
    unittest.main()
