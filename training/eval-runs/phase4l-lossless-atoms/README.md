# Phase 4L: Lossless Atom Actions

Date: 2026-05-19

Status: completed experiment, not browser promoted.

## Goal

Phase 4K proved that compact lossless slots are production-realistic but too
hard for the tiny model: the model had to choose global duration and label slots
separately, and work/rest categories collapsed.

Phase 4L keeps the raw request and source-backed extraction, but pre-binds
candidate timer atoms. The model predicts structure plus atom ids:

```text
Request: first and last timer 5minute, 5 one minute timers in between
Counts: C0@30:31=5
Atoms: A0@21:28=5m:Timer; A1@32:42=1m:Timer
```

Target:

```text
ADD A0
REP C0 A1
ADD A0
END
```

## Implementation

- Added `--user-format lossless-atoms`.
- Extended `extractLosslessActionSlots(request, { includeAtoms: true })`.
- Added atom-aware action targets:
  - `ADD A0`
  - `REP C0 A1`
  - `ALT C0 A0 A1`
  - `BLOCK C0 A0 A1`
- Kept backward compatibility with duration/label action targets.
- Added parser support for atom commands in `parseTimerActions`.
- Added a regression test for atom prompts and atom action parsing.
- Fixed one contradictory synthetic pair template: it now says `hard and easy`
  when the target is hard then easy.

## Dataset

Directory:

```text
training/generated-actions-lossless-atoms-phase4i/
```

Build command:

```bash
node scripts/training/build-timer-sft.mjs \
  --target-format actions \
  --user-format lossless-atoms \
  --phase4-hard-data \
  --user-request-expansion \
  --phase4h-residual-data \
  --phase4i-browser-residual-data \
  --out-dir training/generated-actions-lossless-atoms-phase4i
```

Counts:

- Train rows: 1501
- Validation rows: 207
- Hard validation rows: 62
- Validation + hard atom count stats:
  - min: 1
  - median: 6
  - p90: 8
  - p95: 8
  - max: 15
  - average: 5.53

## Runs

| Run | Source | Best step | Strict | Semantic | Parseable | Semantic-invalid | Notes |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| `phase4l-actions-lossless-atoms-base-lr3e-4` | `google/t5-efficient-tiny` | 1000 | 156/207 | 157/207 | 206/207 | 0/207 | first atom prototype |
| `phase4l-actions-lossless-atoms-tight-base-lr3e-4` | `google/t5-efficient-tiny` | 1000 | 158/207 | 159/207 | 206/207 | 0/207 | selected base atom dataset |
| `phase4l-actions-lossless-atoms-tighter-base-lr3e-4` | `google/t5-efficient-tiny` | 1000 | 138/207 | 139/207 | 207/207 | 0/207 | same-span alias pruning backfired |
| `phase4l-actions-lossless-atoms-regexcue-base-lr3e-4` | `google/t5-efficient-tiny` | 1000 | 149/207 | 150/207 | 207/207 | 0/207 | stricter implicit cue pruning backfired |
| `phase4l-actions-lossless-atoms-tight-cleanup-lr5e-5` | tight checkpoint-1000 | 100 | 163/207 | 164/207 | 206/207 | 0/207 | selected checkpoint |

Hard validation:

| Run | Checkpoint | Strict | Semantic | Parseable | Semantic-invalid |
| --- | --- | ---: | ---: | ---: | ---: |
| `phase4l-actions-lossless-atoms-tight-hard-eval` | tight base checkpoint-1000 | 44/62 | 44/62 | 62/62 | 0/62 |
| `phase4l-actions-lossless-atoms-tight-cleanup-hard-eval` | cleanup checkpoint-100 | 46/62 | 46/62 | 62/62 | 0/62 |

Selected checkpoint:

```text
training/seq2seq-runs/phase4l-actions-lossless-atoms-tight-cleanup-lr5e-5/checkpoint-100
```

## Category Readout

Selected checkpoint on 207-row validation:

- Solved:
  - `count-generic`: 21/21
  - `count-pairs`: 22/22
  - `individual-middle`: 26/26
  - `generic-position`: 5/5
  - `generic-timers-hard`: 6/6
- Improved but still weak:
  - `explicit-label-copy`: 6/22
  - `generic-position-hard`: 5/10
  - `user-generic-surface`: 5/8
  - `count-middle`: 27/35
  - `user-around-contrast`: 16/20
- Still unsolved:
  - `explicit-sequence`: 0/1
  - `user-label-surface`: 0/3

## Conclusions

- Atom actions recovered much of the Phase 4K loss. `count-pairs` moved from
  0/22 in Phase 4K to 22/22 after cleanup.
- Atom actions are still below the oracle-slot Phase 4J action model
  (`163/207` vs `190-191/207`), so the remaining burden is not just syntax. The
  model still struggles to copy arbitrary explicit labels from atom menus.
- More pruning is not automatically better. Removing same-span aliases and
  tightening implicit cue rules made prompts look cleaner but reduced validation
  accuracy.
- The best current lossless direction is atom actions plus targeted continuation,
  but this is not ready for browser promotion.

## Next Candidate Work

- Add more explicit-label-copy training variety, especially multi-item exact
  sequences where durations repeat.
- Consider an even denser explicit sequence action for direct lists, such as a
  `SEQ A0 A1 A2 ...` command. This would reduce repeated `ADD` boilerplate and
  may help label-copy rows.
- Investigate atom ordering: some failures choose the first visually adjacent
  atom instead of the later order cue (`rest then work`).
- Do not spend more time on global duration/label lossless slots unless the
  model or decoder changes.
