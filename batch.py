"""Import organizer transcripts, score a batch, or compare against human labels."""
import argparse
import json
import os
import re
from contextlib import contextmanager
from pathlib import Path
from tempfile import NamedTemporaryFile
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlsplit, urlunsplit
from urllib.request import urlopen

from engine import (DEFAULT_RUBRIC, PROMPT_VERSION, ModelError, calculate, extract_records,
                    fingerprint, model_name, provider_name, read_json, require,
                    score_conversation, validate_rubric)


def write_json(path, result):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, delete=False) as stream:
            temporary = Path(stream.name)
            json.dump(result, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
        temporary.replace(path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


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
    records = extract_records(read_json(args.input))
    rubric = validate_rubric(read_json(args.rubric) if args.rubric else DEFAULT_RUBRIC)
    if args.expect_count is not None:
        require(len(records) == args.expect_count, f"Expected {args.expect_count} transcripts, received {len(records)}.")
    destination = Path(args.output).resolve()
    inputs = [args.input, args.rubric] if args.rubric else [args.input]
    require(destination not in {Path(path).resolve() for path in inputs}, "Choose an output path separate from the inputs.")
    run = {"dataset_sha256": fingerprint(records), "record_count": len(records), "rubric_sha256": fingerprint(rubric),
           "prompt": PROMPT_VERSION, "provider": provider_name(), "model": model_name(), "model_revision": args.model_revision}
    ids = [record["conversation_id"] for record in records]
    with reserve_checkpoint(destination):
        results, errors = {}, {}
        if args.resume and destination.exists():
            checkpoint = read_json(destination)
            require(isinstance(checkpoint, dict) and checkpoint.get("run") == run,
                    "Checkpoint provenance differs. Use the original settings or a new output file.")
            for name, rows_by_id in (("results", results), ("errors", errors)):
                for row in checkpoint[name]:
                    cid = row["conversation_id"]
                    require(cid in ids and cid not in rows_by_id, "Checkpoint has an unexpected or duplicate ID.")
                    rows_by_id[cid] = row
            require(not results.keys() & errors.keys(), "Checkpoint contains both a result and an error for a transcript.")
        for index, conversation in enumerate(records, 1):
            cid = conversation["conversation_id"]
            if cid in results:
                print(f"{index}/{len(records)} already scored", flush=True)
                continue
            try:
                results[cid] = score_conversation(conversation, rubric)
                errors.pop(cid, None)
                print(f"{index}/{len(records)} scored", flush=True)
            except ModelError as error:
                errors[cid] = {"conversation_id": cid, "error": str(error)}
                print(f"{index}/{len(records)} failed", flush=True)
            write_json(destination, {"run": run, "rubric_sha256": run["rubric_sha256"],
                                     "results": [results[cid] for cid in ids if cid in results],
                                     "errors": [errors[cid] for cid in ids if cid in errors]})
        return 1 if errors else 0


def compare(results, labels, rubric):
    """Accept adjudicated labels keyed by conversation ID, then criterion ID."""
    require(isinstance(labels, dict) and bool(labels), "Expected a non-empty mapping of IDs to human answers.")
    gold = {key: calculate(rubric, values) for key, values in labels.items()}
    by_id = {row["conversation_id"]: row for row in results}
    require(len(by_id) == len(results), "Predictions contain duplicate conversation IDs.")
    rubric_hash = fingerprint(rubric)
    require(all(row["audit"]["rubric_sha256"] == rubric_hash for row in results), "Predictions use a different rubric.")
    missing, unexpected = sorted(labels.keys() - by_id.keys()), sorted(by_id.keys() - labels.keys())
    metrics = {item["id"]: {"exact": 0, "compared": 0, "false_na": 0, "missed_na": 0} for item in rubric}
    errors = []
    comparable = sorted(labels.keys() & by_id.keys())
    undefined_total_pairs = 0
    for cid in comparable:
        prediction = {key: row["answer"] for key, row in by_id[cid]["judgments"].items()}
        actual = calculate(rubric, prediction)["total"]
        expected = gold[cid]["total"]
        if actual is not None and expected is not None:
            errors.append(abs(actual - expected))
        else:
            undefined_total_pairs += 1
        for key, row in metrics.items():
            row["compared"] += 1
            predicted_answer, labeled_answer = prediction[key], labels[cid][key]
            row["exact"] += int(predicted_answer == labeled_answer)
            row["false_na"] += int(predicted_answer == "na" and labeled_answer != "na")
            row["missed_na"] += int(labeled_answer == "na" and predicted_answer != "na")
    for row in metrics.values():
        row["na_disagreement"] = row["false_na"] + row["missed_na"]
        row["exact_rate"] = row["exact"] / row["compared"] if row["compared"] else None
    return {"labeled": len(labels), "matched": len(comparable), "missing_ids": missing, "unexpected_ids": unexpected,
            "total_mae": round(sum(errors) / len(errors), 4) if errors else None, "total_pairs": len(errors),
            "undefined_total_pairs": undefined_total_pairs, "criteria": metrics}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    fetch = commands.add_parser("fetch")
    fetch.add_argument("--url-file", required=True)
    fetch.add_argument("--group", default="DEV")
    fetch.add_argument("--output", required=True)
    score = commands.add_parser("score")
    score.add_argument("input")
    score.add_argument("--rubric")
    score.add_argument("--output", required=True)
    score.add_argument("--expect-count", type=int, help="Require this many input records before calling the model.")
    score.add_argument("--model-revision", help="Record the pinned model revision or weights checksum.")
    score.add_argument("--resume", action="store_true", help="Reuse completed results for the same input and configuration.")
    compare_parser = commands.add_parser("compare")
    compare_parser.add_argument("predictions")
    compare_parser.add_argument("labels")
    compare_parser.add_argument("--rubric")
    args = parser.parse_args()
    try:
        if args.command == "fetch":
            fetch_dataset(args)
        elif args.command == "score":
            return run_batch(args)
        else:
            rubric = validate_rubric(read_json(args.rubric) if args.rubric else DEFAULT_RUBRIC)
            report = compare(read_json(args.predictions)["results"], read_json(args.labels), rubric)
            print(json.dumps(report, ensure_ascii=False, indent=2))
            return 1 if report["missing_ids"] or report["unexpected_ids"] else 0
    except (OSError, KeyError, TypeError, ValueError) as error:
        parser.exit(2, f"Error: {error}\n")
    except KeyboardInterrupt:
        parser.exit(130, "Interrupted. Completed batch results are in the output checkpoint.\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
