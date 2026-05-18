# Phase 3 Focused Continuation Sweep

Date: 2026-05-18

Goal: check whether the current production checkpoint has easy remaining
headroom from low-learning-rate continuation or simple category weighting.

Source checkpoint:

```text
training/seq2seq-runs/t5-efficient-tiny-positional-generic-lr1e-5/checkpoint-250
```

Dataset:

```text
training/generated-dsl-compressed-end/timer-sft-train.jsonl
training/generated-dsl-compressed-end/timer-sft-validation.jsonl
```

Generation settings:

- input format: compact
- max input length: 160
- max target length: 256
- max new tokens: 128
- beams: 4
- early stopping: true
- eval batch size: 8

## Results

| Run | Learning rate | Category weights | Best strict | Best step | Notes |
| --- | ---: | --- | ---: | ---: | --- |
| `phase3-low-lr-a` | `5e-6` | none | 139/145 | 0, 100, 250, 500 | Flat |
| `phase3-low-lr-b` | `1e-5` | none | 139/145 | 0, 100, 250, 500 | Flat |
| `phase3-low-lr-c` | `2e-5` | none | 139/145 | 0, 100, 250, 500 | Flat |
| `phase3-weighted-hard` | `1e-5` | `generic-position=3,explicit-label-copy=4,explicit-sequence=6` | 139/145 | 0, 250 | Step 100 and 500 regressed to 138/145 |

All runs stayed parseable at 145/145.

## Error Concentration

The baseline model remained perfect on most validation categories:

- `core-regression`
- `count-generic`
- `count-middle`
- `count-pairs`
- `explicit-label-copy`
- `explicit-sequence`
- `individual-middle`
- `pairs`

The persistent failures were:

- `generic-position`: 0/5 strict and semantic exact across all unweighted
  continuation steps.
- `generic-timers`: 1/2 strict and semantic exact across all unweighted
  continuation steps.

Representative baseline failures:

| ID | Category | Model output | Failure |
| --- | --- | --- | --- |
| `timer-sft-0209` | `generic-timers` | `8m: Timer 4x 1m: Timer 4x 1m: Timer 4x 1m: Timer END` | Expected 6 timers, got 13 |
| `timer-sft-0296` | `generic-position` | `4m: Timer 5x 30s: Timer END` | Dropped the final bookend |
| `timer-sft-0297` | `generic-position` | `6x 10s: Timer 6x 10s: Timer END` | Lost 90s bookends and over-repeated middle timers |
| `timer-sft-0298` | `generic-position` | `2m: Timer 4x 45s: Timer END` | Dropped the final bookend |
| `timer-sft-0299` | `generic-position` | `3m: Timer 8x 1m: Timer END` | Dropped the final bookend |
| `timer-sft-0300` | `generic-position` | `20s: Timer 10s: Timer 7x 20s: Timer END` | Confused inner duration and endpoint duration |

The weighted hard run did not fix `generic-position`; by step 500 it also
regressed `generic-timers` from 1/2 to 0/2.

## Conclusion

There is no useful checkpoint to promote from this Phase 3 sweep. Simple
continuation at `5e-6`, `1e-5`, or `2e-5` is stable but does not improve the
known weak categories. The tested category weighting is not safe because it
adds regressions without improving the target category.

The deployed browser runtime still passes the real acceptance suite because
deterministic generic-list repair covers these simple generic-position cases.
The model itself remains weak on that validation category.

Next recommended work:

1. Move to Phase 4 hard-data expansion / teacher distillation for
   `generic-position` and `generic-timers`.
2. Add a hard validation split with more bookend and middle-count examples.
3. Only revisit continuation training after the dataset contains enough targeted
   examples for those categories.
