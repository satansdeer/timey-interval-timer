# Phase 4O: Targeted Residual Cleanup

Date: 2026-05-20

Status: completed experiment, no new checkpoint selected.

## Goal

Phase 4N selected the hybrid `lossless-item-atoms` action format at
`169/207` validation and `50/62` hard validation. The remaining visible errors
were concentrated in:

- direct `SEQ` rows that repeat the final item, such as `SEQ I0 I1 I2 I2`
- work/rest or high/low order contrasts
- hard generic bookend/count wording

Phase 4O tested whether targeted train-only residual rows could clean up those
errors without changing the fixed validation set.

## Implementation

Added `--phase4o-residual-data` to the dataset builder.

The new train-only categories are:

- `phase4o-seq-anti-repeat`: direct colon-list rows with explicit instructions
  not to duplicate the final item.
- `phase4o-order-contrast`: rest/work, work/rest, low/high, and hard/easy order
  contrasts for `ALT` and `BLOCK` targets.
- `phase4o-generic-position`: bookend/count contrast rows such as opening
  timer, N middle timers, closing timer, plus count-only no-bookend rows.

Generated dataset:

```text
training/generated-actions-lossless-item-atoms-phase4o/
```

- Train rows: 1690
- Validation rows: 207
- Hard validation rows: 62
- New Phase 4O train-only rows:
  - `phase4o-seq-anti-repeat`: 48
  - `phase4o-order-contrast`: 60
  - `phase4o-generic-position`: 81

Also fixed `validate-timer-sft.mjs` so duplicate requests are allowed when
either duplicate record is marked with `metadata.duplicateOk`.

## Runs

All runs started from:

```text
training/seq2seq-runs/phase4n-actions-lossless-item-atoms-cleanup-lr5e-5/checkpoint-250
```

| Run | Training | Best validation | Parseable | Result |
| --- | --- | ---: | ---: | --- |
| `phase4o-actions-residual-cleanup-lr5e-6` | all Phase 4O rows, residual weights, LR `5e-6` | step 0: 169/207 | 207/207 | training regressed; step 25/50: 162/207, step 250: 159/207 |
| `phase4o-actions-residual-cleanup-lr5e-7` | same weights, LR `5e-7` | step 0/25/50/100: 169/207 | 207/207 | stable but no improvement; step 250 regressed to 166/207 |
| `phase4o-actions-order-generic-lr5e-6` | excluded `phase4o-seq-anti-repeat`, LR `5e-6` | step 0/25: 169/207 | 207/207 | no improvement; later steps regressed |
| `phase4o-decode-rp105-beam4` | decode-only, repetition penalty `1.05` | 169/207 | 207/207 | no change |
| `phase4o-decode-nr2-rp105-beam4` | decode-only, no-repeat ngram `2` plus repetition penalty `1.05` | 63/207 | 187/207 | fixes direct sequence copy but breaks repeated structural commands |

Hard validation for the only stable continuation checkpoint:

| Run | Checkpoint | Strict | Parseable | Semantic-invalid |
| --- | --- | ---: | ---: | ---: |
| `phase4o-actions-residual-lr5e-7-step100-hard-eval` | `phase4o-actions-residual-cleanup-lr5e-7/checkpoint-100` | 50/62 | 62/62 | 0/62 |

## Findings

- No Phase 4O trained checkpoint beats Phase 4N. The selected checkpoint remains
  `phase4n-actions-lossless-item-atoms-cleanup-lr5e-5/checkpoint-250`.
- The anti-repeat SFT rows did not fix tail repetition. At LR `5e-6`, the model
  started producing more `SEQ I0 I1 I2 I2` outputs on validation rows that were
  previously correct.
- Lower LR `5e-7` can preserve the existing checkpoint for about 100 steps, but
  it does not move validation or hard validation.
- A global no-repeat decode constraint proves the problem is decode-sensitive:
  it makes `explicit-label-copy` and `explicit-sequence` perfect on validation,
  but it catastrophically breaks valid repeated structural actions such as
  repeated `ADD`/`ALT` patterns.

## Conclusion

Phase 4O is a useful completed negative result. More broad residual SFT from the
Phase 4N checkpoint is not a good next step by itself. The remaining `SEQ`
tail-repeat issue likely needs a targeted constraint at decode time or a
representation change that gives the decoder an explicit sequence length, not a
larger pile of anti-repeat natural-language examples.

Next high-value direction:

- Prototype a narrow semantic decoder constraint for `SEQ I...` only. It should
  allow repeated item ids when the source item list/request actually contains
  duplicates, but penalize or block a duplicate final id when the clean
  source-ordered `Items:` list has no matching duplicate.
- Keep Phase 4O residual rows as stress/eval material, but do not continue
  training from the Phase 4O checkpoints.
