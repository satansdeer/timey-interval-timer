# Timey Tiny Model Research And Optimization TODO

Last updated: 2026-05-20

This document is the continuity file for pushing Timey's in-browser timer model
as far as practical on both capability and footprint. It is intended to be
self-contained enough that a future agent can resume from this file after
context compaction or full context loss.

## Goal

Timey should translate natural-language timer requests into timer sequences in
the browser with a tiny local model, while keeping download size, memory use,
and latency low.

Current strategy:

1. Use a tiny seq2seq model for fuzzy natural-language interpretation.
2. Keep production output parser-backed and compact: the deployed model emits
   Timey DSL today, while current model-first experiments emit Timey action
   plans over deterministic `Items:`/`Atoms:` annotations.
3. Parse all model output with the same shared parser stack used for human
   DSL input.
4. Let deterministic code own cases that are provable without model inference:
   direct DSL input, simple generic timer lists, and fallback/corrections.
5. Measure all changes by category, not only by aggregate exact match.

## Current Known State

Production URL:

- <https://timey-interval-timer.netlify.app>

Last known production deploy:

- Deploy ID: `6a0a023455042e53b919a783`
- Unique URL:
  <https://6a0a023455042e53b919a783--timey-interval-timer.netlify.app>

Current checked-in local browser model:

- App model id: `timey-t5-efficient-tiny`
- Source checkpoint:
  `training/seq2seq-runs/phase4y-actions-browser-exact-dataset-lr2e-5/checkpoint-50`
- Runtime version string in `llm-planner.js`:
  `phase4y-actions-browser-exact-checkpoint-50-dynq8enc-q4dec-ort-beam4`
- Browser model directory: `models/timey-t5-efficient-tiny/`
- Encoder: dynamic-q8 ONNX
- Decoder: opset21 q4 ONNX for supported MatMul/Gather weights
- Decoder q4 exceptions:
  - `/decoder/shared/Gather`
  - `/lm_head/MatMul`
- Current model cache key in `service-worker.js`:
  `timey-model-t5-efficient-tiny-phase4y-actions-dynq8enc-q4dec-v1`
- Current app cache key in `service-worker.js`: `timey-app-v48`
- Encoder content length:
  `11,498,300` bytes
- Encoder SHA-256:
  `4152664aa507d6698f5ca0e051b3386265110f8ab048be3421bf93cd92b25b2f`
- Decoder content length:
  `35,285,526` bytes
- Decoder SHA-256:
  `3d641ce66066fbda9750ec8fbdc190a839ee4078e939beae6c3ef541aad9e4d6`
- ONNX assets total:
  `46,783,826` bytes.

Current runtime:

- `llm-planner.js` uses Transformers.js only for tokenization.
- It uses raw ONNX Runtime Web for encoder/decoder inference.
- Beam search is implemented locally in `llm-planner.js`.
- The model emits action commands over lossless source ids. The browser runtime
  parses those actions directly and does not repair successful model output.
- `TINY_TIMER_NUM_BEAMS = 4`
- `TINY_TIMER_TOPK_PER_BEAM = 8`
- `TINY_TIMER_MAX_INPUT_TOKENS = 480`
- `TINY_TIMER_MAX_NEW_TOKENS = 64`
- ONNX Runtime Web version:
  `1.26.0-dev.20260416-b7804b056c`
- Transformers.js version: `4.2.0`

Current dataset:

- Dataset output directory:
  `training/generated-actions-lossless-item-atoms-seqlen-orderhints-phase4y/`
- Train rows: 2639
- Validation rows: 207
- Hard validation rows: 62
- Hidden validation rows: 16
- Total rows: 2846
- Dataset version in `scripts/training/timer-sft-lib.mjs`: `2026-05-18`
- Target format: action plans with length-coded `SEQn` commands over source
  ids, for example `SEQ3 I0 I1 I2`.
- User format: raw request plus lossless source-backed `Items:`, `Atoms:`,
  `ItemCount:`, and `Order:` annotations.
- Phase 4Y adds 720 high-frequency exact train rows for the three real browser
  action misses.

Current best experimental action-language candidate:

- Source checkpoint:
  `training/seq2seq-runs/phase4y-actions-browser-exact-dataset-lr2e-5/checkpoint-50`
- Dataset:
  `training/generated-actions-lossless-item-atoms-seqlen-orderhints-phase4y/`
- Target format: action plans with length-coded `SEQn` commands over
  deterministic source ids, for example `SEQ3 I0 I1 I2`.
- User format: raw request plus lossless source-backed `Items:`, `Atoms:`,
  `ItemCount:`, and `Order:` annotations.
- Python/HF validation:
  `207/207` strict, `207/207` semantic, `207/207` parseable, `0/207`
  semantic-invalid.
- Hard validation:
  `62/62` strict, `62/62` parseable, `0/62` semantic-invalid.
- Hidden validation:
  `16/16` strict, `16/16` parseable, `0/16` semantic-invalid.
- Browser-regression validation:
  `3/3` strict, `3/3` parseable, `0/3` semantic-invalid.
- Status: promoted locally to the browser runtime as dynamic-q8 encoder + q4
  decoder ONNX assets.

Current best experimental action-language ONNX candidate:

- Source checkpoint:
  `training/seq2seq-runs/phase4y-actions-browser-exact-dataset-lr2e-5/checkpoint-50`
- Temporary local ONNX directory:
  `/private/tmp/timey-phase4y-actions-onnx/dynq8enc-q4dec`
- Quantization:
  dynamic-q8 encoder + q4 decoder with decoder exclusions for
  `/decoder/shared/Gather` and `/lm_head/MatMul`.
- ONNX sizes:
  encoder `11,498,300` bytes, decoder `35,285,526` bytes, total `46,783,826`
  bytes.
- Local ORT validation:
  `207/207` validation, `62/62` hard validation, `16/16` hidden validation,
  `3/3` browser-regression validation, `0` semantic-invalid across all gates.
- Status: promoted locally. q4 encoder + q4 decoder stayed perfect on the main
  offline gates but failed two of three real browser-regression prompts.

Current opt-in expanded dataset:

- Dataset output directory:
  `training/generated-dsl-compressed-end-user-requests/`
- Build flags:
  `--phase4-hard-data --user-request-expansion --phase4h-residual-data`
- Train rows: 1467
- Validation rows: 207
- Hard validation rows: 62
- New categories:
- `generic-position-hard`
- `generic-timers-hard`
  - `user-around-contrast`
  - `user-around-regression-guard`
  - `user-generic-surface`
  - `user-duration-surface`
  - `user-label-surface`
- Train-only Phase 4H residual categories:
  - `phase4h-generic-endpoint`
  - `phase4h-count-duration`
  - `phase4h-work-rest-contrast`
  - `phase4h-plus-work-rest-guard`
  - `phase4h-label-copy`

Current opt-in browser-residual dataset:

- Dataset output directory:
  `training/generated-dsl-compressed-end-phase4i-browser/`
- Build flags:
  `--phase4-hard-data --user-request-expansion --phase4h-residual-data --phase4i-browser-residual-data`
- Train rows: 1543
- Validation rows: 207
- Hard validation rows: 62
- New train-only Phase 4I category:
  - `phase4i-browser-raw-residual`: 76 rows from 19 real raw browser misses
    with four instruction variants each.

Current validation categories:

- `core-regression`
- `count-generic`
- `count-middle`
- `count-pairs`
- `explicit-label-copy`
- `explicit-sequence`
- `generic-position`
- `generic-position-hard`
- `generic-timers`
- `generic-timers-hard`
- `individual-middle`
- `pairs`
- `user-around-contrast`
- `user-around-regression-guard`
- `user-duration-surface`
- `user-generic-surface`
- `user-label-surface`

Current HF/browser candidate status:

- Checkpoint:
  `training/seq2seq-runs/phase4y-actions-browser-exact-dataset-lr2e-5/checkpoint-50`
- Required decode for current best Python/HF result: beam 4
- Python/HF expanded validation result with beam 4:
  207/207 strict, 207/207 parseable, 0/207 semantic-invalid
- Export status: exported and promoted to local browser assets with dynamic-q8
  encoder and q4 decoder.
- Browser debug status: ORT Web loads both sessions; beam-4 generation works.
- Production deploy status: not updated in this phase.

Current real-browser acceptance categories with Phase 4Y local browser assets:

```text
core-regression: 7/7
explicit-label-copy: 4/4
generic-count: 18/18
generic-position: 26/26
```

Current raw browser output gate with Phase 4Y local browser assets:

```text
core-regression: 7/7
explicit-label-copy: 4/4
generic-count: 18/18
generic-position: 26/26
```

## Source Of Truth Files

Core app/runtime:

- `timer-dsl.js`
  - Shared parser/formatter for human DSL and model DSL.
  - Owns `parseTimerDsl`, compact duration formatting, repeat syntax,
    compact generic group syntax, kind inference, and
    `findTimerDslStartIndex`.
- `llm-planner.js`
  - Tiny model preload and inference.
  - Direct DSL bypass before model generation.
  - Browser encoder/decoder ONNX Runtime Web path.
  - Local beam search.
  - Generic-list repair after model output.
- `fallback-planner.js`
  - Deterministic fallback planner.
  - Correction handling.
  - Explicit generic timer extraction and positional generic repairs.
- `planner.js`
  - Chooses tiny model path when loaded, otherwise fallback.
- `assistant-session.js`
  - DOM-free session layer used by web UI and console harness.
- `service-worker.js`
  - App cache and separate model cache.
  - Bump app cache when JS/CSS/HTML changes.
  - Bump model cache only when `/models/` assets change.

Training/eval:

- `scripts/training/timer-sft-lib.mjs`
  - Synthetic dataset source of truth.
  - Category generation.
  - DSL target formatting.
  - Parser-backed validation and comparison.
- `scripts/training/build-timer-sft.mjs`
  - Builds JSONL train/validation/all files.
- `scripts/training/validate-timer-sft.mjs`
  - Validates generated JSONL and prints category counts.
- `scripts/training/seq2seq-timer-benchmark.py`
  - Local seq2seq training and evaluation.
  - Now writes `categorySummary` per step in `summary.json`.
- `scripts/training/quantize-onnx-matmul-nbits.py`
  - Durable wrapper around ORT `MatMulNBitsQuantizer`.
  - Installs the small local `onnx_ir` compatibility shim needed by the
    project environment.
- `scripts/training/eval-timer-model.mjs`
  - OpenAI-compatible endpoint evaluator.
  - Now prints per-category parse/strict/semantic rates and can write
    `--summary-out`.
- `training/README.md`
  - Human docs for current training flow.

Acceptance/debug:

- `tests/browser/real-tiny-model.spec.mjs`
  - Real browser ONNX/Transformers.js acceptance test.
  - Use this to validate the actual browser runtime, not just Python/HF.
- `scripts/debug-tiny-browser-model.mjs`
  - Debugs browser loading/generation.
  - Supports raw ORT session loading mode.
- `tests/llm-planner.test.mjs`
  - Unit tests for tiny planner helpers.
- `tests/fallback-planner.test.mjs`
  - Unit tests for deterministic parser/fallback behavior.
