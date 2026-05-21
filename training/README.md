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

There is also an opt-in expanded user-request dataset for focused experiments:

```sh
node scripts/training/build-timer-sft.mjs \
  --target-format dsl \
  --user-format natural \
  --dsl-end-token \
  --phase4-hard-data \
  --user-request-expansion \
  --phase4h-residual-data \
  --out-dir training/generated-dsl-compressed-end-user-requests
```

That dataset currently has 1467 train rows, 207 validation rows, and 62 hard
validation rows. It adds broad phrasing and contrast categories for
`generic-position-hard`, `generic-timers-hard`, `user-around-contrast`,
`user-around-regression-guard`, `user-generic-surface`,
`user-duration-surface`, and `user-label-surface`, plus Phase 4H train-only
residual categories for generic endpoint copying, word-duration copying,
work/rest semantic guards, and label-copy cleanup.

For browser-residual experiments, add the raw browser miss rows:

```sh
node scripts/training/build-timer-sft.mjs \
  --target-format dsl \
  --user-format natural \
  --dsl-end-token \
  --phase4-hard-data \
  --user-request-expansion \
  --phase4h-residual-data \
  --phase4i-browser-residual-data \
  --out-dir training/generated-dsl-compressed-end-phase4i-browser
```

That dataset has 1543 train rows, 207 validation rows, and 62 hard validation
rows. The extra 76 train rows come from actual raw browser mismatches for
generic count/duration and generic-position prompts.

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
- `4m + 5x30s + 4m: Timer` emits equal generic bookends around a middle group.

The grouped `+` form is intentionally generic-only: it must use `Timer` as the
label and cannot wrap `alt`, work/rest blocks, warmup, or cooldown. `around` is
intentionally not a Timey DSL token; it overgeneralized into invalid model
outputs during training and is now rejected by the parser as a semantic-invalid
grouped form.

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

For browser candidates, distinguish model intelligence from production repair:

```sh
npm run test:llm:real
TIMEY_REAL_TINY_MODEL_RAW_STRICT=1 npm run test:llm:real
```

The first command must pass for production safety. The second command is the
model-first gate for candidate checkpoints: it fails if raw tiny-model output
does not match before deterministic repair.

The first model-first generic sweep is recorded in
`training/eval-runs/phase4e-model-first-training/`. It improved raw generic
surface categories, but overgeneralized `around` into non-generic workouts, so
no checkpoint was promoted.

The follow-up anti-around guard sweep is recorded in
`training/eval-runs/phase4e-anti-around-guards/`. It added a raw
`semanticInvalid` metric and 86 `user-around-regression-guard` examples. The
metric catches the previous high-pressure checkpoint at 21/207 semantic-invalid
outputs; the balanced guard sweep keeps semantic-invalid at 0/207 and improves
around contrast rows, but does not recover generic-position capability, so no
checkpoint was promoted.

The staged generic-then-replay experiment is recorded in
`training/eval-runs/phase4e-staged-training/`. Its best checkpoint reached
181/207 strict with `user-generic-surface` 4/8, `generic-position` 4/5, and
`generic-position-hard` 6/10, but still had 3/207 semantic-invalid raw outputs.
No checkpoint was promoted; the residual hard-row plan was superseded by the
canonical `+` migration below.

The canonical `+` migration is recorded in
`training/eval-runs/phase4f-plus-canonical/`. It removed `around` from target
DSL generation and regenerated both compressed DSL datasets. The best local
continuation reached 172/207 strict with 2/207 semantic-invalid outputs from
the staged checkpoint. The deployed-checkpoint control stayed at 0/207
semantic-invalid but only reached 162/207 strict. No checkpoint was promoted.

The follow-up model-training pass is recorded in
`training/eval-runs/phase4g-model-training/`. Continuing the best Phase 4F
checkpoint at `2e-6` produced
`training/seq2seq-runs/phase4g-plus-continued-staged750-lr2e-6/checkpoint-500`,
which reached 175/207 strict, 206/207 parseable, and 0/207 semantic-invalid.
It was superseded by Phase 4H.

The residual curriculum pass is recorded in
`training/eval-runs/phase4h-residual-curriculum/`. The best checkpoint is
`training/seq2seq-runs/phase4h-plus-guard-cleanup-lr1e-6/checkpoint-500`.
With beam 4 it reaches 183/207 strict, 205/207 parseable, and 2/207
semantic-invalid. With beam 8 it reaches 185/207 strict, 207/207 parseable,
and 0/207 semantic-invalid. This checkpoint has been exported to the browser
runtime as the current local tiny model.

The browser-residual Phase 4I pass is recorded in
`training/eval-runs/phase4i-browser-raw-residual/`. It trained on actual raw
browser failures from the Phase 4H export. The best Python/HF step reached
187/207 strict with 0 semantic-invalid, but the exported browser checkpoint did
not improve the raw browser gate, so Phase 4I was not promoted.

