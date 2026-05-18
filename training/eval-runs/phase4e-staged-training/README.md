# Phase 4E Staged Training

Date: 2026-05-18

Goal: test whether a staged curriculum can recover generic-position capability
first, then replay anti-around/core examples to reduce raw semantic-invalid DSL
without losing the generic gains.

## Setup

Source checkpoint:

```text
training/seq2seq-runs/t5-efficient-tiny-positional-generic-lr1e-5/checkpoint-250
```

Dataset:

```text
training/generated-dsl-compressed-end-user-requests/
```

Decode:

```text
input format: compact
num beams: 4
max new tokens: 128
early stopping: true
```

## Runs

### 1. Generic-Focused Phase

Output:

```text
training/seq2seq-runs/phase4e-staged-generic-lr1e-5/
```

This phase used high weights on `user-generic-surface`,
`generic-position-hard`, and `generic-position`.

Best generic checkpoint: step 750.

| Step | Strict | Parseable | Semantic-invalid | `user-generic-surface` | `generic-position` | `generic-position-hard` |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 0 | 159/207 | 205/207 | 0/207 | 0/8 | 0/5 | 1/10 |
| 250 | 158/207 | 206/207 | 0/207 | 0/8 | 0/5 | 0/10 |
| 500 | 142/207 | 176/207 | 29/207 | 2/8 | 3/5 | 5/10 |
| 750 | 148/207 | 178/207 | 29/207 | 4/8 | 3/5 | 6/10 |

Conclusion: the generic capability is learnable, but it again creates invalid
`around` overgeneralization.

### 2. Replay From Generic Checkpoint

Output:

```text
training/seq2seq-runs/phase4e-staged-replay-lr2e-6/
```

Starting checkpoint:

```text
training/seq2seq-runs/phase4e-staged-generic-lr1e-5/checkpoint-750
```

| Step | Strict | Parseable | Semantic-invalid | `user-generic-surface` | `generic-position` | `generic-position-hard` |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 0 | 148/207 | 178/207 | 29/207 | 4/8 | 3/5 | 6/10 |
| 100 | 154/207 | 183/207 | 24/207 | 4/8 | 3/5 | 6/10 |
| 250 | 159/207 | 190/207 | 17/207 | 3/8 | 3/5 | 6/10 |
| 500 | 163/207 | 190/207 | 15/207 | 3/8 | 4/5 | 6/10 |
| 750 | 165/207 | 192/207 | 14/207 | 3/8 | 4/5 | 6/10 |

Conclusion: 2e-6 replay was too weak to clear invalid grouped DSL.

### 3. Stronger Replay

Output:

```text
training/seq2seq-runs/phase4e-staged-replay-lr5e-6/
```

Starting checkpoint:

```text
training/seq2seq-runs/phase4e-staged-generic-lr1e-5/checkpoint-750
```

Best checkpoint: step 750.

| Step | Strict | Parseable | Semantic-invalid | `user-generic-surface` | `generic-position` | `generic-position-hard` |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 0 | 148/207 | 178/207 | 29/207 | 4/8 | 3/5 | 6/10 |
| 100 | 160/207 | 191/207 | 16/207 | 3/8 | 3/5 | 6/10 |
| 250 | 163/207 | 190/207 | 15/207 | 3/8 | 4/5 | 6/10 |
| 500 | 173/207 | 198/207 | 8/207 | 3/8 | 4/5 | 6/10 |
| 750 | 175/207 | 199/207 | 7/207 | 3/8 | 4/5 | 6/10 |

Conclusion: stronger replay keeps useful generic-position gains and greatly
reduces invalid DSL, but not to zero.

### 4. Cleanup Replay

Output:

```text
training/seq2seq-runs/phase4e-staged-cleanup-lr5e-6/
```

Starting checkpoint:

```text
training/seq2seq-runs/phase4e-staged-replay-lr5e-6/checkpoint-750
```

Best checkpoint: step 500.

