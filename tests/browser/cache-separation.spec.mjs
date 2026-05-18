import { expect, test } from "@playwright/test";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

test.use({ serviceWorkers: "allow" });

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

test("ui service worker upgrades do not delete or redownload the model cache", async ({
  page,
}) => {
  const root = await mkdtemp(join(tmpdir(), "timey-cache-test-"));
  const server = await startStaticServer(root);
  const testId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const appCacheV1 = `browser-${testId}-ui-v1`;
  const appCacheV2 = `browser-${testId}-ui-v2`;
  const modelCacheName = `timey-model-cache-${testId}`;
  const modelAssetUrl = `${server.origin}/models/timey-t5-efficient-tiny/onnx/encoder_model.onnx`;
  const modelBody = `cached-model-${testId}`;

  try {
    await writeStaticApp(root, {
      serviceWorkerVersion: appCacheV1,
      pageText: "Timey UI v1",
    });

    await page.goto(server.origin);
    await installOrUpdateWorker(page);

    await seedModelCache(page, {
      cacheName: modelCacheName,
      url: modelAssetUrl,
      body: modelBody,
    });

    await expect(cacheKeys(page)).resolves.toEqual(
      expect.arrayContaining([`timey-app-${appCacheV1}`, modelCacheName]),
    );

    await writeStaticApp(root, {
      serviceWorkerVersion: appCacheV2,
      pageText: "Timey UI v2",
    });

    await installOrUpdateWorker(page);

    const keysAfterUpgrade = await cacheKeys(page);
    expect(keysAfterUpgrade).toEqual(
      expect.arrayContaining([`timey-app-${appCacheV2}`, modelCacheName]),
    );
    expect(keysAfterUpgrade).not.toContain(`timey-app-${appCacheV1}`);

    const modelLoad = await loadModelFromCache(page, {
      cacheName: modelCacheName,
      url: modelAssetUrl,
    });
    expect(modelLoad).toEqual({
      source: "cache",
      body: modelBody,
      networkDownloads: 0,
    });

    const uiCacheRequests = await cachedRequestUrls(page, `timey-app-${appCacheV2}`);
    expect(uiCacheRequests).not.toContain(modelAssetUrl);
  } finally {
    await cleanupBrowserState(page);
    await server.close();
    await rm(root, { recursive: true, force: true });
  }
});

async function writeStaticApp(root, { serviceWorkerVersion, pageText }) {
  await Promise.all([
    writeFile(
      join(root, "index.html"),
      `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Timey cache test</title>
  </head>
  <body>
    <h1>${escapeHtml(pageText)}</h1>
  </body>
</html>
`,
    ),
    writeFile(join(root, "favicon.svg"), "<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>\n"),
    writeFile(join(root, "styles.css"), "body { font-family: system-ui, sans-serif; }\n"),
    writeFile(join(root, "main.js"), "console.log('timey cache test app');\n"),
    writeFile(join(root, "assistant-session.js"), "export const cacheTest = true;\n"),
    writeFile(join(root, "timer-dsl.js"), "export const cacheTest = true;\n"),
    writeFile(join(root, "fallback-planner.js"), "export const cacheTest = true;\n"),
    writeFile(join(root, "llm-planner.js"), "export const cacheTest = true;\n"),
    writeFile(join(root, "planner.js"), "export const cacheTest = true;\n"),
    writeFile(
      join(root, "manifest.webmanifest"),
      JSON.stringify({ name: "Timey cache test", start_url: "/" }),
    ),
    writeFile(join(root, "service-worker.js"), await serviceWorkerSource(serviceWorkerVersion)),
  ]);
}

async function serviceWorkerSource(version) {
  const source = await readFile(join(repoRoot, "service-worker.js"), "utf8");
  const replacement = `const CACHE_NAME = \`\${APP_CACHE_PREFIX}${version}\`;`;
  const updated = source.replace(/const CACHE_NAME = `\$\{APP_CACHE_PREFIX\}[^`]+`;/, replacement);
  if (updated === source) throw new Error("Could not replace service worker cache version");
  return updated;
}

async function installOrUpdateWorker(page) {
  await page.evaluate(async () => {
    const registration =
      (await navigator.serviceWorker.getRegistration("/")) ||
      (await navigator.serviceWorker.register("/service-worker.js", { updateViaCache: "none" }));

    await registration.update();
    const installingWorker = registration.installing || registration.waiting;
    if (registration.waiting) registration.waiting.postMessage({ type: "SKIP_WAITING" });
    if (installingWorker) await waitForActivated(installingWorker);
    await navigator.serviceWorker.ready;

    if (!navigator.serviceWorker.controller) {
      await new Promise((resolve) => {
        navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true });
      });
    }

    async function waitForActivated(worker) {
      if (worker.state === "activated") return;
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Service worker activation timed out")), 5000);
        worker.addEventListener("statechange", () => {
          if (worker.state === "activated") {
            clearTimeout(timeout);
            resolve();
          }
        });
      });
    }
  });
}

async function seedModelCache(page, { cacheName, url, body }) {
  await page.evaluate(
    async ({ cacheName: targetCacheName, url: targetUrl, body: targetBody }) => {
      const cache = await caches.open(targetCacheName);
      await cache.put(targetUrl, new Response(targetBody, { status: 200 }));
      window.__timeyModelNetworkDownloads = 0;
    },
    { cacheName, url, body },
  );
}

async function loadModelFromCache(page, { cacheName, url }) {
  return page.evaluate(
    async ({ cacheName: targetCacheName, url: targetUrl }) => {
      const cache = await caches.open(targetCacheName);
      const cached = await cache.match(targetUrl);
      if (cached) {
        return {
          source: "cache",
          body: await cached.text(),
          networkDownloads: window.__timeyModelNetworkDownloads || 0,
        };
      }

      window.__timeyModelNetworkDownloads = (window.__timeyModelNetworkDownloads || 0) + 1;
      const response = await fetch(targetUrl);
      return {
        source: "network",
        body: await response.text(),
        networkDownloads: window.__timeyModelNetworkDownloads,
      };
    },
    { cacheName, url },
  );
}

async function cacheKeys(page) {
  return page.evaluate(() => caches.keys());
}

async function cachedRequestUrls(page, cacheName) {
  return page.evaluate(async (targetCacheName) => {
    const cache = await caches.open(targetCacheName);
    const requests = await cache.keys();
    return requests.map((request) => request.url);
  }, cacheName);
}

async function cleanupBrowserState(page) {
  await page.evaluate(async () => {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter((key) => key.startsWith("timey-app-") || key.startsWith("timey-model"))
        .map((key) => caches.delete(key)),
    );
  });
}

async function startStaticServer(root) {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url || "/", "http://127.0.0.1");
      const pathname = decodeURIComponent(url.pathname);
      const filePath = join(root, pathname === "/" ? "index.html" : pathname.slice(1));
      const body = await readFile(filePath);
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type": contentType(filePath),
      });
      response.end(body);
    } catch {
      response.writeHead(404, {
        "Cache-Control": "no-store",
        "Content-Type": "text/plain; charset=utf-8",
      });
      response.end("Not found");
    }
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function contentType(filePath) {
  const extension = extname(basename(filePath));
  if (extension === ".html") return "text/html; charset=utf-8";
  if (extension === ".js") return "text/javascript; charset=utf-8";
  if (extension === ".css") return "text/css; charset=utf-8";
  if (extension === ".svg") return "image/svg+xml";
  if (extension === ".webmanifest") return "application/manifest+json";
  return "application/octet-stream";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
