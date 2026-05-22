# Timey

Local-first interval timer builder with natural-language timer setup.

## Requirements

- A modern browser.
- Python 3 for the simplest local static server.
- Node.js 18 or newer for tests and the console harness.

## Run

```sh
python3 -m http.server 5173
```

Then open `http://localhost:5173`.

## Tests

```sh
npm test
npm run test:fallback
npm run test:llm
```

Run browser regression tests:

```sh
npm install
npx playwright install chromium
npm run test:browser
```

Run the opt-in real browser LLM test:

```sh
npm run hydrate:browser-model
npm run test:llm:real
```

This launches Chromium, imports the pinned browser model path, loads the local
`models/timey-t5-efficient-tiny` ONNX assets, and verifies the known-problem
interval prompts against the actual browser model output. It is intentionally
not part of `npm test` because the first run loads local model files and imports
Transformers.js plus ONNX Runtime Web from the CDN. The test defaults to
installed Chrome; set `TIMEY_REAL_TINY_MODEL_CHANNEL=bundled` to use
Playwright's bundled Chromium instead. Set
`TIMEY_REAL_TINY_MODEL_PROFILE_DIR` to choose the persistent browser profile
used for model caching.

Debug model loading and generation with per-phase browser logs:

```sh
npm run debug:tiny-model
```

Set `TIMEY_DEBUG_TINY_MODEL_PHASE_TIMEOUT_MS`, `TIMEY_DEBUG_TINY_MODEL_PROMPT`,
`TIMEY_DEBUG_TINY_MODEL_CHANNEL=bundled`, or
`TIMEY_DEBUG_TINY_MODEL_HEADED=1` to narrow a specific failure. Set
`TIMEY_DEBUG_TINY_MODEL_MODE=ort` to check raw ONNX Runtime Web session loading
without tokenization or generation.

Run the console assistant harness against dialog fixtures:

```sh
node scripts/timmy-harness.mjs
node scripts/timmy-harness.mjs --fixture failed-six-steps-dialog --show-log
```

List available fixtures:

```sh
node scripts/timmy-harness.mjs --list
```

Build and validate the timer DSL dataset used by the tiny seq2seq model:

```sh
npm run training:build
npm run training:validate
```

See `training/README.md` for the dataset format, training command, and current
local results.

## Deploy

Deploy with the authenticated Netlify CLI from a clean static bundle:

```sh
npm run hydrate:browser-model
rm -rf /tmp/timey-netlify
mkdir -p /tmp/timey-netlify/scripts/training
cp index.html styles.css main.js assistant-session.js fallback-planner.js planner.js llm-planner.js service-worker.js manifest.webmanifest favicon.svg /tmp/timey-netlify/
cp timer-dsl.js /tmp/timey-netlify/
cp scripts/training/timer-sft-lib.mjs /tmp/timey-netlify/scripts/training/
cp -R models /tmp/timey-netlify/
netlify deploy --prod --dir /tmp/timey-netlify --message "Deploy Timey"
```

If the folder is not linked yet, create and link the site first:

```sh
netlify sites:create --name timey-interval-timer
```

Current production release:

- App: https://timey-interval-timer.netlify.app
- Netlify deploy id: `6a0ed36e0172c100ef1ab8ac`
- Source tag: `timmy-t2-v0.1.0`
- Model repo: https://huggingface.co/Satansdeer/timmy-t2
- Dataset repo: https://huggingface.co/datasets/Satansdeer/timmy-t2-timer-sft

## Timer Semantics

Running timers are derived from persisted wall-clock timestamps:

- `elapsedBeforeStartMs` stores elapsed time before the latest start/resume.
- `startedAtMs` stores the absolute `Date.now()` timestamp for the current run.
- Current progress is recomputed as `elapsedBeforeStartMs + (Date.now() - startedAtMs)`.

That means closing the page, reopening it, sleeping the device, or going offline does not freeze the workout state. The page may not be allowed to play sounds while closed, but the timer position is recalculated correctly when it is opened again.

## AI Setup

The assistant uses a planner stack:

- `assistant-session.js` is the shared DOM-free session layer used by both the web UI and console harness.
- `timer-dsl.js` defines the timer shorthand grammar used by both human input and model output.
- `scripts/training/timer-sft-lib.mjs` defines the shared action-slot prompt builder and action parser used by both training/eval and the browser runtime.
- `llm-planner.js` loads the trained `timey-t5-efficient-tiny` seq2seq model from local `/models` assets hydrated from Hugging Face. It uses Transformers.js for tokenization and raw ONNX Runtime Web for encoder/decoder inference.
- `planner.js` chooses the tiny model path when the model is loaded, otherwise the deterministic backup.
- `fallback-planner.js` is the deterministic backup for unsupported browsers, failed model loads, and correction requests. Successful model output is parsed as Timey action commands and validated before changing UI state.

On page load, the app checks WebAssembly support. Supported browsers
automatically load and use the local tiny model. Unsupported browsers use the
fallback parser without prompting.

The tiny model path pins `@huggingface/transformers@4.2.0`,
`onnxruntime-web@1.26.0-dev.20260416-b7804b056c`, and the Phase 4Y action
checkpoint exported as dynamic-q8 encoder plus q4 decoder ONNX. The model input keeps
the raw request and shared lossless slot annotations, and the model emits Timey
action commands such as `ADD A0`, `ALT C0 A4 A5`, or `SEQ3 I0 I1 I2`. The shared
action parser expands those commands into timer objects.

The public Timmy T2 release is:

- **Timmy T2**: Timmy Timer Translator.
- Hugging Face model: `Satansdeer/timmy-t2`.
- Hugging Face dataset: `Satansdeer/timmy-t2-timer-sft`.
- Release version: `v0.1.0`.
- Runtime model version:
  `phase4y-actions-browser-exact-checkpoint-50-dynq8enc-q4dec-ort-beam4`.
- Browser artifact: dynamic-q8 encoder plus q4 decoder ONNX, 46,783,826 bytes
  total.
- Release gates: 207/207 validation, 62/62 hard validation, 16/16 hidden
  validation, and 3/3 browser-regression prompts for the selected ONNX export.

Model binaries are not tracked in git. Hydrate the local browser runtime assets
from Hugging Face before running the real model tests or deploying:

```sh
npm run hydrate:browser-model
```

## Update Caching

The service worker owns `timey-app-*` caches for app files and a separate
`timey-model-t5-efficient-tiny-phase4y-actions-dynq8enc-q4dec-v1` cache for same-origin `/models/` assets.
App files use network-first responses; model files use cache-first responses so
ordinary UI deploys do not force a fresh model download.

The browser cache regression test simulates a UI deploy by upgrading the
service worker from one app cache version to another. It seeds a separate fake
model cache first, then verifies the old UI cache is removed, the new UI cache
is installed, and the model cache entry is still available without a network
download.

The model should return only parseable Timey action commands. UI state is
changed only after action parsing, schema validation, and timer normalization.
