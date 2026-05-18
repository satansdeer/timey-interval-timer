# Phase 4 Hard Data Expansion

Date: 2026-05-18

Goal: test whether targeted hard examples can improve the tiny model's own
handling of generic bookend and grouped timer requests, without relying on
deterministic browser repair.

## Dataset

New opt-in build flag:

```sh
node scripts/training/build-timer-sft.mjs \
  --target-format dsl \
  --user-format natural \
  --dsl-end-token \
  --phase4-hard-data \
  --out-dir training/generated-dsl-compressed-end-phase4-hard
```

The default dataset is not changed unless `--phase4-hard-data` is passed.

Phase 4 adds parser-validated template data from known timer specs:

- `generic-position-hard`
  - train: 120
  - hard validation: 10
- `generic-timers-hard`
  - train: 49
  - hard validation: 6

Final Phase 4 dataset:

- train: 940 rows
- validation: 161 rows
- hard validation subset: 16 rows

The regular validation rows are the committed baseline validation rows plus the
new hard holdout rows. This was checked by comparing user requests after
excluding the hard categories.

## Runs

Source checkpoint:

```text
training/seq2seq-runs/t5-efficient-tiny-positional-generic-lr1e-5/checkpoint-250
```

Generation settings:

- input format: compact
- beams: 4
- max new tokens: 128
- early stopping: true

| Run | Steps | Best strict | Best hard holdout | Notes |
| --- | --- | ---: | ---: | --- |
| `phase4-final-unweighted-lr1e-5` | `0,100,250,500` | 143/161 | 4/16 | No improvement |
| `phase4-final-weighted-lr1e-5` | `0,100,250,500` | 146/161 | 7/16 | Improved hard rows, preserved regular validation |
| `phase4-final-weighted-continue500-lr1e-5` | `0,250,500` from weighted checkpoint 500 | 146/161 at step 0 | 7/16 at step 0 | Further continuation overfit and regressed `count-generic` |

Weighted settings:

```text
generic-position-hard=10
generic-timers-hard=8
generic-position=4
generic-timers=4
```

## Best Candidate

Best Python/HF checkpoint:

```text
training/seq2seq-runs/phase4-final-weighted-lr1e-5/checkpoint-500
```

Validation at that step:

- total strict/semantic: 146/161
- original regular validation: 139/145
- hard validation: 7/16
- `generic-position`: 0/5
- `generic-position-hard`: 2/10
- `generic-timers`: 1/2
- `generic-timers-hard`: 5/6

This checkpoint is not promoted. It improves the new hard generic-timer holdout
and a small slice of hard generic-position, but it does not solve the original
`generic-position` validation category.

## Failure Pattern

The model still struggles to preserve both endpoint timers while compressing
the middle run. Typical failures:

- drops the final bookend
- repeats the middle run twice
- changes the final bookend duration, often to a nearby seen value like `5m`
- confuses short middle durations with endpoint durations

Representative output from the best weighted checkpoint:

```text
Prompt: first and last timers are 4 minutes, put five 30 second timers in between
Expected: 4m: Timer | 5x 30s: Timer | 4m: Timer
Actual:   4m: Timer | 5x 30s: Timer | 5m: Timer
```

## Conclusion

Hard-data expansion produced a measurable but incomplete improvement:

- good: hard holdout improved from 4/16 to 7/16
- good: regular validation stayed at the previous 139/145 on the best candidate
- bad: original `generic-position` stayed 0/5
- bad: longer continuation overfit and regressed `count-generic`

No model should be exported or deployed from this phase yet.

Next useful work:

1. Try true teacher paraphrase distillation rather than template-only hard data.
2. Consider a DSL-level bookend/group syntax so the model does not need to
   remember and reproduce both endpoint lines independently.
3. Consider semantic deterministic constraints for provable generic-position
   facts before further low-bit encoder work.
