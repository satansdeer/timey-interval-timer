# Phase 4K: Compact Lossless Slots

Date: 2026-05-19

## Question

Phase 4J showed that action targets are easier than raw DSL when the model gets
oracle slots:

```text
Request: first and last timer 5minute, 5 one minute timers in between
Slots: D0=5m; D1=1m; C0=5; L0=Timer

ADD D0 L0
REP C0 D1 L0
ADD D0 L0
END
```

The problem with that result is that production cannot use oracle slots. This
experiment asks whether we can keep the user text intact and add compact,
deterministic, source-backed annotations instead.

## Format

The new user format is:

```text
--user-format lossless-slots
```

Example:

```text
Request: first and last timer 5minute, 5 one minute timers in between
Slots: D0@21:28=5m; D1@32:42=1m; C0@30:31=5; L0@default=Timer
```

The original request is still present. Slot offsets point back into that raw
request, so the annotation pass does not replace or discard the text. Defaults
such as `Timer`, and bounded implicit workout duration candidates, are marked as
defaults rather than pretending they came from text spans.

## Implementation

Main changes:

- `extractLosslessActionSlots(request)` in `scripts/training/timer-sft-lib.mjs`
  extracts duration, count, and label candidates.
- `formatTimerActions(timers, { slots })` can bind action targets against a
  supplied candidate slot set instead of creating oracle slots.
- `--user-format lossless-slots` in `scripts/training/build-timer-sft.mjs`
  builds raw request plus span-backed slots.
- Train-only rows whose expected values are not recoverable from text/default
  candidates are skipped instead of receiving hidden oracle slots.

The extractor recognizes:

- compact and natural durations: `5minute`, `1 min 15 sec`, `0:45`,
  `one and a half minutes`, `forty five seconds`
- counts as digits or words, excluding spans already consumed as durations
- labels after duration colons, plus known timer labels like `warmup`,
  `cooldown`, `work`, `rest`, `hard`, `easy`, and explicit custom labels
- source-span merges for repeated normalized values

## Dataset

Build command:

```sh
node scripts/training/build-timer-sft.mjs \
  --target-format actions \
  --user-format lossless-slots \
  --phase4-hard-data \
  --user-request-expansion \
  --phase4h-residual-data \
  --phase4i-browser-residual-data \
  --out-dir training/generated-actions-lossless-slots-phase4i
```

Result:

| Split | Rows |
| --- | ---: |
| Train | 1518 |
| Validation | 207 |
| Hard validation | 62 |

Compared with the oracle-slot action dataset, 25 train-only rows were skipped.
Those rows asked the model to produce values not present in the request and not
covered by bounded defaults. Skipping them is intentional: otherwise the
experiment would silently reintroduce oracle information.

Slot count in train prompts:

| Metric | Slots |
| --- | ---: |
| Min | 3 |
| Median | 12 |
| P90 | 14 |
| Max | 18 |

## Runs

### Continue From Oracle-Slot Action Checkpoint

Run:

```text
training/seq2seq-runs/phase4k-actions-lossless-slots-continue-lr5e-5/
```

Source:

```text
training/seq2seq-runs/phase4j-actions-delex-base-lr3e-4/checkpoint-1000
```

Result:

| Step | Strict | Parseable | Semantic-invalid |
| ---: | ---: | ---: | ---: |
| 0 | 45/207 | 198/207 | 0/207 |
| 100 | 43/207 | 197/207 | 0/207 |
| 250 | 43/207 | 206/207 | 0/207 |
| 500 | 56/207 | 207/207 | 0/207 |

Conclusion: continuing from the oracle-slot action model is a poor strategy.
The output language is the same, but the slot id distribution changed enough
that the model mostly emits parseable but wrong slot references.

### Train Base Tiny With Lossless Slots

Run:

```text
training/seq2seq-runs/phase4k-actions-lossless-slots-pruned-alias-lr3e-4/
```

Source:

```text
google/t5-efficient-tiny
```

Result:

| Step | Strict | Parseable | Semantic-invalid |
| ---: | ---: | ---: | ---: |
| 0 | 0/207 | 0/207 | 0/207 |
| 250 | 30/207 | 169/207 | 0/207 |
| 500 | 40/207 | 202/207 | 0/207 |
| 1000 | 108/207 | 205/207 | 0/207 |

Category result at step 1000:

| Category | Strict |
| --- | ---: |
| count-generic | 21/21 |
| generic-position | 5/5 |
| generic-timers | 2/2 |
| generic-timers-hard | 6/6 |
| user-duration-surface | 2/2 |
| user-generic-surface | 8/8 |
| individual-middle | 20/26 |
| count-middle | 13/35 |
| count-pairs | 0/22 |
| explicit-label-copy | 9/22 |
| user-label-surface | 0/3 |

## Findings

The good news: lossless slots preserve the main benefit for generic timer
requests. The generic categories reached 100%, including the hard generic and
user-surface cases that motivated the action language.

The bad news: the lossless slot menu adds enough selection burden that work/rest
and pair structures regress sharply. The model now has to choose between many
valid-looking duration and label ids whose order depends on source text, not on
timer order. The worst category is `count-pairs` at 0/22.

The broad lesson: action targets are good, but slot ids are a hidden output
language. Oracle slots made that language easy by ordering values like the
answer. Lossless slots make the language production-realistic but harder.

## Conclusion

This is not ready to promote.

The compact lossless extractor is still useful as infrastructure and as a
research result:

- It removes lossy preprocessing.
- It exposes candidate values with reversible source offsets.
- It keeps generic timer performance strong.
- It gives us a clear failure mode: pair/work-rest slot selection, especially
  when source order differs from timer order.

Next experiment should not add more repair. It should reduce slot-selection
burden while staying lossless, probably by changing the action language to
reference local roles inside repeated blocks, or by adding deterministic slot
ordering rules that are not answer-oracle but are more stable than raw source
order.
