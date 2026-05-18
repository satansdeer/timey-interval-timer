# Phase 4H: Residual Curriculum Training

Date: 2026-05-18

## Goal

Push the tiny `google/t5-efficient-tiny` timer model beyond the Phase 4G
candidate by training directly against the remaining validation failure shapes:
generic endpoints, generic count/duration copying, work/rest contrast around
warmup/cooldown, and label copying.

The promotion bar remains model-first:

- raw Python/HF output should be parseable;
- raw semantic-invalid should be zero;
- deterministic repair should not be counted as model intelligence.

## Dataset Changes

Added opt-in train-only residual rows behind:

```sh
--phase4h-residual-data
```

The expanded user-request dataset now has:

| Split | Rows |
| --- | ---: |
| Train | 1467 |
| Validation | 207 |
| Hard validation | 62 |

New train-only categories:

| Category | Rows | Purpose |
| --- | ---: | --- |
| `phase4h-generic-endpoint` | 112 | Preserve opening/middle/closing generic groups |
| `phase4h-count-duration` | 62 | Count/duration copying, including `half a minute` and `ninety seconds` |
| `phase4h-work-rest-contrast` | 55 | Keep warmup/cooldown and work/rest syntax distinct from generic groups |
| `phase4h-plus-work-rest-guard` | 32 | Explicitly guard against illegal `+` groups around work/rest blocks |
| `phase4h-label-copy` | 12 | Preserve named sequence labels and repeated labels |

Validation stayed unchanged, so Phase 4G and Phase 4H scores are comparable.

## Baseline

Source checkpoint:

```text
training/seq2seq-runs/phase4g-plus-continued-staged750-lr2e-6/checkpoint-500
```

Source metrics on the 207-row validation set with beam 4:

| Strict | Parseable | Semantic-invalid |
| ---: | ---: | ---: |
| 175/207 | 206/207 | 0/207 |

## Experiments

### Weighted Residual Continuation

Runs:

```text
training/seq2seq-runs/phase4h-residual-seed7-lr2e-6/
training/seq2seq-runs/phase4h-residual-seed11-lr5e-7/
```

Result:

| Run | Best strict | Parseable | Semantic-invalid | Conclusion |
| --- | ---: | ---: | ---: | --- |
| `seed7-lr2e-6` | 175/207 | 206/207 | 0/207 | Step 50 tied source, later steps regressed |
| `seed11-lr5e-7` | 175/207 | 206/207 | 0/207 | Safe but flat |

Conclusion: residual rows mixed into full training are not enough to move the
model. Higher pressure destabilizes the model; lower pressure preserves it.

### Decode Controls

Source checkpoint decode checks:

| Decode | Strict | Parseable | Semantic-invalid |
| --- | ---: | ---: | ---: |
| beam 4, length penalty 1.2 | 175/207 | 205/207 | 0/207 |
| beam 4, length penalty 0.8 | 174/207 | 206/207 | 0/207 |
| beam 8 | 175/207 | 207/207 | 0/207 |

Conclusion: Phase 4G does not hide more strict accuracy in wider beams, though
beam 8 does improve parseability.

### Residual-Only Curriculum

Run:

```text
training/seq2seq-runs/phase4h-curriculum-residual-only-lr1e-5/
```

Best hard-behavior step:

| Step | Strict | Parseable | Semantic-invalid |
| ---: | ---: | ---: | ---: |
| 250 | 169/207 | 196/207 | 11/207 |

Useful category gains at step 250:

| Category | Source | Step 250 |
| --- | ---: | ---: |
| `generic-position` | 1/5 | 2/5 |
| `generic-position-hard` | 4/10 | 6/10 |
| `user-generic-surface` | 3/8 | 4/8 |
| `generic-timers` | 1/2 | 2/2 |
| `count-generic` | 19/21 | 20/21 |
| `user-label-surface` | 1/3 | 2/3 |

Conclusion: the tiny model has capacity for the hard behaviors, but isolated
hard-row training breaks general syntax and reintroduces semantic-invalid
outputs.

### Full Replay Cleanup

Run:

```text
training/seq2seq-runs/phase4h-curriculum-replay-lr2e-6/
```

Source checkpoint:

```text
training/seq2seq-runs/phase4h-curriculum-residual-only-lr1e-5/checkpoint-250
```

Best step:

| Step | Strict | Parseable | Semantic-invalid |
| ---: | ---: | ---: | ---: |
| 500 | 180/207 | 203/207 | 4/207 |

Conclusion: replay recovers most damaged categories and beats Phase 4G, but is
not promotable because semantic-invalid remains non-zero.

### Invalid Cleanup

Run:

```text
training/seq2seq-runs/phase4h-invalid-cleanup-lr1e-6/
```

Source checkpoint:

```text
training/seq2seq-runs/phase4h-curriculum-replay-lr2e-6/checkpoint-500
```

Best beam-4 result:

| Step | Strict | Parseable | Semantic-invalid |
| ---: | ---: | ---: | ---: |
| 250 | 182/207 | 205/207 | 2/207 |
| 500 | 182/207 | 205/207 | 2/207 |

The remaining invalids were both `user-around-regression-guard` rows where the
model used illegal `+` grouping around work/rest content.

