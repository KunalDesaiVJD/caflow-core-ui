const CACHE_NAME = "caflow-v4";
const PRECACHE_URLS = ["/", "/index.html"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  // Skip OAuth redirects
  if (event.request.url.includes("/~oauth")) return;
  // Network first for API calls
  if (event.request.url.includes("/rest/") || event.request.url.includes("/functions/")) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok && event.request.url.startsWith(self.location.origin)) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() =>
        caches.match(event.request).then((r) => {
          if (r) return r;
          // Fall back to the app shell ONLY for a navigation. Doing it for any
          // request handed index.html to whatever asked — so a JS module, a
          // worker script or a font that hit a transient network failure came
          // back as HTML and failed in a way that pointed nowhere near the cause.
          // The 1.25 MB pdfjs worker was the likeliest victim: with HTML in place
          // of its script, PDF text extraction dies, and the ledger reader then
          // reported the file as an unreadable scan.
          if (event.request.mode === "navigate") return caches.match("/");
          return Response.error();
        })
      )
  );
});
