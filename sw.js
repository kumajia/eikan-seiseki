const CACHE = "eikan-stats-v5";
const CORE_FILES = ["./", "./index.html", "./manifest.json"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE_FILES)));
  self.skipWaiting();
});
self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
  );
  self.clients.claim();
});
self.addEventListener("fetch", e => {
  // 同一オリジンのGETだけキャッシュ対象にする
  // （Gemini APIへのPOSTや、APIキーがURLに入るリクエストをCache Storageに残さないため）
  if (e.request.method !== "GET") return;
  if (new URL(e.request.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then(res => {
        const resClone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, resClone));
        return res;
      })
      .catch(async () => {
        const hit = await caches.match(e.request);
        if (hit) return hit;
        if (e.request.mode === "navigate") {
          const idx = await caches.match("./index.html");
          if (idx) return idx;
        }
        return Response.error();
      })
  );
});