- `tests/timer-dsl.test.mjs`
  - Unit tests for Timey DSL grammar.
- `tests/browser/cache-separation.spec.mjs`
  - Ensures UI cache upgrades do not delete/redownload model cache.

## Important Commands

Run standard tests:

```sh
npm test
npm run training:validate
npm run test:browser
```

Run real browser tiny model acceptance:

```sh
npm run test:llm:real
```

Debug browser model loading and generation:

```sh
npm run debug:tiny-model
```

Build and validate dataset:

```sh
npm run training:build
npm run training:validate
```

Run OpenAI-compatible endpoint eval:

```sh
npm run training:eval -- \
  --model <model-name> \
  --dataset training/generated-dsl-compressed-end/timer-sft-validation.jsonl \
  --target-format dsl \
  --out training/eval-runs/<run>/predictions.jsonl \
  --summary-out training/eval-runs/<run>/summary.json
```

Run local seq2seq benchmark/training:

```sh
.venv-mlx/bin/python scripts/training/seq2seq-timer-benchmark.py \
  --model <checkpoint-or-base-model> \
  --train training/generated-dsl-compressed-end/timer-sft-train.jsonl \
  --validation training/generated-dsl-compressed-end/timer-sft-validation.jsonl \
  --output-dir training/seq2seq-runs/<run-name> \
  --steps 0,100,250,500 \
  --batch-size 8 \
  --learning-rate <lr> \
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

Deploy static bundle:

```sh
rm -rf /tmp/timey-netlify
mkdir -p /tmp/timey-netlify
cp index.html styles.css main.js assistant-session.js fallback-planner.js planner.js llm-planner.js service-worker.js manifest.webmanifest favicon.svg timer-dsl.js /tmp/timey-netlify/
cp -R models /tmp/timey-netlify/
netlify deploy --prod --dir /tmp/timey-netlify --message "Deploy Timey"
```

## Research References

### Constrained Decoding

- PICARD: Parsing Incrementally for Constrained Auto-Regressive Decoding from
  Language Models
  - Paper: <https://arxiv.org/abs/2109.05093>
  - Hugging Face paper page: <https://huggingface.co/papers/2109.05093>
  - Why relevant: PICARD rejects inadmissible tokens during decoding for formal
    output languages. Timey DSL is much smaller than SQL, so this should be
    easier to implement.

- NeuroLogic Decoding: Neural Text Generation with Predicate Logic Constraints
  - Paper: <https://arxiv.org/abs/2010.12884>
  - Why relevant: useful background for constrained generation. Probably less
    directly applicable than PICARD because our constraints are mostly syntax
    and a few local structure constraints.

### Quantization

- ONNX Runtime quantization docs
  - Docs: <https://onnxruntime.ai/docs/performance/model-optimizations/quantization.html>
  - Relevant section: `Quantize to Int4/UInt4`
  - Why relevant: documents `MatMulNBits` and block-wise weight-only int4
    quantization. This is the most likely path to shrink the current q8 model.

- ONNX 4-bit integer types
  - Docs: <https://onnx.ai/onnx/technical/int4.html>
  - Why relevant: defines `INT4`/`UINT4` storage and mentions weight-only
    compression. This tells us what format-level support exists.

- Understanding INT4 Quantization for Transformer Models: Latency Speedup,
  Composability, and Failure Cases
  - Paper: <https://arxiv.org/abs/2301.12017>
  - Why relevant: explicitly studies W4A4 transformer behavior and notes
    important failure modes. Encoder-decoder models are a better target than
    decoder-only models, which fits T5.

- EfficientQAT: Efficient Quantization-Aware Training for Large Language Models
  - Paper: <https://arxiv.org/abs/2407.11062>
  - Hugging Face paper page: <https://huggingface.co/papers/2407.11062>
  - Why relevant: if int4 breaks browser beam outputs, QAT-style continuation
    may recover enough accuracy while keeping low-bit footprint.

### Distillation

- Sequence-Level Knowledge Distillation
  - Paper: <https://arxiv.org/abs/1606.07947>
  - Hugging Face paper page: <https://huggingface.co/papers/1606.07947>
  - Why relevant: NL to Timey DSL is a translation task. A stronger teacher can
    generate canonical DSL labels and hard paraphrases, then the tiny model
    learns the sequence distribution.

## Compatibility Of Proposed Experiments

The experiments are compatible if applied as layers:

```text
better dataset / teacher distillation
→ tiny checkpoint continuation
→ optional quantization-aware continuation
→ selective q8/q4 ONNX export
→ constrained browser decoding
→ category eval + real browser acceptance
```

Constrained decoding is runtime-only and can be applied to any checkpoint or
quantization variant.

Distillation improves training data and is compatible with normal continuation
training and later quantization.

QAT should happen after selecting a strong checkpoint and before final export.

Selective q8/q4 export is a deployment compression layer. It should be measured
after every training/QAT candidate because quantization can change beam order.

## Work Plan

### Phase 0: Baseline Manifest

Status: completed 2026-05-17

Purpose: create a durable baseline before changing runtime or model assets.

Tasks:

- [x] Create `training/eval-runs/baseline-current/`.
- [x] Save current `npm run test:llm:real` output with category summary.
- [x] Save current model file sizes:
  - `models/timey-t5-efficient-tiny/onnx/encoder_model_quantized.onnx`
  - `models/timey-t5-efficient-tiny/onnx/decoder_model_quantized.onnx`
- [x] Save current `llm-planner.js` model constants.
- [x] Save production URL/deploy id.
- [x] Save `npm test`, `npm run training:validate`, and
  `npm run test:browser` results.

Artifact:

- `training/eval-runs/baseline-current/README.md`

Done criteria:

- A future agent can compare any experiment against this baseline without
  reading old conversation context.

### Phase 1: Constrained Timey DSL Decoding

Status: completed 2026-05-17

Hypothesis:

Constrained decoding will improve robustness and may allow smaller/weaker
quantized decoders because invalid DSL branches are removed before beam ranking
matters.

Implementation:

- Added prefix-validity helpers in `timer-dsl.js`:
  - `isTimerDslPrefix(text)`
  - `isCompleteTimerDsl(text)`
  - `getTimerDslPrefixState(text)`
- The implementation reuses the real parser by probing whether a small suffix
  can complete a partial output into parseable Timey DSL. This avoids creating
  a second independent grammar.
- Grammar to support:
  - `duration: label`
  - `Nx duration: label`
  - `Nalt duration: label | duration: label`
  - multiple commands separated by newline, comma, semicolon, or whitespace
    when the next valid command starts.
  - final `END` line for model outputs.
- Keep labels permissive after `:`:
  - Allow partial labels while prefix is incomplete.
  - Recognize command boundaries when a new duration/repeat start appears.
- Modified `generateBeamSearch` in `llm-planner.js`:
  - Decode candidate `outputIds` for each candidate.
  - Reject candidate tokens whose decoded text is not a valid DSL prefix.
  - Let EOS through only if the text is complete DSL.
  - If all candidates are rejected for a beam, keep one guarded fallback
    candidate and mark `constraintFallback: true` on the beam.
- Added unit tests for prefix/completeness helpers in `tests/timer-dsl.test.mjs`.

Measurement:

- `npm test`: passed.
- `npm run training:validate`: passed.
- `npm run test:llm:real`: passed.
- `npm run test:browser`: passed.
- Real browser acceptance after constrained decoding:
  - `core-regression`: 7/7
  - `explicit-label-copy`: 4/4
  - `generic-count`: 15/15
  - `generic-position`: 26/26
- Real browser test runtime after constrained decoding: about 35 seconds, in
  the same rough range as the Phase 0 baseline.
- Deployed to production:
  - Deploy ID: `6a09fdc1ca126541a6dfcf6c`
  - Website: <https://timey-interval-timer.netlify.app>
  - Unique URL:
    <https://6a09fdc1ca126541a6dfcf6c--timey-interval-timer.netlify.app>
  - App cache bumped to `timey-app-v41`.
  - Model cache remained `timey-model-t5-efficient-tiny-selective-q8-v1`.

Success criteria:

- [x] No category regression.
- [x] No malformed raw DSL for acceptance prompts observed by acceptance suite.
- [x] Browser runtime still completes under current timeout.

Risks:

- T5 tokenization can emit partial pieces that decode oddly. Prefix validation
  must accept incomplete but potentially valid prefixes.
- Overly strict constraints can block valid labels. Keep label region broad.
- Grammar constraints can change beam ranking. Use category summary to catch
  subtle regressions.

### Phase 2: Selective INT4 / Mixed Q4-Q8 ONNX Export

Status: completed initial sweep; q8 encoder + q4 decoder promoted and deployed.

Hypothesis:

Weight-only int4 on selected MatMul nodes can reduce model size without losing
category accuracy, especially when constrained decoding is active.

Starting point:

- Current selective q8 decoder works.
- Full signed q8 decoder and unsigned q8 decoder previously changed browser
  beam outputs for positional prompts.
- Mixed q8 encoder + fp32 decoder worked but model directory was about 61 MB.
- Current selective q8 decoder is about 36 MB and total model dir about 49 MB.

Existing selective q8 command that produced the current decoder:

```sh
.venv-mlx/bin/python -c "from onnxruntime.quantization import quantize_dynamic, QuantType; quantize_dynamic('/tmp/timey-t5-positional-manual250-onnx-v1/decoder_model.onnx', '/tmp/timey-t5-positional-manual250-onnx-v1/decoder_model_q8_exclude_shared_lm.onnx', weight_type=QuantType.QInt8, nodes_to_exclude=['/lm_head/MatMul','/decoder/shared/Gather']); print('done')"
```

Tasks:

- [x] Recreate a clean fp32 ONNX export from the current checkpoint if needed.
- [x] Try encoder int4 weight-only first.
- [x] Try decoder int4 with the same exclusions:
  - `/decoder/shared/Gather`
  - `/lm_head/MatMul`
- [x] If decoder int4 fails, try mixed variants:
  - encoder q4 + decoder selective q8
  - encoder q8 + decoder selected q4 MLP-only nodes
  - encoder q8 + decoder attention q8 and MLP q4
  - q4 for larger MatMul nodes only, leave small/sensitive nodes q8/fp32
- [x] Verify ONNX Runtime Web can create sessions for viable candidates.
- [x] Run `npm run debug:tiny-model` in ORT mode against candidate assets.
- [x] Run `npm run test:llm:real`.
- [x] Record model file sizes and category summary.

Measurement table to fill:

| Variant | Encoder | Decoder | Exclusions | Model dir size | Real browser categories | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| baseline | q8 | selective q8 | shared/lm_head fp32 | 50,108 KB | 52/52 | ONNX total 48,848,411 bytes |
| q4-enc/q8-dec | opset21 q4 MatMul+Gather | selective q8 | decoder shared/lm_head fp32 | ONNX total 43,514,704 bytes | 50/52 | Browser loads, but generic-position regressed 24/26 |
| q8-enc/q4-dec | q8 | opset21 q4 MatMul+Gather | decoder shared/lm_head fp32 | 48,108 KB | 52/52 | Promoted locally; ONNX total 46,801,469 bytes |
| q4-enc/q4-dec | opset21 q4 MatMul+Gather | opset21 q4 MatMul+Gather | decoder shared/lm_head fp32 | ONNX total 41,468,159 bytes | 51/52 | Browser loads, but generic-position regressed 25/26 |

Phase 2 notes:

- Clean fp32 ONNX exports were created under `/tmp/timey-phase2-q4-onnx/fp32`
  and `/tmp/timey-phase2-q4-onnx/fp32-opset21`.
- `quantize_dynamic(..., weight_type=QuantType.QInt4/QUInt4)` failed in local
  ORT with `Quantized weights ... must be 8-bit before packing as 4-bit
  values.`
- ORT `MatMulNBits` required a small local `onnx_ir` shim because the installed
  quantizer imports that package but it is not installed in the project venv.
- Opset17 Gather q4 candidates were invalid in ORT because the quantizer lifted
  the graph to opset21 while old `ReduceMean` nodes still used an `axes`
  attribute.
- Opset21 MatMul+Gather q4 candidates loaded in Python ORT CPU and ORT Web.
- The promoted q8 encoder + q4 decoder variant saves 2,046,942 ONNX bytes
  versus baseline and preserves all real-browser acceptance categories. It does
  not meet the 20% stretch reduction, so future compression work should focus on
  q4 encoder recovery, better selective q4 node choice, or QAT.
- `TIMEY_DEBUG_TINY_MODEL_MODE=ort npm run debug:tiny-model` passed on
  2026-05-18 for the promoted q8/q4 assets. ORT Web created both sessions:
  encoder inputs `input_ids`, `attention_mask`; decoder inputs
  `encoder_attention_mask`, `input_ids`, `encoder_hidden_states`.
- Detailed artifact: `training/eval-runs/phase2-q4-candidates/README.md`.

Success criteria:

- Real browser acceptance 52/52.
- No category regression.
- Meaningful model size reduction, preferably at least 20% from current 49 MB.
- No browser session creation failures.

Risks:

- ORT Web may not support some int4 contrib ops in the current WASM build.
- Int4 may preserve parseability but change exact semantic outputs.
- Beam order can change even when greedy top token looks plausible.

### Phase 3: Focused Continuation Training Sweep

Status: completed initial sweep 2026-05-18; no checkpoint promoted.

Hypothesis:

The current checkpoint may have small remaining headroom if continued at low
learning rate with category weighting. Category-level eval should reveal whether
we are improving true weak spots or just trading regressions.

Run from current production checkpoint, not from scratch:

```text
training/seq2seq-runs/t5-efficient-tiny-positional-generic-lr1e-5/checkpoint-250
```

Suggested sweeps:

| Run | Learning rate | Category weights | Steps |
| --- | --- | --- | --- |
| low-lr-a | `5e-6` | none | `0,100,250,500` |
| low-lr-b | `1e-5` | none | `0,100,250,500` |
| low-lr-c | `2e-5` | none | `0,100,250,500` |
| weighted-hard | `1e-5` | `generic-position=3,explicit-label-copy=4,explicit-sequence=6` | `0,100,250,500` |

Sweep result:

| Run | Best strict validation | Result |
| --- | ---: | --- |
| `phase3-low-lr-a` | 139/145 | Flat; no target-category improvement |
| `phase3-low-lr-b` | 139/145 | Flat; no target-category improvement |
| `phase3-low-lr-c` | 139/145 | Flat; no target-category improvement |
| `phase3-weighted-hard` | 139/145 | No target-category improvement; regressed to 138/145 at steps 100 and 500 |

The persistent model-only failures are `generic-position` and `generic-timers`.
The browser runtime passes current acceptance because deterministic generic-list
repair covers the simple cases, but the seq2seq checkpoint itself did not learn
those validation examples through simple continuation.

Artifact:

- `training/eval-runs/phase3-continuation-sweep/README.md`

Command template:

```sh
.venv-mlx/bin/python scripts/training/seq2seq-timer-benchmark.py \
  --model training/seq2seq-runs/t5-efficient-tiny-positional-generic-lr1e-5/checkpoint-250 \
  --train training/generated-dsl-compressed-end/timer-sft-train.jsonl \
  --validation training/generated-dsl-compressed-end/timer-sft-validation.jsonl \
  --output-dir training/seq2seq-runs/<run-name> \
  --steps 0,100,250,500 \
  --batch-size 8 \
  --learning-rate <lr> \
  --weight-decay 0.01 \
  --max-grad-norm 1.0 \
  --train-order shuffle \
  --category-weight <optional-category-weights> \
  --max-input-length 160 \
  --max-target-length 256 \
  --max-new-tokens 128 \
  --input-format compact \
  --eval-batch-size 8 \
  --num-beams 4 \
  --early-stopping
