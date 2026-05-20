# Phase 4W: Order Hints To 100% Local Validation

Date: 2026-05-20

Status: completed experiment, selected HF checkpoint candidate. Not browser
promoted.

## Goal

Phase 4P proved that length-coded `SEQn` actions trained from the base tiny
model were stronger than continuing older target-language checkpoints. The
remaining failures were mostly valid-but-wrong outputs: swapped work/rest order,
generic endpoint/middle count mistakes, and role confusion around phrasing such
as `rest/work`, `work/rest`, `opening`, `middle`, `closing`, and `between`.

This phase tested whether a tiny model could pass the current validation suite
if the prompt carried compact, lossless structure instead of forcing the model
to infer all order relationships from raw text.

## Dataset And Language Changes

The selected dataset is:

```text
training/generated-actions-lossless-item-atoms-seqlen-orderhints-phase4q/
```

It keeps the Phase 4P action target language:

```text
SEQ3 I0 I1 I2
END
```

The input prompt now includes:

- raw user request;
- source-backed `Items:` ids;
- source-backed `Atoms:` ids;
- `ItemCount: N`;
- compact `Order:` hints.

Example order hints:

```text
O0@...=A0>A1(Rest>Work)
O0@...=A1>A0>A2(Timer>Timer>Timer)
```

The no-order-hint control dataset is:

```text
training/generated-actions-lossless-item-atoms-seqlen-phase4q/
```

Both Phase 4Q datasets have:

- 1914 train rows
- 207 validation rows
- 62 hard validation rows
- 16 hidden validation rows

## Implementation Notes

- Added `--phase4q-role-order-data`.
- Added hidden validation split support.
- Added `--action-order-hints`.
- Added `ItemCount: N` to the lossless item/atom prompt.
- Added order hints for slash, dash, comma, `then`, `before`, and
  opening/middle/closing generic spans.
- Preserved `Recovery` labels for requests that say recovery rather than rest.
- Fixed contradictory synthetic rows where the text and target order disagreed.
- Removed `and` and `plus` as order separators. In this domain they usually
  mean membership, not sequence.
- Suppressed adjacent order hints when the bridge contains `is`, because
  `work is 30s, rest is 20s` assigns durations rather than order.
- Rewrote an ambiguous hidden validation default-duration row to use explicit
  durations.

## Main Training Command

```sh
.venv-mlx/bin/python scripts/training/seq2seq-timer-benchmark.py \
  --model training/seq2seq-runs/phase4v-actions-seqlen-orderhints-fixed-base-lr3e-4/checkpoint-3500 \
  --train training/generated-actions-lossless-item-atoms-seqlen-orderhints-phase4q/timer-sft-train.jsonl \
  --validation training/generated-actions-lossless-item-atoms-seqlen-orderhints-phase4q/timer-sft-validation.jsonl \
  --output-dir training/seq2seq-runs/phase4w-actions-seqlen-orderhints-generic-cleanup-lr5e-5 \
  --steps 0,25,50,100,250,500 \
  --batch-size 8 \
  --learning-rate 5e-5 \
  --weight-decay 0.01 \
  --max-grad-norm 1.0 \
  --train-order shuffle \
  --category-weight generic-position-hard=12,phase4q-generic-count-binding=10,phase4o-generic-position=6,generic-position=5,user-around-regression-guard=4,user-around-contrast=3,explicit-label-copy=3,phase4p-seq-length-pedagogy=3 \
  --input-format compact \
  --num-beams 4 \
  --max-input-length 480 \
  --max-target-length 128 \
  --max-new-tokens 64 \
  --eval-batch-size 8 \
  --report-every 25 \
  --seed 113
```

## Results

| Phase/run | Selected step | Validation strict | Hard strict | Hidden strict | Notes |
| --- | ---: | ---: | ---: | ---: | --- |
| Phase 4Q no hints, base | 2500 | 192/207 | not selected | 12/16 | role/order data alone was not enough |
| Phase 4Q no hints, cleanup | 250 | 193/207 | not selected | 13/16 | small continuation gain |
| Phase 4R order hints | 2500 | 200/207 | 58/62 | 16/16 | exposed contradictory hints/data |
| Phase 4S consistency fixes | 3000 | 202/207 | 61/62 | 16/16 | safer data, still short |
| Phase 4T ItemCount + 3-id hints | 4000 | 206/207 | 61/62 | 14/16 | hidden set caught misleading hints |
| Phase 4V fixed hints | 3500 | 205/207 | 60/62 | 16/16 | robust hidden score, one validation miss remained |
| Phase 4W prompt fix eval | 0 | 206/207 | not run | not run | suppressing `is` hints fixed one miss |
| Phase 4W generic cleanup | 500 | 207/207 | 62/62 | 16/16 | selected checkpoint |

Selected checkpoint:

```text
training/seq2seq-runs/phase4w-actions-seqlen-orderhints-generic-cleanup-lr5e-5/checkpoint-500
```

Selected checkpoint scores:

- Validation: 207/207 strict, 207/207 semantic, 207/207 parseable,
  0/207 semantic-invalid.
- Hard validation: 62/62 strict, 62/62 semantic, 62/62 parseable,
  0/62 semantic-invalid.
- Hidden validation: 16/16 strict, 16/16 semantic, 16/16 parseable,
  0/16 semantic-invalid.

## Bloggable Lessons

The biggest improvement came from changing the task contract, not from making
the tiny model reason harder. `SEQn`, `Items:`, `Atoms:`, `ItemCount:`, and
`Order:` turn the problem into a compact source-id selection task.

Hidden validation mattered. Phase 4T looked excellent on visible validation at
206/207, but dropped to 14/16 hidden because `and` and `plus` were interpreted
as sequence hints. The hidden split caught a prompt-contract bug before it could
be mistaken for generalization.

Some model failures were data failures. Contradictory role-order rows and
implicit defaults made perfect behavior impossible. Cleaning the data contract
was a prerequisite for clean convergence.

Semantic density helped, but only when the hints stayed lossless and honest.
The successful hints reduced order burden without discarding raw text or
replacing the model's input with a lossy slot extraction.

## Caveat And Next Step

This result is a strong local milestone, not production proof. The hidden set is
small, and the browser runtime still expects DSL output from the deployed Phase
4H model. The next completed unit should implement the browser action-plan
runtime/export path and then compare Python/HF output against raw browser ONNX
output by category.