| Step | Strict | Parseable | Semantic-invalid | `user-generic-surface` | `generic-position` | `generic-position-hard` |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 0 | 175/207 | 199/207 | 7/207 | 3/8 | 4/5 | 6/10 |
| 100 | 175/207 | 200/207 | 6/207 | 3/8 | 4/5 | 6/10 |
| 250 | 178/207 | 202/207 | 4/207 | 3/8 | 4/5 | 6/10 |
| 500 | 179/207 | 203/207 | 4/207 | 4/8 | 4/5 | 6/10 |

### 5. Final Short Cleanup

Output:

```text
training/seq2seq-runs/phase4e-staged-final-cleanup-lr1e-5/
```

Starting checkpoint:

```text
training/seq2seq-runs/phase4e-staged-cleanup-lr5e-6/checkpoint-500
```

Best checkpoint: step 100 or step 250.

| Step | Strict | Parseable | Semantic-invalid | `user-generic-surface` | `generic-position` | `generic-position-hard` |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 0 | 179/207 | 203/207 | 4/207 | 4/8 | 4/5 | 6/10 |
| 50 | 179/207 | 203/207 | 4/207 | 4/8 | 4/5 | 6/10 |
| 100 | 181/207 | 204/207 | 3/207 | 4/8 | 4/5 | 6/10 |
| 250 | 181/207 | 204/207 | 3/207 | 4/8 | 4/5 | 6/10 |

## Best Raw Result

Best staged checkpoint:

```text
training/seq2seq-runs/phase4e-staged-final-cleanup-lr1e-5/checkpoint-100
```

Key category scores:

| Category | Baseline deployed checkpoint | Best staged checkpoint |
| --- | ---: | ---: |
| overall strict | 159/207 | 181/207 |
| parseable | 205/207 | 204/207 |
| semantic-invalid | 0/207 | 3/207 |
| `user-generic-surface` | 0/8 | 4/8 |
| `generic-position` | 0/5 | 4/5 |
| `generic-position-hard` | 1/10 | 6/10 |
| `user-around-contrast` | 8/20 | 14/20 |
| `user-around-regression-guard` | 7/13 | 9/13 |
| `count-middle` | 35/35 | 35/35 |
| `individual-middle` | 26/26 | 25/26 |
| `pairs` | 9/9 | 9/9 |
| `core-regression` | 2/2 | 2/2 |

Remaining hard-invalid outputs:

```text
5m around 4alt 45s: Work | 45s: Rest 5m: Cooldown END
5m around 5x 45s: Rest | 45s: Work 5m: Cooldown END
12m around 8alt 30s: Rest | 30s: Work 9m: Cooldown END
```

Their source prompts are ordinary warmup/cooldown plus work/rest requests, not
generic timer requests:

```text
I need 5 min warm up, then 4 45 seconds timers alternating work/rest, then 5 minutes cool down
put 5 45 seconds rest/work timers between a 5 minute warmup and 5 minute cooldown
bookend 8 separate 30 seconds rest/work middle timers with warmup 12 minutes and cooldown 9 minutes
```

## Conclusion

No checkpoint from this staged run should be promoted because raw
`semanticInvalid` is still non-zero.

The staged recipe is still a useful completed unit:

- It recovers generic-position capability that the balanced one-shot recipe
  could not learn.
- It improves overall strict validation from 159/207 to 181/207.
- It preserves core/count/pair categories much better than the original
  high-pressure generic sweep.
- It reduces semantic-invalid grouped DSL from 29/207 after the generic phase to
  3/207 after cleanup.

Next task:

- Generate train-only residual hard rows from the three remaining invalid
  shapes and nearby paraphrases.
- Rebuild the expanded dataset.
- Continue from
  `training/seq2seq-runs/phase4e-staged-final-cleanup-lr1e-5/checkpoint-100`
  with a short low-rate hard-row pass.
- Promotion remains blocked until raw Python/HF and raw browser ONNX both have
  zero semantic-invalid output and improved generic categories.
