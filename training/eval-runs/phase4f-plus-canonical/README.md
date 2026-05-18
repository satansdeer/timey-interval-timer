# Phase 4F: Canonical `+` Generic DSL

Date: 2026-05-18

## Goal

Remove `around` from the model target DSL and use a single semantically dense
generic grouping form for humans and model output:

```text
4m + 5x30s + 4m: Timer
```

The prior `around` token was compact, but the tiny model overgeneralized it
into invalid work/rest and warmup/cooldown outputs.

## Code And Dataset Changes

- `timer-dsl.js` now rejects grouped `around` syntax as semantic-invalid.
- `timer-dsl.js` still allows normal labels containing the word, for example
  `1m: Run around`.
- `scripts/training/timer-sft-lib.mjs` now formats all generic groups with
  `+`, including matching bookends.
- Regenerated tracked datasets:
  - `training/generated-dsl-compressed-end/`
    - train: 771
    - validation: 145
  - `training/generated-dsl-compressed-end-user-requests/`
    - train: 1194
    - validation: 207
    - hard validation: 62
- Validation confirmed no assistant target contains `around`.

## Commands

```sh
npm test

node scripts/training/build-timer-sft.mjs \
  --target-format dsl \
  --dsl-end-token \
  --out-dir training/generated-dsl-compressed-end

node scripts/training/build-timer-sft.mjs \
  --target-format dsl \
  --user-format natural \
  --dsl-end-token \
  --phase4-hard-data \
  --user-request-expansion \
  --out-dir training/generated-dsl-compressed-end-user-requests

node scripts/training/validate-timer-sft.mjs \
  training/generated-dsl-compressed-end/timer-sft-train.jsonl \
  training/generated-dsl-compressed-end/timer-sft-validation.jsonl \
  training/generated-dsl-compressed-end-user-requests/timer-sft-train.jsonl \
  training/generated-dsl-compressed-end-user-requests/timer-sft-validation.jsonl \
  training/generated-dsl-compressed-end-user-requests/timer-sft-hard-validation.jsonl
```

## Baselines

Expanded validation set: 207 rows.

| Source checkpoint | Strict | Parseable | Semantic-invalid | Notes |
| --- | ---: | ---: | ---: | --- |
| deployed `t5-efficient-tiny-positional-generic-lr1e-5/checkpoint-250` | 159/207 | 205/207 | 0/207 | safe but weak on generic-position and user-generic-surface |
| staged `phase4e-staged-final-cleanup-lr1e-5/checkpoint-100` | 165/207 | 183/207 | 24/207 | retains old `around` target behavior |

## Continuation Runs

Both runs used the same expanded `+` dataset, beam 4, compact input, batch 8,
learning rate `5e-6`, weight decay `0.01`, max grad norm `1.0`, random train
order, and the existing hard-category weighting recipe.

| Run | Step | Strict | Parseable | Semantic-invalid |
| --- | ---: | ---: | ---: | ---: |
| staged-origin `phase4f-plus-canonical-staged-lr5e-6` | 0 | 165/207 | 183/207 | 24/207 |
| staged-origin `phase4f-plus-canonical-staged-lr5e-6` | 100 | 166/207 | 182/207 | 25/207 |
| staged-origin `phase4f-plus-canonical-staged-lr5e-6` | 250 | 167/207 | 184/207 | 23/207 |
| staged-origin `phase4f-plus-canonical-staged-lr5e-6` | 500 | 167/207 | 196/207 | 10/207 |
| staged-origin `phase4f-plus-canonical-staged-lr5e-6` | 750 | 172/207 | 204/207 | 2/207 |
| deployed-origin `phase4f-plus-canonical-deployed-lr5e-6` | 0 | 159/207 | 205/207 | 0/207 |
| deployed-origin `phase4f-plus-canonical-deployed-lr5e-6` | 100 | 161/207 | 205/207 | 0/207 |
| deployed-origin `phase4f-plus-canonical-deployed-lr5e-6` | 250 | 159/207 | 203/207 | 0/207 |
| deployed-origin `phase4f-plus-canonical-deployed-lr5e-6` | 500 | 160/207 | 203/207 | 0/207 |
| deployed-origin `phase4f-plus-canonical-deployed-lr5e-6` | 750 | 162/207 | 198/207 | 0/207 |

Best staged-origin step 750 target categories:

| Category | Strict |
| --- | ---: |
| `generic-position` | 1/5 |
| `generic-position-hard` | 1/10 |
| `user-generic-surface` | 3/8 |
| `generic-timers-hard` | 4/6 |
| `user-around-contrast` | 15/20 |
| `user-around-regression-guard` | 9/13 |

## Error Concentration At Best Step

Best staged-origin step 750 remaining errors:

| Category | Misses |
| --- | ---: |
| `generic-position-hard` | 9 |
| `user-generic-surface` | 5 |
| `user-around-contrast` | 5 |
| `user-around-regression-guard` | 4 |
| `generic-position` | 4 |
| `generic-timers-hard` | 2 |
| `user-duration-surface` | 2 |
| `user-label-surface` | 2 |
| `count-generic` | 1 |
| `generic-timers` | 1 |

The two semantic-invalid raw outputs at best step were:

```text
3m around 8x1m: Timer END
12m + 8x30s: Rest | 30s: Work 9m: Cooldown END
```

Most valid-but-wrong misses are still endpoint-copy, middle-count, and
duration-copy errors, for example dropping the final bookend, changing the
bookend duration, or expanding the wrong middle duration.

## Conclusion

Canonical `+` is the right DSL direction because it removes the second grouped
token that caused overgeneralization, and the parser now enforces that source of
truth for both humans and model output.

No checkpoint from this phase should be promoted. The best staged-origin run
improves over deployed baseline strict score but still has nonzero
semantic-invalid output and much weaker generic-position accuracy than the old
`around` staged checkpoint. The deployed-origin control is semantically safe but
does not learn the hard generic-position task.

The next model-first work should create more targeted training pressure for
first-pass generic endpoint, middle-count, and duration-copy correctness under
the `+` syntax, while keeping semantic-invalid at zero.