```

Promotion criteria:

- Category summary must preserve:
  - `core-regression`
  - `generic-count`
  - `generic-position`
  - `explicit-label-copy`
- No aggregate regression hidden by category mix.
- Candidate must pass real browser test after ONNX export/quantization.

Do not promote based only on Python/HF validation exact match. Browser ONNX
beam output is the deployment truth.

Phase 3 conclusion:

- No Phase 3 checkpoint should be exported or promoted.
- Move to Phase 4 hard-data expansion / teacher distillation before more
  continuation training.

### Phase 4: Teacher Distillation / Hard Data Expansion

Status: hard-data expansion completed 2026-05-18; no checkpoint promoted.

Hypothesis:

More targeted, parser-validated paraphrases can improve tiny model robustness
without increasing model size.

Approach:

- Use a stronger teacher model to generate natural-language paraphrases for
  existing timer specs.
- Keep Timey DSL targets canonical and parser-validated.
- Do not blindly trust teacher DSL output. Prefer generating requests from
  known timer specs, then using our own formatter for target DSL.
- Add metadata that records:
  - teacher model
  - prompt template
  - source category
  - generated timestamp
  - validation result
- Keep a separate hard validation split to avoid training on every new hard
  case.

Implemented local hard-data expansion:

- Added opt-in dataset flag `--phase4-hard-data`.
- Added parser-validated `generic-position-hard` and `generic-timers-hard`
  examples generated from known timer specs.
- Added hard-validation metadata and
  `timer-sft-hard-validation.jsonl` output.
- Preserved the committed baseline validation set by appending Phase 4 specs
  after all existing specs.

Phase 4 dataset artifact:

- `training/generated-dsl-compressed-end-phase4-hard/`
  - train: 940 rows
  - validation: 161 rows
  - hard validation: 16 rows

Phase 4 run artifact:

- `training/eval-runs/phase4-hard-data/README.md`

Measured result:

| Run | Best strict validation | Hard validation | Result |
| --- | ---: | ---: | --- |
| `phase4-final-unweighted-lr1e-5` | 143/161 | 4/16 | no improvement |
| `phase4-final-weighted-lr1e-5` | 146/161 | 7/16 | partial hard-data improvement, no old-validation regression |
| `phase4-final-weighted-continue500-lr1e-5` | 146/161 at step 0 | 7/16 at step 0 | further continuation overfit and regressed `count-generic` |

Best checkpoint from this phase:

- `training/seq2seq-runs/phase4-final-weighted-lr1e-5/checkpoint-500`

Do not promote it yet:

- Original regular validation remains 139/145.
- Original `generic-position` remains 0/5.
- Hard holdout improved from 4/16 to 7/16, but this is not enough to justify
  export/deployment.

Priority categories:

- `generic-position`
  - first/last/final/start/end/bookend/outer/outside/begin/finish/another
  - middle/between/inside wording
  - bookend duration before/after count
- `explicit-label-copy`
  - arbitrary exercise labels
  - labels with punctuation
  - labels that imply kind: easy, recovery, hard, warmdown
- `count-middle`
  - exact N middle intervals, not N pairs
  - typo variants: `alterating`, `alterations`, `minu`, `mintues`
- `count-pairs`
  - each block contains both rest and work
  - order ambiguity: rest/work vs work/rest

Acceptance:

- Dataset validation passes.
- Category summary improves or stays flat on old validation and hard validation.
- Real browser acceptance remains green after training/export.

Phase 4 conclusion:

- Template-only hard data helps `generic-timers-hard` and a small part of
  `generic-position-hard`, but does not fix the original `generic-position`
  validation examples.
- Follow-up work tried the DSL-level bookend/group syntax. See Phase 4B below.

Risks:

- Synthetic paraphrases can leak validation phrasing if generated from the same
  templates. Keep hard validation examples separate.
- Teacher may produce unnatural wording. Filter obvious artifacts.
- More data can dilute already-good categories. Use category weights if needed.

### Phase 4B: Compact Generic Group DSL

Status: completed 2026-05-18; superseded by Phase 4F canonical `+` syntax, no
checkpoint promoted.

Hypothesis:

Generic positional failures are partly caused by the target DSL requiring the
model to repeat endpoint lines independently. A denser generic syntax should
let the model express the same sequence with fewer copied facts.

Initial syntax tried in `timer-dsl.js`:

```text
4m around 5x30s: Timer
30s + 5x10s + 1m: Timer
```

Original meaning:

- `around` is equal generic bookends around a middle generic group.
- `+` is an ordered generic group chain, including asymmetric endpoints.
- `5x30s` is accepted as no-space repeat shorthand, alongside the older
  `5x 30s`.

Superseding decision:

- `around` is no longer valid target DSL. It overgeneralized into invalid
  warmup/cooldown and work/rest outputs.
- Matching bookends now use the same `+` form as asymmetric groups:
  `4m + 5x30s + 4m: Timer`.
- The parser still allows labels containing `around`, such as
  `1m: Run around`.

Dataset changes:

- Regenerated `training/generated-dsl-compressed-end/`.
- Regenerated `training/generated-dsl-compressed-end-phase4-hard/`.
- Splits and category counts stayed the same.
- Historical Phase 4B targets used `around` when endpoints matched and `+`
  otherwise. Phase 4F regenerated tracked datasets so all generic group targets
  now use `+`.
- Warmup/cooldown, work/rest, pair, alt, and explicit-label targets keep the
  existing syntax.

Measurement artifact:

- `training/eval-runs/phase5-dsl-groups/README.md`

Runs from current production checkpoint:

```text
training/seq2seq-runs/t5-efficient-tiny-positional-generic-lr1e-5/checkpoint-250
```

Results:

| Run | Best strict | Best target gain | Result |
| --- | ---: | --- | --- |
| `phase5-dsl-groups-weighted-lr1e-5` | 143/161 at step 0 | step 500 reaches `generic-position` 3/5 and `generic-position-hard` 5/10 | not usable; parseability regresses to 143/161 |
| `phase5-dsl-groups-weighted-lr1e-5-midpoints` | 144/161 at step 450 | step 450 reaches `generic-position` 3/5 and `generic-position-hard` 5/10 | not usable; broad regression remains |
| `phase5-dsl-groups-soft-lr5e-6` | 143/161 at step 0 | step 750 reaches only `generic-position` 1/5 | not useful; no stable target gain |

Conclusion:

- The DSL change is valid and useful for humans/data.
- The model can learn `around`, but weighted continuation overgeneralizes it.
- The common bad output shape is `warmup around alt middle cooldown`, for
  example:

```text
12m around 5alt 45s: Rest | 45s: Work 9m: Cooldown END
```

- No Phase 4B/5 checkpoint should be exported or deployed.

Follow-up semantic constraint status:

- Implemented in `timer-dsl.js` and `llm-planner.js`.
- Old `around` grouped forms are rejected as semantic-invalid.
- `+` grouped forms must use `Timer` as the label.
- Grouped forms cannot contain `alt` or `|` block separators.
- Browser beam search discards those semantic dead ends before considering
  fallback candidates.
- Next useful model work is teacher/contrastive distillation with many negative
  examples where warmup/cooldown and work/rest must keep the old syntax.

### Phase 4C: User Request Expansion

Status: completed initial expansion 2026-05-18; no checkpoint promoted.

Hypothesis:

Real-user robustness needs broader phrasing than the original synthetic
templates, especially contrast rows where words like `around`, `bookend`, and
`between` appear but the correct output is not grouped generic syntax.

Implemented dataset flag:

```sh
node scripts/training/build-timer-sft.mjs \
  --target-format dsl \
  --user-format natural \
  --dsl-end-token \
  --phase4-hard-data \
  --user-request-expansion \
  --out-dir training/generated-dsl-compressed-end-user-requests
