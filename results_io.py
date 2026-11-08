"""Validate saved runs for the UI and export the competition's JSON 1.0 format.

Hashes establish input/rubric consistency, not proof of model authorship.
"""
import argparse
import copy
import json
import re
import tempfile
from datetime import datetime
from pathlib import Path

from engine import (DEFAULT_RUBRIC, calculate, extract_records, filled,
                    fingerprint, model_name, provider_name, read_json,
                    require, validate_assessment, validate_operator_evidence, validate_rubric)

CANONICAL_IDS = {
    "greeting": "contact", "needs": "discovery", "identity": "identification",
    "consultation": "consultation", "empathy": "empathy",
    "management": "dialogue", "closing": "closure", "critical": "critical",
}
LOCAL_PROVIDERS = {"ollama", "llamacpp"}
# Freeze the checked-in official configuration. Editing rubric.json later must
# not quietly redefine the baseline used by the competition export.
OFFICIAL_RUBRIC_SHA256 = "1512da5566676ca1ff7b815639efaa2d0235c7a3c0eb3f7288d74bdc1bab096f"


def _timestamp(value):
    require(filled(value, 100), "Нужна дата запуска с часовым поясом.")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        raise ValueError("Неверная дата запуска в audit.created_at.") from None
    require(parsed.utcoffset() is not None, "В дате запуска отсутствует часовой пояс.")


def _numbered_turns(conversation):
    return [{"n": n, "timestamp": t["timestamp"], "speaker": t["speaker"], "text": t["text"]}
            for n, t in enumerate(conversation["transcript"], 1)]


def input_fingerprint(conversation):
    return fingerprint(_numbered_turns(conversation))


def validate_runs(payload, records, allow_empty=False):
    """Validate an entire batch atomically; never trust its saved score."""
    conversations = extract_records(records)
    by_id = {c["conversation_id"]: c for c in conversations}
    require(isinstance(payload, dict), "Ожидается объект результатов пакетной оценки.")
    try:
        json.dumps(payload, allow_nan=False)
    except (TypeError, ValueError):
        raise ValueError("Результаты должны быть JSON без NaN и Infinity.") from None
    results, errors = payload.get("results"), payload.get("errors", [])
    require(isinstance(results, list) and isinstance(errors, list), "Нужны массивы results и errors.")
    require(allow_empty or bool(results or errors), "Файл результатов пуст.")
    require(len(results) + len(errors) <= len(conversations), "Результатов больше, чем загруженных диалогов.")
    normalized, normalized_errors, seen = [], [], set()
    batch_hash = payload.get("rubric_sha256")
    if batch_hash is not None:
        require(isinstance(batch_hash, str) and re.fullmatch(r"[a-f0-9]{64}", batch_hash), "Неверный хеш чек-листа пакета.")
    for raw in results:
        require(isinstance(raw, dict), "Результат должен быть объектом.")
        cid = raw.get("conversation_id")
        require(isinstance(cid, str) and cid in by_id and cid not in seen,
                "Неизвестный или повторяющийся ID результата.")
        seen.add(cid)
        rubric = validate_rubric(raw.get("rubric"))
        judgments = validate_assessment(raw, rubric, len(by_id[cid]["transcript"]))
        partial = raw.get("status") == "needs_review"
        if partial:
            validate_operator_evidence(judgments, [item for item in rubric if item["id"] in judgments], by_id[cid])
        audit = raw.get("audit")
        require(isinstance(audit, dict), f"{cid}: отсутствует audit.")
        require(filled(audit.get("model"), 500) and filled(audit.get("created_at"), 100),
                f"{cid}: нужны модель и время запуска.")
        require(filled(audit.get("prompt"), 200), f"{cid}: отсутствует версия промпта.")
        _timestamp(audit["created_at"])
        require(isinstance(audit.get("provider"), str) and audit["provider"] in LOCAL_PROVIDERS,
                f"{cid}: неизвестный провайдер запуска.")
        require(audit.get("input_sha256") == input_fingerprint(by_id[cid]),
                f"{cid}: результат относится к другому транскрипту.")
        if "context_sha256" in audit:
            conversation = by_id[cid]
            context = {"channel": conversation["channel"], "language": conversation["language"],
                       "messages": _numbered_turns(conversation)}
            require(audit["context_sha256"] == fingerprint(context),
                    f"{cid}: язык или канал диалога отличается от запуска.")
        if "settings" in audit or "settings_sha256" in audit:
            settings = audit.get("settings")
            require(isinstance(settings, dict) and audit.get("settings_sha256") == fingerprint(settings),
                    f"{cid}: хеш настроек модели не совпадает.")
            require(settings.get("provider") == audit["provider"],
                    f"{cid}: провайдер в настройках и audit не совпадает.")
            require(settings.get("prompt", audit["prompt"]) == audit["prompt"],
                    f"{cid}: версия промпта в настройках и audit не совпадает.")
        rubric_hash = fingerprint(rubric)
        require(audit.get("rubric_sha256") == rubric_hash, f"{cid}: хеш чек-листа не совпадает.")
        require(batch_hash is None or batch_hash == rubric_hash, f"{cid}: чек-лист отличается от пакета.")
        result = copy.deepcopy(raw)
        result["score"] = calculate(rubric, {key: row["answer"] for key, row in judgments.items()}, allow_partial=partial)
        normalized.append(result)
    for raw in errors:
        require(isinstance(raw, dict), "Ошибка обработки должна быть объектом.")
        cid = raw.get("conversation_id")
        require(isinstance(cid, str) and cid in by_id and cid not in seen,
                "Неизвестный или повторяющийся ID ошибки.")
        require(filled(raw.get("error"), 5000), f"{cid}: нужна причина ошибки.")
        seen.add(cid)
        normalized_errors.append({"conversation_id": cid, "error": raw["error"]})
    return {"results": normalized, "errors": normalized_errors}


