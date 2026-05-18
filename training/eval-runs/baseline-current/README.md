# Current Tiny Model Baseline

Captured: 2026-05-17T17:30:59Z

This is the Phase 0 baseline for the Timey tiny in-browser model research plan.
Use it as the comparison point before constrained decoding, int4/mixed
quantization, continuation training, QAT, or distillation experiments.

## Repo State

- Branch: `main`
- HEAD: `60019c5`
- Worktree: dirty at capture time. This baseline intentionally includes the
  current in-progress tiny-model/training/runtime changes in the workspace.

The status at capture time included modified app/test files and untracked
training/model/test assets. Do not treat `60019c5` alone as a reproducible
baseline without the dirty worktree contents.

## Production

- Website: <https://timey-interval-timer.netlify.app>
- Last known production deploy ID: `6a09ec415a31a1162a974b9b`
- Unique deploy URL:
  <https://6a09ec415a31a1162a974b9b--timey-interval-timer.netlify.app>

## Model Constants

From `llm-planner.js` at capture time:

- `TRANSFORMERS_PACKAGE_VERSION`: `4.2.0`
- `TRAINED_TINY_MODEL_ID`: `timey-t5-efficient-tiny`
- `TRAINED_TINY_MODEL_VERSION`:
  `t5-efficient-tiny-positional-generic-lr1e-5-checkpoint-250-selective-q8-ort-beam`
- `TRAINED_TINY_MODEL_DTYPE`: `q8-encoder-selective-q8-decoder`
- `TRAINED_TINY_MODEL_DEVICE`: `wasm`
- `ONNXRUNTIME_WEB_VERSION`: `1.26.0-dev.20260416-b7804b056c`
- `TINY_TIMER_ENCODER_URL`:
  `/models/timey-t5-efficient-tiny/onnx/encoder_model_quantized.onnx`
- `TINY_TIMER_DECODER_URL`:
  `/models/timey-t5-efficient-tiny/onnx/decoder_model_quantized.onnx`
- `TINY_TIMER_INPUT_PREFIX`: `translate timer request to Timey DSL: `
- `TINY_TIMER_MAX_INPUT_TOKENS`: `160`
- `TINY_TIMER_MAX_NEW_TOKENS`: `64`
- `TINY_TIMER_NUM_BEAMS`: `4`
- `TINY_TIMER_TOPK_PER_BEAM`: `8`

From `service-worker.js` at capture time:

- App cache: `timey-app-v40`
- Model cache: `timey-model-t5-efficient-tiny-selective-q8-v1`

## Model Asset Sizes

```text
 11496369 models/timey-t5-efficient-tiny/onnx/encoder_model_quantized.onnx
 37352042 models/timey-t5-efficient-tiny/onnx/decoder_model_quantized.onnx
 48848411 total
```

Directory size:

```text
50108 KB models/timey-t5-efficient-tiny
```

## Dataset Baseline

Command:

```sh
npm run training:validate
```

Result:

```text
training/generated-dsl-compressed-end/timer-sft-train.jsonl: 771 records
  core-regression: 6
  count-generic: 96
  count-middle: 161
  count-pairs: 98
  explicit-label-copy: 98
  explicit-label-copy-train: 58
  explicit-sequence: 4
  generic-position: 86
  generic-timers: 7
  individual-middle: 118
  pairs: 39
training/generated-dsl-compressed-end/timer-sft-validation.jsonl: 145 records
  core-regression: 2
  count-generic: 21
  count-middle: 35
  count-pairs: 22
  explicit-label-copy: 22
  explicit-sequence: 1
  generic-position: 5
  generic-timers: 2
  individual-middle: 26
  pairs: 9
Validated 916 records.
```

## Check Results

### Unit And Console Suites

Command:

```sh
npm test
```

Result:

```text
timer DSL tests passed
fallback planner tests passed
assistant session fixture tests passed
fallback suite passed
llm planner tests passed
planner LLM path tests passed
LLM suite passed
all tests passed
```

### Browser Regression Suite

Command:

```sh
npm run test:browser
```

Result:

```text
Running 5 tests using 3 workers

  -  1 tests/browser/real-tiny-model.spec.mjs:262:1 › trained tiny timer model obeys interval setup prompts
  ✓  3 tests/browser/timeline-seek.spec.mjs:11:1 › timeline supports click and drag seeking across the full plan
  ✓  4 tests/browser/timeline-seek.spec.mjs:59:1 › timeline supports touch scrubbing on a mobile viewport
  ✓  5 tests/browser/timeline-seek.spec.mjs:105:1 › mobile layout reserves space for the Timey widget
  ✓  2 tests/browser/cache-separation.spec.mjs:12:1 › ui service worker upgrades do not delete or redownload the model cache

  1 skipped
  4 passed
```

### Real Browser Tiny Model Acceptance

Command:

```sh
npm run test:llm:real
```

Result:

```text
Real tiny model by category:
  core-regression: 7/7 (100.0%)
  explicit-label-copy: 4/4 (100.0%)
  generic-count: 15/15 (100.0%)
  generic-position: 26/26 (100.0%)
  ✓  1 tests/browser/real-tiny-model.spec.mjs:262:1 › trained tiny timer model obeys interval setup prompts

  1 passed
```

## Baseline Acceptance Criteria

Any future experiment must be compared against this baseline. Do not promote an
experiment unless it preserves or improves:

- `npm test`
- `npm run training:validate`
- `npm run test:browser`
- `npm run test:llm:real`
- Real browser category rates:
  - `core-regression`
  - `explicit-label-copy`
  - `generic-count`
  - `generic-position`

For model-file experiments, also record:

- encoder bytes
- decoder bytes
- total model directory size
- browser session creation success/failure
- raw category summary from `npm run test:llm:real`

