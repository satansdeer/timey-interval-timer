const APP_CACHE_PREFIX = "timey-app-";
const CACHE_NAME = `${APP_CACHE_PREFIX}v31`;
const LEGACY_APP_CACHE_PATTERN = /^timey-v\d+$/;
const ASSETS = [
  "./",
  "./index.html",
  "./favicon.svg",
  "./styles.css",
  "./main.js",
  "./assistant-session.js",
  "./fallback-planner.js",
  "./llm-planner.js",
  "./planner.js",
  "./manifest.webmanifest",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS.map((asset) => new Request(asset)))),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter(isOldAppCache).map((key) => caches.delete(key))),
      ),
  );
  self.clients.claim();
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(networkFirst(event.request));
});

function isOldAppCache(key) {
  if (key === CACHE_NAME) return false;
  return key.startsWith(APP_CACHE_PREFIX) || LEGACY_APP_CACHE_PATTERN.test(key);
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok) {
      await cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    if (request.mode === "navigate") return cache.match("./index.html");
    return Response.error();
  }
}
