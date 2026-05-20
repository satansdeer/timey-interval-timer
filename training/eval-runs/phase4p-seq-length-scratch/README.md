# Phase 4P: Length-Coded `SEQn` Actions From Scratch

Date: 2026-05-20

Status: completed experiment, selected HF checkpoint candidate.

## Goal

Phase 4O showed that targeted residual continuation from the Phase 4N action
checkpoint did not fix direct `SEQ` tail repetition. The working hypothesis was
that the prior checkpoints were biased by older target languages, so a genuine
syntax change should be trained from the base tiny model instead of continued
from the old basin.

This phase changed direct sequence actions from open-ended:

```text
SEQ I0 I1 I2
END
```

to length-coded:

```text
SEQ3 I0 I1 I2
END
```

The goal is to give the decoder an explicit stop count for source-ordered item
or atom lists, so it has less opportunity to append a duplicate tail id.

## Implementation

- Added `--action-seq-length` to the dataset builder.
- Added `ACTION_SEQ_LENGTH_SYSTEM_PROMPT`.
- Added `SEQn` formatting for action sequence targets.
- Extended `parseTimerActions` to accept both legacy `SEQ ...` and new
  `SEQn ...` commands.
- `SEQn` validation rejects missing ids and extra ids after the declared
  length, for example `SEQ3 I0 I1 I2 I2`.
- Added `--phase4p-seq-length-data`, a train-only sequence-length pedagogy set
  with 72 rows.
- Added unit tests for `SEQ3` generation, parsing, and extra-id rejection.

Generated dataset:

```text
training/generated-actions-lossless-item-atoms-seqlen-phase4p/
```

- Train rows: 1762
- Validation rows: 207
- Hard validation rows: 62
- New train-only category:
  - `phase4p-seq-length-pedagogy`: 72
- `SEQn` examples across all rows: 334

## Runs

Scratch run from the base tiny model:

```text
training/seq2seq-runs/phase4p-actions-seqlen-base-lr3e-4/
```

| Step | Strict | Semantic | Parseable | Semantic-invalid |
| ---: | ---: | ---: | ---: | ---: |
| 0 | 0/207 | 0/207 | 0/207 | 0/207 |
| 250 | 54/207 | 54/207 | 144/207 | 0/207 |
| 500 | 52/207 | 52/207 | 184/207 | 0/207 |
| 1000 | 166/207 | 166/207 | 206/207 | 0/207 |
| 1500 | 181/207 | 181/207 | 204/207 | 0/207 |
| 2000 | 185/207 | 186/207 | 203/207 | 0/207 |

Hard validation for scratch step 2000:

```text
training/seq2seq-runs/phase4p-actions-seqlen-base-step2000-hard-eval/
```

- Strict: 52/62
- Parseable: 60/62
- Semantic-invalid: 0/62

Cleanup run from scratch step 2000:

```text
training/seq2seq-runs/phase4p-actions-seqlen-cleanup-lr5e-5/
```

| Step | Strict | Semantic | Parseable | Semantic-invalid | Notes |
| ---: | ---: | ---: | ---: | ---: | --- |
| 0 | 185/207 | 186/207 | 203/207 | 0/207 | scratch checkpoint |
| 25 | 187/207 | 188/207 | 203/207 | 0/207 | small gain |
| 50 | 191/207 | 192/207 | 207/207 | 0/207 | selected candidate |
| 100 | 192/207 | 193/207 | 205/207 | 0/207 | one more strict match, but parse regression |
| 250 | 191/207 | 191/207 | 203/207 | 0/207 | later category regression |

Hard validation comparison:

| Checkpoint | Strict | Semantic | Parseable | Semantic-invalid |
| --- | ---: | ---: | ---: | ---: |
| cleanup step 50 | 55/62 | 55/62 | 62/62 | 0/62 |
| cleanup step 100 | 54/62 | 54/62 | 61/62 | 0/62 |

Selected HF checkpoint:

```text
training/seq2seq-runs/phase4p-actions-seqlen-cleanup-lr5e-5/checkpoint-50
```

## Findings

- The basin hypothesis was correct. Starting from `google/t5-efficient-tiny`
  with the new syntax beat the Phase 4N selected checkpoint by a large margin:
  `169/207` to `191/207` validation, and `50/62` to `55/62` hard validation.
- The explicit sequence length solved the parseability side of the direct
  sequence problem at the selected step: validation and hard validation are both
  fully parseable.
- Step 100 has the best aggregate validation score, but it reintroduces parse
  failures and is worse on the hard set. Step 50 is the safer checkpoint.
- Remaining errors are mostly valid-but-wrong role/order choices:
  `count-middle`, `user-around-contrast`, `user-around-regression-guard`, and
  `generic-position-hard`.
- This is still not production-ready by itself. The browser runtime currently
  expects DSL output, while this candidate emits action plans over extracted
  `Items:` and `Atoms:` annotations.

## Conclusion

Phase 4P is the strongest tiny HF training result so far and should replace
Phase 4N as the current action-language candidate. The next work is not another
small continuation from old checkpoints; it is either:

- integrate/export the selected action-plan candidate into the browser runtime,
  including deterministic lossless `Items:`/`Atoms:` extraction; or
- run a larger from-scratch curriculum around the remaining role/order errors
  while keeping `SEQn` and the Phase 4P pedagogy rows.
