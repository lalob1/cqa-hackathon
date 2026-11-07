"""Import organizer transcripts, score a batch, or compare against human labels."""
import argparse
import json
import re
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlsplit, urlunsplit
from urllib.request import urlopen

from engine import DEFAULT_RUBRIC, ModelError, calculate, extract_records, fingerprint, read_json, require, score_conversation, validate_rubric


def write_json(path, result):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)


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
    output = {"rubric_sha256": fingerprint(rubric), "results": [], "errors": []}
    for index, conversation in enumerate(records, 1):
        try:
            output["results"].append(score_conversation(conversation, rubric))
            print(f"{index}/{len(records)} scored", flush=True)
        except ModelError as error:
            output["errors"].append({"conversation_id": conversation["conversation_id"], "error": str(error)})
            print(f"{index}/{len(records)} failed", flush=True)
        write_json(args.output, output)
    return 1 if output["errors"] else 0


def compare(results, labels, rubric):
    """Accept adjudicated labels keyed by conversation ID, then criterion ID."""
    require(isinstance(labels, dict) and bool(labels), "Expected a non-empty mapping of IDs to human answers.")
    gold = {key: calculate(rubric, values) for key, values in labels.items()}
    by_id = {row["conversation_id"]: row for row in results}
    require(len(by_id) == len(results), "Predictions contain duplicate conversation IDs.")
    rubric_hash = fingerprint(rubric)
    require(all(row["audit"]["rubric_sha256"] == rubric_hash for row in results), "Predictions use a different rubric.")
    missing, unexpected = sorted(labels.keys() - by_id.keys()), sorted(by_id.keys() - labels.keys())
    metrics = {item["id"]: {"exact": 0, "compared": 0, "na_disagreement": 0} for item in rubric}
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
            row["exact"] += int(prediction[key] == labels[cid][key])
            row["na_disagreement"] += int((prediction[key] == "na") != (labels[cid][key] == "na"))
    for row in metrics.values():
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
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
