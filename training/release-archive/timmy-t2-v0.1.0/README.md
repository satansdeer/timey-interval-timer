# Timmy T2 v0.1.0 Training Archive

This archive preserves the useful training/eval lineage for the Timmy T2
release without committing raw checkpoints or the full local `seq2seq-runs`
tree.

Public release artifacts:

- Model: <https://huggingface.co/Satansdeer/timmy-t2>
- Dataset: <https://huggingface.co/datasets/Satansdeer/timmy-t2-timer-sft>
- Production deploy: <https://timey-interval-timer.netlify.app>
- Production deploy id: `6a0ed36e0172c100ef1ab8ac`
- Source tag: `timmy-t2-v0.1.0`
- Production model-promotion commit: `213323b`

## Archived Files

`summaries/` contains selected `summary.json` files for the action-language
lineage:

- Phase 4Q: length-coded `SEQn` baseline.
- Phase 4R: order hints.
- Phase 4S: consistency fixes.
- Phase 4T: item count and three-id order hints.
- Phase 4V: fixed order hints.
- Phase 4W: first 100% validation/hard/hidden action checkpoint.
- Phase 4Y: browser-exact continuation and final q8-encoder/q4-decoder ONNX
  gates.

`predictions/` contains only public browser-regression prediction rows. Hidden
prediction rows are intentionally not archived here.

## Selected Results

| Artifact | Gate | Result |
| --- | --- | --- |
| Phase 4W action checkpoint | validation | 207/207 strict, 207/207 semantic |
| Phase 4Y fp32 checkpoint | browser-regression | 3/3 strict |
| Phase 4Y fp32 checkpoint | validation/hard/hidden | 207/207, 62/62, 16/16 |
| Phase 4Y dynamic-q8 encoder + q4 decoder ONNX | browser-regression | 3/3 strict |
| Phase 4Y dynamic-q8 encoder + q4 decoder ONNX | validation/hard/hidden | 207/207, 62/62, 16/16 |

## What Is Not Archived

- Raw checkpoint directories.
- Full prediction JSONL files for hidden validation.
- Temporary ONNX export directories under `/private/tmp`.
- Failed or superseded experimental checkpoints.

The final fp32 checkpoint and browser ONNX files are preserved in the Hugging
Face model repo.
