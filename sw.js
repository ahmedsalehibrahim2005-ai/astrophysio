// sw.js — Service worker for AstroPhysio: makes the app work fully offline after the first visit.
const CACHE = 'astrophysio-v1';
const CORE = ['./', './index.html'];
const VIDEOS = [
  'ARED Squat.mp4',
  'Sledge Squat.mp4',
  'Astronaut Fitness & Exercise Routine.mp4',
  'Resistance Training in Microgravity.mp4',
].map((f) => './assets/videos/' + encodeURI(f));

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(CORE);
    // Videos are cached one by one so a single failure does not break the install.
    await Promise.all(VIDEOS.map((u) => cache.add(u).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Video players ask for byte ranges; the Cache API does not answer those, so we slice the cached file ourselves.
async function rangeResponse(req) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(req.url);
  if (!hit) {
    try { return await fetch(req); } catch (err) { return new Response('Offline', { status: 503 }); }
  }
  const buf = await hit.arrayBuffer();
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.get('range')) || [];
  let start = m[1] ? parseInt(m[1], 10) : 0;
  let end = m[2] ? parseInt(m[2], 10) : buf.byteLength - 1;
  if (!m[1] && m[2]) { start = buf.byteLength - parseInt(m[2], 10); end = buf.byteLength - 1; }
  end = Math.min(end, buf.byteLength - 1);
  return new Response(buf.slice(start, end + 1), {
    status: 206,
    statusText: 'Partial Content',
    headers: {
      'Content-Type': hit.headers.get('Content-Type') || 'video/mp4',
      'Content-Range': `bytes ${start}-${end}/${buf.byteLength}`,
      'Content-Length': String(end - start + 1),
    },
  });
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;

  if (req.headers.has('range')) { e.respondWith(rangeResponse(req)); return; }

  // Pages: try the network first (so updates show up), fall back to the cached copy when offline.
  if (req.mode === 'navigate' || url.pathname.endsWith('/') || url.pathname.endsWith('.html')) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {}); }
          return res;
        })
        .catch(async () => (await caches.match(req)) || (await caches.match('./index.html')))
    );
    return;
  }

  // Everything else: cached copy first, then network (and remember it).
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok && res.status === 200) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {}); }
      return res;
    }))
  );
});
