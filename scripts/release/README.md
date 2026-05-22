# Release Scripts

## Hugging Face

The Timmy T2 Hugging Face release is staged by:

```sh
node scripts/release/stage-huggingface.mjs
```

The script writes ignored local staging folders under
`release/huggingface/timmy-t2-v0.1.0/`:

- `model/` for `Satansdeer/timmy-t2`
- `dataset/` for `Satansdeer/timmy-t2-timer-sft`

Upload after `hf auth login`:

```sh
hf upload Satansdeer/timmy-t2 release/huggingface/timmy-t2-v0.1.0/model . \
  --commit-message "Release Timmy T2 v0.1.0"

hf upload Satansdeer/timmy-t2-timer-sft release/huggingface/timmy-t2-v0.1.0/dataset . \
  --repo-type dataset \
  --commit-message "Release Timmy T2 timer SFT v0.1.0"
```

The public dataset intentionally excludes the hidden validation rows. Hidden
aggregate metrics are recorded in the model manifest.
