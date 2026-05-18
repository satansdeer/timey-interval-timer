#!/usr/bin/env node
import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const channel = process.env.TIMEY_DEBUG_TINY_MODEL_CHANNEL || "chrome";
const headed = process.env.TIMEY_DEBUG_TINY_MODEL_HEADED === "1";
const profileDir =
  process.env.TIMEY_DEBUG_TINY_MODEL_PROFILE_DIR ||
  join(tmpdir(), `timey-debug-tiny-model-profile-${channel.replaceAll(/\W+/g, "-")}`);
const prompt =
  process.env.TIMEY_DEBUG_TINY_MODEL_PROMPT ||
  "8 minutes warmup, 4 of 1 minute alterations work/rest in the middle, 8 minutes cooldown";
const phaseTimeoutMs = Number(process.env.TIMEY_DEBUG_TINY_MODEL_PHASE_TIMEOUT_MS || 120_000);
const mode = process.env.TIMEY_DEBUG_TINY_MODEL_MODE || "transformers";
const ortVersion = "1.26.0-dev.20260416-b7804b056c";

const startedAt = Date.now();
const log = (message) => {
  const elapsed = String(((Date.now() - startedAt) / 1000).toFixed(1)).padStart(6);
  console.log(`[${elapsed}s] ${message}`);
};

const server = await startRepoServer();
log(`server ${server.origin}`);

const context = await chromium.launchPersistentContext(profileDir, {
  args: ["--enable-unsafe-webgpu", "--ignore-gpu-blocklist", "--disable-dev-shm-usage"],
  ...(channel === "bundled" ? {} : { channel }),
  headless: !headed,
  serviceWorkers: "block",
  viewport: { width: 1280, height: 720 },
});

