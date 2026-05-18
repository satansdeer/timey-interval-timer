# Phase 6 User Request Expansion

Date: 2026-05-18

Goal: expand the training and validation surface toward the broad phrasing real
users use, without changing the deployed model unless category results justify
promotion.

## Dataset

Added an opt-in generator flag:

```sh
node scripts/training/build-timer-sft.mjs \
  --target-format dsl \
  --user-format natural \
  --dsl-end-token \
  --phase4-hard-data \
  --user-request-expansion \
  --out-dir training/generated-dsl-compressed-end-user-requests
```

Tracked dataset:

```text
training/generated-dsl-compressed-end-user-requests/
```

Counts:

| Split | Rows |
| --- | ---: |
| Train | 1121 |
| Validation | 194 |
| Hard validation | 49 |

New categories:

| Category | Train | Validation | Purpose |
| --- | ---: | ---: | --- |
| `user-around-contrast` | 114 | 20 | Negative contrast rows where words like `around`, `bookend`, or `between` appear in warmup/cooldown or work/rest requests, but the target must remain normal warmup/cooldown or alt/block syntax. |
| `user-generic-surface` | 42 | 8 | Plain generic bookend/list wording such as "5 minutes, then five timers of 1 minute, then 5 minutes". |
| `user-duration-surface` | 12 | 2 | Natural duration variants such as "half a minute", "0:45", and "one and a half minutes". |
| `user-label-surface` | 13 | 3 | Named timer sequences with labels that must be copied exactly. |

Validation:

```text
Validated 1364 records.
```

## Runs

Source checkpoint:

```text
training/seq2seq-runs/t5-efficient-tiny-positional-generic-lr1e-5/checkpoint-250
```

Dataset:

```text
training/generated-dsl-compressed-end-user-requests/
```

Decode:

- beam 4
- compact input
- max new tokens 128
- early stopping

### Contrast Run

Output:

```text
training/seq2seq-runs/phase6-user-request-contrast-lr1e-5/
```

Settings:

```text
learning rate: 1e-5
user-around-contrast=4
user-generic-surface=4
user-duration-surface=2
user-label-surface=2
generic-position-hard=4
generic-timers-hard=4
generic-position=2
generic-timers=2
```

Result:

| Step | Strict | Parseable | `user-around-contrast` | `user-generic-surface` | `generic-position` | Notes |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| 0 | 152/194 | 192/194 | 8/20 | 0/8 | 0/5 | baseline on expanded validation |
| 250 | 152/194 | 191/194 | 10/20 | 0/8 | 0/5 | contrast improves slightly |
| 500 | 156/194 | 188/194 | 15/20 | 0/8 | 0/5 | best contrast gain, but pair categories regress |

Regressions at step 500:

| Category | Step 0 | Step 500 |
| --- | ---: | ---: |
| `pairs` | 9/9 | 8/9 |
| `count-pairs` | 22/22 | 20/22 |
| `individual-middle` | 26/26 | 25/26 |

### Balanced Replay Run

Output:

```text
training/seq2seq-runs/phase6-user-request-balanced-lr5e-6/
```

Settings:

```text
learning rate: 5e-6
user-around-contrast=3
user-generic-surface=3
user-duration-surface=2
user-label-surface=2
generic-position-hard=3
generic-timers-hard=3
generic-position=2
generic-timers=2
count-pairs=2
pairs=2
individual-middle=2
```

Result:

| Step | Strict | Parseable | `user-around-contrast` | `user-generic-surface` | `generic-position` | Notes |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| 0 | 152/194 | 192/194 | 8/20 | 0/8 | 0/5 | baseline |
| 250 | 152/194 | 193/194 | 10/20 | 0/8 | 0/5 | no broad regression |
| 500 | 154/194 | 193/194 | 12/20 | 0/8 | 0/5 | best balanced checkpoint |
| 750 | 154/194 | 192/194 | 11/20 | 0/8 | 0/5 | no further gain |

Replay categories stayed green at step 500:

| Category | Step 0 | Step 500 |
| --- | ---: | ---: |
| `pairs` | 9/9 | 9/9 |
| `count-pairs` | 22/22 | 22/22 |
| `individual-middle` | 26/26 | 26/26 |

## Failure Pattern

The expansion successfully teaches some negative contrast behavior. The model
gets better at requests where natural wording uses "around" or "bookend" but
the correct DSL is still warmup/cooldown plus work/rest middle timers.

The expansion does not fix generic bookend/list composition. Step-500 balanced
failures still collapse outputs such as:

```text
5m: Timer 5x 1m: Timer END
8m: Timer 8x 8m: Timer END
1m15s: Timer END
2x 20s: Timer END
```

The model often emits only the first endpoint and the middle group, drops the
final endpoint, or normalizes hard durations to easier values. This is the same
core weakness observed in earlier generic-position phases.

## Conclusion

No checkpoint from this phase should be promoted.

Keep the dataset expansion and evaluation category. It gives us a better
real-user validation surface and shows that contrastive training can improve
some ambiguous wording without changing runtime size. It is not enough to make
the tiny model own generic bookend semantics by itself.

Next useful work:

1. Keep deterministic generic-position repair in the browser path.
2. Treat broad `user-generic-surface` composition as deterministic repair first,
   then replay/distillation data second. Completed in the follow-up deterministic
   repair pass on 2026-05-18.
3. If training again, use stronger teacher-generated paraphrases and more
   explicit old-category replay rather than only increasing synthetic weights.
