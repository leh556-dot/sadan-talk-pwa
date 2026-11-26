/* 사단 통합 톡 — 서비스 워커 (앱 셸 오프라인 캐시)
 * 시트 API(Apps Script) 요청은 캐시하지 않습니다. 항상 네트워크.
 */
const VERSION = 'sadan-talk-v8';
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './demo/snapshot.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  // 캐시를 채울 때는 HTTP 캐시를 건너뛰고 네트워크에서 받는다.
  // (GitHub Pages가 정적 파일을 10분간 캐시하므로, 그대로 받으면 새 버전을 올려도
  //  껍데기 캐시에 예전 app.js가 들어가 버린다 — 2026-11-26 실제 발생.)
  event.waitUntil(
    caches.open(VERSION)
      .then((cache) => cache.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // 외부(시트 API·시트 링크 등)는 손대지 않는다.
  if (url.origin !== location.origin) return;

  // 페이지 이동: 네트워크 우선, 실패하면 캐시된 셸
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put('./index.html', copy));
        return res;
      }).catch(() => caches.match('./index.html'))
    );
    return;
  }

  // 정적 자원: 캐시 우선 + 백그라운드 갱신
  event.respondWith(
    caches.match(req).then((hit) => {
      const network = fetch(req).then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => hit);
      return hit || network;
    })
  );
});
