// v18: 起動直後（Wi-Fi未接続）に古いキャッシュが表示される問題への対応。
//  - ページ本体(navigate)は毎回 no-store で取りに行き、ブラウザのHTTPキャッシュに邪魔されないようにする
//  - キャッシュから配信した場合はアプリへ知らせ、通信が戻ったら更新を促せるようにする
//  - バージョンを上げることで activate 時に古いキャッシュが破棄される
const CACHE = "eikan-stats-v18";
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

  const isNav = e.request.mode === "navigate";

  // 開いているタブ全部に知らせる（アプリ側で「キャッシュを表示中」のバーを出すため）
  const notify = async (type) => {
    const list = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of list) c.postMessage({ sw: type });
  };

  e.respondWith(
    // ページ本体はブラウザのHTTPキャッシュを経由させない（古いHTMLを掴まないため）
    fetch(isNav ? new Request(e.request, { cache: "no-store" }) : e.request)
      .then(res => {
        if (res && res.ok) {
          const resClone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, resClone));
        }
        return res;
      })
      .catch(async () => {
        // ここに来る＝通信できなかった。起動直後でWi-Fi未接続のときもここを通る
        const hit = await caches.match(e.request);
        if (hit) {
          if (isNav) notify("served-from-cache");
          return hit;
        }
        if (isNav) {
          const idx = await caches.match("./index.html");
          if (idx) { notify("served-from-cache"); return idx; }
        }
        return Response.error();
      })
  );
});
