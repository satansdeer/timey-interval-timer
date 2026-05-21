# Phase 4Y Browser Exact Continuation And Quantization

Goal: recover the real browser action-output misses found after Phase 4W action
runtime integration, then quantize without losing behavior.

## Starting Point

Phase 4W passed the fixed offline gates, but raw browser-style action prompts
still failed these three requests:

- `5 one minute timers and one 30 second`
- `Make 1 timer for 90 seconds and 4 timers for 15 seconds`
- `start and end with 5 minute timers, 5 one-minute timers in the middle`

The first two failures appended or reordered a repeated generic segment. The
third exposed a missing slot for hyphenated `one-minute`.

## Changes

- Added hyphen-tolerant duration extraction in
  `scripts/training/timer-sft-lib.mjs`.
- Added `--phase4y-browser-action-exact-data`, producing 720 train-only exact
  browser-action rows for those three requests.
- Continued from
  `training/seq2seq-runs/phase4w-actions-seqlen-orderhints-generic-cleanup-lr5e-5/checkpoint-500`
  for 50 steps at LR `2e-5`.

Selected checkpoint:

```text
training/seq2seq-runs/phase4y-actions-browser-exact-dataset-lr2e-5/checkpoint-50
```

## Results

| Gate | HF/Python | ONNX dynamic-q8 encoder + q4 decoder |
| --- | ---: | ---: |
| validation | 207/207 | 207/207 |
| hard validation | 62/62 | 62/62 |
| hidden validation | 16/16 | 16/16 |
| browser-regression prompts | 3/3 | 3/3 |

The q4 encoder + q4 decoder export preserved the main offline gates but failed
the browser-regression probe at 1/3. q4 encoder + fp32 decoder also failed at
1/3, so the sensitive component was the encoder. Dynamic-q8 encoder + q4
decoder was the smallest browser-compatible tested export that preserved all
measured behavior.

## Promoted Artifact

```text
models/timey-t5-efficient-tiny/onnx/encoder_model_quantized.onnx
models/timey-t5-efficient-tiny/onnx/decoder_model_quantized.onnx
```

- Encoder: dynamic-q8 ONNX, `11,498,300` bytes
- Decoder: q4 ONNX with `/decoder/shared/Gather` and `/lm_head/MatMul` left
  fp32, `35,285,526` bytes
- Total ONNX bytes: `46,783,826`

## Browser Runtime Gate

Command:

```sh
TIMEY_REAL_TINY_MODEL=1 TIMEY_REAL_TINY_MODEL_RAW_STRICT=1 TIMEY_REAL_TINY_MODEL_TIMEOUT_MS=900000 npm run test:llm:real
```

Result:

```text
core-regression: 7/7
explicit-label-copy: 4/4
generic-count: 18/18
generic-position: 26/26
```

Both normalized timers and raw model timers passed these categories.

## Conclusion

For this action-language T5-efficient-tiny checkpoint, full q4 is too aggressive
for the encoder on exact browser prompts. The practical local deployment choice
is dynamic-q8 encoder + q4 decoder until we decide whether recovering the q4
encoder footprint is worth a QAT or selective-layer quantization project.
