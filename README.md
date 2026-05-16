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

Run the console assistant harness against dialog fixtures:

```sh
node scripts/timmy-harness.mjs
node scripts/timmy-harness.mjs --fixture failed-six-steps-dialog --show-log
```

List available fixtures:

```sh
node scripts/timmy-harness.mjs --list
```

## Deploy

Deploy with the authenticated Netlify CLI from a clean static bundle:

```sh
rm -rf /tmp/timey-netlify
mkdir -p /tmp/timey-netlify
cp index.html styles.css main.js assistant-session.js fallback-planner.js planner.js llm-planner.js service-worker.js manifest.webmanifest favicon.svg /tmp/timey-netlify/
netlify deploy --prod --dir /tmp/timey-netlify --message "Deploy Timey"
```

If the folder is not linked yet, create and link the site first:

```sh
netlify sites:create --name timey-interval-timer
```

## Timer Semantics

Running timers are derived from persisted wall-clock timestamps:

- `elapsedBeforeStartMs` stores elapsed time before the latest start/resume.
- `startedAtMs` stores the absolute `Date.now()` timestamp for the current run.
- Current progress is recomputed as `elapsedBeforeStartMs + (Date.now() - startedAtMs)`.

That means closing the page, reopening it, sleeping the device, or going offline does not freeze the workout state. The page may not be allowed to play sounds while closed, but the timer position is recalculated correctly when it is opened again.

## AI Setup

The assistant uses a planner stack:

- `assistant-session.js` is the shared DOM-free session layer used by both the web UI and console harness.
- `llm-planner.js` tries WebLLM in the browser through WebGPU and only sends prior timer state for correction requests.
- `planner.js` chooses the LLM path when the model is loaded, otherwise the deterministic backup.
- `fallback-planner.js` is the deterministic backup for unsupported browsers or failed model loads. Successful LLM output is not semantically replaced by the fallback parser; LLM behavior is tested separately so prompt and harness regressions stay visible.

On page load, the app checks WebGPU support. Supported browsers get a one-time choice to load the local model; that preference is stored in `localStorage`. Unsupported browsers use the fallback parser without prompting.

The tiny LLM path pins WebLLM to `@mlc-ai/web-llm@0.2.83`, tries `Qwen2-0.5B-Instruct-q4f16_1-MLC` first, then falls back to `Llama-3.2-1B-Instruct-q4f16_1-MLC`. The first run downloads model assets, so it can take a while. App deploys should not clear those model caches; users should only need a fresh model download when the pinned WebLLM/model identity changes or their browser storage is cleared. Once unavailable or failed, the app still works through the fallback parser.

## Update Caching

The service worker owns only `timey-app-*` caches and uses network-first responses for same-origin app files. It deliberately ignores cross-origin WebLLM/model requests and preserves non-Timey Cache Storage entries so model assets survive ordinary app deploys.

The browser cache regression test simulates a UI deploy by upgrading the service worker from one app cache version to another. It seeds a separate fake WebLLM/model cache first, then verifies the old UI cache is removed, the new UI cache is installed, and the model cache entry is still available without a network download.

The model should return only validated timer JSON. UI state is changed only after schema validation and timer normalization.
