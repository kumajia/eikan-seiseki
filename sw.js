const CACHE = "eikan-stats-v17";
const SHARE_CACHE = "eikan-share-tmp";
const CORE_FILES = ["./", "./index.html", "./manifest.json"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE_FILES)));
  self.skipWaiting();
});
self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE && k !== SHARE_CACHE).map(k => caches.delete(k))
    ))
  );
  self.clients.claim();
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);

  // Web Share Target: 共有された画像をPOSTで受け取り、Cacheに置いてからアプリへリダイレクト
  if (e.request.method === "POST" && url.pathname.endsWith("/share-target")) {
    e.respondWith((async () => {
      try {
        const data = await e.request.formData();
        const files = data.getAll("images").filter(f => f && f.size);
        const cache = await caches.open(SHARE_CACHE);
        for (const k of await cache.keys()) await cache.delete(k); // 前回の残りを掃除
        await Promise.all(files.map((f, i) =>
          cache.put(`./shared-img-${String(i).padStart(2, "0")}`,
            new Response(f, { headers: { "Content-Type": f.type || "image/jpeg" } }))
        ));
      } catch (err) {}
      return Response.redirect("./index.html?share=1#add", 303);
    })());
    return;
  }

  // 同一オリジンのGETだけキャッシュ対象にする
  // （Gemini APIへのPOSTや、APIキーがURLに入るリクエストをCache Storageに残さないため）
  if (e.request.method !== "GET") return;
  if (url.origin !== self.location.origin) return;
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
