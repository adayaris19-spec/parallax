// PARALLAX service worker: makes repeat visits load instantly and keeps the site usable on a bad
// connection. The page shell is served from the phone at once and refreshed in the background (the
// next visit gets any new version); fonts and libraries come from the phone; data is fetched fresh,
// falling back to the last copy when offline. Videos are never cached here (they stream).
const V = "px-v39";
const SHELL = ["./", "index.html", "icon.svg", "icon-180.png", "manifest.webmanifest"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(V).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

const put = (req, res) => { if (res && res.ok && res.type !== "opaque") { const copy = res.clone(); caches.open(V).then((c) => c.put(req, copy)); } return res; };

self.addEventListener("fetch", (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET" || req.headers.has("range")) return;
  // The page itself: instant from the phone, refreshed in the background.
  if (req.mode === "navigate" && url.origin === location.origin) {
    e.respondWith(caches.open(V).then(async (c) => {
      const cached = await c.match("index.html");
      const fresh = fetch(req).then((r) => { if (r.ok && /\/(index\.html)?$/.test(url.pathname)) c.put("index.html", r.clone()); return r; });
      if (cached && /\/(index\.html)?$/.test(url.pathname)) { e.waitUntil(fresh.catch(() => {})); return cached; }
      return fresh.catch(() => (/\/(index\.html)?$/.test(url.pathname) && cached) || Response.error());
    }));
    return;
  }
  // Fonts and libraries: they never change at a given address.
  if (/^(fonts\.googleapis\.com|fonts\.gstatic\.com|cdn\.jsdelivr\.net)$/.test(url.hostname)) {
    e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((r) => put(req, r))));
    return;
  }
  // Data from the database: always fresh, the last copy when there is no connection.
  if (url.hostname.endsWith(".supabase.co") && url.pathname.startsWith("/rest/v1/")) {
    e.respondWith(fetch(req).then((r) => put(req, r)).catch(() => caches.match(req).then((hit) => hit || Response.error())));
    return;
  }
  // The site's own small files: from the phone, refreshed in the background.
  if (url.origin === location.origin && /\.(png|svg|webmanifest|json)$/.test(url.pathname)) {
    e.respondWith(caches.match(req).then((hit) => { const f = fetch(req).then((r) => put(req, r)); return hit || f; }));
  }
});

// Alerts for followed goals (sent by the push function). Tapping one opens the story.
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: "Parallax", body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "Parallax", { body: d.body || "", tag: d.tag, icon: "icon-180.png", badge: "icon-180.png", data: { url: d.url || "./" } }));
});
self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = e.notification.data?.url || "./";
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((cs) => {
    for (const c of cs) if ("focus" in c) { c.navigate(url).catch(() => {}); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
