# Phase 4I: Browser Raw Residual Training

Date: 2026-05-18

## Goal

Reduce reliance on deterministic generic-list repair by training directly on
the actual raw browser mismatches produced by the Phase 4H ONNX export.

This phase used the real browser raw-output gate as the source of truth. The
target was not just repaired production correctness, because repaired output was
already passing. The target was first-pass tiny-model correctness for generic
count/duration and generic-position prompts.

## Dataset Changes

Added an opt-in dataset flag:

```sh
--phase4i-browser-residual-data
```

Built dataset:

```text
training/generated-dsl-compressed-end-phase4i-browser/
```

Build command:

```sh
node scripts/training/build-timer-sft.mjs \
  --target-format dsl \
  --user-format natural \
  --dsl-end-token \
  --phase4-hard-data \
  --user-request-expansion \
  --phase4h-residual-data \
  --phase4i-browser-residual-data \
  --out-dir training/generated-dsl-compressed-end-phase4i-browser
```

Dataset size:

| Split | Rows |
| --- | ---: |
| Train | 1543 |
| Validation | 207 |
| Hard validation | 62 |

The new train-only category is:

| Category | Rows | Source |
| --- | ---: | --- |
| `phase4i-browser-raw-residual` | 76 | 19 browser raw mismatches, 4 prompt variants each |

The residual prompts came from raw browser failures such as:

```text
2 two minute timers and 3 thirty second timers
first and last timer 5minute, 5 one minute timers in between
8 minute timer, 4 one minute timers, 8 minute timer
two 3 minute timers around 8 one minute timers
```

Each row targets canonical generic `+` DSL, for example:

```text
5m + 5x1m + 5m: Timer
END
```

The validator now permits exact duplicate user requests only when the record has
`metadata.duplicateOk`. That is used here because the browser-residual category
intentionally includes multiple instruction wrappers around the same underlying
request.

## Training Runs

Source checkpoint for both runs:

```text
training/seq2seq-runs/phase4h-plus-guard-cleanup-lr1e-6/checkpoint-500
```

### Contrast-Only Residual

Run:

```text
training/seq2seq-runs/phase4i-browser-raw-residual-lr1e-6/
```

This run used contrast-style browser residual rows without the exact prompt
template. Best Python/HF result:

| Step | Strict | Parseable | Semantic-invalid |
| ---: | ---: | ---: | ---: |
| 50 | 187/207 | 207/207 | 0/207 |
| 100 | 187/207 | 207/207 | 0/207 |

Later steps regressed to 184/207 and one later checkpoint lost parseability.

### Exact Browser Residual

Run:

```text
training/seq2seq-runs/phase4i-browser-exact-lr2e-6/
```

Training settings:

```text
learning_rate=2e-6
batch_size=4
train_order=random
num_beams=8
phase4i-browser-raw-residual weight=20
phase4h-generic-endpoint weight=4
phase4h-count-duration weight=4
generic-position weight=2
generic-position-hard weight=2
user-generic-surface weight=2
```

Python/HF validation:

| Step | Strict | Parseable | Semantic-invalid |
| ---: | ---: | ---: | ---: |
| 0 | 186/207 | 207/207 | 0/207 |
| 25 | 186/207 | 207/207 | 0/207 |
| 50 | 187/207 | 207/207 | 0/207 |
| 100 | 185/207 | 207/207 | 0/207 |
| 150 | 184/207 | 207/207 | 0/207 |
| 250 | 184/207 | 206/207 | 0/207 |

Best step was `checkpoint-50`, but the improvement was only one validation row
over the regenerated Phase 4H baseline.

## Browser ONNX Check

Exported and quantized `phase4i-browser-exact-lr2e-6/checkpoint-50` with the
same q8 encoder + q4 decoder recipe as Phase 4H, then temporarily installed it
under:

```text
models/timey-t5-efficient-tiny/
```

Real-browser repaired output still passed all categories, but raw output did
not improve:

| Category | Repaired | Raw |
| --- | ---: | ---: |
| `core-regression` | 7/7 | 7/7 |
| `explicit-label-copy` | 4/4 | 4/4 |
| `generic-count` | 18/18 | 14/18 |
| `generic-position` | 26/26 | 11/26 |

This tied Phase 4H raw browser performance. Some individual outputs changed,
but the changes were not consistently better. Examples:

```text
2 thirty second timers then 3 ten second timers
raw: 2m + 3x20s + 3m: Timer END

two 3 minute timers around 8 one minute timers
raw: 3m + 8x1m + 4m: Timer END
```

Increasing `TINY_TIMER_TOPK_PER_BEAM` from 8 to 16 did not change the raw
failures and made generation slower, so top-k truncation was not the cause.

## Conclusion

Do not promote Phase 4I.

Training on exact browser residual rows produced a small Python/HF improvement,
but it did not transfer to better raw browser ONNX behavior. The failure shape
is more structural than simple lack of examples: the tiny model still collapses
count/duration and endpoint/middle slots in generic timer requests.

Useful learnings:

- Real-browser raw output must remain a separate gate from repaired production
  output.
- Adding exact residual examples alone is not enough for this tiny architecture.
- Top-k widening did not recover hidden good beams.
- Repaired production output is safe, but model-first progress needs either a
  better training objective/curriculum, an architecture with more reliable
  copying, or a constrained/slot-aware decode path that prevents duration and
  endpoint substitutions before parse/repair.

The deployed local assets were restored to the Phase 4H checkpoint after this
experiment.
