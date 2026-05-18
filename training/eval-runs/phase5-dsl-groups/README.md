# Phase 5 Compact Generic Group DSL

Date: 2026-05-18

Goal: reduce the tiny model's burden on generic positional timer requests by
changing the target DSL rather than asking it to emit repeated endpoint lines.

## DSL Change

Added two parser-backed forms to the shared Timey DSL in `timer-dsl.js`:

```text
4m around 5x30s: Timer
30s + 5x10s + 1m: Timer
```

`around` is used only for equal generic bookends. `+` is used for ordered
generic groups, including asymmetric endpoints. The parser also accepts
no-space repeat shorthand such as `5x30s`.

Examples:

```text
4m around 5x30s: Timer
```

expands to:

```text
4m: Timer
5x 30s: Timer
4m: Timer
```

and:

```text
30s + 5x10s + 1m: Timer
```

expands to:

```text
30s: Timer
5x 10s: Timer
1m: Timer
```

## Dataset

Regenerated both tracked DSL datasets:

- `training/generated-dsl-compressed-end/`
- `training/generated-dsl-compressed-end-phase4-hard/`

The splits and category counts stayed the same. Generic bookend targets now use
`around` when endpoints match, and `+` when endpoints differ.

Representative validation target changes:

```text
first and last timers are 4 minutes, put five 30 second timers in between
old: 4m: Timer | 5x 30s: Timer | 4m: Timer
new: 4m around 5x30s: Timer

beginning 30 seconds; inside five timers lasting 10 seconds; ending 1 minute
old: 30s: Timer | 5x 10s: Timer | 1m: Timer
new: 30s + 5x10s + 1m: Timer
```

## Runs

Source checkpoint:

```text
training/seq2seq-runs/t5-efficient-tiny-positional-generic-lr1e-5/checkpoint-250
```

Dataset:

```text
training/generated-dsl-compressed-end-phase4-hard/
```

Decode:

- beam 4
- compact input
- max new tokens 128
- early stopping

### Weighted Run

Output:

```text
training/seq2seq-runs/phase5-dsl-groups-weighted-lr1e-5/
```

Settings:

```text
learning rate: 1e-5
generic-position-hard=10
generic-timers-hard=8
generic-position=4
generic-timers=4
```

Result:

| Step | Strict | Parseable | `generic-position` | `generic-position-hard` | Notes |
| --- | ---: | ---: | ---: | ---: | --- |
| 0 | 143/161 | 161/161 | 0/5 | 1/10 | baseline on new targets |
| 100 | 142/161 | 161/161 | 0/5 | 0/10 | no gain |
| 250 | 142/161 | 161/161 | 0/5 | 0/10 | no gain |
| 500 | 134/161 | 143/161 | 3/5 | 5/10 | learns `around`, but broad parse regression |

### Weighted Midpoint Probe

Output:

```text
training/seq2seq-runs/phase5-dsl-groups-weighted-lr1e-5-midpoints/
```

Same settings as the weighted run, with additional eval steps.

Result:

| Step | Strict | Parseable | `generic-position` | `generic-position-hard` | Notes |
| --- | ---: | ---: | ---: | ---: | --- |
| 300 | 139/161 | 158/161 | 0/5 | 0/10 | regression starts before target gain |
| 350 | 137/161 | 154/161 | 1/5 | 1/10 | not usable |
| 400 | 140/161 | 155/161 | 3/5 | 1/10 | target gain, broad regression |
| 450 | 144/161 | 154/161 | 3/5 | 5/10 | best strict, but still broad regression |

### Soft Run

Output:

```text
training/seq2seq-runs/phase5-dsl-groups-soft-lr5e-6/
```

Settings:

```text
learning rate: 5e-6
generic-position-hard=4
generic-timers-hard=4
generic-position=2
generic-timers=2
```

Result:

| Step | Strict | Parseable | `generic-position` | `generic-position-hard` | Notes |
| --- | ---: | ---: | ---: | ---: | --- |
| 250 | 142/161 | 161/161 | 0/5 | 0/10 | preserves strong categories, no gain |
| 500 | 142/161 | 161/161 | 0/5 | 0/10 | preserves strong categories, no gain |
| 750 | 141/161 | 159/161 | 1/5 | 0/10 | starts regressing before useful gain |

## Failure Pattern

The new DSL is learnable: later weighted checkpoints produce correct compact
outputs such as:

```text
4m around 5x30s: Timer END
8m around 4x1m: Timer END
```

But weighted continuation also overgeneralizes `around` into non-generic
workouts, for example:

```text
12m around 5alt 45s: Rest | 45s: Work 9m: Cooldown END
```

That output is intentionally rejected by the shared parser because `around` is
only defined for generic timer groups. The regression hits `count-middle`,
`individual-middle`, and one `core-regression` row.

## Conclusion

No checkpoint from this phase should be promoted.

The DSL change itself is still useful:

- It is valid human syntax.
- It defines the compact target shape we want.
- It reduces endpoint repetition in the target language.
- It gives a clear target for future constrained decoding and distillation.

Naive weighted continuation is not sufficient. It creates a clean tradeoff:

- low pressure: preserves existing categories but does not improve
  `generic-position`;
- high pressure: improves `generic-position`, but overuses `around` and damages
  already-solved categories.

Next useful work:

1. Add runtime semantic constraints so `around` can only be generated with
   generic `Timer` labels and cannot wrap `alt`/work-rest forms.
2. Try teacher paraphrase/distillation into the compact DSL, with many negative
   examples where warmup/cooldown and work/rest must stay on the old syntax.
3. If training again locally, add explicit contrastive examples rather than
   only increasing generic category weights.