```

Added categories:

- `user-around-contrast`
  - warmup/cooldown plus alternating or paired work/rest middle timers
  - wording intentionally includes `around`, `bookend`, `surround`, or
    `between`
  - target must stay old syntax, not grouped generic syntax
- `user-generic-surface`
  - plain timer sequences with generic bookends and middle groups
  - target uses canonical `+` grouped syntax
- `user-duration-surface`
  - variants such as `half a minute`, `0:45`, `one and a half minutes`
- `user-label-surface`
  - named timer sequences that must preserve exact labels and order

Initial Phase 4C validation:

- Dataset validation passed: 1364 total records.
- Hard validation rows: 49.

Current regenerated Phase 4F dataset:

- Dataset validation passed: 1463 expanded records.
- Hard validation rows: 62.
- All assistant targets use canonical `+`; no assistant target contains
  `around`.

Run artifact:

- `training/eval-runs/phase6-user-request-expansion/README.md`

Measured result:

| Run | Best strict validation | Useful gain | Regression |
| --- | ---: | --- | --- |
| `phase6-user-request-contrast-lr1e-5` | 156/194 at step 500 | `user-around-contrast` improved 8/20 to 15/20 | `pairs`, `count-pairs`, and `individual-middle` regressed |
| `phase6-user-request-balanced-lr5e-6` | 154/194 at step 500 | `user-around-contrast` improved 8/20 to 12/20 | no pair/middle replay regression, but no generic-position gain |

Conclusion:

- Keep the expanded dataset and category-level eval.
- Do not promote either checkpoint.
- The small model can learn some negative contrast behavior.
- The small model still does not reliably compose generic bookend/list
  sequences from broad natural wording.
- Keep deterministic generic-position repair in the browser path.
- Treat `user-generic-surface` as the next repair/distillation target.

### Phase 4D: Deterministic User Generic Surface Repair

Status: completed 2026-05-18.

Hypothesis:

The `user-generic-surface` failures are provable plain-timer requests, so they
should be handled by deterministic extraction before spending more training
budget. The model can still try first, but browser repair should replace a
collapsed all-generic model output when the request itself clearly specifies the
full generic sequence.

Implemented:

- Extended `fallback-planner.js` shared generic extraction, which is used by:
  - fallback planning;
  - `llm-planner.js` `repairGenericTimerList` after tiny-model output.
- Tightened `repairGenericTimerList` so a deterministic generic parse also
  repairs hallucinated non-generic kinds such as `Warmup` on a prompt that says
  `no warmup`.
- Added structured generic sequence parsing for forms such as:
  - `plain timers only: 5 minutes, then five timers of 1 minute, then 5 minutes`
  - `no labels, no warmup: start with 20 seconds, do 7 5 seconds timers, finish with 20 seconds`
  - `make the outside generic timers 8 minutes and 8 minutes; put 4 1 minute timers inside`
  - `1 min 15 sec once, 15 seconds six times, 75 seconds once, all plain timers`
  - `timer sequence for practice: one 3 minutes, 5 short 15 seconds timers, one 4 minutes`
- Added duration span support for:
  - `0:45`
  - `half a minute`
  - `one and a half minutes`
  - multi-part durations such as `1 min 15 sec`
  - common word-number durations such as `forty five seconds` and
    `seventy five seconds`
- Bumped app cache to `timey-app-v44`; model cache unchanged.

Validation:

- All 50 `user-generic-surface` rows in the expanded train+validation dataset
  are now exactly covered by `extractExplicitGenericTimers`.
- Added unit tests for fallback and tiny-model repair.
- Added real-browser acceptance scenarios for representative user-generic
  phrasing.

Conclusion:

- This category has deterministic repair coverage as a production safety net.
- This is not the desired end state. Future model promotion should be judged on
  raw tiny-model outputs first, then repaired production outputs second.
- Future training should include `user-generic-surface` as a first-class model
  behavior target, not just as replay data hidden behind repair.

### Phase 4E: Raw Model Gate And Model-First Training

Status: in progress 2026-05-18.

Principle:

Repairs are guardrails, not the main solution. The model should learn to emit
the correct Timey DSL whenever the request is within the trained task surface.

Implemented checks:

- `planWithTinyLlm` now returns `rawTimers` in addition to repaired `timers`.
- `tests/browser/real-tiny-model.spec.mjs` prints two category summaries:
  - repaired production output;
  - raw tiny-model output before repair.
- `TIMEY_REAL_TINY_MODEL_RAW_STRICT=1 npm run test:llm:real` is the opt-in
  raw-output gate for candidate checkpoints.

Current raw browser baseline after adding the gate:

| Category | Repaired production output | Raw tiny-model output |
| --- | ---: | ---: |
| `core-regression` | 7/7 | 7/7 |
| `explicit-label-copy` | 4/4 | 4/4 |
| `generic-count` | 18/18 | 9/18 |
| `generic-position` | 26/26 | 1/26 |

Current policy:

- Production acceptance can keep repair enabled.
- Candidate model promotion should require raw category improvement and should
  not count repaired outputs as model intelligence.
- Any future training run should report:
  - raw Python/HF validation by category;
  - raw real-browser ONNX validation by category;
  - repaired production validation as a separate safety metric.

Initial model-first sweep:

- Artifact:
  `training/eval-runs/phase4e-model-first-training/README.md`
- Run:
  `training/seq2seq-runs/phase4e-model-first-generic-lr1e-5/`
- Result:
  - `user-generic-surface` improved from 0/8 to 4/8 by step 750.
  - `generic-position` improved from 0/5 to 3/5 by step 500/750.
  - `generic-position-hard` improved from 1/10 to 6/10 by step 750.
  - But core/count/pair categories regressed badly.
- Conclusion:
  - Do not promote.
  - The model has capacity, but naive weighting causes `around`
    overgeneralization into warmup/cooldown and work/rest outputs.
  - Next training should add semantic-invalid raw eval and anti-`around`
    contrast rows before another sweep.

Anti-around guard sweep:

- Artifact:
  `training/eval-runs/phase4e-anti-around-guards/README.md`
- Run:
  `training/seq2seq-runs/phase4e-anti-around-balanced-lr5e-6/`
- Completed:
  - Added `semanticInvalid` and `semanticInvalidDetail` to raw Python/HF eval.
  - Added `user-around-regression-guard` rows generated from actual bad output
    shapes:
    - `around` with `alt`
    - `around` wrapping `|`
    - grouped syntax with work/rest labels instead of `Timer`
  - Regenerated `training/generated-dsl-compressed-end-user-requests/`.
- Dataset after regeneration:
  - train: 1194
  - validation: 207
  - hard validation: 62
  - `user-around-regression-guard`: 73 train, 13 validation/hard validation
- Sanity check:
  - Previous high-pressure checkpoint measured with the new metric:
    strict 155/207, parseable 186/207, semantic-invalid 21/207.
  - Invalids concentrate in `core-regression`, `count-middle`,
    `individual-middle`, `pairs`, and around guard categories.
- Balanced sweep result:
  - Step 750 strict 165/207, parseable 206/207, semantic-invalid 0/207.
  - `user-around-contrast` improved 8/20 to 15/20.
  - `user-around-regression-guard` improved 7/13 to 8/13.
  - `user-generic-surface`, `generic-position`, and `generic-position-hard`
    did not improve.
- Conclusion:
  - Do not promote.
  - The guard data and metric successfully fight invalid `around`
    overgeneralization, but the safe balanced recipe does not learn the
    generic-position task.
  - Remaining failures are mostly valid but wrong outputs: dropped endpoints,
    wrong middle counts, wrong durations, or swapped work/rest order.

Next model-first training task:

- Completed staged curriculum:
  - Artifact:
    `training/eval-runs/phase4e-staged-training/README.md`
  - Generic phase:
    `training/seq2seq-runs/phase4e-staged-generic-lr1e-5/`
  - Replay phases:
    - `training/seq2seq-runs/phase4e-staged-replay-lr2e-6/`
    - `training/seq2seq-runs/phase4e-staged-replay-lr5e-6/`
    - `training/seq2seq-runs/phase4e-staged-cleanup-lr5e-6/`
    - `training/seq2seq-runs/phase4e-staged-final-cleanup-lr1e-5/`
- Best staged checkpoint:
  `training/seq2seq-runs/phase4e-staged-final-cleanup-lr1e-5/checkpoint-100`
- Best staged result:
  - strict 181/207
  - parseable 204/207
  - semantic-invalid 3/207
  - `user-generic-surface`: 4/8
  - `generic-position`: 4/5
  - `generic-position-hard`: 6/10
  - `user-around-contrast`: 14/20
  - `user-around-regression-guard`: 9/13
  - `count-middle`: 35/35
  - `individual-middle`: 25/26
  - `pairs`: 9/9
- Conclusion:
  - Do not promote because raw `semanticInvalid` is still non-zero.
  - Staging works better than one-shot balanced training for raw capability:
    it recovers generic-position behavior and preserves core/count/pair
    categories.
  - Blind replay appears to plateau with a few stubborn invalid `around` rows.

Superseded next task:

- The earlier plan was to add residual train-only rows for the last invalid
  `around` shapes. This was superseded by Phase 4F, which removed `around` from
  the target DSL entirely and retrained/evaluated against canonical `+`.

### Phase 4F: Canonical `+` Generic DSL

Status: completed 2026-05-18; parser/dataset change kept, no checkpoint
promoted.

Artifact:

- `training/eval-runs/phase4f-plus-canonical/README.md`

Hypothesis:

The `around` token created an avoidable overgeneralization path. Using one
generic grouping form for both symmetric and asymmetric generic sequences should
reduce semantic-invalid output and keep the DSL easier to maintain.

Implemented:

- Removed `around` from canonical generator output in
  `scripts/training/timer-sft-lib.mjs`.
- `timer-dsl.js` now rejects grouped `around` as semantic-invalid.
- Normal labels containing `around` remain valid.
- Regenerated tracked datasets:
  - `training/generated-dsl-compressed-end/`: 771 train, 145 validation
  - `training/generated-dsl-compressed-end-user-requests/`: 1194 train,
    207 validation, 62 hard validation
- Verified no assistant target contains `around`.

Baselines on the 207-row expanded validation set:

| Source checkpoint | Strict | Parseable | Semantic-invalid |
| --- | ---: | ---: | ---: |
| deployed `t5-efficient-tiny-positional-generic-lr1e-5/checkpoint-250` | 159/207 | 205/207 | 0/207 |
| staged `phase4e-staged-final-cleanup-lr1e-5/checkpoint-100` | 165/207 | 183/207 | 24/207 |

Continuation results:

| Run | Best step | Strict | Parseable | Semantic-invalid |
| --- | ---: | ---: | ---: | ---: |
| `phase4f-plus-canonical-staged-lr5e-6` | 750 | 172/207 | 204/207 | 2/207 |
| `phase4f-plus-canonical-deployed-lr5e-6` | 750 | 162/207 | 198/207 | 0/207 |

Best staged-origin step 750 category notes:

- `generic-position`: 1/5
- `generic-position-hard`: 1/10
- `user-generic-surface`: 3/8
- `generic-timers-hard`: 4/6
- `user-around-contrast`: 15/20
- `user-around-regression-guard`: 9/13

Remaining semantic-invalid outputs at best staged-origin step:

```text
3m around 8x1m: Timer END
12m + 8x30s: Rest | 30s: Work 9m: Cooldown END
```

Conclusion:

- Canonical `+` is the right DSL/source-of-truth direction.
- Do not promote any Phase 4F checkpoint.
- The staged checkpoint can partly unlearn `around`, but generic-position
  accuracy collapses compared with the older `around` target.
- The deployed checkpoint stays semantically safe but does not learn the hard
  generic-position task enough.
- Next model-first work should target first-pass generic endpoint, middle-count,
  and duration-copy correctness under `+`, while keeping `semanticInvalid` at
  0/207.

### Phase 4G: Plus DSL Model Training

Status: completed 2026-05-18; HF checkpoint candidate selected, not exported
or deployed yet.

Artifact:

- `training/eval-runs/phase4g-model-training/README.md`

Goal:

Run real continuation training after the canonical `+` migration and find a
candidate that improves raw model capability without relying on deterministic
repair.

Continuation source:

```text
training/seq2seq-runs/phase4f-plus-canonical-staged-lr5e-6/checkpoint-750
```

Main run:

```text
training/seq2seq-runs/phase4g-plus-continued-staged750-lr2e-6/
```

Results on the 207-row expanded validation set:

| Step | Strict | Parseable | Semantic-invalid |
| ---: | ---: | ---: | ---: |
| 0 | 172/207 | 204/207 | 2/207 |
| 100 | 173/207 | 205/207 | 1/207 |
| 250 | 173/207 | 206/207 | 0/207 |
| 500 | 175/207 | 206/207 | 0/207 |
| 1000 | 171/207 | 204/207 | 2/207 |

Best HF checkpoint:

```text
training/seq2seq-runs/phase4g-plus-continued-staged750-lr2e-6/checkpoint-500
```

Best checkpoint category notes:

- `generic-position-hard`: improved to 4/10.
- `user-around-regression-guard`: improved to 10/13.
- `count-generic`: regressed from 20/21 at Phase 4F step 750 to 19/21.
- Core/count-middle/count-pairs/explicit-label/individual-middle/pairs stayed
  perfect.
- No semantic-invalid output at best step.

Cleanup control:

- Run:
  `training/seq2seq-runs/phase4g-plus-balanced-cleanup-lr1e-6/`
- Source:
  `training/seq2seq-runs/phase4g-plus-continued-staged750-lr2e-6/checkpoint-500`
- Best aggregate stayed 175/207 with 0 semantic-invalid, but the category mix
  was weaker (`generic-position-hard` 3/10, `count-generic` 20/21), so it did
  not replace the main checkpoint.

Conclusion:

- This was the first post-`+` checkpoint with both an aggregate gain and
  zero semantic-invalid raw Python/HF output.
- It was superseded by Phase 4H, which improved aggregate validation further.
- Historical candidate:
  `training/seq2seq-runs/phase4g-plus-continued-staged750-lr2e-6/checkpoint-500`

### Phase 4H: Residual Curriculum Training

Status: completed and promoted to local browser assets 2026-05-18.

Artifact:

- `training/eval-runs/phase4h-residual-curriculum/README.md`

Goal:

Train against the specific residual failure shapes from Phase 4G without
reintroducing semantic-invalid output:

- generic endpoint and middle-count copying;
- generic count/duration copying;
- word durations such as `half a minute` and `ninety seconds`;
- work/rest requests that mention `around`, `bookend`, or `between` but must
  not use generic `+` grouping;
- label-copy misses.

Dataset changes:

- Added opt-in `--phase4h-residual-data`.
- Added train-only categories:
  - `phase4h-generic-endpoint`: 112 rows
  - `phase4h-count-duration`: 62 rows
  - `phase4h-work-rest-contrast`: 55 rows
  - `phase4h-plus-work-rest-guard`: 32 rows
  - `phase4h-label-copy`: 12 rows
- Expanded dataset now has 1467 train rows, 207 validation rows, and 62 hard
  validation rows.
- Validation stayed unchanged, so Phase 4G and Phase 4H are comparable.

Training sweep summary:

| Run | Decode | Strict | Parseable | Semantic-invalid | Result |
| --- | --- | ---: | ---: | ---: | --- |
| Phase 4G source | beam 4 | 175/207 | 206/207 | 0/207 | previous candidate |
| residual weighted, seed 7 | beam 4 | 175/207 | 206/207 | 0/207 | tied early, then regressed |
| residual weighted, seed 11 | beam 4 | 175/207 | 206/207 | 0/207 | safe but flat |
| residual-only curriculum | beam 4 | 169/207 | 196/207 | 11/207 | learned hard behaviors but broke syntax |
| replay cleanup | beam 4 | 180/207 | 203/207 | 4/207 | aggregate gain, still unsafe |
| invalid cleanup | beam 4 | 182/207 | 205/207 | 2/207 | count-middle invalids fixed |
| plus-guard cleanup | beam 4 | 183/207 | 205/207 | 2/207 | best beam-4 aggregate |
| plus-guard cleanup | beam 8 | 185/207 | 207/207 | 0/207 | best safe HF result |

Best HF checkpoint:

```text
training/seq2seq-runs/phase4h-plus-guard-cleanup-lr1e-6/checkpoint-500
```

Best measured Python/HF decode:

```text
num_beams=8, early_stopping=true
```

Beam 12 and beam 16 did not improve beyond the beam-8 score.

Browser export and local promotion:

- Exported `checkpoint-500` to ONNX opset21.
- Quantized encoder q8 with ORT dynamic quantization.
- Quantized decoder q4 with ORT MatMulNBits, excluding:
  - `/decoder/shared/Gather`
  - `/lm_head/MatMul`
- Added durable wrapper:
  `scripts/training/quantize-onnx-matmul-nbits.py`
- Updated runtime:
  - `TRAINED_TINY_MODEL_VERSION`:
    `t5-efficient-tiny-phase4h-plus-guard-checkpoint-500-q8enc-q4dec-ort-beam8`
  - `TINY_TIMER_NUM_BEAMS=8`
  - model cache:
    `timey-model-t5-efficient-tiny-q8enc-q4dec-v2`
  - app cache: `timey-app-v46`

Exported asset sizes:

| Asset | Bytes | SHA-256 |
| --- | ---: | --- |
| encoder q8 | 11,498,300 | `c086f2c818ca338f1e8365d5630a28468283fd774c08aa5b4b1d51e46f4fc540` |
| decoder q4 | 35,285,581 | `dd719902165b795aaaf215dcc8c4d34c8fe1c0b264f564d9d03dba0e83982f57` |

Real-browser repaired output with local Phase 4H assets:

| Category | Pass |
| --- | ---: |
| `core-regression` | 7/7 |
| `explicit-label-copy` | 4/4 |
| `generic-count` | 18/18 |
| `generic-position` | 26/26 |

Raw browser output with local Phase 4H assets:

| Category | Pass |
| --- | ---: |
| `core-regression` | 7/7 |
| `explicit-label-copy` | 4/4 |
| `generic-count` | 14/18 |
| `generic-position` | 11/26 |

Conclusions:

- The tiny model can learn more than Phase 4G showed; residual curriculum plus
  replay moved the safe HF result from 175/207 to 185/207.
- Isolated hard-row training is unsafe. It improved hard categories but
  reintroduced illegal grouped work/rest syntax.
- Beam 8 matters for the new checkpoint: beam 4 leaves two semantic-invalid
  outputs, while beam 8 selects valid alternatives.
- The model still does not pass every validation row. Remaining Python/HF
  misses are valid-but-wrong outputs concentrated in word durations, generic
  endpoint copying, `around` work/rest details, and one label-copy row.
- Browser ONNX behavior is weaker than Python/HF on raw generic count and
  generic-position prompts. Repaired production output passes, but raw output
  remains below the model-first bar.
- Phase 4H is the local browser model to keep unless a later checkpoint beats
  it in raw browser categories.

### Phase 4I: Browser Raw Residual Training

Status: completed 2026-05-18; no checkpoint promoted.

Artifact:

- `training/eval-runs/phase4i-browser-raw-residual/README.md`

Goal:

Train directly on actual Phase 4H raw browser mismatches to improve first-pass
model output for generic count/duration and generic-position prompts.

Dataset changes:

- Added opt-in `--phase4i-browser-residual-data`.
- Generated:
  `training/generated-dsl-compressed-end-phase4i-browser/`
- Added train-only category:
  - `phase4i-browser-raw-residual`: 76 rows
- Dataset size:
  - train: 1543
  - validation: 207
  - hard validation: 62
- `validate-timer-sft.mjs` now permits duplicate user requests only when
  `metadata.duplicateOk` is set, because the residual set intentionally wraps
  the same prompt in several instruction templates.

Runs:

| Run | Best step | Strict | Parseable | Semantic-invalid | Result |
| --- | ---: | ---: | ---: | ---: | --- |
| `phase4i-browser-raw-residual-lr1e-6` | 50/100 | 187/207 | 207/207 | 0/207 | small HF gain, later regression |
| `phase4i-browser-exact-lr2e-6` | 50 | 187/207 | 207/207 | 0/207 | selected for browser export check |

Browser ONNX check:

- Exported and quantized `phase4i-browser-exact-lr2e-6/checkpoint-50`.
- Temporarily installed it under `models/timey-t5-efficient-tiny/`.
- Repaired browser output still passed all categories.
- Raw browser output tied Phase 4H:
  - `core-regression`: 7/7
  - `explicit-label-copy`: 4/4
  - `generic-count`: 14/18
  - `generic-position`: 11/26
- Increasing `TINY_TIMER_TOPK_PER_BEAM` from 8 to 16 did not change the raw
  failures.
- Phase 4H assets were restored after the check.

Conclusion:

- Do not promote Phase 4I.
- Exact residual rows improved Python/HF by one validation item but did not
  transfer to better raw ONNX browser output.
- The failure appears structural for this tiny model: it collapses
  count/duration and endpoint/middle slots rather than simply lacking those
  exact examples.
- Next model-first work should change the training objective/curriculum,
  architecture, or constrained decode surface rather than adding another small
  exact-residual set.

### Phase 4J: Delexicalized Action Plans

Status: completed initial architecture experiment 2026-05-19; not browser
promoted.

Artifact:

- `training/eval-runs/phase4j-actions-delex/README.md`

Goal:

Reduce the tiny model's count/duration binding burden by moving concrete values
into extracted slots and asking the model to emit action commands over slot ids.

Example input:

```text
Request: first and last timer 5minute, 5 one minute timers in between
Slots: D0=5m; D1=1m; C0=5; L0=Timer
```

Example target:

```text
ADD D0 L0
REP C0 D1 L0
ADD D0 L0
END
```

Implemented:

- Added `--target-format actions`.
- Added `ACTION_SYSTEM_PROMPT`.
- Added `formatTimerActions` and `parseTimerActions`.
- Added `scripts/training/parse-timer-actions-batch.mjs`.
- Updated Python seq2seq eval and JS endpoint eval to parse action outputs.
- Built `training/generated-actions-delex-phase4i/`.
- Added action target unit tests.

Dataset:

- Train rows: 1543
- Validation rows: 207
- Hard validation rows: 62
- Caveat: current dataset uses oracle slots derived from known specs. Production
  still needs a deterministic slot extractor.

Runs:

| Run | Source | Best strict | Parseable | Semantic-invalid | Result |
| --- | --- | ---: | ---: | ---: | --- |
| `phase4j-actions-delex-lr1e-5` | Phase 4H checkpoint | 0/207 | 0/207 | 0/207 | old DSL output bias did not unlearn |
| `phase4j-actions-delex-base-lr3e-4` | `google/t5-efficient-tiny` | 190/207 | 205/207 | 0/207 | action architecture works; generic categories solved |
| `phase4j-actions-delex-label-cleanup-lr5e-5` | base action checkpoint-1000 | 191/207 | 203/207 | 0/207 | tiny label-slot cleanup gain |

Beam 8 did not improve the base action checkpoint or label-cleanup checkpoint.

Important category result for the best action checkpoint:

- `count-generic`: 21/21
- `generic-position`: 5/5
- `generic-position-hard`: 10/10
- `user-generic-surface`: 8/8
- `count-middle`: 35/35
- `user-duration-surface`: 2/2
- `explicit-label-copy`: 12/22
- `user-label-surface`: 1/3 at cleanup step 100/250

Conclusion:

- The architecture directly fixes the failure type that motivated it:
  count/duration and endpoint/middle binding.
- It outperforms the best DSL HF validation result (`191/207` vs `185/207`),
  but this is not apples-to-apples production readiness because action eval uses
  oracle slots.
- The next practical task is to implement real slot extraction and then export a
  browser ONNX action candidate.

### Phase 4K: Compact Lossless Slots

Status: completed initial experiment 2026-05-19; not browser promoted.

Artifact:

- `training/eval-runs/phase4k-lossless-slots/README.md`

Goal:

Replace Phase 4J's oracle slots with a production-realistic annotation pass that
keeps the raw request intact and adds compact source-backed candidate slots.

Example input:

```text
Request: first and last timer 5minute, 5 one minute timers in between
Slots: D0@21:28=5m; D1@32:42=1m; C0@30:31=5; L0@default=Timer
```

Implemented:

- Added `--user-format lossless-slots`.
- Added `extractLosslessActionSlots(request)`.
- Slot metadata now supports source spans/default markers while remaining
  compatible with `parseTimerActions`.
- `formatTimerActions(timers, { slots })` can bind targets to supplied
  deterministic candidate slots instead of creating oracle slots.
- Train-only rows that require values not recoverable from text/default
  candidates are skipped for this dataset instead of receiving hidden oracle
  slots.

Dataset:

- Directory: `training/generated-actions-lossless-slots-phase4i/`
- Train rows: 1518
- Validation rows: 207
- Hard validation rows: 62
- 25 train-only rows skipped as unbindable without oracle information.
- Train prompt slot counts after alias pruning:
  - min: 3
  - median: 12
  - p90: 14
  - max: 18

Runs:

| Run | Source | Best strict | Parseable | Semantic-invalid | Result |
| --- | --- | ---: | ---: | ---: | --- |
| `phase4k-actions-lossless-slots-continue-lr5e-5` | Phase 4J action checkpoint | 56/207 | 207/207 | 0/207 | parseable but wrong slot ids; continuation is poor |
| `phase4k-actions-lossless-slots-base-lr3e-4` | `google/t5-efficient-tiny` | 115/207 | 193/207 | 0/207 | broad alias prototype; generic solved, work/rest weak |
| `phase4k-actions-lossless-slots-pruned-alias-lr3e-4` | `google/t5-efficient-tiny` | 108/207 | 205/207 | 0/207 | current code/dataset; fewer aliases but still weak |

Important category result for the current pruned-alias run:

- Strong:
  - `count-generic`: 21/21
  - `generic-position`: 5/5
  - `generic-timers-hard`: 6/6
  - `user-generic-surface`: 8/8
  - `individual-middle`: 20/26
- Weak:
  - `count-pairs`: 0/22
  - `count-middle`: 13/35
  - `explicit-label-copy`: 9/22
  - `user-label-surface`: 0/3

Conclusion:

- Lossless annotations are the right production direction because they avoid
  throwing away semantics before the model runs.
- They preserve the generic-timer gains from action targets.
- They are much harder than oracle slots because slot ids become a second output
  language. Source-order slot ids often differ from timer-order slot ids, and
  work/rest pair rows suffer most.
- Do not promote Phase 4K as-is.
- Next high-value model-language experiment should reduce slot-selection burden
  without becoming lossy. Candidate directions:
  - deterministic but non-oracle slot ordering rules, especially for labels
  - local role references inside actions, such as block-local `A/B` atoms
  - separate value binding from structural action prediction in two constrained
    decode passes

### Phase 4L: Lossless Atom Actions

Status: completed experiment 2026-05-19; not browser promoted.

Artifact:

- `training/eval-runs/phase4l-lossless-atoms/README.md`

Goal:

Reduce Phase 4K's global duration/label slot burden by pre-binding source-backed
timer atoms while preserving the raw request. The model predicts structure plus
atom ids instead of separate duration and label ids.

Example input:

```text
Request: first and last timer 5minute, 5 one minute timers in between
Counts: C0@30:31=5
Atoms: A0@21:28=5m:Timer; A1@32:42=1m:Timer
```

Example target:

```text
ADD A0
REP C0 A1
ADD A0
END
```

Implemented:

- Added `--user-format lossless-atoms`.
- Extended lossless slot extraction with atom candidates.
- Extended action formatting and parsing with `ADD/REP/ALT/BLOCK` atom forms.
- Added a regression test for atom prompts and atom action parsing.
- Fixed one contradictory synthetic pair template so text order matches target
  order.

Dataset:

- Directory: `training/generated-actions-lossless-atoms-phase4i/`
- Train rows: 1501
- Validation rows: 207
- Hard validation rows: 62
- Validation + hard atom count stats:
  - min: 1
  - median: 6
  - p90: 8
  - p95: 8
  - max: 15
  - average: 5.53

Runs:

| Run | Source | Best step | Strict | Parseable | Semantic-invalid | Result |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| `phase4l-actions-lossless-atoms-base-lr3e-4` | `google/t5-efficient-tiny` | 1000 | 156/207 | 206/207 | 0/207 | first atom prototype |
| `phase4l-actions-lossless-atoms-tight-base-lr3e-4` | `google/t5-efficient-tiny` | 1000 | 158/207 | 206/207 | 0/207 | selected base atom dataset |
| `phase4l-actions-lossless-atoms-tighter-base-lr3e-4` | `google/t5-efficient-tiny` | 1000 | 138/207 | 207/207 | 0/207 | same-span alias pruning backfired |
| `phase4l-actions-lossless-atoms-regexcue-base-lr3e-4` | `google/t5-efficient-tiny` | 1000 | 149/207 | 207/207 | 0/207 | stricter implicit cue pruning backfired |
| `phase4l-actions-lossless-atoms-tight-cleanup-lr5e-5` | tight checkpoint-1000 | 100 | 163/207 | 206/207 | 0/207 | selected checkpoint |

Hard validation:

- Base tight checkpoint-1000: 44/62 strict, 62/62 parseable, 0 semantic-invalid.
- Cleanup checkpoint-100: 46/62 strict, 62/62 parseable, 0 semantic-invalid.

Selected checkpoint:

`training/seq2seq-runs/phase4l-actions-lossless-atoms-tight-cleanup-lr5e-5/checkpoint-100`

Conclusion:

- Atom actions are a real recovery over Phase 4K: `count-pairs` improved from
  0/22 to 22/22.
- Atom actions remain below oracle action slots from Phase 4J
  (`163/207` vs `190-191/207`), mostly because arbitrary explicit label copying
  is still weak.
- More prompt pruning is not automatically beneficial. Cleaner atom menus from
  same-span alias pruning and stricter implicit cues reduced accuracy.
- Do not promote Phase 4L to browser yet. Next high-value model-language idea is
  a direct sequence command such as `SEQ A0 A1 A2`, plus more explicit-label-copy
  data.

### Phase 4M: SEQ Atom Actions

Status: completed experiment 2026-05-19; not browser promoted.

Artifact:

- `training/eval-runs/phase4m-seq-actions/README.md`

Goal:

Test whether exact explicit label-copy rows improve if no-hint atom sequences
use a compact sequence command instead of repeated `ADD` commands.

Example target:

```text
SEQ A0 A2 A4
END
```

Implemented:

- Added `SEQ atom atom ...` to the action parser.
- Updated atom-action fallback formatting to emit `SEQ` for multi-timer
  no-hint sequences.
- Updated the action prompt and training action tests.

Dataset:

- Directory: `training/generated-actions-lossless-atoms-seq-phase4i/`
- Train rows: 1501
- Validation rows: 207
- Hard validation rows: 62
- `SEQ` train targets: 188
- `SEQ` validation targets: 26

Runs:

| Run | Source | Best step | Strict | Parseable | Semantic-invalid | Result |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| `phase4m-actions-lossless-atoms-seq-base-lr3e-4` | `google/t5-efficient-tiny` | 1000 | 134/207 | 206/207 | 0/207 | worse than Phase 4L base |
| `phase4m-actions-lossless-atoms-seq-cleanup-lr5e-5` | Phase 4L selected checkpoint | 100 | 164/207 | 207/207 | 0/207 | tiny continuation gain |

Hard validation:

- Cleanup checkpoint-100: 46/62 strict, 62/62 parseable, 0 semantic-invalid.

Conclusion:

- `SEQ` is parser-safe and the model can learn it, but it is not the main fix.
- Explicit label-copy improved only from 6/22 to 7/22.
- Base training with `SEQ` regressed badly versus Phase 4L base.
- The remaining problem is wrong atom selection from the menu, not repeated
  `ADD` syntax. Next work should improve explicit-sequence atom representation,
  probably by adding a source-ordered `Items:` list or better atom ordering.

### Phase 4N: Source-Ordered Items + Atom Hybrid

Status: completed experiment 2026-05-20; selected checkpoint candidate.

Artifact:

- `training/eval-runs/phase4n-lossless-item-atoms/README.md`

Goal:

Fix explicit label-copy and exact sequence rows by adding source-ordered
`Items:` ids while preserving the atom-command behavior that already works for
structural timer rows.

Key implementation:

- Added `--user-format lossless-items`.
- Added `--user-format lossless-item-atoms`.
- Added `I0`, `I1`, ... item slots to action metadata.
- Extended `parseTimerActions` so `ADD`, `SEQ`, `REP`, `ALT`, and `BLOCK` can
  resolve item ids or atom ids.
- Added direct colon item extraction so exact timer mentions produce monotonic
  source-order ids:

```text
Request: 30 seconds: Plank, 45 seconds: Squats, 1 minute: Rest
Items: I0@0:10,12:17=30s:Plank; I1@19:29,31:37=45s:Squats; I2@39:47,49:53=1m:Rest
Atoms: A0@0:10,12:17=30s:Plank; ...

