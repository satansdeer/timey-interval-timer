# Timey Tiny Model Research And Optimization TODO

Last updated: 2026-05-17

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
2. Emit compact Timey DSL, not JSON.
3. Parse all model output with the same `timer-dsl.js` parser used for human
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

Current browser model:

- App model id: `timey-t5-efficient-tiny`
- Source checkpoint:
  `training/seq2seq-runs/t5-efficient-tiny-positional-generic-lr1e-5/checkpoint-250`
- Runtime version string in `llm-planner.js`:
  `t5-efficient-tiny-positional-generic-lr1e-5-checkpoint-250-q8enc-q4dec-ort-beam`
- Browser model directory: `models/timey-t5-efficient-tiny/`
- Encoder: q8 ONNX
- Decoder: opset21 q4 ONNX for supported MatMul/Gather weights
- Decoder q4 exceptions:
  - `/decoder/shared/Gather`
  - `/lm_head/MatMul`
- Current model cache key in `service-worker.js`:
  `timey-model-t5-efficient-tiny-q8enc-q4dec-v1`
- Current app cache key in `service-worker.js`: `timey-app-v42`
- Decoder content length:
  `35,305,100` bytes
- Total model directory is roughly 47 MB.

Current runtime:

- `llm-planner.js` uses Transformers.js only for tokenization.
- It uses raw ONNX Runtime Web for encoder/decoder inference.
- Beam search is implemented locally in `llm-planner.js`.
- `TINY_TIMER_NUM_BEAMS = 4`
- `TINY_TIMER_TOPK_PER_BEAM = 8`
- `TINY_TIMER_MAX_INPUT_TOKENS = 160`
- `TINY_TIMER_MAX_NEW_TOKENS = 64`
- ONNX Runtime Web version:
  `1.26.0-dev.20260416-b7804b056c`
- Transformers.js version: `4.2.0`

Current dataset:

- Dataset output directory:
  `training/generated-dsl-compressed-end/`
- Train rows: 771
- Validation rows: 145
- Total rows: 916
- Dataset version in `scripts/training/timer-sft-lib.mjs`: `2026-05-17`
- Target format: compressed Timey DSL with final `END` token for training.

Current validation categories:

- `core-regression`
- `count-generic`
- `count-middle`
- `count-pairs`
- `explicit-label-copy`
- `explicit-sequence`
- `generic-position`
- `generic-timers`
- `individual-middle`
- `pairs`

Current real-browser acceptance categories:

```text
core-regression: 7/7
explicit-label-copy: 4/4
generic-count: 15/15
generic-position: 26/26
```

## Source Of Truth Files

Core app/runtime:

- `timer-dsl.js`
  - Shared parser/formatter for human DSL and model DSL.
  - Owns `parseTimerDsl`, compact duration formatting, repeat syntax,
    kind inference, and `findTimerDslStartIndex`.
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

Status: pending

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

### Phase 4: Teacher Distillation / Hard Data Expansion

Status: pending

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

Risks:

- Synthetic paraphrases can leak validation phrasing if generated from the same
  templates. Keep hard validation examples separate.
- Teacher may produce unnatural wording. Filter obvious artifacts.
- More data can dilute already-good categories. Use category weights if needed.

### Phase 5: Quantization-Aware Continuation

Status: pending, only do this if Phase 2 int4/mixed quantization causes useful
but fixable category regressions.

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
