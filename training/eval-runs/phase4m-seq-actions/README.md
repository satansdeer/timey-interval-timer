# Phase 4M: SEQ Atom Actions

Date: 2026-05-19

Status: completed experiment, not browser promoted.

## Goal

Phase 4L showed that lossless atom actions fixed the structural work/rest pair
problem but still struggled with exact explicit label sequences:

- `explicit-label-copy`: 6/22 at the selected Phase 4L checkpoint
- `explicit-sequence`: 0/1
- `user-label-surface`: 0/3

Phase 4M tests whether a compact direct sequence command helps those rows by
removing repeated `ADD` boilerplate.

Old atom target:

```text
ADD A0
ADD A2
ADD A4
END
```

New atom target:

```text
SEQ A0 A2 A4
END
```

## Implementation

- Added `SEQ atom atom ...` to `parseTimerActions`.
- Stopped stripping `SEQ` as a no-op parser token.
- Updated the action system prompt to mention `SEQ`.
- Updated atom-action fallback formatting so no-hint multi-timer sequences use
  `SEQ`.
- Kept `REP`, `ALT`, `BLOCK`, and endpoint hint behavior unchanged.
- Added a regression test for `SEQ A0 A2 A4`.

## Dataset

Directory:

```text
training/generated-actions-lossless-atoms-seq-phase4i/
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
  --out-dir training/generated-actions-lossless-atoms-seq-phase4i
```

Counts:

- Train rows: 1501
- Validation rows: 207
- Hard validation rows: 62
- `SEQ` train targets: 188
- `SEQ` validation targets: 26
- Validation `SEQ` categories:
  - `explicit-label-copy`: 22
  - `explicit-sequence`: 1
  - `user-label-surface`: 3

## Runs

| Run | Source | Best step | Strict | Semantic | Parseable | Semantic-invalid | Notes |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| `phase4m-actions-lossless-atoms-seq-base-lr3e-4` | `google/t5-efficient-tiny` | 1000 | 134/207 | 135/207 | 206/207 | 0/207 | worse than Phase 4L base |
| `phase4m-actions-lossless-atoms-seq-cleanup-lr5e-5` | Phase 4L selected checkpoint | 100 | 164/207 | 165/207 | 207/207 | 0/207 | tiny continuation gain |

Hard validation:

| Run | Checkpoint | Strict | Semantic | Parseable | Semantic-invalid |
| --- | --- | ---: | ---: | ---: | ---: |
| `phase4m-actions-lossless-atoms-seq-cleanup-hard-eval` | cleanup checkpoint-100 | 46/62 | 46/62 | 62/62 | 0/62 |

Best checkpoint:

```text
training/seq2seq-runs/phase4m-actions-lossless-atoms-seq-cleanup-lr5e-5/checkpoint-100
```

## Category Readout

Best checkpoint on 207-row validation:

- `explicit-label-copy`: 7/22, up from 6/22 at Phase 4L selected checkpoint.
- `explicit-sequence`: 0/1, unchanged.
- `user-label-surface`: 0/3, unchanged.
- `count-pairs`: 22/22, unchanged.
- `count-generic`: 21/21, unchanged at checkpoint 100.
- `generic-position-hard`: 5/10, unchanged from Phase 4L selected checkpoint.

The model did learn the new command partially:

- Step 0 continuation: 0 `SEQ` outputs.
- Step 100 continuation: 7 `SEQ` outputs, 7/22 explicit-label-copy strict.
- Step 500 continuation: 27 `SEQ` outputs, but one `count-generic` row regressed.

## Conclusions

- `SEQ` is syntactically useful and safe for the parser, but it is not a major
  capability unlock for tiny T5.
- The main remaining issue is not `ADD` boilerplate. The model still picks the
  wrong atom ids from the candidate menu on exact label-copy rows.
- Base training with `SEQ` is worse than Phase 4L base training. Do not switch
  the base target language wholesale to `SEQ`.
- The only useful result is a small continuation gain from 163/207 to 164/207.
  This is too small to promote.

## Next Candidate Work

- Improve atom candidate ordering for explicit sequences, so the correct atoms
  appear in source/list order with fewer nearby distractors.
- Add a dedicated exact-sequence extractor feature, such as a separate `Items:`
  list, instead of only a global `Atoms:` menu.
- Add more exact sequence contrast data only after improving the prompt
  representation; training alone is unlikely to solve wrong atom selection.
