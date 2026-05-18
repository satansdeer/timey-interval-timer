# Phase 4E Anti-Around Guards

Date: 2026-05-18

Goal: make grouped-DSL overgeneralization measurable, then add training
contrast rows that separate generic `around` syntax from warmup/cooldown plus
work/rest syntax.

## Changes

- Added `semanticInvalid` and `semanticInvalidDetail` to the Python seq2seq
  benchmark predictions.
- The metric comes from the shared DSL prefix validator, so it catches hard
  invalid grouped forms such as:
  - `around` with `alt`
  - grouped syntax with `|`
  - grouped syntax with labels other than `Timer`
- Added `user-around-regression-guard` synthetic examples based on actual bad
  raw outputs from the previous high-pressure model-first run.

Dataset after regeneration:

| Split | Count | `user-around-regression-guard` |
| --- | ---: | ---: |
| train | 1194 | 73 |
| validation | 207 | 13 |
| hard validation | 62 | 13 |

## Sanity Check On Previous Bad Checkpoint

Checkpoint:

```text
training/seq2seq-runs/phase4e-model-first-generic-lr1e-5/checkpoint-750
```

Eval-only result on the updated validation set:

| Strict | Parseable | Semantic-invalid |
| ---: | ---: | ---: |
| 155/207 | 186/207 | 21/207 |

The semantic-invalid failures were concentrated in the categories that regressed
in the previous run:

| Category | Semantic-invalid |
| --- | ---: |
| `core-regression` | 2/2 |
| `count-middle` | 10/35 |
| `individual-middle` | 5/26 |
| `user-around-regression-guard` | 2/13 |
| `pairs` | 1/9 |
| `user-around-contrast` | 1/20 |

Representative invalid outputs:

```text
12m around 5alt 45s: Rest | 45s: Work 9m: Cooldown END
8m around 8x15s: Rest | 1m: Work 8m: Cooldown END
5m around 4x 1m: Rest | 1m: Work 5m: Cooldown END
```

This confirms the new metric captures the exact overgeneralization we care
about.

## Balanced Anti-Around Sweep

Output:

```text
training/seq2seq-runs/phase4e-anti-around-balanced-lr5e-6/
```

Source checkpoint:

```text
training/seq2seq-runs/t5-efficient-tiny-positional-generic-lr1e-5/checkpoint-250
```

Settings:

```text
learning rate: 5e-6
train order: random
user-generic-surface=12
generic-position-hard=8
generic-position=5
user-duration-surface=4
user-around-regression-guard=10
user-around-contrast=6
count-middle=4
individual-middle=4
pairs=3
count-pairs=3
core-regression=4
explicit-label-copy=2
generic-timers-hard=4
generic-timers=3
```

Result:

| Step | Strict | Parseable | Semantic-invalid | `user-around-contrast` | `user-around-regression-guard` | `user-generic-surface` | `generic-position` | `generic-position-hard` |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 0 | 159/207 | 205/207 | 0/207 | 8/20 | 7/13 | 0/8 | 0/5 | 1/10 |
| 250 | 160/207 | 206/207 | 0/207 | 10/20 | 7/13 | 0/8 | 0/5 | 0/10 |
| 500 | 163/207 | 206/207 | 0/207 | 14/20 | 7/13 | 0/8 | 0/5 | 0/10 |
| 750 | 165/207 | 206/207 | 0/207 | 15/20 | 8/13 | 0/8 | 0/5 | 0/10 |

## Conclusion

No checkpoint from this run should be promoted.

Completed unit of work:

- We can now measure semantic-invalid grouped DSL directly in raw Python/HF
  validation.
- The new metric successfully detects the old high-pressure failure mode.
- The anti-around data plus lower learning rate avoids hard-invalid grouped DSL
  while improving around/workout contrast categories.

What did not work:

- The safe balanced recipe did not transfer the generic-position capability
  gains from the previous high-pressure run.
- The remaining misses are mostly valid but wrong outputs: dropped endpoints,
  wrong middle count, wrong duration, or wrong work/rest order.

Next experiment should be staged rather than just globally weighted:

1. A short generic-focused phase to recover `user-generic-surface` and
   `generic-position` gains.
2. A lower-rate anti-around/core replay phase to drive `semanticInvalid` back to
   zero while preserving generic gains.
3. Promotion only if raw validation and raw browser categories improve without
   relying on deterministic repair.
