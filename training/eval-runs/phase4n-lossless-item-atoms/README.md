# Phase 4N: Source-Ordered Items + Atom Hybrid

Date: 2026-05-20

Status: completed experiment, selected checkpoint candidate.

## Goal

Phase 4M showed that `SEQ` syntax was safe but did not fix wrong atom
selection. The next hypothesis was that direct label-copy rows need a clean,
source-ordered `Items:` list, while structural workout rows should keep the
atom commands that Phase 4L/4M already handled well.

## Implementation

- Added `--user-format lossless-items`.
- Added `--user-format lossless-item-atoms`.
- Added source-ordered `Items:` slots with `I0`, `I1`, ... ids.
- Extended `parseTimerActions` so `ADD`, `SEQ`, `REP`, `ALT`, and `BLOCK` can
  resolve either item ids or atom ids.
- Added a direct colon-item extractor so exact timer mentions such as
  `15s: Plank / 45 sec: Squats / 15 sec: Rest` become monotonic item targets:

```text
Items: I0@7:10,12:17=15s:Plank; I1@20:26,28:34=45s:Squats; I2@37:43,45:49=15s:Rest
SEQ I0 I1 I2
END
```

- Added a negated-label guard so text such as `no warmup or cooldown` does not
  create misleading warmup/cooldown item candidates.
- Added tests for all-item targets and hybrid item/atom targets.

## Dataset

All-item dataset:

```text
training/generated-actions-lossless-items-phase4i/
```

- Train rows: 1478
- Validation rows: 207
- Hard validation rows: 62
- All targets use `I` item ids.
- 23 train-only rows are skipped because item-only binding cannot recover all
  required values without atom fallback.

Hybrid item/atom dataset:

```text
training/generated-actions-lossless-item-atoms-phase4i/
```

- Train rows: 1501
- Validation rows: 207
- Hard validation rows: 62
- `I` item targets: 214 / 1708
- All `I` targets are direct `SEQ` rows.
- Structural rows keep atom targets such as `ADD A0`, `REP C0 A1`,
  `ALT C0 A5 A6`, and `BLOCK C0 A3 A1`.

## Runs

| Run | Source | Best step | Strict | Parseable | Semantic-invalid | Notes |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| `phase4n-actions-lossless-items-cleanup-v2-lr5e-5` | Phase 4L selected checkpoint | 500 | 158/207 | 199/207 | 0/207 | all-item output helped labels but regressed structural rows |
| `phase4n-actions-lossless-item-atoms-cleanup-lr5e-5` | Phase 4M selected checkpoint | 250 | 169/207 | 207/207 | 0/207 | selected hybrid result |
| `phase4n-actions-lossless-item-atoms-polish-lr1e-5` | Hybrid checkpoint-250 | 0 | 169/207 | 207/207 | 0/207 | lower-LR polish did not improve |

Hard validation:

| Run | Checkpoint | Strict | Parseable | Semantic-invalid |
| --- | --- | ---: | ---: | ---: |
| `phase4n-actions-lossless-item-atoms-hard-eval` | hybrid checkpoint-250 | 50/62 | 62/62 | 0/62 |

Selected checkpoint:

```text
training/seq2seq-runs/phase4n-actions-lossless-item-atoms-cleanup-lr5e-5/checkpoint-250
```

## Category Readout

Hybrid checkpoint-250 on 207-row validation:

- `explicit-label-copy`: 14/22, up from 7/22 in Phase 4M.
- `explicit-sequence`: 0/1, still misses one repeated work/rest exact sequence.
- `user-label-surface`: 2/3, up from 0/3.
- `count-pairs`: 22/22, preserved from Phase 4M.
- `generic-position`: 5/5, preserved from Phase 4M.
- `generic-position-hard`: 6/10, up from 5/10.
- `user-generic-surface`: 8/8, up from 5/8.
- `count-middle`: 27/35, unchanged.
- `pairs`: 6/9, unchanged.
- `individual-middle`: 21/26, down from 26/26.

## Conclusions

- Source-ordered items are useful, but only when scoped to direct sequence
  copying. Making every action use item ids overloaded the model and regressed
  rows that atom actions already solved.
- The hybrid representation is the first post-Phase-4M experiment that improves
  aggregate validation: `164/207` to `169/207`.
- Hard validation also improves: `46/62` to `50/62`.
- The main remaining errors are not parser failures. They are sequence tail
  repetition in `SEQ` rows and wrong order/role selection in hard generic or
  work/rest rows.
- Do not run additional generic polish from the selected checkpoint without a
  tighter objective. The first lower-LR polish attempt reduced accuracy.

## Next Candidate Work

- Add targeted anti-repeat sequence rows for exact `SEQ` outputs where the model
  repeats the penultimate item, such as `SEQ I0 I1 I2 I2`.
- Add contrast rows for `rest then work` and high/low order, because remaining
  middle-timer errors are mostly role-order swaps.
- Consider a decode-time validity constraint for `SEQ`: when the target has a
  clean source-ordered item list, repeated final ids should be penalized unless
  the request repeats that exact item.
