# Phase 2 Q4 Candidate Sweep

Date: 2026-05-17

Goal: test whether selective int4/weight-only q4 ONNX export can reduce the
browser model footprint while preserving Timey's real browser acceptance suite.

## Baseline

- Source checkpoint:
  `training/seq2seq-runs/t5-efficient-tiny-positional-generic-lr1e-5/checkpoint-250`
- Production baseline before this sweep:
  - Encoder: q8 ONNX, `11,496,369` bytes
  - Decoder: selective q8 ONNX, `37,352,042` bytes
  - Total ONNX: `48,848,411` bytes
  - Model directory: `50,108` KB
- Real browser acceptance:
  - `core-regression`: 7/7
  - `explicit-label-copy`: 4/4
  - `generic-count`: 15/15
  - `generic-position`: 26/26

## Local Exports

Fresh fp32 ONNX exports:

- `/tmp/timey-phase2-q4-onnx/fp32`
  - `encoder_model.onnx`: `45,552,996` bytes
  - `decoder_model.onnx`: `49,826,230` bytes
- `/tmp/timey-phase2-q4-onnx/fp32-opset21`
  - `encoder_model.onnx`: `45,554,370` bytes
  - `decoder_model.onnx`: `49,828,554` bytes

Dynamic q4 through `quantize_dynamic(..., QuantType.QInt4/QUInt4)` failed with:

```text
RuntimeError: Quantized weights for ... must be 8-bit before packing as 4-bit values.
```

The working q4 path used ORT's MatMulNBits/GatherBlockQuantized quantizer
against the opset21 export. The installed ORT quantizer required a small local
`onnx_ir` compatibility shim for this experiment.

Opset17 Gather q4 candidates were rejected by ORT because the quantizer changed
the model opset while old `ReduceMean` nodes still used the removed `axes`
attribute.

## Candidate Results

| Candidate | Encoder | Decoder | ONNX total | Browser result |
| --- | --- | --- | --- | --- |
| q4-enc/q8-dec | `6,163,059` bytes | `37,351,645` bytes | `43,514,704` bytes | 50/52 |
| q4-enc/q4-dec | `6,163,059` bytes | `35,305,100` bytes | `41,468,159` bytes | 51/52 |
| q8-enc/q4-dec | `11,496,369` bytes | `35,305,100` bytes | `46,801,469` bytes | 52/52 |

All three candidates loaded in ONNX Runtime Web. The q8-encoder/q4-decoder
candidate is the only one that preserved the full real browser acceptance
suite, so it was promoted locally.

`TIMEY_DEBUG_TINY_MODEL_MODE=ort npm run debug:tiny-model` passed on
2026-05-18 for the promoted assets. ORT Web created the encoder session with
inputs `input_ids`, `attention_mask` and output `last_hidden_state`; it created
the decoder session with inputs `encoder_attention_mask`, `input_ids`,
`encoder_hidden_states` and output `logits`.

Promoted local assets:

- `models/timey-t5-efficient-tiny/onnx/encoder_model_quantized.onnx`
  - baseline q8 encoder
  - sha256:
    `3ab15012eb8f5a27a42a0619f6e7aba336bd1c7b0a32d2e3c5ac06651ce8aa8a`
- `models/timey-t5-efficient-tiny/onnx/decoder_model_quantized.onnx`
  - opset21 q4 decoder
  - sha256:
    `119341f1c58c3820e59a32ad01720e7f2536a0d7b9ca34b034fccd1c60d55245`

Promoted model size:

- Encoder: `11,496,369` bytes
- Decoder: `35,305,100` bytes
- Total ONNX: `46,801,469` bytes
- Model directory: `48,108` KB
- ONNX savings versus baseline: `2,046,942` bytes

## Regressions Observed

### q4 encoder + q8 decoder

```text
core-regression: 7/7
explicit-label-copy: 4/4
generic-count: 15/15
generic-position: 24/26
```

Failures were concentrated in positional generic prompts:

- `outside timers are 4 minutes each, middle is 7 one minute timers`
  - Expected: generic 4m bookends around seven 1m timers.
  - Actual: correct durations but semantic labels drifted into warmup/work/rest/cooldown.
- `first timer 30 seconds, last timer 30 seconds, and three 10 second timers in between`
  - Expected: `30s, 10s, 10s, 10s, 30s` all generic.
  - Actual: repeated `30s` timers and introduced work/rest/cooldown labels.

### q4 encoder + q4 decoder

```text
core-regression: 7/7
explicit-label-copy: 4/4
generic-count: 15/15
generic-position: 25/26
```

Failure:

- `first timer 30 seconds, last timer 30 seconds, and three 10 second timers in between`
  - Expected: `30s, 10s, 10s, 10s, 30s` all generic.
  - Actual: nine `30s` timers, with the last one labeled rest.

## Runtime Metadata

Updated local runtime metadata for the promoted candidate:

- `TRAINED_TINY_MODEL_VERSION`:
  `t5-efficient-tiny-positional-generic-lr1e-5-checkpoint-250-q8enc-q4dec-ort-beam`
- `TRAINED_TINY_MODEL_DTYPE`:
  `q8-encoder-q4-decoder-opset21`
- Service-worker model cache:
  `timey-model-t5-efficient-tiny-q8enc-q4dec-v1`

## Follow-ups

- The promoted q4 decoder is a small but clean reduction, not the target 20%+
  reduction.
- The q4 encoder is the main remaining compression opportunity. It cuts the
  encoder from `11,496,369` to `6,163,059` bytes but changes positional beam
  outputs.
- Next plausible work:
  - targeted hard-data/QAT pass for the q4 encoder failure prompts,
  - more selective encoder q4 node choice,
  - q4 only for large encoder feed-forward MatMul nodes,
  - compare beam traces for baseline versus q4 encoder on the two failure
    prompts.
