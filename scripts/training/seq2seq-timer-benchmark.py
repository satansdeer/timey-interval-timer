#!/usr/bin/env python3
import argparse
import json
import math
import random
import subprocess
import time
from pathlib import Path

import torch
from transformers import AutoModelForSeq2SeqLM, AutoTokenizer


def main():
    args = parse_args()
    random.seed(args.seed)
    torch.manual_seed(args.seed)

    raw_train_records = read_jsonl(args.train)
    train_records = apply_category_weights(raw_train_records, args.category_weight)
    validation_records = read_jsonl(args.validation)
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    steps = sorted(set(args.steps))
    if steps[0] != 0:
      steps.insert(0, 0)
    max_step = max(steps)

    device = pick_device(args.device)
    tokenizer = AutoTokenizer.from_pretrained(args.model, extra_special_tokens={})
    model = AutoModelForSeq2SeqLM.from_pretrained(args.model)
    model.to(device)

    summary = {
        "model": args.model,
        "device": str(device),
        "trainRecords": len(raw_train_records),
        "effectiveTrainRecords": len(train_records),
        "validationRecords": len(validation_records),
        "generation": {
            "inputFormat": args.input_format,
            "evalBatchSize": args.eval_batch_size,
            "maxNewTokens": args.max_new_tokens,
            "numBeams": args.num_beams,
            "repetitionPenalty": args.repetition_penalty,
            "noRepeatNgramSize": args.no_repeat_ngram_size,
            "lengthPenalty": args.length_penalty,
            "earlyStopping": args.early_stopping,
        },
        "training": {
            "trainOrder": args.train_order,
            "learningRate": args.learning_rate,
            "batchSize": args.batch_size,
            "weightDecay": args.weight_decay,
            "maxGradNorm": args.max_grad_norm,
            "categoryWeight": args.category_weight,
        },
        "steps": [],
    }

    if 0 in steps:
        summary["steps"].append(evaluate_step(model, tokenizer, validation_records, args, 0, output_dir, device))

    if max_step > 0:
        optimizer = torch.optim.AdamW(model.parameters(), lr=args.learning_rate, weight_decay=args.weight_decay)
        train_examples = [record_to_example(record, args) for record in train_records]
        train_state = make_train_state(train_examples, args)

        model.train()
        started = time.time()
        for step in range(1, max_step + 1):
            batch_examples = take_train_batch(train_examples, train_state, args)
            batch = make_batch(tokenizer, batch_examples, args, device)

            loss = model(**batch).loss
            loss.backward()
            if args.max_grad_norm > 0:
                torch.nn.utils.clip_grad_norm_(model.parameters(), args.max_grad_norm)
            optimizer.step()
            optimizer.zero_grad(set_to_none=True)

            if step % args.report_every == 0 or step in steps:
                elapsed = time.time() - started
                print(f"step {step}: loss={loss.item():.4f} elapsed={elapsed:.1f}s", flush=True)

            if step in steps:
                checkpoint_dir = output_dir / f"checkpoint-{step}"
                checkpoint_dir.mkdir(parents=True, exist_ok=True)
                model.save_pretrained(checkpoint_dir)
                tokenizer.save_pretrained(checkpoint_dir)
                summary["steps"].append(
                    evaluate_step(model, tokenizer, validation_records, args, step, output_dir, device)
                )
                model.train()

    (output_dir / "summary.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, indent=2), flush=True)


def evaluate_step(model, tokenizer, records, args, step, output_dir, device):
    model.eval()
    predictions = []
    parse_passes = 0
    strict_passes = 0
    semantic_passes = 0
    semantic_invalid_count = 0
    started = time.time()

    generation_args = {
        "max_new_tokens": args.max_new_tokens,
        "num_beams": args.num_beams,
        "do_sample": False,
        "repetition_penalty": args.repetition_penalty,
        "length_penalty": args.length_penalty,
    }
    if args.no_repeat_ngram_size > 0:
        generation_args["no_repeat_ngram_size"] = args.no_repeat_ngram_size
    if args.early_stopping:
        generation_args["early_stopping"] = True

    with torch.no_grad():
        for batch_records in chunks(records, args.eval_batch_size):
            batch_examples = [record_to_example(record, args) for record in batch_records]
            encoded = tokenizer(
                [example["input"] for example in batch_examples],
                return_tensors="pt",
                padding=True,
                max_length=args.max_input_length,
                truncation=True,
            )
            encoded = {key: value.to(device) for key, value in encoded.items()}
            generated = model.generate(**encoded, **generation_args)
            outputs = tokenizer.batch_decode(generated, skip_special_tokens=True)
            parsed_outputs = parse_timer_dsl_batch(outputs)

            for record, example, output, parsed_output in zip(batch_records, batch_examples, outputs, parsed_outputs):
                output = output.strip()
                expected = example["timers"]
                parse_ok = False
                semantic_invalid = bool(parsed_output.get("semanticInvalid"))
                semantic_invalid_detail = parsed_output.get("semanticInvalidDetail")
                semantic_invalid_count += int(semantic_invalid)

                try:
                    if not parsed_output.get("ok"):
                        raise ValueError(parsed_output.get("error") or "DSL parser failed")
                    actual = parsed_output["timers"]
                    parse_ok = True
                    parse_passes += 1
                    strict_errors = compare_timer_outputs(expected, actual, ignore_labels=False)
                    semantic_errors = compare_timer_outputs(expected, actual, ignore_labels=True)
                except Exception as error:
                    actual = None
                    strict_errors = [str(error)]
                    semantic_errors = [str(error)]

                strict_ok = len(strict_errors) == 0
                semantic_ok = len(semantic_errors) == 0
                strict_passes += int(strict_ok)
                semantic_passes += int(semantic_ok)
                predictions.append(
                    {
                        "id": record["id"],
                        "category": record["category"],
                        "parseOk": parse_ok,
                        "semanticInvalid": semantic_invalid,
                        "semanticInvalidDetail": semantic_invalid_detail,
                        "ok": strict_ok,
                        "semanticOk": semantic_ok,
                        "strictErrors": strict_errors,
                        "semanticErrors": semantic_errors,
                        "expected": expected,
                        "actual": actual,
                        "rawContent": output,
                    }
                )

    prediction_path = output_dir / f"predictions-step-{step}.jsonl"
    prediction_path.write_text("\n".join(json.dumps(item) for item in predictions) + "\n", encoding="utf-8")

    total = len(records)
    result = {
        "step": step,
        "parseable": parse_passes,
        "parseableRate": rate(parse_passes, total),
        "strictExact": strict_passes,
        "strictExactRate": rate(strict_passes, total),
        "semanticExact": semantic_passes,
        "semanticExactRate": rate(semantic_passes, total),
        "semanticInvalid": semantic_invalid_count,
        "semanticInvalidRate": rate(semantic_invalid_count, total),
        "categorySummary": summarize_predictions_by_category(predictions),
        "seconds": round(time.time() - started, 3),
        "predictions": str(prediction_path),
    }
    print(
        (
            f"eval step {step}: parseable={parse_passes}/{total} strict={strict_passes}/{total} "
            f"semantic={semantic_passes}/{total} semantic-invalid={semantic_invalid_count}/{total}"
        ),
        flush=True,
    )
    print_category_summary(result["categorySummary"])
    return result


def record_to_example(record, args):
    messages = record["messages"]
    system = next(message["content"] for message in messages if message["role"] == "system")
    user = next(message["content"] for message in messages if message["role"] == "user")
    assistant = next(message["content"] for message in messages if message["role"] == "assistant")
    if args.input_format == "compact":
        input_text = f"translate timer request to Timey DSL: {user}"
    else:
        input_text = f"{system}\nRequest: {user}"
    return {
        "input": input_text,
        "target": assistant,
        "timers": record["metadata"]["expectedTimers"],
    }


def make_batch(tokenizer, examples, args, device):
    inputs = tokenizer(
        [example["input"] for example in examples],
        return_tensors="pt",
        padding=True,
        max_length=args.max_input_length,
        truncation=True,
    )
    labels = tokenizer(
        text_target=[example["target"] for example in examples],
        return_tensors="pt",
        padding=True,
        max_length=args.max_target_length,
        truncation=True,
    )["input_ids"]
    labels[labels == tokenizer.pad_token_id] = -100
    batch = {key: value.to(device) for key, value in inputs.items()}
    batch["labels"] = labels.to(device)
    return batch


def make_train_state(train_examples, args):
    ordered_examples = list(train_examples)
    if args.train_order == "shuffle":
        random.shuffle(ordered_examples)
    return {
        "examples": ordered_examples,
        "index": 0,
    }


def take_train_batch(train_examples, state, args):
    if args.train_order == "random":
        return random.choices(train_examples, k=args.batch_size)

    batch = []
    while len(batch) < args.batch_size:
        if state["index"] >= len(state["examples"]):
            state["index"] = 0
            if args.train_order == "shuffle":
                random.shuffle(state["examples"])
        batch.append(state["examples"][state["index"]])
        state["index"] += 1
    return batch


def apply_category_weights(records, weights):
    if not weights:
        return records

    weighted = []
    for record in records:
        repeat = weights.get(record.get("category"), 1)
        weighted.extend([record] * repeat)
    return weighted


def parse_timer_dsl_batch(contents):
    script = Path(__file__).with_name("parse-timer-dsl-batch.mjs")
    completed = subprocess.run(
        ["node", str(script)],
        input=json.dumps(list(contents)),
        text=True,
        capture_output=True,
        check=False,
    )
    if completed.returncode != 0:
        message = completed.stderr.strip() or completed.stdout.strip() or "DSL parser process failed"
        raise RuntimeError(message)
    return json.loads(completed.stdout)


def compare_timer_outputs(expected, actual, ignore_labels):
    errors = []
    if len(expected) != len(actual):
        errors.append(f"timer count expected {len(expected)}, got {len(actual)}")
    for index, (left, right) in enumerate(zip(expected, actual), start=1):
        if not ignore_labels and left["label"] != right["label"]:
            errors.append(f"timer {index} label expected {left['label']!r}, got {right['label']!r}")
        if int(left["durationSeconds"]) != int(right["durationSeconds"]):
            errors.append(f"timer {index} duration expected {left['durationSeconds']}, got {right['durationSeconds']}")
        if left["kind"] != right["kind"]:
            errors.append(f"timer {index} kind expected {left['kind']}, got {right['kind']}")
    return errors


def read_jsonl(path):
    return [json.loads(line) for line in Path(path).read_text(encoding="utf-8").splitlines() if line.strip()]


def chunks(values, size):
    for index in range(0, len(values), size):
        yield values[index : index + size]


def pick_device(value):
    if value != "auto":
        return torch.device(value)
    if torch.backends.mps.is_available():
        return torch.device("mps")
    if torch.cuda.is_available():
        return torch.device("cuda")
    return torch.device("cpu")


def rate(count, total):
    if not total:
        return 0.0
    return round(count / total, 4)


def summarize_predictions_by_category(predictions):
    buckets = {}
    for prediction in predictions:
        category = prediction.get("category") or "uncategorized"
        bucket = buckets.setdefault(
            category,
            {
                "category": category,
                "count": 0,
                "parseable": 0,
                "strictExact": 0,
                "semanticExact": 0,
                "semanticInvalid": 0,
            },
        )
        bucket["count"] += 1
        bucket["parseable"] += int(bool(prediction.get("parseOk")))
        bucket["strictExact"] += int(bool(prediction.get("ok")))
        bucket["semanticExact"] += int(bool(prediction.get("semanticOk")))
        bucket["semanticInvalid"] += int(bool(prediction.get("semanticInvalid")))

    summary = []
    for bucket in buckets.values():
        count = bucket["count"]
        summary.append(
            {
                **bucket,
                "parseableRate": rate(bucket["parseable"], count),
                "strictExactRate": rate(bucket["strictExact"], count),
                "semanticExactRate": rate(bucket["semanticExact"], count),
                "semanticInvalidRate": rate(bucket["semanticInvalid"], count),
            }
        )
    return sorted(summary, key=lambda item: (-item["semanticInvalidRate"], item["strictExactRate"], item["category"]))


def print_category_summary(summary):
    if not summary:
        return
    print("  by category:", flush=True)
    for item in summary:
        print(
            "    {category}: strict {strictExact}/{count} ({strictPercent:.1f}%) "
            "semantic {semanticExact}/{count} ({semanticPercent:.1f}%) "
            "parse {parseable}/{count} ({parsePercent:.1f}%) "
            "semantic-invalid {semanticInvalid}/{count} ({semanticInvalidPercent:.1f}%)".format(
                **item,
                strictPercent=item["strictExactRate"] * 100,
                semanticPercent=item["semanticExactRate"] * 100,
                parsePercent=item["parseableRate"] * 100,
                semanticInvalidPercent=item["semanticInvalidRate"] * 100,
            ),
            flush=True,
        )


def parse_args():
    parser = argparse.ArgumentParser(description="Benchmark seq2seq models on Timey timer DSL generation.")
    parser.add_argument("--model", required=True)
    parser.add_argument("--train", default="training/generated-dsl-natural/timer-sft-train.jsonl")
    parser.add_argument("--validation", default="training/generated-dsl-natural/timer-sft-validation.jsonl")
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--steps", default="0,50,100,200,300")
    parser.add_argument("--batch-size", type=int, default=4)
    parser.add_argument("--learning-rate", type=float, default=5e-4)
    parser.add_argument("--weight-decay", type=float, default=0.01)
    parser.add_argument("--max-grad-norm", type=float, default=1.0)
    parser.add_argument("--train-order", choices=["sequential", "shuffle", "random"], default="shuffle")
    parser.add_argument(
        "--category-weight",
        default="",
        help="Comma-separated integer repeat weights by category, for example explicit-label-copy=6,explicit-sequence=8",
    )
    parser.add_argument("--max-input-length", type=int, default=384)
    parser.add_argument("--max-target-length", type=int, default=384)
    parser.add_argument("--max-new-tokens", type=int, default=256)
    parser.add_argument("--input-format", choices=["chat", "compact"], default="chat")
    parser.add_argument("--eval-batch-size", type=int, default=8)
    parser.add_argument("--num-beams", type=int, default=1)
    parser.add_argument("--repetition-penalty", type=float, default=1.0)
    parser.add_argument("--no-repeat-ngram-size", type=int, default=0)
    parser.add_argument("--length-penalty", type=float, default=1.0)
    parser.add_argument("--early-stopping", action="store_true")
    parser.add_argument("--device", default="auto")
    parser.add_argument("--report-every", type=int, default=25)
    parser.add_argument("--seed", type=int, default=7)
    parsed = parser.parse_args()
    parsed.steps = [int(value) for value in parsed.steps.split(",") if value.strip()]
    parsed.category_weight = parse_category_weights(parsed.category_weight)
    if any(step < 0 for step in parsed.steps):
        raise ValueError("--steps must contain non-negative integers")
    if parsed.batch_size < 1:
        raise ValueError("--batch-size must be positive")
    if parsed.eval_batch_size < 1:
        raise ValueError("--eval-batch-size must be positive")
    if parsed.num_beams < 1:
        raise ValueError("--num-beams must be positive")
    if parsed.no_repeat_ngram_size < 0:
        raise ValueError("--no-repeat-ngram-size must be non-negative")
    if not math.isfinite(parsed.learning_rate) or parsed.learning_rate <= 0:
        raise ValueError("--learning-rate must be positive")
    if not math.isfinite(parsed.weight_decay) or parsed.weight_decay < 0:
        raise ValueError("--weight-decay must be non-negative")
    if not math.isfinite(parsed.max_grad_norm) or parsed.max_grad_norm < 0:
        raise ValueError("--max-grad-norm must be non-negative")
    return parsed


def parse_category_weights(value):
    weights = {}
    if not value:
        return weights
    for item in value.split(","):
        item = item.strip()
        if not item:
            continue
        if "=" not in item:
            raise ValueError("--category-weight entries must be category=integer")
        category, raw_weight = item.split("=", 1)
        category = category.strip()
        weight = int(raw_weight)
        if not category or weight < 1:
            raise ValueError("--category-weight entries must be category=integer with integer >= 1")
        weights[category] = weight
    return weights


if __name__ == "__main__":
    main()