def make_submission(payload, records, group, team_name):
    """Export all expected IDs, keeping processing errors and missing results."""
    group = str(group).upper()
    require(group in ("DEV", "PROD"), "Группа должна быть DEV или PROD.")
    require(filled(team_name, 200), "Укажите название команды.")
    meta = records.get("data", records) if isinstance(records, dict) else {}
    if not isinstance(meta, dict):
        meta = {}
    require(not str(meta.get("dataset_group_id", "")).upper().startswith("SYNTHETIC"),
            "Синтетические примеры нельзя сдавать как контрольный набор.")
    conversations = extract_records(records)
    expected = 65 if group == "DEV" else 10
    require(len(conversations) == expected, f"Для {group} нужно ровно {expected} диалогов.")
    calls = sum(c["channel"] == "voice call" for c in conversations)
    require(calls == (5 if group == "DEV" else 0),
            "DEV должен содержать 60 чатов и 5 звонков; PROD — 10 чатов.")
    checked = validate_runs(payload, conversations, allow_empty=True)
    for result in checked["results"]:
        require(fingerprint(result["rubric"]) == OFFICIAL_RUBRIC_SHA256,
                "Для конкурсной выгрузки нужны оценки по исходному чек-листу; "
                "изменённый чек-лист можно использовать в рабочем интерфейсе.")
    by_id = {r["conversation_id"]: r for r in checked["results"]}
    errors = {r["conversation_id"]: r["error"] for r in checked["errors"]}
    names = sorted({r["audit"]["model"] for r in checked["results"]})
    if not names:
        require(provider_name() in LOCAL_PROVIDERS, "Неизвестный настроенный провайдер.")
        require(filled(model_name(), 500), "Не указана настроенная модель.")
        names = [model_name()]
    output = {"schema_version": "1.0", "team_name": team_name,
              "model": {"mode": "local", "name": ", ".join(names)}, "results": []}
    for conversation in conversations:
        cid = conversation["conversation_id"]
        result = by_id.get(cid)
        if result is None:
            output["results"].append({"conversation_id": cid, "status": "error", "criteria": [],
                                      "score": None, "error": errors.get(cid, "Нет сохранённого результата оценки.")})
            continue
        if result.get("status") == "needs_review":
            missing = ", ".join(result["criterion_errors"])
            output["results"].append({"conversation_id": cid, "status": "error", "criteria": [],
                                      "score": None, "error": f"Требуется проверка критериев: {missing}."})
            continue
        criteria = []
        for internal_id, official_id in CANONICAL_IDS.items():
            row = result["judgments"][internal_id]
            answer = row["answer"]
            value = {"yes": True, "no": False, "na": None}.get(answer) if isinstance(answer, str) else answer
            turns = sorted({n for span in row["evidence"] for n in range(span["start"], span["end"] + 1)})
            criteria.append({"criterion_id": official_id, "value": value,
                             "rationale": row["reason"], "evidence_turns": turns})
        score = result["score"]
        output["results"].append({"conversation_id": cid, "status": "ok", "criteria": criteria,
                                  "score": {"final_score": score["total"], "critical_flag": score["flags"]["critical"]}})
    return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, help="Internal batch JSON from batch.py score")
    parser.add_argument("--dataset", required=True, help="Original organizer transcript JSON")
    parser.add_argument("--group", choices=["dev", "prod", "DEV", "PROD"], required=True)
    parser.add_argument("--team", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    try:
        path = Path(args.output)
        protected_paths = {Path(args.input).resolve(), Path(args.dataset).resolve()}
        require(path.resolve() not in protected_paths,
                "Файл --output должен отличаться от --input и --dataset; исходные данные не перезаписываются.")
        output = make_submission(read_json(args.input), read_json(args.dataset), args.group, args.team)
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent,
                                             prefix=path.name + ".", suffix=".tmp", delete=False) as handle:
                temporary = Path(handle.name)
                json.dump(output, handle, ensure_ascii=False, indent=2, allow_nan=False)
                handle.write("\n")
            temporary.replace(path)
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)
        failures = sum(row["status"] == "error" for row in output["results"])
        print(f"Saved {len(output['results'])} records; errors: {failures}. Output: {path}")
        return 1 if failures else 0
    except (OSError, ValueError, TypeError, KeyError) as exc:
        parser.exit(2, f"Error: {exc}\n")


if __name__ == "__main__":
    raise SystemExit(main())
