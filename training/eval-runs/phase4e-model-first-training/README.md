# Phase 4E Model-First Generic Training

Date: 2026-05-18

Goal: measure whether the tiny checkpoint can learn broad generic bookend/list
requests in its raw output, without counting deterministic repair as model
intelligence.

## Raw Browser Gate

Added a raw-output acceptance path before this run:

```sh
TIMEY_REAL_TINY_MODEL_RAW_STRICT=1 npm run test:llm:real
```

The default real-browser test still verifies repaired production behavior, but
now also prints raw tiny-model category scores.

Current browser baseline:

| Category | Repaired production output | Raw tiny-model output |
| --- | ---: | ---: |
| `core-regression` | 7/7 | 7/7 |
| `explicit-label-copy` | 4/4 | 4/4 |
| `generic-count` | 18/18 | 9/18 |
| `generic-position` | 26/26 | 1/26 |

## Training Run

Output:

```text
training/seq2seq-runs/phase4e-model-first-generic-lr1e-5/
```

Source checkpoint:

```text
training/seq2seq-runs/t5-efficient-tiny-positional-generic-lr1e-5/checkpoint-250
```

Dataset:

```text
training/generated-dsl-compressed-end-user-requests/
```

Settings:

```text
learning rate: 1e-5
train order: random
user-generic-surface=20
generic-position-hard=12
generic-position=8
user-duration-surface=6
generic-timers-hard=6
generic-timers=4
user-around-contrast=3
count-middle=2
count-pairs=2
pairs=2
individual-middle=2
explicit-label-copy=2
```

## Result

| Step | Strict | Parseable | `user-generic-surface` | `generic-position` | `generic-position-hard` | `user-around-contrast` | Regressions |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 0 | 152/194 | 192/194 | 0/8 | 0/5 | 1/10 | 8/20 | none |
| 250 | 148/194 | 191/194 | 0/8 | 0/5 | 0/10 | 7/20 | `count-middle` 34/35, `explicit-label-copy` 21/22 |
| 500 | 146/194 | 176/194 | 1/8 | 3/5 | 5/10 | 7/20 | `core-regression` 1/2, `count-middle` 25/35, `individual-middle` 23/26 |
| 750 | 150/194 | 175/194 | 4/8 | 3/5 | 6/10 | 10/20 | `core-regression` 0/2, `count-middle` 25/35, `individual-middle` 21/26, `pairs` 8/9 |

## Failure Pattern

The run shows the tiny model has some capacity for the target category:

- `user-generic-surface` moves from 0/8 to 4/8.
- `generic-position` moves from 0/5 to 3/5.
- `generic-position-hard` moves from 1/10 to 6/10.

But the model pays for that by overusing compact generic group syntax in
non-generic workouts. Common bad raw outputs include:

```text
12m around 5alt 45s: Rest | 45s: Work 9m: Cooldown END
5m around 7alt 1m30s: Rest | 1m30s: Work 5m: Cooldown END
5m around 4x 1m: Rest | 1m: Work 5m: Cooldown END
```

Those are semantically invalid because grouped `around` is generic-only and
must not wrap `alt` or work/rest block syntax.

## Conclusion

No checkpoint from this run should be promoted.

The useful conclusion is sharper than the previous repair-only step:

- The tiny model can learn generic surface syntax under enough pressure.
- Naive high-pressure weighting is too blunt and causes broad raw regressions.
- Future training should explicitly separate generic grouped syntax from
  warmup/cooldown + work/rest syntax.

Next model-first experiment:

1. Add more anti-`around` contrast rows for warmup/cooldown and work/rest,
   especially near the exact bad forms above.
2. Add a raw semantic-invalid rate to Python eval, not just parse/strict.
3. Try lower learning rate or staged replay after a short generic-focused phase.
4. Promote only if raw browser strict categories improve without core,
   `count-middle`, `individual-middle`, or `pairs` regressions.

Items 1 and 2 were completed in
`training/eval-runs/phase4e-anti-around-guards/`. That follow-up confirms the
metric catches this checkpoint's invalid `around` failures and that balanced
anti-around replay can keep semantic-invalid output at zero, but the next
capability experiment still needs staged generic training plus replay.