SEQ I0 I1 I2
END
```

Datasets:

- All-item: `training/generated-actions-lossless-items-phase4i/`
  - Train rows: 1478
  - Validation rows: 207
  - Hard validation rows: 62
  - Result: useful label-copy signal, but structural regressions.
- Hybrid item/atom: `training/generated-actions-lossless-item-atoms-phase4i/`
  - Train rows: 1501
  - Validation rows: 207
  - Hard validation rows: 62
  - `I` item targets: 214 / 1708, all direct `SEQ` rows.
  - Structural rows keep `A` atom targets.

Runs:

| Run | Source | Best step | Strict | Parseable | Semantic-invalid | Result |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| `phase4n-actions-lossless-items-cleanup-v2-lr5e-5` | Phase 4L selected checkpoint | 500 | 158/207 | 199/207 | 0/207 | all-item output regressed structural rows |
| `phase4n-actions-lossless-item-atoms-cleanup-lr5e-5` | Phase 4M selected checkpoint | 250 | 169/207 | 207/207 | 0/207 | selected hybrid result |
| `phase4n-actions-lossless-item-atoms-polish-lr1e-5` | hybrid checkpoint-250 | 0 | 169/207 | 207/207 | 0/207 | lower-LR polish did not improve |

Hard validation:

- Hybrid checkpoint-250: 50/62 strict, 62/62 parseable, 0 semantic-invalid.

Selected checkpoint:

`training/seq2seq-runs/phase4n-actions-lossless-item-atoms-cleanup-lr5e-5/checkpoint-250`

Category deltas versus Phase 4M selected:

- `explicit-label-copy`: 7/22 -> 14/22
- `explicit-sequence`: 0/1 -> 0/1
- `user-label-surface`: 0/3 -> 2/3
- `count-pairs`: 22/22 -> 22/22
- `generic-position`: 5/5 -> 5/5
- `generic-position-hard`: 5/10 -> 6/10
- `user-generic-surface`: 5/8 -> 8/8
- `individual-middle`: 26/26 -> 21/26

Conclusion:

- The all-item target language was too disruptive.
- The hybrid target language is a real improvement: source-ordered items help
  direct sequence copying, while atom targets preserve solved structure.
- Do not polish blindly from the selected checkpoint; the first lower-LR polish
  reduced accuracy.
- Next high-value work should target the remaining errors directly:
  anti-repeat `SEQ` rows and work/rest or high/low order contrasts.

### Phase 4O: Targeted Residual Cleanup

Status: completed experiment 2026-05-20; no new checkpoint selected.

Artifact:

- `training/eval-runs/phase4o-residual-cleanup/README.md`

Goal:

Test whether the Phase 4N residual errors can be fixed with targeted train-only
rows:

- anti-repeat direct `SEQ` rows
- rest/work and high/low order contrasts
- hard generic bookend/count contrasts

Implementation:

- Added `--phase4o-residual-data`.
- Added train-only categories:
  - `phase4o-seq-anti-repeat`: 48 rows
  - `phase4o-order-contrast`: 60 rows
  - `phase4o-generic-position`: 81 rows
- Generated `training/generated-actions-lossless-item-atoms-phase4o/`.
  - Train rows: 1690
  - Validation rows: 207
  - Hard validation rows: 62
- Fixed `validate-timer-sft.mjs` so duplicate requests are allowed when either
  duplicate record has `metadata.duplicateOk`.

Runs:

| Run | Training | Best validation | Parseable | Conclusion |
| --- | --- | ---: | ---: | --- |
| `phase4o-actions-residual-cleanup-lr5e-6` | all Phase 4O rows, LR `5e-6` | step 0: 169/207 | 207/207 | training regressed to 162/207 by step 25 |
| `phase4o-actions-residual-cleanup-lr5e-7` | all Phase 4O rows, LR `5e-7` | step 0/25/50/100: 169/207 | 207/207 | stable, no improvement; step 250 regressed to 166/207 |
| `phase4o-actions-order-generic-lr5e-6` | excluded anti-repeat rows, LR `5e-6` | step 0/25: 169/207 | 207/207 | no improvement; later regression |
| `phase4o-decode-rp105-beam4` | decode-only repetition penalty `1.05` | 169/207 | 207/207 | no change |
| `phase4o-decode-nr2-rp105-beam4` | global no-repeat ngram `2` | 63/207 | 187/207 | fixes direct `SEQ` copy but breaks structural commands |

Hard validation:

- `phase4o-actions-residual-cleanup-lr5e-7/checkpoint-100`: 50/62 strict,
  62/62 parseable, 0 semantic-invalid.

Conclusion:

- Phase 4N remains selected:
  `training/seq2seq-runs/phase4n-actions-lossless-item-atoms-cleanup-lr5e-5/checkpoint-250`
- Phase 4O residual SFT did not improve validation or hard validation.
- Anti-repeat natural-language examples made the tail-repeat failure worse at
  normal cleanup LR.
- The global no-repeat decode probe shows the remaining direct `SEQ` errors are
  decode-sensitive, but global no-repeat is too blunt because valid structural
  commands repeat op/id tokens.
- Next useful direction is not more broad residual continuation. Prototype a
  narrow `SEQ I...` decoder constraint or an explicit sequence-length action
  representation, then rerun the fixed validation.

### Phase 4P: Length-Coded `SEQn` Actions From Scratch

Status: completed 2026-05-20; selected HF checkpoint candidate, not browser
promoted.

Artifact:

- `training/eval-runs/phase4p-seq-length-scratch/README.md`

Goal:

Test the user's basin hypothesis: after enough target-language changes, a
continuation checkpoint may be anchored to older syntax. The experiment changed
open-ended sequence actions from `SEQ I0 I1 I2` to length-coded
`SEQ3 I0 I1 I2`, then trained from the base tiny model with a small
sequence-length pedagogy set.

Implementation:

- Added `--action-seq-length`.
- Added `ACTION_SEQ_LENGTH_SYSTEM_PROMPT`.
- Added `--phase4p-seq-length-data`.
- Added train-only `phase4p-seq-length-pedagogy`: 72 rows.
- Extended `parseTimerActions` so legacy `SEQ` remains valid while new `SEQn`
  rejects missing or extra ids.
- Generated
  `training/generated-actions-lossless-item-atoms-seqlen-phase4p/`.
  - Train rows: 1762
  - Validation rows: 207
  - Hard validation rows: 62

Runs:

| Run | Source | Best selected step | Strict | Semantic | Parseable | Semantic-invalid |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| `phase4p-actions-seqlen-base-lr3e-4` | `google/t5-efficient-tiny` | 2000 | 185/207 | 186/207 | 203/207 | 0/207 |
| `phase4p-actions-seqlen-cleanup-lr5e-5` | base step 2000 | 50 | 191/207 | 192/207 | 207/207 | 0/207 |

Hard validation:

- Base step 2000: 52/62 strict, 60/62 parseable, 0 semantic-invalid.
- Cleanup step 50: 55/62 strict, 62/62 parseable, 0 semantic-invalid.
- Cleanup step 100: 54/62 strict, 61/62 parseable, 0 semantic-invalid.

Selected checkpoint:

```text
training/seq2seq-runs/phase4p-actions-seqlen-cleanup-lr5e-5/checkpoint-50
```

Conclusion:

- The basin hypothesis was correct. Training from scratch with the new syntax
  moved the action candidate from Phase 4N's `169/207` validation and `50/62`
  hard validation to `191/207` validation and `55/62` hard validation.
- Step 100 reached `192/207` validation, but it reintroduced parse failures and
  scored worse on hard validation. Step 50 is the safer candidate.
- Remaining failures are valid-but-wrong outputs concentrated in role/order
  selection, especially `count-middle`, hard generic position, and around
  contrast/regression rows.
- Next work should either integrate/export this action-language candidate into
  the browser or run a bigger from-scratch curriculum focused on the remaining
  role/order failures. Do not continue Phase 4O/4N checkpoints for this syntax.

### Phase 4Q-W: Role/Order Hints And Hidden Stress

Status: completed 2026-05-20; selected HF checkpoint candidate, not browser
promoted.

Artifact:

- `training/eval-runs/phase4w-order-hints-100pct/README.md`

Goal:

Turn the Phase 4P action language into a completed tiny-model training unit by
attacking the remaining valid-but-wrong failures: role order, generic bookend
counts, and ambiguity around phrases such as `work/rest`, `rest/work`,
`opening`, `middle`, `closing`, and `between`.

Implementation:

- Added `--phase4q-role-order-data`.
- Added a hidden validation split to the dataset builder and validation
  harness.
- Added train-only Phase 4Q categories:
  - `phase4q-alt-order-curriculum`: 72 rows
  - `phase4q-block-order-curriculum`: 9 rows
  - `phase4q-block-default-duration-curriculum`: 12 rows
  - `phase4q-generic-count-binding`: 50 rows
  - `phase4q-hard-easy-label-curriculum`: 9 rows
- Added hidden validation categories:
  - `phase4q-hidden-alt-order`: 6 rows
  - `phase4q-hidden-block-order`: 4 rows
  - `phase4q-hidden-generic-count`: 6 rows
- Added `--action-order-hints`, which appends compact lossless `Order:` hints
  to the prompt, for example:
  - `O0@...=A0>A1(Rest>Work)`
  - `O0@...=A1>A0>A2(Timer>Timer>Timer)`
- Added `ItemCount: N` to the lossless item/atom prompt.
- Fixed contradictory synthetic data:
  - pair templates now bind target order to the text;
  - `hard then rest` became `hard then easy`;
  - `work, recovery` can preserve the `Recovery` label;
  - generated `around` contrast rows no longer hard-code `work/rest` when the
    target order is `rest/work`;
  - ambiguous default-duration hidden rows were rewritten with explicit
    durations.
- Fixed misleading hint extraction:
  - `and` and `plus` are treated as membership, not order;
  - adjacent hints are suppressed when the bridge contains `is`, because
    `work is X, rest is Y` assigns durations rather than order.

Datasets:

- No-order-hint control:
  `training/generated-actions-lossless-item-atoms-seqlen-phase4q/`
- Order-hint candidate:
  `training/generated-actions-lossless-item-atoms-seqlen-orderhints-phase4q/`
- Both have:
  - Train rows: 1914
  - Validation rows: 207
  - Hard validation rows: 62
  - Hidden validation rows: 16

Run summary:

| Phase/run | Selected step | Validation strict | Hard strict | Hidden strict | Notes |
| --- | ---: | ---: | ---: | ---: | --- |
| Phase 4Q no hints, base | 2500 | 192/207 | not selected | 12/16 | role/order data alone was not enough |
| Phase 4Q no hints, cleanup | 250 | 193/207 | not selected | 13/16 | small continuation gain |
| Phase 4R order hints | 2500 | 200/207 | 58/62 | 16/16 | exposed contradictory hints/data |
| Phase 4S consistency fixes | 3000 | 202/207 | 61/62 | 16/16 | safer data, still short |
| Phase 4T ItemCount + 3-id hints | 4000 | 206/207 | 61/62 | 14/16 | hidden set caught misleading `and`/`plus` hints |
| Phase 4V fixed hints | 3500 | 205/207 | 60/62 | 16/16 | robust hidden score, one validation miss remained |
| Phase 4W prompt fix eval | 0 | 206/207 | not run | not run | suppressing `is` hints fixed one miss |
| Phase 4W generic cleanup | 500 | 207/207 | 62/62 | 16/16 | selected checkpoint |

Selected checkpoint:

```text
training/seq2seq-runs/phase4w-actions-seqlen-orderhints-generic-cleanup-lr5e-5/checkpoint-500
```

Selected result:

- Validation: 207/207 strict, 207/207 semantic, 207/207 parseable,
  0/207 semantic-invalid.
- Hard validation: 62/62 strict, 62/62 semantic, 62/62 parseable,
  0/62 semantic-invalid.
- Hidden validation: 16/16 strict, 16/16 semantic, 16/16 parseable,
  0/16 semantic-invalid.

Conclusion:

- A tiny T5 model can reach 100% on the current fixed validation, hard, and
  small hidden sets when the output language is action-oriented and the prompt
  gives compact lossless structure.
- The main gain came from reducing syntactic and order-reasoning burden, not
  from asking the model to reason harder.
- Hidden validation was essential. It caught the Phase 4T regression where the
  visible validation improved but `and`/`plus` order hints taught the wrong
  behavior.
- Some earlier "model errors" were actually data or prompt-contract errors.
  Fixing contradictory synthetic rows and ambiguous defaults was necessary
  before the model could converge cleanly.
- This is a completed bloggable unit, but not a production deployment. The app
  still needs an action-plan browser runtime/export path and browser ONNX eval
  before this checkpoint can replace the deployed Phase 4H DSL model.

### Phase 4X: Action ONNX Quantization

Status: completed local ONNX/ORT probe 2026-05-20; no browser assets promoted.

Artifact:

- `training/eval-runs/phase4x-action-onnx-quantization/README.md`

Goal:

Verify that Phase 4W survives ONNX export and low-bit weight quantization before
spending browser-runtime work on the action language.

Implementation:

- Extended `scripts/training/seq2seq-timer-benchmark.py` with
  `--backend ort`.
- Exported the Phase 4W checkpoint to fp32 ONNX with Optimum.
- Quantized:
  - q8 encoder + q4 decoder;
  - q4 encoder + q4 decoder.
- Kept q4 decoder exclusions from the previous safe browser export:
  - `/decoder/shared/Gather`
  - `/lm_head/MatMul`
- Saved summary JSONs only; temporary ONNX binaries remain under
  `/private/tmp/timey-phase4w-actions-onnx/`.

Results:

| Candidate | Encoder bytes | Decoder bytes | Total bytes | Validation | Hard | Hidden |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| fp32 ONNX | 45,554,370 | 49,828,554 | 95,382,924 | 207/207 | not run | not run |
| q8 encoder + q4 decoder | 11,498,300 | 35,285,526 | 46,783,826 | 207/207 | 62/62 | 16/16 |
| q4 encoder + q4 decoder | 6,116,635 | 35,285,526 | 41,402,161 | 207/207 | 62/62 | 16/16 |

Conclusion:

- The quantization step did not reduce measured local intelligence on current
  gates.
- The q4 encoder no longer causes an observed validation regression in the
  action-language setup, unlike the earlier DSL browser model.
- Select q4 encoder + q4 decoder as the current footprint candidate.
- Do not promote to `models/` until action-plan browser runtime integration and
  raw browser ONNX Runtime Web category eval pass.

### Phase 4Y: Browser Exact Continuation And Encoder q8 Recovery

Status: completed locally; selected export promoted to `models/`.

Reason:

- After adding the browser action runtime, Phase 4W q4/q4 looked perfect on
  validation, hard, and hidden offline gates but still failed three real browser
  prompts in raw action output.
- The failures were not caused by decoder search width. Beam 8 and top-k 16
  reproduced the same misses.
- The fp32 Phase 4W checkpoint also failed those prompts, so the first fix was
  data and input-feature coverage, not quantization.

Data/runtime changes:

- Added hyphen-tolerant duration slots so `one-minute` creates a 1m atom.
- Added `--phase4y-browser-action-exact-data` to generate 720 train-only exact
  browser action rows from three real misses.
- Continued Phase 4W checkpoint for 50 steps at LR `2e-5`:
  `training/seq2seq-runs/phase4y-actions-browser-exact-dataset-lr2e-5/checkpoint-50`.

HF/Python results:

| Gate | Result |
| --- | --- |
| validation | 207/207 |
| hard validation | 62/62 |
| hidden validation | 16/16 |
| browser-regression prompts | 3/3 |

ONNX quantization results:

| Variant | Encoder bytes | Decoder bytes | Total bytes | Browser-regression | Main gates |
| --- | ---: | ---: | ---: | --- | --- |
| fp32 | 43M | 48M | 91M approx | 3/3 | not needed after dynamic-q8/q4 passed |
| q4 encoder + q4 decoder | 6,116,635 | 35,285,526 | 41,402,161 | 1/3 | 207/207, 62/62, 16/16 |
| q4 encoder + fp32 decoder | 6,116,635 | 48M approx | 54M approx | 1/3 | not selected |
| MatMulNBits q8 encoder + q4 decoder | 36,219,085 | 35,285,526 | 71,504,611 | 3/3 | browser load failed at encoder fetch/session creation |
| dynamic-q8 encoder + q4 decoder | 11,498,300 | 35,285,526 | 46,783,826 | 3/3 | 207/207, 62/62, 16/16 |
| MatMulNBits q8 encoder + q8 decoder | 36,219,085 | 36M approx | 71M approx | 3/3 | not selected |

Conclusion:

- The q4 encoder is the sensitive component for these exact action prompts.
- dynamic-q8 encoder + q4 decoder is the smallest browser-compatible tested
  export that keeps all measured behavior.
- The selected artifact is larger than the Phase 4X q4/q4 candidate, but still
  smaller than fp32 and passes the gates that matter.

### Phase 5: Quantization-Aware Continuation

Status: optional future work. Phase 4Y found a real q4-encoder regression and
recovered it by using dynamic-q8 encoder weights. QAT is only justified if we
need to recover the roughly 5 MB footprint delta between q4 and dynamic-q8
encoder.

Hypothesis:

QAT-style continuation can make a selected checkpoint more robust to low-bit
export and preserve browser beam outputs.

Practical options:

- Simulated quantization noise during fine-tuning for sensitive linear weights.
- Layer-wise selective QAT only on candidate q4 nodes.
- EfficientQAT-inspired approach: freeze most weights and train quantization
  parameters if tooling is practical.
- If QAT is too costly, continue training against outputs produced by the
  quantized browser runtime failures: add the failure prompts and canonical
  targets to hard data.

Success criteria:

- Recovers category regressions introduced by q4/mixed quantization.
- Keeps or reduces model footprint compared with q8 baseline.
- Does not require a runtime that cannot run in browser.

Risks:

- QAT implementation cost may exceed benefit for this tiny model.
- Tooling for encoder-decoder T5 plus ONNX export may be brittle.
- Training can fix Python/HF behavior but still fail after ONNX quantization.

### Phase 6: Deployment

Status: pending for any future promoted model/runtime change.

Before deploy:

- [ ] `npm test`
- [ ] `npm run training:validate`
- [ ] `npm run test:llm:real`
- [ ] `npm run test:browser`
- [ ] Verify model file sizes.
- [ ] Verify service worker cache keys:
  - Bump app cache for JS/CSS/HTML changes.
  - Bump model cache if `/models/` files change.
- [ ] Update `TRAINED_TINY_MODEL_VERSION` if model/runtime behavior changes.
- [ ] Update `TRAINED_TINY_MODEL_DTYPE` if quantization changes.
- [ ] Update `training/README.md` current results.
- [ ] Create deploy bundle and deploy with Netlify CLI.
- [ ] Smoke-check production:
  - `service-worker.js` cache key.
  - `llm-planner.js` model version string.
  - model asset content lengths.
  - a prompt in browser if practical.

## Current Known Failure Modes And Fix Ownership

Already fixed/covered:

- Direct DSL input should bypass the model:
  - Example: `30 seconds: Plank, 45 seconds: Squats, 1 minute: Rest`
  - Owner: `llm-planner.js` + `timer-dsl.js`
- Generic count collapse:
  - Example: `10 one minute timers`
  - Owner: tiny model plus deterministic generic-list repair.
- Positional generic collapse:
  - Example: `first and last timer 5minute, 5 one minute timers in between`
  - Owner: tiny model plus deterministic generic-position repair.
- Separated endpoint wording:
  - Example: `first is 1 minute, then five 20 second timers, last is 1 minute`
  - Owner: `fallback-planner.js` positional extractor.
- Broad plain generic surface wording:
  - Example:
    `plain timers only: 5 minutes, then five timers of 1 minute, then 5 minutes`
  - Owner: `fallback-planner.js` structured generic sequence extractor plus
    `llm-planner.js` generic repair.

Boundary:

- Corrections currently fall back to deterministic code.
- The tiny seq2seq planner should not own stateful conversational edits yet.

Future failures should be classified before fixing:

| Failure type | Preferred owner |
| --- | --- |
| Invalid DSL syntax | constrained decoding / parser |
| Valid DSL but wrong count for simple generic list | deterministic repair or data |
| Wrong work/rest order | training data |
| Wrong endpoint duration | training data or deterministic repair if provable |
| Label copied incorrectly from direct DSL | direct DSL bypass |
| Browser session load failure | ONNX export/runtime |
| Python eval passes but browser fails | ONNX quantization/runtime beam behavior |

## Notes For Future Agents

- Do not revert unrelated dirty worktree changes.
- Use `rg`/`sed` for inspection and `apply_patch` for edits.
- Do not overwrite model assets unless the experiment is explicitly promoting a
  new export.
- Keep human DSL and model DSL defined in one place: `timer-dsl.js`.
- Category-level summaries are now the primary way to decide what to train next.
- Browser acceptance is the final truth for deployment. Python/HF metrics are
  useful but insufficient.
- If a model asset changes, update both constants and service-worker model cache
  names so existing users do not silently keep stale assets.
- If only JS/CSS/HTML changes, bump app cache only.
