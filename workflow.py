"""Local, durable run history and append-only appeal decisions (stdlib SQLite).

This is a single-machine demo workflow, not an authenticated multi-user service.
Model judgments are immutable snapshots; reviews never overwrite them.
"""
import argparse
import json
import os
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from engine import ROOT, calculate, filled, fingerprint, read_json, require, valid_answer
from results_io import validate_runs


class ConflictError(ValueError):
    """An appeal or decision used an obsolete revision."""


def now():
    return datetime.now(timezone.utc).isoformat()


def encoded(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False)


class WorkflowStore:
    def __init__(self, path=None):
        self.path = Path(path or os.environ.get("CQA_DB", str(ROOT / "data" / "cqa.sqlite3")))
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connection() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS runs (
                    seq INTEGER PRIMARY KEY AUTOINCREMENT,
                    run_id TEXT NOT NULL UNIQUE,
                    conversation_id TEXT NOT NULL,
                    conversation_json TEXT NOT NULL,
                    result_json TEXT NOT NULL,
                    content_sha256 TEXT,
                    stored_at TEXT NOT NULL,
                    revision INTEGER NOT NULL DEFAULT 0
                );
                CREATE INDEX IF NOT EXISTS runs_conversation ON runs(conversation_id, seq);
                CREATE TABLE IF NOT EXISTS appeals (
                    seq INTEGER PRIMARY KEY AUTOINCREMENT,
                    appeal_id TEXT NOT NULL UNIQUE,
                    run_id TEXT NOT NULL REFERENCES runs(run_id),
                    criterion_id TEXT NOT NULL,
                    message TEXT NOT NULL,
                    opened_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS decisions (
                    seq INTEGER PRIMARY KEY AUTOINCREMENT,
                    appeal_id TEXT NOT NULL UNIQUE REFERENCES appeals(appeal_id),
                    answer_json TEXT NOT NULL,
                    reason TEXT NOT NULL,
                    reviewer TEXT NOT NULL,
                    decided_at TEXT NOT NULL
                );
            """)
            # Preserve databases created before idempotent imports were added.
            columns = {row["name"] for row in db.execute("PRAGMA table_info(runs)")}
            if "content_sha256" not in columns:
                db.execute("ALTER TABLE runs ADD COLUMN content_sha256 TEXT")
            for row in db.execute("SELECT seq,conversation_json,result_json FROM runs WHERE content_sha256 IS NULL").fetchall():
                result = json.loads(row["result_json"])
                result.pop("run_id", None)
                digest = fingerprint({"conversation": json.loads(row["conversation_json"]), "original": result})
                db.execute("UPDATE runs SET content_sha256=? WHERE seq=?", (digest, row["seq"]))
            db.execute("CREATE INDEX IF NOT EXISTS runs_content ON runs(content_sha256)")

    @contextmanager
    def connection(self, write=False):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys = ON")
        try:
            db.execute("BEGIN IMMEDIATE" if write else "BEGIN")
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

    def save_run(self, conversation, result):
        return self.save_runs([conversation], {"results": [result], "errors": []})[0]

    def save_runs(self, records, payload):
        validated = validate_runs(payload, records)
        by_id = {record["conversation_id"]: record for record in records}
        ids = []
        # The whole import succeeds or rolls back; it does not leave half an import.
        with self.connection(write=True) as db:
            for result in validated["results"]:
                cid = result["conversation_id"]
                # The browser identifies a conversation by ID across all runs.
                # A different transcript under that ID would make history
                # restoration ambiguous; reject the whole import atomically.
                prior = db.execute("SELECT conversation_json FROM runs WHERE conversation_id=? LIMIT 1", (cid,)).fetchone()
                require(prior is None or json.loads(prior["conversation_json"]) == by_id[cid],
                        f"{cid}: этот ID уже сохранён с другим содержимым диалога.")
                # run_id is a server handle, not part of the original model response.
                result.pop("run_id", None)
                digest = fingerprint({"conversation": by_id[cid], "original": result})
                existing = db.execute("SELECT run_id FROM runs WHERE content_sha256=? ORDER BY revision DESC,seq DESC LIMIT 1",
                                      (digest,)).fetchone()
                if existing:
                    ids.append(existing["run_id"])
                    continue
                run_id = uuid.uuid4().hex
                db.execute("INSERT INTO runs(run_id,conversation_id,conversation_json,result_json,content_sha256,stored_at) VALUES (?,?,?,?,?,?)",
                           (run_id, cid, encoded(by_id[cid]), encoded(result), digest, now()))
                ids.append(run_id)
        return ids

    @staticmethod
    def _load(db, run_id):
        require(filled(run_id, 100), "Укажите run_id.")
        row = db.execute("SELECT * FROM runs WHERE run_id=?", (run_id,)).fetchone()
        require(row is not None, "Запуск не найден.")
        original = json.loads(row["result_json"])
        answers = {key: item["answer"] for key, item in original["judgments"].items()}
        appeals = []
        for appeal in db.execute("""SELECT a.*,d.answer_json,d.reason,d.reviewer,d.decided_at
                FROM appeals a LEFT JOIN decisions d ON a.appeal_id=d.appeal_id
                WHERE a.run_id=? ORDER BY a.seq""", (run_id,)):
            item = {key: appeal[key] for key in ("appeal_id", "criterion_id", "message", "opened_at")}
            item["status"] = "decided" if appeal["decided_at"] else "open"
            item["decision"] = None
            if appeal["decided_at"]:
                answer = json.loads(appeal["answer_json"])
                answers[appeal["criterion_id"]] = answer
                item["decision"] = {"answer": answer, "reason": appeal["reason"],
                                    "reviewer": appeal["reviewer"], "decided_at": appeal["decided_at"]}
            appeals.append(item)
        return {"run_id": run_id, "conversation": json.loads(row["conversation_json"]),
                "original": original, "appeals": appeals, "final_answers": answers,
                "final_score": calculate(original["rubric"], answers, allow_partial=original.get("status") == "needs_review"),
                "revision": row["revision"],
                "stored_at": row["stored_at"]}

    def get_run(self, run_id):
        with self.connection() as db:
            return self._load(db, run_id)

    @staticmethod
    def _check_revision(run, expected_revision):
        require(type(expected_revision) is int and expected_revision >= 0, "Укажите expected_revision из текущего запуска.")
        if run["revision"] != expected_revision:
            raise ConflictError("Запуск уже изменился. Обновите данные перед сохранением решения.")

    def open_appeal(self, run_id, criterion_id, message, expected_revision):
        require(filled(message, 1000), "Добавьте комментарий к апелляции (до 1000 символов).")
        with self.connection(write=True) as db:
            run = self._load(db, run_id)
            self._check_revision(run, expected_revision)
            require(isinstance(criterion_id, str) and criterion_id in run["original"]["judgments"], "Неизвестный критерий.")
            if any(a["criterion_id"] == criterion_id and a["status"] == "open" for a in run["appeals"]):
                raise ConflictError("По этому критерию уже есть открытая апелляция.")
            db.execute("INSERT INTO appeals(appeal_id,run_id,criterion_id,message,opened_at) VALUES (?,?,?,?,?)",
                       (uuid.uuid4().hex, run_id, criterion_id, message.strip(), now()))
            db.execute("UPDATE runs SET revision=revision+1 WHERE run_id=?", (run_id,))
            return self._load(db, run_id)

    def decide(self, run_id, appeal_id, answer, reason, expected_revision, reviewer="Проверяющий"):
        require(filled(reason, 1000), "Укажите основание решения (до 1000 символов).")
        require(filled(reviewer, 160), "Укажите имя или роль проверяющего.")
        require(filled(appeal_id, 100), "Укажите appeal_id.")
        with self.connection(write=True) as db:
            run = self._load(db, run_id)
            self._check_revision(run, expected_revision)
            appeal = next((a for a in run["appeals"] if a["appeal_id"] == appeal_id), None)
            require(appeal is not None, "Апелляция не найдена в этом запуске.")
            if appeal["status"] != "open":
                raise ConflictError("Решение уже сохранено. Для пересмотра откройте новую апелляцию.")
            criterion = next(item for item in run["original"]["rubric"] if item["id"] == appeal["criterion_id"])
            require(valid_answer(answer, criterion), "Недопустимая оценка для критерия.")
            db.execute("INSERT INTO decisions(appeal_id,answer_json,reason,reviewer,decided_at) VALUES (?,?,?,?,?)",
                       (appeal_id, encoded(answer), reason.strip(), reviewer.strip(), now()))
            db.execute("UPDATE runs SET revision=revision+1 WHERE run_id=?", (run_id,))
            return self._load(db, run_id)

    def list_runs(self, filter_name="all", conversation_id=None, latest=True, limit=100, offset=0):
        require(filter_name in ("all", "critical", "final-critical", "appeal", "needs-review"), "Неизвестный фильтр запусков.")
        require(type(latest) is bool, "latest должен быть true или false.")
        require(type(limit) is int and 1 <= limit <= 500 and type(offset) is int and offset >= 0, "Неверные limit/offset.")
        require(conversation_id is None or filled(conversation_id, 200), "Неверный conversation_id.")
        with self.connection() as db:
            query = "SELECT run_id FROM runs"
            conditions, args = [], []
            if latest:
                conditions.append("seq IN (SELECT MAX(seq) FROM runs GROUP BY conversation_id)")
            if conversation_id is not None:
                conditions.append("conversation_id=?")
                args.append(conversation_id)
            if conditions:
                query += " WHERE " + " AND ".join(conditions)
            query += " ORDER BY seq DESC"
            summaries = []
            for row in db.execute(query, args).fetchall():
                run = self._load(db, row["run_id"])
                original = run["original"]
                status = original.get("status", "complete")
                original_flag = any(original["score"]["flags"].values())
                final_flag = any(run["final_score"]["flags"].values())
                pending = sum(a["status"] == "open" for a in run["appeals"])
                if filter_name == "critical" and not original_flag:
                    continue
                if filter_name == "final-critical" and not final_flag:
                    continue
                if filter_name == "appeal" and not pending:
                    continue
                if filter_name == "needs-review" and status != "needs_review":
                    continue
                flags = [{"criterion_id": item["id"], "reason": original["judgments"][item["id"]]["reason"],
                          "evidence": original["judgments"][item["id"]]["evidence"]}
                         for item in original["rubric"] if item["type"] == "flag"
                         and original["judgments"].get(item["id"], {}).get("answer") == "yes"]
                final_flags = []
                for item in original["rubric"]:
                    key = item["id"]
                    if item["type"] != "flag" or run["final_answers"].get(key) != "yes":
                        continue
                    decision = next((a["decision"] for a in reversed(run["appeals"])
                                     if a["criterion_id"] == key and a["decision"]), None)
                    final_flags.append({"criterion_id": key,
                                        "reason": decision["reason"] if decision else original["judgments"][key]["reason"],
                                        "source": "reviewer" if decision else "model",
                                        # Model spans remain context, not a reviewer's new proof.
                                        "evidence": [] if decision else original["judgments"][key]["evidence"],
                                        "original_model_evidence": original["judgments"][key]["evidence"]})
                summaries.append({"run_id": run["run_id"], "conversation_id": original["conversation_id"],
                                  "status": status,
                                  "language": run["conversation"]["language"], "channel": run["conversation"]["channel"],
                                  "original_score": original["score"]["total"], "final_score": run["final_score"]["total"],
                                  "original_critical": original_flag, "final_critical": final_flag,
                                  "critical_reasons": flags, "final_critical_reasons": final_flags,
                                  "open_appeals": pending, "revision": run["revision"],
                                  "rubric_sha256": original["audit"]["rubric_sha256"], "stored_at": run["stored_at"]})
        return {"total": len(summaries), "offset": offset, "limit": limit,
                "results": summaries[offset:offset + limit]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--db", help="Default: data/cqa.sqlite3 or CQA_DB")
    commands = parser.add_subparsers(dest="command", required=True)
    imp = commands.add_parser("import")
    imp.add_argument("--input", required=True)
    imp.add_argument("--dataset", required=True)
    listing = commands.add_parser("list")
    listing.add_argument("--filter", default="all", choices=("all", "critical", "final-critical", "appeal", "needs-review"))
    listing.add_argument("--all-runs", action="store_true")
    listing.add_argument("--limit", type=int, default=100)
    listing.add_argument("--offset", type=int, default=0)
    show = commands.add_parser("show")
    show.add_argument("run_id")
    appeal = commands.add_parser("appeal")
    appeal.add_argument("run_id")
    appeal.add_argument("criterion_id")
    appeal.add_argument("--message", required=True)
    appeal.add_argument("--revision", type=int, required=True)
    decide = commands.add_parser("decide")
    decide.add_argument("run_id")
    decide.add_argument("appeal_id")
    decide.add_argument("--answer", required=True, help='JSON value: "yes", "no", "na" or number')
    decide.add_argument("--reason", required=True)
    decide.add_argument("--reviewer", default="Проверяющий")
    decide.add_argument("--revision", type=int, required=True)
    args = parser.parse_args()
    try:
        store = WorkflowStore(args.db)
        if args.command == "import":
            from engine import extract_records
            payload = read_json(args.input)
            records = extract_records(read_json(args.dataset))
            ids = store.save_runs(records, payload)
            result = {"run_ids": ids, "errors": payload.get("errors", [])}
        elif args.command == "list":
            result = store.list_runs(args.filter, latest=not args.all_runs, limit=args.limit, offset=args.offset)
        elif args.command == "show":
            result = store.get_run(args.run_id)
        elif args.command == "appeal":
            result = store.open_appeal(args.run_id, args.criterion_id, args.message, args.revision)
        else:
            result = store.decide(args.run_id, args.appeal_id, json.loads(args.answer), args.reason, args.revision, args.reviewer)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 1 if result.get("errors") else 0
    except (OSError, sqlite3.Error, ValueError) as error:
        parser.exit(2, f"Error: {error}\n")


if __name__ == "__main__":
    raise SystemExit(main())
