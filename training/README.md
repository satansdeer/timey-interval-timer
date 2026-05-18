# Timer Seq2Seq Training

This directory contains the local training harness for the tiny timer planner.
The current production target is a small seq2seq model that translates natural
language timer requests into the same compact Timey DSL that humans can type in
the app.

## Dataset

Build and validate the current DSL dataset:

```sh
npm run training:build
npm run training:validate
```

Generated files:

- `training/generated-dsl-compressed-end/timer-sft-train.jsonl`
- `training/generated-dsl-compressed-end/timer-sft-validation.jsonl`
- `training/generated-dsl-compressed-end/timer-sft-all.jsonl`
- `training/generated-dsl-compressed-end/timer-sft-manifest.json`

The current split is 771 train rows and 145 validation rows. It includes
count-stress categories for exact N middle intervals, exact work/rest pairs,
plain repeated timers, alternating timers, and label copying.

## DSL Format

Assistant targets use the shared timer shorthand parser in `timer-dsl.js`.
The app, dataset builder, JS evaluator, and Python benchmark all route through
that parser, so future DSL changes only need one grammar update.

```text
8m: Warmup
4x 1m: Rest | 1m: Work
8m: Cooldown
END
```

Supported dense forms:

- `2x 2m30s: Step` repeats the same timer twice.
- `2x2m30s: Step` is also accepted when omitting the space after `x`.
- `4x 1m: Rest | 1m: Work` repeats the full rest/work block 4 times.
- `5alt 45s: Rest | 45s: Work` emits 5 total alternating timers.
- `7x 40s: Timer` emits 7 generic timers; the parser numbers them internally.
- `8m + 4x1m + 8m: Timer` emits ordered generic timer groups with one shared label.
- `4m around 5x30s: Timer` emits equal generic bookends around a middle group.

The grouped `+` and `around` forms are intentionally generic-only: they must
use `Timer` as the label and cannot wrap `alt`, work/rest blocks, warmup, or
cooldown.

The final `END` line is a training and evaluation stop marker. The parser strips
it before comparison, so the timer syntax remains valid human input.

## Train

Run the seq2seq harness against the DSL dataset:

```sh
.venv-mlx/bin/python scripts/training/seq2seq-timer-benchmark.py \
  --model google/t5-efficient-tiny \
  --train training/generated-dsl-compressed-end/timer-sft-train.jsonl \
  --validation training/generated-dsl-compressed-end/timer-sft-validation.jsonl \
  --output-dir training/seq2seq-runs/t5-efficient-tiny-compressed-compact-beam4 \
  --steps 0,250,500,1000 \
  --batch-size 8 \
  --learning-rate 3e-4 \
  --weight-decay 0.01 \
  --max-grad-norm 1.0 \
  --train-order shuffle \
  --max-input-length 160 \
  --max-target-length 256 \
  --max-new-tokens 128 \
  --input-format compact \
  --eval-batch-size 8 \
  --num-beams 4 \
  --early-stopping
```

The final production checkpoint was produced by continuing from the best tiny
checkpoint with targeted label-copy weighting:

```sh
.venv-mlx/bin/python scripts/training/seq2seq-timer-benchmark.py \
  --model training/seq2seq-runs/t5-efficient-tiny-label-copy-trainonly-lr3e-5/checkpoint-500 \
  --train training/generated-dsl-compressed-end/timer-sft-train.jsonl \
  --validation training/generated-dsl-compressed-end/timer-sft-validation.jsonl \
  --output-dir training/seq2seq-runs/t5-efficient-tiny-label-copy-final-lr2e-5 \
  --steps 0,100,250,500 \
  --batch-size 8 \
  --learning-rate 2e-5 \
  --weight-decay 0.01 \
  --max-grad-norm 1.0 \
  --train-order shuffle \
  --category-weight explicit-label-copy=6,explicit-sequence=12,explicit-label-copy-train=8 \
  --max-input-length 160 \
  --max-target-length 256 \
  --max-new-tokens 128 \
  --input-format compact \
  --eval-batch-size 8 \
  --num-beams 4 \
  --early-stopping
```

Do not use `--no-repeat-ngram-size` for this task. Repeated timer lines such as
`1m: Rest` and `1m: Work` are valid and often required, so n-gram repetition
blocking can force malformed outputs.

## Evaluate

The seq2seq benchmark writes category-level rates into each step of
`summary.json` under `categorySummary`, and prints the same table after every
eval step. Categories are sorted from weakest strict exact rate to strongest, so
the next training target is visible without manually reading prediction JSONL.

For an OpenAI-compatible endpoint, use the JS evaluator:

```sh
npm run training:eval -- \
  --model <model-name> \
  --dataset training/generated-dsl-compressed-end/timer-sft-validation.jsonl \
  --target-format dsl \
  --out training/eval-runs/<run>/predictions.jsonl \
  --summary-out training/eval-runs/<run>/summary.json
```

It reports parseable, strict exact, and semantic exact rates overall and by
dataset category.

## Results

The production checkpoint is:

```text
training/seq2seq-runs/t5-efficient-tiny-positional-generic-lr1e-5/checkpoint-250
```

Current local scores:

| Model/run | Decode | Strict exact | Semantic exact |
| --- | --- | --- | --- |
| `google/t5-efficient-tiny`, positional-generic candidate | beam 4 | 139/145 | 139/145 |
| same checkpoint, excluding provably repairable generic rows | beam 4 | 139/139 | 139/139 |
| `google/flan-t5-small`, pre-label-copy checkpoint | beam 4 | 133/139 | 133/139 |

The compressed repeat syntax removed the long-output counting failures that made
the tiny model unreliable. The label-copy continuation fixed the remaining
explicit sequence misses without regressing count, pair, generic timer, or
original validation rows. The positional-generic continuation fixes the observed
prompt `first and last timers 5 minute, 5 one minute in between` without
regressing non-positional validation. The remaining raw-model misses are generic
list variants covered by the shared deterministic generic-list repair in the
browser path.

The current dataset adds compact generic group targets for those remaining raw
model misses. Symmetric generic bookends use `around`; asymmetric generic
sequences use `+`. This is intended to reduce endpoint-copy and middle-run
duplication errors during the next focused continuation run.

## Browser Export

The deployed browser model is a selective q8 ONNX export of the production
checkpoint:

```text
models/timey-t5-efficient-tiny/
```

It contains tokenizer/config files at the model root and the two ONNX files used
by the browser runtime. The encoder is q8. The decoder is dynamically quantized
except for `/decoder/shared/Gather` and `/lm_head/MatMul`, which keeps the shared
embedding/lm-head weight fp32. Full signed and unsigned q8 decoder quantization
changed the browser beam output for positional generic prompts.

- `onnx/encoder_model_quantized.onnx`
- `onnx/decoder_model_quantized.onnx`

The app uses Transformers.js for tokenization and raw ONNX Runtime Web for
greedy/beam decoder inference. It intentionally does not use the Transformers.js
`text2text-generation` pipeline because that path hung during browser preload
with this exported T5 checkpoint.