### Plus Work/Rest Guard Cleanup

Run:

```text
training/seq2seq-runs/phase4h-plus-guard-cleanup-lr1e-6/
```

Source checkpoint:

```text
training/seq2seq-runs/phase4h-invalid-cleanup-lr1e-6/checkpoint-250
```

Beam-4 result:

| Step | Strict | Parseable | Semantic-invalid |
| ---: | ---: | ---: | ---: |
| 0 | 182/207 | 205/207 | 2/207 |
| 50 | 181/207 | 205/207 | 2/207 |
| 100 | 181/207 | 205/207 | 2/207 |
| 250 | 180/207 | 205/207 | 2/207 |
| 500 | 183/207 | 205/207 | 2/207 |

Best HF checkpoint:

```text
training/seq2seq-runs/phase4h-plus-guard-cleanup-lr1e-6/checkpoint-500
```

Decode sweep on that checkpoint:

| Decode | Strict | Parseable | Semantic-invalid |
| --- | ---: | ---: | ---: |
| beam 4 | 183/207 | 205/207 | 2/207 |
| beam 4, length penalty 1.2 | 182/207 | 205/207 | 2/207 |
| beam 8 | 185/207 | 207/207 | 0/207 |
| beam 12 | 185/207 | 207/207 | 0/207 |
| beam 16 | 185/207 | 207/207 | 0/207 |

Beam 8 is the best practical decode setting. Wider beams did not improve
strict match beyond 185/207.

Beam-8 category summary for the best checkpoint:

| Category | Strict |
| --- | ---: |
| `core-regression` | 2/2 |
| `count-generic` | 21/21 |
| `count-middle` | 35/35 |
| `count-pairs` | 22/22 |
| `explicit-label-copy` | 21/22 |
| `explicit-sequence` | 1/1 |
| `generic-position` | 2/5 |
| `generic-position-hard` | 5/10 |
| `generic-timers` | 2/2 |
| `generic-timers-hard` | 6/6 |
| `individual-middle` | 26/26 |
| `pairs` | 9/9 |
| `user-around-contrast` | 16/20 |
| `user-around-regression-guard` | 11/13 |
| `user-duration-surface` | 0/2 |
| `user-generic-surface` | 4/8 |
| `user-label-surface` | 2/3 |

## Conclusions

Phase 4H produced the best tiny checkpoint so far:

```text
training/seq2seq-runs/phase4h-plus-guard-cleanup-lr1e-6/checkpoint-500
```

Best measured Python/HF decode:

```text
beam 8: 185/207 strict, 207/207 parseable, 0/207 semantic-invalid
```

This is a real improvement over Phase 4G:

| Candidate | Decode | Strict | Parseable | Semantic-invalid |
| --- | --- | ---: | ---: | ---: |
| Phase 4G | beam 4 | 175/207 | 206/207 | 0/207 |
| Phase 4H | beam 4 | 183/207 | 205/207 | 2/207 |
| Phase 4H | beam 8 | 185/207 | 207/207 | 0/207 |

The model still does not pass every validation row. Remaining misses are valid
but wrong outputs, concentrated in:

- word duration normalization: `half a minute`, `ninety seconds`;
- generic endpoint/middle duration copying;
- around-word work/rest order and duration details;
- one explicit label-copy row.

## Promotion Status

Promoted locally as the current browser model assets.

Exported checkpoint:

```text
training/seq2seq-runs/phase4h-plus-guard-cleanup-lr1e-6/checkpoint-500
```

Runtime settings:

```text
TRAINED_TINY_MODEL_VERSION=t5-efficient-tiny-phase4h-plus-guard-checkpoint-500-q8enc-q4dec-ort-beam8
TINY_TIMER_NUM_BEAMS=8
TINY_TIMER_TOPK_PER_BEAM=8
MODEL_CACHE_NAME=timey-model-t5-efficient-tiny-q8enc-q4dec-v2
```

Export/quantization:

| Asset | Format | Bytes | SHA-256 |
| --- | --- | ---: | --- |
| `encoder_model_quantized.onnx` | q8 | 11,498,300 | `c086f2c818ca338f1e8365d5630a28468283fd774c08aa5b4b1d51e46f4fc540` |
| `decoder_model_quantized.onnx` | q4 | 35,285,581 | `dd719902165b795aaaf215dcc8c4d34c8fe1c0b264f564d9d03dba0e83982f57` |

Browser debug:

- ORT Web session creation passed.
- Prompt `8 minute timer, 4 one minute timers, 8 minute timer` produced raw
  DSL `8m + 4x1m + 8m: Timer END`.
- Repaired production real-browser categories passed.

Raw browser gate:

| Category | Repaired | Raw |
| --- | ---: | ---: |
| `core-regression` | 7/7 | 7/7 |
| `explicit-label-copy` | 4/4 | 4/4 |
| `generic-count` | 18/18 | 14/18 |
| `generic-position` | 26/26 | 11/26 |

Conclusion: Phase 4H is a better local browser checkpoint than the old
positional-generic model, but it still does not meet the stricter model-first
bar because raw browser output relies on deterministic repair for many generic
count and positional generic requests.
