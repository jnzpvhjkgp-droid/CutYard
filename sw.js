// Service worker: gör CutYard användbar offline (t.ex. i verkstaden utan täckning).
// Höj VERSION när filerna ändras så att gamla cachar rensas.
const VERSION = 'cutyard-v6';
const SHELL = [
    './',
    'index.html',
    'manifest.webmanifest',
    'assets/app.css',
    'assets/icon.svg',
    'assets/icon-192.png',
    'assets/icon-512.png',
    'assets/fonts/inter-400.woff2',
    'assets/fonts/inter-500.woff2',
    'assets/fonts/inter-600.woff2',
    'assets/fonts/inter-700.woff2',
    'assets/fonts/jetbrains-mono-400.woff2',
    'assets/fonts/jetbrains-mono-700.woff2',
    'src/app.js',
    'src/core.js',
    'src/viewer.js',
    'src/draw.js',
    'src/print.js',
    'src/profiles.js',
    'vendor/three.min.js',
    'vendor/OrbitControls.js',
    'vendor/qrcode.mjs'
];

self.addEventListener('install', e => {
    e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
    e.waitUntil(caches.keys()
        .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
        .then(() => self.clients.claim()));
});

// Stale-while-revalidate för egna filer: svara direkt från cachen och uppdatera i bakgrunden.
self.addEventListener('fetch', e => {
    const req = e.request;
    if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
    e.respondWith(caches.open(VERSION).then(async cache => {
        const cached = await cache.match(req, { ignoreSearch: true });
        const network = fetch(req).then(res => {
            if (res.ok) cache.put(req, res.clone());
            return res;
        }).catch(() => cached || (req.mode === 'navigate' ? cache.match('index.html') : Response.error()));
        return cached || network;
    }));
});
