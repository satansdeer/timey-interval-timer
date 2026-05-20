# Phase 4X: Action ONNX Quantization

Date: 2026-05-20

Status: completed local ONNX/ORT quantization probe. No browser assets promoted.

## Goal

Take the Phase 4W action-language checkpoint that reached 100% in HF/Python and
verify whether ONNX export plus weight quantization preserves the exact same
model behavior before browser integration work starts.

Selected source checkpoint:

```text
training/seq2seq-runs/phase4w-actions-seqlen-orderhints-generic-cleanup-lr5e-5/checkpoint-500
```

Evaluation target:

- 207-row validation
- 62-row hard validation
- 16-row hidden validation
- `num_beams=4`
- compact action prompt
- action parser comparison against expected timers

## Harness Change

`scripts/training/seq2seq-timer-benchmark.py` now supports:

```sh
--backend hf
--backend ort
```

The `ort` backend uses `optimum.onnxruntime.ORTModelForSeq2SeqLM` for
evaluation-only runs. This keeps the HF, fp32 ONNX, and quantized ONNX gates on
the same parser-backed benchmark.

## Export

Exported fp32 ONNX to a temporary local directory:

```sh
.venv-mlx/bin/python -m optimum.exporters.onnx \
  --model training/seq2seq-runs/phase4w-actions-seqlen-orderhints-generic-cleanup-lr5e-5/checkpoint-500 \
  --task text2text-generation \
  --opset 21 \
  /private/tmp/timey-phase4w-actions-onnx/fp32
```

The exporter emitted a warning that PyTorch's exporter officially supports up
to opset 20, but it produced the same opset21-style two-file encoder/decoder
layout used by the existing browser pipeline.

## Quantization Candidates

### q8 Encoder + q4 Decoder

- Encoder: ORT dynamic q8.
- Decoder: ORT `MatMulNBits` q4.
- Decoder exclusions:
  - `/decoder/shared/Gather`
  - `/lm_head/MatMul`

This matches the earlier Phase 4H safe browser compression pattern.

### q4 Encoder + q4 Decoder

- Encoder: ORT `MatMulNBits` q4, including supported `MatMul` and constant
  `Gather` weights.
- Decoder: same q4 decoder as above.

This is the aggressive footprint candidate.

## Sizes

| Candidate | Encoder bytes | Decoder bytes | ONNX total bytes |
| --- | ---: | ---: | ---: |
| fp32 ONNX | 45,554,370 | 49,828,554 | 95,382,924 |
| q8 encoder + q4 decoder | 11,498,300 | 35,285,526 | 46,783,826 |
| q4 encoder + q4 decoder | 6,116,635 | 35,285,526 | 41,402,161 |

The q4/q4 candidate is 53,980,763 bytes smaller than fp32 ONNX, about 56.6%
smaller by ONNX bytes.

## Results

| Candidate | Validation | Hard validation | Hidden validation | Semantic-invalid |
| --- | ---: | ---: | ---: | ---: |
| fp32 ONNX | 207/207 | not run | not run | 0/207 |
| q8 encoder + q4 decoder | 207/207 | 62/62 | 16/16 | 0 across all gates |
| q4 encoder + q4 decoder | 207/207 | 62/62 | 16/16 | 0 across all gates |

Tracked summaries:

- `training/seq2seq-runs/phase4x-action-onnx-fp32-validation-eval/summary.json`
- `training/seq2seq-runs/phase4x-action-onnx-q8enc-q4dec-validation-eval/summary.json`
- `training/seq2seq-runs/phase4x-action-onnx-q8enc-q4dec-hard-eval/summary.json`
- `training/seq2seq-runs/phase4x-action-onnx-q8enc-q4dec-hidden-eval/summary.json`
- `training/seq2seq-runs/phase4x-action-onnx-q4enc-q4dec-validation-eval/summary.json`
- `training/seq2seq-runs/phase4x-action-onnx-q4enc-q4dec-hard-eval/summary.json`
- `training/seq2seq-runs/phase4x-action-onnx-q4enc-q4dec-hidden-eval/summary.json`

## Conclusion

The quantization hypothesis passed locally. Unlike the earlier DSL model, this
action-language checkpoint preserved all current Python/ORT gates even with a
q4 encoder.

The current best footprint candidate is:

```text
/private/tmp/timey-phase4w-actions-onnx/q4enc-q4dec
```

Do not promote those temporary ONNX files directly to `models/` yet. The app
still needs the action-plan browser runtime path, and the final acceptance gate
must run in the actual browser ONNX Runtime Web decoder, not only
`ORTModelForSeq2SeqLM` on CPU.