try {
  const page = await context.newPage();
  page.on("console", (message) => log(`browser ${message.type()}: ${message.text()}`));
  page.on("pageerror", (error) => log(`browser pageerror: ${error.stack || error.message}`));
  page.on("requestfailed", (request) => log(`request failed ${request.url()} ${request.failure()?.errorText}`));
  page.on("response", (response) => {
    const url = response.url();
    if (isDebugNetworkUrl(url)) {
      const length = response.headers()["content-length"] || "unknown-size";
      log(`response ${response.status()} ${length} ${url}`);
    }
  });

  await page.goto(`${server.origin}/__tiny_model_debug.html`);
  const result =
    mode === "ort"
      ? await page.evaluate(
          async ({ phaseTimeoutMs: timeoutMs, ortVersion: version }) => {
            const events = [];
            const mark = (name, detail = "") => {
              const event = {
                name,
                detail,
                elapsedMs: Math.round(performance.now()),
              };
              events.push(event);
              console.log(`[tiny-debug] ${name}${detail ? `: ${detail}` : ""}`);
            };
            const withTimeout = (name, promise) =>
              Promise.race([
                promise,
                new Promise((_, reject) => {
                  setTimeout(() => reject(new Error(`${name} timed out after ${timeoutMs}ms`)), timeoutMs);
                }),
              ]);

            try {
              mark(
                "environment",
                JSON.stringify({
                  crossOriginIsolated,
                  webgpu: Boolean(navigator.gpu),
                  webassembly: typeof WebAssembly,
                  userAgent: navigator.userAgent,
                }),
              );

              mark("llm-import-start");
              const llm = await withTimeout("llm-import", import("/llm-planner.js"));
              mark(
                "llm-import-done",
                JSON.stringify({
                  model: llm.TRAINED_TINY_MODEL_ID,
                  version: llm.TRAINED_TINY_MODEL_VERSION,
                  dtype: llm.TRAINED_TINY_MODEL_DTYPE,
                  encoder: llm.TINY_TIMER_ENCODER_URL,
                  decoder: llm.TINY_TIMER_DECODER_URL,
                }),
              );

              mark("ort-import-start", version);
              const ort = await withTimeout(
                "ort-import",
                import(`https://cdn.jsdelivr.net/npm/onnxruntime-web@${version}/dist/ort.wasm.min.mjs`),
              );
              ort.env.debug = true;
              ort.env.logLevel = "verbose";
              ort.env.wasm.numThreads = 1;
              ort.env.wasm.proxy = false;
              ort.env.wasm.wasmPaths = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${version}/dist/`;
              mark(
                "ort-import-done",
                JSON.stringify({
                  version: ort.env.versions,
                  wasm: {
                    numThreads: ort.env.wasm.numThreads,
                    proxy: ort.env.wasm.proxy,
                    wasmPaths: ort.env.wasm.wasmPaths,
                  },
                }),
              );

              const sessions = [];
              for (const modelFile of [llm.TINY_TIMER_ENCODER_URL, llm.TINY_TIMER_DECODER_URL]) {
                mark("ort-session-start", modelFile);
                const session = await withTimeout(
                  `ort-session ${modelFile}`,
                  ort.InferenceSession.create(modelFile, {
                    executionProviders: ["wasm"],
                    graphOptimizationLevel: "all",
                  }),
                );
                const sessionInfo = {
                  modelFile,
                  inputNames: session.inputNames,
                  outputNames: session.outputNames,
                };
                sessions.push(sessionInfo);
                mark("ort-session-done", JSON.stringify(sessionInfo));
              }

              return {
                ok: true,
                mode: "ort",
                events,
                sessions,
                resources: performance
                  .getEntriesByType("resource")
                  .map((entry) => entry.name)
                  .filter((name) => name.includes("onnxruntime") || name.includes("/models/")),
              };
            } catch (error) {
              mark("error", String(error?.message || error));
              return {
                ok: false,
                mode: "ort",
                events,
                error: String(error?.message || error),
                stack: error?.stack,
                resources: performance
                  .getEntriesByType("resource")
                  .map((entry) => entry.name)
                  .filter((name) => name.includes("onnxruntime") || name.includes("/models/")),
              };
            }
          },
          { phaseTimeoutMs, ortVersion },
        )
      : await page.evaluate(
          async ({ prompt: requestText, phaseTimeoutMs: timeoutMs }) => {
      const events = [];
      const mark = (name, detail = "") => {
        const event = {
          name,
          detail,
          elapsedMs: Math.round(performance.now()),
        };
        events.push(event);
        console.log(`[tiny-debug] ${name}${detail ? `: ${detail}` : ""}`);
      };
      const withTimeout = (name, promise) =>
        Promise.race([
          promise,
          new Promise((_, reject) => {
            setTimeout(() => reject(new Error(`${name} timed out after ${timeoutMs}ms`)), timeoutMs);
          }),
        ]);

      try {
        mark(
          "environment",
          JSON.stringify({
            crossOriginIsolated,
            webgpu: Boolean(navigator.gpu),
            webassembly: typeof WebAssembly,
            userAgent: navigator.userAgent,
          }),
        );

        mark("import-start");
        const llm = await withTimeout("import", import("/llm-planner.js"));
        mark(
          "import-done",
          JSON.stringify({
            model: llm.TRAINED_TINY_MODEL_ID,
            dtype: llm.TRAINED_TINY_MODEL_DTYPE,
            device: llm.TRAINED_TINY_MODEL_DEVICE,
            transformers: llm.TRANSFORMERS_PACKAGE_VERSION,
            ortWeb: llm.ONNXRUNTIME_WEB_VERSION,
          }),
        );
        const transformers = await withTimeout("transformers-env-import", import(llm.TRANSFORMERS_CDN_URL));
        mark(
          "transformers-env",
          JSON.stringify({
            onnxKeys: Object.keys(transformers.env.backends?.onnx || {}),
            wasmKeys: Object.keys(transformers.env.backends?.onnx?.wasm || {}),
            wasm: transformers.env.backends?.onnx?.wasm || null,
          }),
        );
        if (transformers.env.backends?.onnx?.wasm) {
          transformers.env.backends.onnx.wasm.numThreads = 1;
          transformers.env.backends.onnx.wasm.proxy = false;
          transformers.env.backends.onnx.wasm.wasmPaths = llm.ONNXRUNTIME_WASM_PATHS;
          mark(
            "transformers-env-overridden",
            JSON.stringify(transformers.env.backends.onnx.wasm),
          );
        }

        mark("preload-start");
        const selectedModel = await withTimeout(
          "preload",
          llm.preloadTinyLlm((status, progress) => {
            mark("preload-status", `${Math.round(Number(progress || 0) * 100)}% ${status}`);
          }),
        );
        mark("preload-done", selectedModel);

        mark("generate-start", requestText);
        const planned = await withTimeout(
          "generate",
          llm.planWithTinyLlm({
            text: requestText,
            onStatus: (status, progress) => {
              mark("generate-status", `${Math.round(Number(progress || 0) * 100)}% ${status}`);
            },
          }),
        );
        mark("generate-done", JSON.stringify(planned.timers));

        return {
          ok: true,
          events,
          model: planned.model,
          rawContent: planned.rawContent,
          timers: planned.timers,
        };
      } catch (error) {
        mark("error", String(error?.message || error));
        return {
          ok: false,
          events,
          error: String(error?.message || error),
          stack: error?.stack,
          resources: performance
            .getEntriesByType("resource")
            .map((entry) => entry.name)
            .filter((name) => name.includes("onnxruntime") || name.includes("/models/")),
        };
      }
          },
          { prompt, phaseTimeoutMs },
        );

  log(JSON.stringify(result, null, 2));
  process.exitCode = result.ok ? 0 : 1;
} finally {
  await context.close();
  await server.close();
}

async function startRepoServer() {
  const server = createServer(async (request, response) => {
    const requestStartedAt = Date.now();
    try {
      const url = new URL(request.url || "/", "http://127.0.0.1");
      const pathname = decodeURIComponent(url.pathname);

      if (pathname === "/" || pathname === "/__tiny_model_debug.html") {
        response.writeHead(200, responseHeaders("text/html; charset=utf-8"));
        response.end(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Timey tiny model debug</title>
  </head>
  <body></body>
</html>
`);
        return;
      }

      const filePath = resolve(repoRoot, pathname.slice(1));
      if (filePath !== repoRoot && !filePath.startsWith(`${repoRoot}${sep}`)) {
        throw new Error("Path escapes repo root");
      }

      const body = await readFile(filePath);
      response.writeHead(200, responseHeaders(contentType(filePath)));
      response.end(body);
      if (pathname.startsWith("/models/")) {
        log(`served ${pathname} ${body.length}B in ${Date.now() - requestStartedAt}ms`);
      }
    } catch (error) {
      response.writeHead(404, responseHeaders("text/plain; charset=utf-8"));
      response.end("Not found");
      log(`404 ${request.url} ${error?.message || error}`);
    }
  });

  await new Promise((resolvePromise) => server.listen(0, "127.0.0.1", resolvePromise));
  const address = server.address();
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolvePromise) => server.close(resolvePromise)),
  };
}

function responseHeaders(contentTypeValue) {
  return {
    "Cache-Control": "no-store",
    "Content-Type": contentTypeValue,
    "Cross-Origin-Embedder-Policy": "credentialless",
    "Cross-Origin-Opener-Policy": "same-origin",
  };
}

function contentType(filePath) {
  const extension = extname(basename(filePath));
  if (extension === ".html") return "text/html; charset=utf-8";
  if (extension === ".js" || extension === ".mjs") return "text/javascript; charset=utf-8";
  if (extension === ".css") return "text/css; charset=utf-8";
  if (extension === ".svg") return "image/svg+xml";
  if (extension === ".webmanifest") return "application/manifest+json";
  return "application/octet-stream";
}

function isDebugNetworkUrl(url) {
  return (
    url.includes("/models/") ||
    url.includes("@huggingface/transformers") ||
    url.includes("onnxruntime") ||
    url.endsWith(".wasm") ||
    url.endsWith(".mjs")
  );
}
