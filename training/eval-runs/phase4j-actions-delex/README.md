# Phase 4J: Delexicalized Action Plans

Date: 2026-05-19

## Blog Seed

The raw DSL model was not mostly failing at syntax anymore. It was failing at
binding: it understood that a request had endpoints, middle timers, and repeat
counts, but it substituted or dropped concrete values such as `5m`, `1m`, `20s`,
or final endpoint durations.

This experiment moved value binding out of generation. The input now includes
extracted slots, and the model emits a small action plan that references those
slots instead of writing raw durations, counts, or labels.

Example:

```text
Request: first and last timer 5minute, 5 one minute timers in between
Slots: D0=5m; D1=1m; C0=5; L0=Timer
```

Target:

```text
ADD D0 L0
REP C0 D1 L0
ADD D0 L0
END
```

The action compiler turns that back into Timey DSL, then the existing shared
`timer-dsl.js` parser expands it into timers. So this is not a second timer
grammar; it is a lower-entropy model output layer above the existing parser.

## Implementation

Added a third training target format:

```text
--target-format actions
```

New files and entry points:

- `scripts/training/timer-sft-lib.mjs`
  - `ACTION_SYSTEM_PROMPT`
  - `formatTimerActions`
  - `parseTimerActions`
  - action-slot metadata in generated records
- `scripts/training/parse-timer-actions-batch.mjs`
  - batch parser/compiler for Python eval
- `scripts/training/seq2seq-timer-benchmark.py`
  - parses action outputs with per-record slots
- `scripts/training/eval-timer-model.mjs`
  - accepts `--target-format actions`
- `tests/training-actions.test.mjs`
  - verifies action dataset generation and action-to-timers round trips

The parser accepts commands either on separate lines or as a token stream, so
these are equivalent:

```text
ADD D0 L0
REP C0 D1 L0
END
```

```text
ADD D0 L0 REP C0 D1 L0 END
```

## Dataset

Built dataset:

```text
training/generated-actions-delex-phase4i/
```

Build command:

```sh
node scripts/training/build-timer-sft.mjs \
  --target-format actions \
  --user-format natural \
  --phase4-hard-data \
  --user-request-expansion \
  --phase4h-residual-data \
  --phase4i-browser-residual-data \
  --out-dir training/generated-actions-delex-phase4i
```

Dataset size:

| Split | Rows |
| --- | ---: |
| Train | 1543 |
| Validation | 207 |
| Hard validation | 62 |

Important caveat: this dataset uses oracle slots derived from the known timer
spec. It validates the model architecture separately from the production slot
extractor. A browser implementation still needs deterministic extraction of
duration/count/label slots from the user request.

## Runs

### Continue Phase 4H Into Actions

Run:

```text
training/seq2seq-runs/phase4j-actions-delex-lr1e-5/
```

Source:

```text
training/seq2seq-runs/phase4h-plus-guard-cleanup-lr1e-6/checkpoint-500
```

Result:

| Step | Strict | Parseable | Semantic-invalid |
| ---: | ---: | ---: | ---: |
| 0 | 0/207 | 0/207 | 0/207 |
| 50 | 0/207 | 0/207 | 0/207 |
| 100 | 0/207 | 0/207 | 0/207 |
| 250 | 0/207 | 0/207 | 0/207 |
| 500 | 0/207 | 0/207 | 0/207 |

Conclusion: continuing the DSL-trained checkpoint was the wrong starting point.
Even with falling loss, it kept emitting old Timey DSL instead of the new action
language.

### Train Base Tiny On Actions

Run:

```text
training/seq2seq-runs/phase4j-actions-delex-base-lr3e-4/
```

Source:

```text
google/t5-efficient-tiny
```

Best result:

| Step | Strict | Parseable | Semantic-invalid |
| ---: | ---: | ---: | ---: |
| 500 | 169/207 | 190/207 | 0/207 |
| 1000 | 190/207 | 205/207 | 0/207 |

Beam 8 on `checkpoint-1000` did not improve beyond beam 4.

Category result at step 1000:

| Category family | Result |
| --- | --- |
| Generic count/list | 100% |
| Generic position/bookends | 100% |
| User generic surface | 100% |
| Count middle | 100% |
| User duration surface | 100% |
| Around contrast | 100% |
| Explicit label copy | 12/22 |
| User label surface | 0/3 |
| Count pairs | 20/22 |

This is the first tiny run where the generic categories are fully solved in
raw Python/HF validation.

### Label Cleanup

Run:

```text
training/seq2seq-runs/phase4j-actions-delex-label-cleanup-lr5e-5/
```

Source:

```text
training/seq2seq-runs/phase4j-actions-delex-base-lr3e-4/checkpoint-1000
```

Best result:

| Step | Strict | Parseable | Semantic-invalid |
| ---: | ---: | ---: | ---: |
| 0 | 190/207 | 205/207 | 0/207 |
| 100 | 191/207 | 203/207 | 0/207 |
| 250 | 191/207 | 203/207 | 0/207 |
| 500 | 190/207 | 197/207 | 0/207 |

Beam 8 on `checkpoint-100` did not improve beyond beam 4.

The cleanup helped only slightly. The stable remaining errors are mostly label
slot or duration slot selection in explicit sequence rows, for example choosing
`D0` where the expected action needed `D2`, or referencing a slot that is not in
that record.

## Conclusion

This architecture is promising.

Compared with the best DSL target (`185/207` safe HF validation, with raw
browser generic failures still present), the action target reached `191/207`
without browser-specific repair and solved the categories that were motivating
the architecture change:

- `count-generic`: 21/21
- `generic-position`: 5/5
- `generic-position-hard`: 10/10
- `user-generic-surface`: 8/8

The experiment also changed the shape of the problem. The model no longer needs
to generate exact durations or counts, and the old endpoint/middle collapse is
gone under oracle slots. The remaining problem is slot selection among labels
and explicit sequence durations.

Do not promote this directly yet:

- It has only Python/HF validation, no browser ONNX export.
- It assumes oracle slots. Production still needs a deterministic slot extractor.
- It is a new output language, so browser constrained decoding should be updated
  around action tokens rather than Timey DSL tokens.

Next practical step:

Implement a production slot extractor for durations, counts, and likely labels,
then run a real browser action-model export. If slot extraction is reliable, the
model should have a much easier job than raw DSL generation.
