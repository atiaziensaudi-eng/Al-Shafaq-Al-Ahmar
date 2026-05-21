// ===================================================
// Service Worker — نظام إدارة محطة الوقود
// الإصدار: 2.2 (مصحح) | تاريخ: 2026
// ===================================================

const CACHE_VERSION = '2026-05-21';
const CACHE_NAME  = 'fuel-station-v2.2-' + CACHE_VERSION;
const FONTS_CACHE = 'fuel-station-fonts-v1';

const PRECACHE_URLS = [
  '/Al-Shafaq-Al-Ahmar/',
  '/Al-Shafaq-Al-Ahmar/index.html',
  '/Al-Shafaq-Al-Ahmar/manifest.json'
  // ملاحظة: أُزيلت الصور من هنا — إذا كانت غير موجودة تسبب فشل Install كاملاً
  // أضفها فقط إذا كنت متأكداً من وجودها:
  // '/Al-Shafaq-Al-Ahmar/icon-192-maskable.png',
  // '/Al-Shafaq-Al-Ahmar/icon-512-maskable.png'
];

const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

// ===== Install =====
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
      .catch(err => {
        console.warn('[SW] Install cache error:', err);
        return self.skipWaiting();
      })
  );
});

// ===== Activate =====
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key !== CACHE_NAME && key !== FONTS_CACHE)
          .map(key => {
            console.log('[SW] حذف كاش قديم:', key);
            return caches.delete(key);
          })
      ))
      .then(() => self.clients.claim())
  );
});

// ===== Fetch =====
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  if (event.request.method !== 'GET') return;

  // تجاهل Firebase تماماً
  if (
    url.hostname.includes('firebaseio.com')  ||
    url.hostname.includes('firebaseapp.com') ||
    url.hostname.includes('firebase.google.com')
  ) return;

  // ── خطوط Google: CacheFirst ─────────────────────────────────
  if (FONT_HOSTS.some(h => url.hostname.includes(h))) {
    event.respondWith(
      caches.open(FONTS_CACHE).then(cache =>
        cache.match(event.request).then(cached => {
          if (cached) return cached;
          return fetch(event.request, { mode: 'cors' })
            .then(response => {
              if (response && response.status === 200) {
                cache.put(event.request, response.clone());
              }
              return response;
            })
            // [إصلاح] 503 بدلاً من 408
            // ❌ كان: status 408 (Request Timeout) — معنى خاطئ
            // ✅ الآن: status 503 (Service Unavailable) — الصحيح للـ Offline
            .catch(() => new Response('', {
              status: 503,
              statusText: 'Font unavailable offline'
            }));
        })
      )
    );
    return;
  }

  // ── gstatic (Firebase JS SDK): StaleWhileRevalidate ─────────
  if (url.hostname.includes('gstatic.com')) {
    event.respondWith(
      caches.open(CACHE_NAME).then(cache =>
        cache.match(event.request).then(cached => {
          const fetchPromise = fetch(event.request)
            .then(response => {
              if (response && response.status === 200) {
                cache.put(event.request, response.clone());
              }
              return response;
            })
            .catch(() => null);
          return cached || fetchPromise;
        })
      )
    );
    return;
  }

  // ── الملفات الأساسية: NetworkFirst مع Fallback ───────────────
  event.respondWith(
    fetch(event.request, {
      // [إصلاح] cache: 'no-cache' فقط لملفات HTML — ليس لـ CSS/JS/Images
      // ❌ كان: cache: 'no-cache' لكل الطلبات — يُلغي فائدة الكاش للملفات الثابتة
      // ✅ الآن: no-cache للـ HTML فقط (تريد دائماً أحدث نسخة منه)
      cache: event.request.destination === 'document' ? 'no-cache' : 'default'
    })
      .then(networkResponse => {
        if (networkResponse && networkResponse.status === 200) {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        }
        return networkResponse;
      })
      .catch(() =>
        caches.match(event.request).then(cached => {
          if (cached) return cached;
          if (event.request.destination === 'document') {
            return caches.match('/Al-Shafaq-Al-Ahmar/index.html');
          }
          // [إصلاح] 503 بدلاً من غير متاح بدون status code
          return new Response('غير متاح أوفلاين', {
            status: 503,
            statusText: 'Service Unavailable'
          });
        })
      )
  );
});

// ===== رسائل من الصفحة =====
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  if (event.data?.type === 'GET_VERSION') {
    event.ports[0]?.postMessage({ version: CACHE_VERSION, cache: CACHE_NAME });
  }
});
