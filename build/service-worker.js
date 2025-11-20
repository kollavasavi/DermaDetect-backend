// ===========================================================
// 🚀 PWA SERVICE WORKER – FIXED & OPTIMIZED
// ===========================================================

const CACHE_NAME = "dermadetect-v3";   // ⬅ BUMPED VERSION!
const urlsToCache = [
  "/",
  "/index.html",
  "/manifest.json",
  "/favicon.ico",
  "/android-chrome-192x192.png",  // ⬅ FIXED: matches manifest
  "/android-chrome-512x512.png",  // ⬅ FIXED: matches manifest
];

// ===========================================================
// INSTALL – cache app shell + force immediate activation
// ===========================================================
self.addEventListener("install", (event) => {
  console.log("📦 Service Worker installing…");
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log("📁 Caching app shell...");
      // Use addAll with error handling to prevent installation failure
      return cache.addAll(
        urlsToCache.map((url) => new Request(url, { cache: "reload" }))
      ).catch((err) => {
        console.warn("⚠️ Some files failed to cache (this is OK):", err);
        // Cache files individually to prevent one failure from breaking all
        return Promise.allSettled(
          urlsToCache.map(url => 
            cache.add(new Request(url, { cache: "reload" }))
              .catch(e => console.warn(`Failed to cache ${url}:`, e))
          )
        );
      });
    })
  );
  self.skipWaiting(); // 🚀 instantly activate new version
});

// ===========================================================
// ACTIVATE – delete old caches + take control immediately
// ===========================================================
self.addEventListener("activate", (event) => {
  console.log("⚡ Service Worker activating…");
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames.map((cacheName) => {
          if (cacheName !== CACHE_NAME) {
            console.log("🗑 Removing old cache:", cacheName);
            return caches.delete(cacheName);
          }
        })
      )
    )
  );

  // Take control without refresh
  return self.clients.claim();
});

// ===========================================================
// FETCH HANDLER
// Network-first for API
// Cache-first for static files
// ===========================================================
self.addEventListener("fetch", (event) => {
  const request = event.request;

  // Ignore Chrome extension and non-HTTP requests
  if (!request.url.startsWith("http")) return;

  // === ⭐ API REQUESTS → NETWORK FIRST ⭐ ===
  if (
    request.url.includes("/api/") ||
    request.url.includes("5000") || // backend running
    request.url.includes("ngrok-free.dev/api/") // ⬅ ADDED for ngrok
  ) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => {
          return caches.match(request).then((cached) => {
            return (
              cached ||
              new Response(
                JSON.stringify({
                  error: "Offline: Could not reach server",
                }),
                {
                  status: 503,
                  headers: { "Content-Type": "application/json" },
                }
              )
            );
          });
        })
    );
    return;
  }

  // === ⭐ STATIC FILES → CACHE FIRST ⭐ ===
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;

      return fetch(request)
        .then((response) => {
          if (response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => {
          // Offline fallback
          if (request.destination === "document") {
            return caches.match("/index.html");
          }
          return new Response("Offline", { status: 503 });
        });
    })
  );
});

// ===========================================================
// SKIP_WAITING (from index.js → onUpdate())
// ===========================================================
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    console.log("♻ Updating to new service worker…");
    self.skipWaiting();
  }
});