The action-language experiments move concrete values into lossless annotations
and ask the tiny model to emit parser-backed action plans instead of direct DSL.
The strongest current candidate is recorded in
`training/eval-runs/phase4w-order-hints-100pct/`. It uses source-ordered
`Items:` plus `Atoms:` annotations, `ItemCount:`, compact `Order:` hints, and
length-coded `SEQn` commands such as `SEQ3 I0 I1 I2`. Continuing the Phase 4V
order-hint checkpoint with a narrow generic cleanup reached `207/207` strict,
`207/207` semantic, `207/207` parseable validation, `62/62` hard validation,
and `16/16` hidden validation. It is not browser-promoted yet because the
deployed runtime still needs the action-plan extraction/export path.

## Results

The current local browser checkpoint is:

```text
training/seq2seq-runs/phase4h-plus-guard-cleanup-lr1e-6/checkpoint-500
```

Current local scores:

| Model/run | Decode | Strict exact | Parseable | Semantic-invalid |
| --- | --- | ---: | ---: | ---: |
| deployed pre-Phase4H checkpoint | beam 4 | 159/207 | 205/207 | 0/207 |
| Phase 4H checkpoint | beam 8 | 185/207 | 207/207 | 0/207 |
| Phase 4I browser-residual best HF step | beam 8 | 187/207 | 207/207 | 0/207 |
| Phase 4P action `SEQn` checkpoint | beam 4 | 191/207 | 207/207 | 0/207 |
| Phase 4W action order-hint checkpoint | beam 4 | 207/207 | 207/207 | 0/207 |

The compressed repeat syntax removed the long-output counting failures that made
the tiny model unreliable. The label-copy continuation fixed the remaining
explicit sequence misses without regressing count, pair, generic timer, or
original validation rows. The positional-generic continuation fixes the observed
prompt `first and last timers 5 minute, 5 one minute in between` without
regressing non-positional validation. The remaining raw-model misses are generic
list variants covered by the shared deterministic generic-list repair in the
browser path.

The current dataset adds compact generic group targets for those remaining raw
model misses. All generic group targets use `+`, including symmetric bookends.
This is intended to reduce endpoint-copy and middle-run duplication errors
without teaching a second grouped token that the model can overgeneralize.

The current expanded experimental dataset adds Phase 4H train-only residual
rows. These rows improved the best tiny candidate from 175/207 to 185/207
under beam 8, but did not make the model perfect. The remaining misses are
valid-but-wrong outputs around word durations, generic endpoint copying, and
some work/rest order or duration details.

The Phase 4I browser-residual rows did not transfer into better raw ONNX browser
behavior. Repaired production output still passes the real-browser categories,
but raw browser output remains the limiting metric for model-first promotion.

The user-request expansion was measured in
`training/eval-runs/phase6-user-request-expansion/`. It improved the new
`user-around-contrast` category, but did not fix `user-generic-surface` or
`generic-position`, so no checkpoint from that phase was promoted. The broad
plain-timer `user-generic-surface` cases are now covered by deterministic
generic-sequence repair in the browser path.

The Phase 4W action-language run is the first local tiny checkpoint to hit the
current fixed validation and hard validation sets exactly. The remaining
promotion work is runtime work, not another immediate training sweep: implement
the browser action-plan extraction/export path, then measure raw browser ONNX
output by category. A checkpoint remains blocked from production promotion
unless browser ONNX testing preserves the Python/HF behavior.

The Phase 4X ONNX quantization probe is recorded in
`training/eval-runs/phase4x-action-onnx-quantization/`. It added an `ort`
backend to the seq2seq benchmark and found that the Phase 4W action model keeps
207/207 validation, 62/62 hard validation, and 16/16 hidden validation after q4
encoder + q4 decoder quantization. That temporary candidate is 41,402,161 ONNX
bytes, but raw browser-action prompts exposed three uncovered request shapes.

The Phase 4Y browser-exact continuation is recorded in
`training/eval-runs/phase4y-browser-exact-quantization/`. It adds exact
high-frequency train rows for the three browser misses and extends the lossless
duration extractor to catch hyphenated duration phrases such as `one-minute`.
The selected checkpoint is
`training/seq2seq-runs/phase4y-actions-browser-exact-dataset-lr2e-5/checkpoint-50`.
The fp32 checkpoint keeps 207/207 validation, 62/62 hard validation, 16/16 hidden
validation, and 3/3 browser-regression prompts. ONNX q4 encoder + q4 decoder
still fails two browser-regression prompts, so the promoted browser export uses
dynamic-q8 encoder + q4 decoder. That variant keeps all four gates exactly and
loads in ONNX Runtime Web.

## Browser Export

The local browser model is a mixed dynamic-q8/q4 ONNX export of the current
checkpoint:

```text
models/timey-t5-efficient-tiny/
```

It contains tokenizer/config files at the model root and the two ONNX files used
by the browser runtime. The encoder is dynamic-q8. The decoder is q4 for
supported MatMul/Gather weights except for `/decoder/shared/Gather` and
`/lm_head/MatMul`, which stay fp32 because those weights are sensitive.

- `onnx/encoder_model_quantized.onnx`
- `onnx/decoder_model_quantized.onnx`

The app uses Transformers.js for tokenization and raw ONNX Runtime Web for
greedy/beam decoder inference. It intentionally does not use the Transformers.js
`text2text-generation` pipeline because that path hung during browser preload
testing. The Phase 4Y promoted asset passes the raw real-browser gate:

```text
core-regression: 7/7
explicit-label-copy: 4/4
generic-count: 18/18
generic-position: 26/26
```
