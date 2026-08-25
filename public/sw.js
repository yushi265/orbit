const CACHE_NAME = "orbit-static-v4";
const STATIC_ASSET = /\.(?:js|css|svg|png|webp|ico|woff2?)$/i;
const STATIC_CONTENT_TYPE =
  /^(?:text\/css|text\/javascript|application\/javascript|image\/|font\/)/i;
const DEV_ASSET = /^(?:\/src\/|\/@|\/node_modules\/)/;

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (
    request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/") ||
    request.mode === "navigate" ||
    request.destination === "document" ||
    url.pathname === "/sw.js" ||
    DEV_ASSET.test(url.pathname) ||
    !STATIC_ASSET.test(url.pathname)
  )
    return;
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      const contentType = response.headers.get("content-type") ?? "";
      if (
        response.ok &&
        !response.redirected &&
        response.type !== "opaqueredirect" &&
        STATIC_CONTENT_TYPE.test(contentType)
      )
        await cache.put(request, response.clone());
      return response;
    }),
  );
});
