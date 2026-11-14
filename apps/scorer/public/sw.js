// The build replaces the two placeholders with a version and the list of files.
const CACHE = "segnapunti-__VERSION__";
const FILES = "__FILES__";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

// A new version waits here until the app says no match is open on the board.
self.addEventListener("message", (event) => {
  if (event.data === "activate") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || new URL(request.url).origin !== location.origin) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const hit = await cache.match(request, { ignoreSearch: true, ignoreVary: true });
      if (hit) return hit;
      if (request.mode === "navigate") return (await cache.match("./", { ignoreVary: true })) ?? fetch(request);
      return fetch(request);
    })(),
  );
});
