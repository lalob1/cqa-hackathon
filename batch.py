"""Import organizer transcripts, score a batch, or compare against human labels."""
import argparse
from contextlib import contextmanager
import copy
import json
import os
import re
import tempfile
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlsplit, urlunsplit
from urllib.request import urlopen

import engine
from engine import DEFAULT_RUBRIC, ModelError, allowed_answers, calculate, extract_records, fingerprint, read_json, require, score_conversation, validate_judgments, validate_rubric
from results_io import validate_runs


def write_json(path, result):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent,
                                         prefix=path.name + ".", suffix=".tmp", delete=False) as handle:
            temporary = Path(handle.name)
            json.dump(result, handle, ensure_ascii=False, indent=2, allow_nan=False)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        temporary.replace(path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def fetch_dataset(args):
    url = urlsplit(Path(args.url_file).read_text(encoding="utf-8-sig").strip())
    require(url.scheme == "https" and bool(url.hostname), "The organizer URL must use HTTPS.")
    query, changes = re.subn(r"(^|&)group_id=[^&]*", lambda match: match[1] + "group_id=" + quote(args.group, safe=""), url.query)
    require(changes == 1, "The organizer URL must contain exactly one group_id parameter.")
    try:
        with urlopen(urlunsplit(url._replace(query=query)), timeout=30) as response:
            payload = json.load(response)
    except HTTPError as error:
        raise ValueError(f"Organizer API returned HTTP {error.code}.") from None
    except (URLError, TimeoutError):
        raise ValueError("Organizer API could not be reached.") from None
    records = extract_records(payload)
    require(payload.get("data", {}).get("dataset_group_id") == args.group, "The organizer returned a different group.")
    write_json(args.output, payload)
    print(f"Saved {len(records)} transcripts.")


def run_batch(args):
    with reserve_checkpoint(Path(args.output).resolve()):
        return _run_batch(args)


def _run_batch(args):
    records = extract_records(read_json(args.input))
    expected = getattr(args, "expect_count", None)
    require(expected is None or len(records) == expected, f"Expected {expected} transcripts, received {len(records)}.")
    revision = getattr(args, "model_revision", None)
    if revision is not None:
        os.environ["CQA_MODEL_REVISION"] = revision
    rubric = validate_rubric(read_json(args.rubric) if args.rubric else DEFAULT_RUBRIC)
    require(Path(args.input).resolve() != Path(args.output).resolve(), "Input and output must be different files.")
    if args.rubric:
        require(Path(args.rubric).resolve() != Path(args.output).resolve(), "Output must not overwrite the rubric.")
    manifest = batch_manifest(records, rubric)
    output = {"schema_version": "cqa-batch-v1", "manifest": manifest,
              "rubric_sha256": fingerprint(rubric), "results": [], "errors": []}
    if getattr(args, "resume", False):
        require(Path(args.output).is_file(), "Resume requires an existing output checkpoint.")
        output = validate_checkpoint(read_json(args.output), records, rubric, manifest)
    completed = {row["conversation_id"] for row in output["results"]}
    # An interrupt before the first response still leaves a recoverable manifest.
    write_json(args.output, output)
    for index, conversation in enumerate(records, 1):
        cid = conversation["conversation_id"]
        if cid in completed:
            print(f"{index}/{len(records)} reused", flush=True)
            continue
        output["errors"] = [row for row in output["errors"] if row["conversation_id"] != cid]
        try:
            output["results"].append(score_conversation(conversation, rubric))
            print(f"{index}/{len(records)} scored", flush=True)
        except ModelError as error:
            output["errors"].append({"conversation_id": conversation["conversation_id"], "error": str(error)})
            print(f"{index}/{len(records)} failed", flush=True)
        write_json(args.output, output)
    return 1 if output["errors"] else 0


def numbered_turns(conversation):
    return [{"n": index, "timestamp": row["timestamp"], "speaker": row["speaker"], "text": row["text"]}
            for index, row in enumerate(conversation["transcript"], 1)]


def batch_manifest(records, rubric):
    """A resume guard identifies the complete input and configured inference request.

    Hashes detect changed inputs/settings; they do not prove model authorship or
    identify model weights behind a mutable local model alias.
    """
    provider = engine.provider_name()
    endpoint = os.environ.get("CQA_OLLAMA_URL", "http://127.0.0.1:11434") if provider == "ollama" else os.environ.get("CQA_LLAMA_URL", "http://127.0.0.1:8080")
    settings = engine.inference_settings()
    return {"version": 1, "dataset_sha256": fingerprint(records), "rubric_sha256": fingerprint(rubric),
            "provider": provider, "model": engine.model_name(), "prompt": engine.PROMPT_VERSION,
            "settings": settings, "settings_sha256": fingerprint(settings), "endpoint_sha256": fingerprint(endpoint)}


def validate_checkpoint(payload, records, rubric, manifest):
    require(isinstance(payload, dict) and payload.get("schema_version") == "cqa-batch-v1",
            "This checkpoint has no resume manifest. Start a new run with another output file.")
    require(payload.get("manifest") == manifest and payload.get("rubric_sha256") == fingerprint(rubric),
            "Cannot resume: dataset, rubric, provider, model, prompt or settings changed. Use a new output file.")
    require(isinstance(payload.get("results"), list) and isinstance(payload.get("errors"), list), "Invalid checkpoint lists.")
    # Share the UI importer validation, including model/timestamp metadata and
    # JSON finiteness, so a resumed run is also safe to import into the app.
    checked = validate_runs(payload, records, allow_empty=True)
    by_id = {row["conversation_id"]: row for row in records}
    seen = set()
    output = copy.deepcopy(payload)
    output.update(checked)
    for row in output["results"]:
        require(isinstance(row, dict), "Invalid checkpoint result.")
        cid = row.get("conversation_id")
        require(cid in by_id and cid not in seen, "Checkpoint contains an unknown or duplicate ID.")
        seen.add(cid)
        audit = row.get("audit")
        require(isinstance(audit, dict) and audit.get("rubric_sha256") == manifest["rubric_sha256"]
                and fingerprint(row.get("rubric")) == manifest["rubric_sha256"], "Checkpoint rubric changed.")
        turns = numbered_turns(by_id[cid])
        context = {"language": by_id[cid]["language"], "channel": by_id[cid]["channel"], "messages": turns}
        require(audit.get("input_sha256") == fingerprint(turns)
                and audit.get("context_sha256") == fingerprint(context), "Checkpoint transcript or context changed.")
        require(audit.get("provider") == manifest["provider"] and audit.get("prompt") == manifest["prompt"]
                and audit.get("settings_sha256") == manifest["settings_sha256"]
                and audit.get("settings") == manifest["settings"], "Checkpoint inference settings changed.")
        judgments = validate_judgments(row.get("judgments"), rubric, len(turns))
        row["score"] = calculate(rubric, {key: value["answer"] for key, value in judgments.items()})
    for row in output["errors"]:
        require(isinstance(row, dict) and row.get("conversation_id") in by_id
                and row["conversation_id"] not in seen and isinstance(row.get("error"), str) and row["error"].strip(),
                "Checkpoint contains an unknown, duplicate or invalid error.")
        seen.add(row["conversation_id"])
    return output


def _label(value):
    return str(value)


def _metrics(results_by_id, labels, rubric):
    comparable = sorted(labels.keys() & results_by_id.keys())
    metrics = {}
    for item in rubric:
        classes = [_label(value) for value in allowed_answers(item)]
        metrics[item["id"]] = {"exact": 0, "compared": 0, "na_disagreement": 0, "false_na": 0, "missed_na": 0,
                               "classes": classes,
                               "confusion_matrix": {gold: {pred: 0 for pred in classes} for gold in classes}}
        if item["type"] == "scale":
            metrics[item["id"]].update({"scale_absolute_error_sum": 0, "scale_pairs": 0})
        if item["type"] == "flag":
            metrics[item["id"]]["detection"] = {"true_positive": 0, "false_positive": 0,
                                                  "false_negative": 0, "true_negative": 0}
    score_errors, queue = [], []
    undefined_total_pairs = 0
    for cid in comparable:
        result = results_by_id[cid]
        prediction = {key: row["answer"] for key, row in result["judgments"].items()}
        actual = calculate(rubric, prediction)["total"]
        expected = calculate(rubric, labels[cid])["total"]
        absolute_error = None
        if actual is not None and expected is not None:
            absolute_error = round(abs(actual - expected), 4)
            score_errors.append(absolute_error)
        else:
            undefined_total_pairs += 1
        differences, critical_mismatch, na_mismatches = [], False, 0
        for item in rubric:
            key, predicted, reference = item["id"], prediction[item["id"]], labels[cid][item["id"]]
            row = metrics[key]
            row["compared"] += 1
            row["exact"] += int(predicted == reference)
            na_disagreement = (predicted == "na") != (reference == "na")
            row["na_disagreement"] += int(na_disagreement)
            row["false_na"] += int(predicted == "na" and reference != "na")
            row["missed_na"] += int(reference == "na" and predicted != "na")
            row["confusion_matrix"][_label(reference)][_label(predicted)] += 1
            if item["type"] == "scale" and predicted != "na" and reference != "na":
                row["scale_absolute_error_sum"] += abs(predicted - reference)
                row["scale_pairs"] += 1
            if item["type"] == "flag":
                name = ("true_positive" if reference == "yes" else "false_positive") if predicted == "yes" else ("false_negative" if reference == "yes" else "true_negative")
                row["detection"][name] += 1
                critical_mismatch = critical_mismatch or predicted != reference
            if predicted != reference:
                judgment = result["judgments"][key]
                differences.append({"criterion_id": key, "predicted": predicted, "reference": reference,
                                    "na_disagreement": na_disagreement, "reason": judgment["reason"],
                                    "evidence": copy.deepcopy(judgment["evidence"])})
                na_mismatches += int(na_disagreement)
        if differences:
            audit = result["audit"]
            queue.append({"conversation_id": cid, "predicted_total": actual, "reference_total": expected,
                          "absolute_score_error": absolute_error, "critical_mismatch": critical_mismatch,
                          "na_mismatches": na_mismatches, "differences": differences,
                          "audit": {key: audit.get(key) for key in ("model", "provider", "prompt", "rubric_sha256", "input_sha256")}})
    total_exact, total_compared = 0, 0
    for row in metrics.values():
        total_exact += row["exact"]
        total_compared += row["compared"]
        row["exact_rate"] = row["exact"] / row["compared"] if row["compared"] else None
        row["na_disagreement_rate"] = row["na_disagreement"] / row["compared"] if row["compared"] else None
        if "scale_pairs" in row:
            row["scale_mae"] = row["scale_absolute_error_sum"] / row["scale_pairs"] if row["scale_pairs"] else None
        if "detection" in row:
            values = row["detection"]
            tp, fp, fn = values["true_positive"], values["false_positive"], values["false_negative"]
            values["precision"] = tp / (tp + fp) if tp + fp else None
            values["recall"] = tp / (tp + fn) if tp + fn else None
            values["f1"] = 2 * tp / (2 * tp + fp + fn) if 2 * tp + fp + fn else None
    queue.sort(key=lambda row: (not row["critical_mismatch"], -row["na_mismatches"],
                                -(row["absolute_score_error"] or 0), row["conversation_id"]))
    return {"labeled": len(labels), "matched": len(comparable),
            "missing_ids": sorted(labels.keys() - results_by_id.keys()),
            "unexpected_ids": sorted(results_by_id.keys() - labels.keys()),
            "coverage": len(comparable) / len(labels) if labels else None,
            "total_mae": round(sum(score_errors) / len(score_errors), 4) if score_errors else None,
            "total_pairs": len(score_errors), "undefined_total_pairs": undefined_total_pairs,
            "criterion_exact_rate": total_exact / total_compared if total_compared else None,
            "criteria": metrics, "review_queue": queue}


def compare(results, labels, rubric, records=None):
    """Team diagnostics against adjudicated labels, not the organizer ranking formula.

    Confusion matrices use reference labels as rows and model predictions as columns.
    Totals are recomputed from answers; a provided total is never trusted. No missing
    prediction is converted to zero, and unlabelled predictions do not enter metrics.
    """
    validate_rubric(rubric)
    require(isinstance(labels, dict) and bool(labels), "Expected a non-empty mapping of IDs to human answers.")
    for cid, answers in labels.items():
        require(isinstance(cid, str) and bool(cid.strip()), "Label IDs must be non-empty strings.")
        calculate(rubric, answers)
    require(isinstance(results, list), "Expected a list of prediction results.")
    dataset = {row["conversation_id"]: row for row in extract_records(records)} if records is not None else None
    by_id = {}
    rubric_hash = fingerprint(rubric)
    for row in results:
        require(isinstance(row, dict) and isinstance(row.get("conversation_id"), str), "Invalid prediction result.")
        cid = row["conversation_id"]
        require(cid not in by_id, "Predictions contain duplicate conversation IDs.")
        require(isinstance(row.get("audit"), dict) and row["audit"].get("rubric_sha256") == rubric_hash,
                "Predictions use a different rubric.")
        if "rubric" in row:
            require(fingerprint(row["rubric"]) == rubric_hash, "The saved prediction rubric is inconsistent.")
        if dataset is not None:
            require(cid in dataset, "A prediction ID is missing from the supplied dataset.")
            turns = numbered_turns(dataset[cid])
            require(row["audit"].get("input_sha256") == fingerprint(turns), "A prediction transcript differs from the supplied dataset.")
            if "context_sha256" in row["audit"]:
                context = {"language": dataset[cid]["language"], "channel": dataset[cid]["channel"], "messages": turns}
                require(row["audit"]["context_sha256"] == fingerprint(context), "A prediction context differs from the supplied dataset.")
            count = len(turns)
        else:
            count = 500  # Syntax bound only; supply --dataset to verify actual message ranges.
        validate_judgments(row.get("judgments"), rubric, count)
        by_id[cid] = row
    report = _metrics(by_id, labels, rubric)
    report["metric_scope"] = "Team diagnostics on matched human-labelled dialogs; not the official ranking formula."
    report["evidence_checked_against_dataset"] = dataset is not None
    if dataset is not None:
        require(set(labels) <= dataset.keys(), "A label ID is missing from the supplied dataset.")
        report["breakdowns"] = {}
        for field in ("language", "channel"):
            groups = {}
            for value in sorted({row[field] for row in dataset.values()}):
                group_labels = {cid: answers for cid, answers in labels.items() if dataset[cid][field] == value}
                if not group_labels:
                    continue
                group_results = {cid: row for cid, row in by_id.items() if dataset[cid][field] == value}
                group = _metrics(group_results, group_labels, rubric)
                group.pop("review_queue")
                groups[value] = group
            report["breakdowns"][field] = groups
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    fetch = commands.add_parser("fetch")
    fetch.add_argument("--url-file", required=True)
    fetch.add_argument("--group", default="DEV")
    fetch.add_argument("--output", required=True)
    score = commands.add_parser("score")
    score.add_argument("--expect-count", type=int)
    score.add_argument("--model-revision")
    score.add_argument("input")
    score.add_argument("--rubric")
    score.add_argument("--output", required=True)
    score.add_argument("--resume", action="store_true", help="Reuse validated successes in an unchanged output checkpoint; retry failed/unprocessed dialogs.")
    compare_parser = commands.add_parser("compare")
    compare_parser.add_argument("predictions")
    compare_parser.add_argument("labels")
    compare_parser.add_argument("--rubric")
    compare_parser.add_argument("--dataset", help="Validate transcript evidence and report metrics by language/channel.")
    compare_parser.add_argument("--report", help="Save the diagnostic report and review queue as JSON.")
    export = commands.add_parser("export", help="Export organizer results JSON 1.0.")
    export.add_argument("input")
    export.add_argument("predictions")
    export.add_argument("--team-name", required=True)
    export.add_argument("--group", choices=("dev", "prod"), required=True)
    export.add_argument("--output")
    args = parser.parse_args()
    try:
        if args.command == "export":
            from results_io import make_submission
            output = Path(args.output or f"results/{args.group}/results.json").resolve()
            require(output not in {Path(args.input).resolve(), Path(args.predictions).resolve()},
                    "--output must not overwrite dataset or predictions.")
            result = make_submission(read_json(args.predictions), read_json(args.input), args.group, args.team_name)
            write_json(output, result)
            return 1 if any(row["status"] == "error" for row in result["results"]) else 0
        if args.command == "fetch":
            fetch_dataset(args)
        elif args.command == "score":
            return run_batch(args)
        else:
            rubric = validate_rubric(read_json(args.rubric) if args.rubric else DEFAULT_RUBRIC)
            payload = read_json(args.predictions)
            report = compare(payload["results"], read_json(args.labels), rubric,
                             read_json(args.dataset) if args.dataset else None)
            prediction_errors = payload.get("errors", [])
            require(isinstance(prediction_errors, list), "Prediction errors must be a list.")
            report["prediction_errors"] = prediction_errors
            if args.report:
                protected = {Path(value).resolve() for value in (args.predictions, args.labels, args.rubric, args.dataset) if value}
                require(Path(args.report).resolve() not in protected, "Report output must not overwrite input files.")
                write_json(args.report, report)
            print(json.dumps(report, ensure_ascii=False, indent=2))
            return 1 if report["missing_ids"] or report["unexpected_ids"] else 0
    except (OSError, KeyError, TypeError, ValueError) as error:
        parser.exit(2, f"Error: {error}\n")
    return 0





@contextmanager
def reserve_checkpoint(path):
    """Hold an OS lock for one batch writer, released even if the process exits."""
    path.parent.mkdir(parents=True, exist_ok=True)
    lock_path = path.with_name(path.name + ".lock")
    with lock_path.open("a+b") as lock:
        try:
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as error:
            raise ValueError(f"Another batch is writing {path.name}.") from error
        yield


def submission_payload(dataset, checkpoint, team_name, group):
    from results_io import make_submission
    return make_submission(checkpoint, dataset, group, team_name)


if __name__ == "__main__":
    raise SystemExit(main())
