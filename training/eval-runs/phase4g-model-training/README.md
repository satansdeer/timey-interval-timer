# Phase 4G: Plus DSL Model Training

Date: 2026-05-18

## Goal

Run real continuation training on top of the canonical `+` DSL checkpoint and
select a concrete HF checkpoint candidate for browser export testing.

Phase 4F established the right DSL direction but stopped at 172/207 strict with
2/207 semantic-invalid outputs. This phase tests whether continued model
training can improve raw first-pass accuracy without relying on deterministic
repair.

## Starting Point

Source checkpoint:

```text
training/seq2seq-runs/phase4f-plus-canonical-staged-lr5e-6/checkpoint-750
```

Source metrics on the 207-row expanded validation set:

| Strict | Parseable | Semantic-invalid |
| ---: | ---: | ---: |
| 172/207 | 204/207 | 2/207 |

## Continuation Run

Run:

```text
training/seq2seq-runs/phase4g-plus-continued-staged750-lr2e-6/
```

Key settings:

- learning rate: `2e-6`
- batch size: `8`
- train order: `random`
- beam: `4`
- max input tokens: `160`
- max new tokens: `128`
- category weights emphasized:
  - `user-generic-surface=18`
  - `generic-position-hard=16`
  - `generic-position=14`
  - `generic-timers-hard=10`
  - `user-around-regression-guard=18`
  - `user-around-contrast=12`

Results:

| Step | Strict | Parseable | Semantic-invalid | Notes |
| ---: | ---: | ---: | ---: | --- |
| 0 | 172/207 | 204/207 | 2/207 | source checkpoint |
| 100 | 173/207 | 205/207 | 1/207 | small improvement |
| 250 | 173/207 | 206/207 | 0/207 | first safe checkpoint |
| 500 | 175/207 | 206/207 | 0/207 | best checkpoint |
| 1000 | 171/207 | 204/207 | 2/207 | overtrained/regressed |

Best checkpoint:

```text
training/seq2seq-runs/phase4g-plus-continued-staged750-lr2e-6/checkpoint-500
```

Best checkpoint category summary:

| Category | Strict |
| --- | ---: |
| `core-regression` | 2/2 |
| `count-generic` | 19/21 |
| `count-middle` | 35/35 |
| `count-pairs` | 22/22 |
| `explicit-label-copy` | 22/22 |
| `explicit-sequence` | 1/1 |
| `generic-position` | 1/5 |
| `generic-position-hard` | 4/10 |
| `generic-timers` | 1/2 |
| `generic-timers-hard` | 4/6 |
| `individual-middle` | 26/26 |
| `pairs` | 9/9 |
| `user-around-contrast` | 15/20 |
| `user-around-regression-guard` | 10/13 |
| `user-duration-surface` | 0/2 |
| `user-generic-surface` | 3/8 |
| `user-label-surface` | 1/3 |

Error concentration at best checkpoint:

| Category | Misses |
| --- | ---: |
| `generic-position-hard` | 6 |
| `user-generic-surface` | 5 |
| `user-around-contrast` | 5 |
| `generic-position` | 4 |
| `user-around-regression-guard` | 3 |
| `count-generic` | 2 |
| `generic-timers-hard` | 2 |
| `user-duration-surface` | 2 |
| `user-label-surface` | 2 |
| `generic-timers` | 1 |

## Cleanup Control

Run:

```text
training/seq2seq-runs/phase4g-plus-balanced-cleanup-lr1e-6/
```

Source checkpoint:

```text
training/seq2seq-runs/phase4g-plus-continued-staged750-lr2e-6/checkpoint-500
```

Key settings:

- learning rate: `1e-6`
- stronger replay on `count-generic`, `user-around-contrast`, and core/count
  categories

Results:

| Step | Strict | Parseable | Semantic-invalid | Notes |
| ---: | ---: | ---: | ---: | --- |
| 0 | 175/207 | 206/207 | 0/207 | source checkpoint |
| 100 | 174/207 | 206/207 | 0/207 | lost one generic-position-hard row |
| 250 | 175/207 | 206/207 | 0/207 | restored one count-generic row, still lower generic-position-hard |
| 500 | 175/207 | 206/207 | 0/207 | same aggregate, weaker hard generic mix |

Conclusion: cleanup did not beat the source checkpoint.

## Conclusion

This phase produced a real model-training improvement:

- best Phase 4F result: 172/207 strict, 2/207 semantic-invalid
- best Phase 4G result: 175/207 strict, 0/207 semantic-invalid
- deployed-checkpoint baseline on this dataset: 159/207 strict,
  0/207 semantic-invalid

The export candidate is:

```text
training/seq2seq-runs/phase4g-plus-continued-staged750-lr2e-6/checkpoint-500
```

It should be exported to ONNX and tested in the raw browser runtime before any
promotion. Do not use the 1000-step checkpoint; it overtrained and reintroduced
semantic-invalid outputs.
