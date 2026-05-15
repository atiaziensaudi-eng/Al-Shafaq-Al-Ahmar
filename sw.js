// ===================================================
// Service Worker — نظام إدارة محطة الوقود
// الإصدار: 2.1 | تاريخ: 2026
// ===================================================

// ── اسم الكاش ديناميكي — غيّر التاريخ عند كل نشر ──────────────
const CACHE_VERSION = '2026-05-13';
const CACHE_NAME = 'fuel-station-v2.1-' + CACHE_VERSION;

// الملفات الأساسية التي تُخزَّن مؤقتاً
const PRECACHE_URLS = [
  '/Al-Shafaq-Al-Ahmar/',
  '/Al-Shafaq-Al-Ahmar/index.html',
  '/Al-Shafaq-Al-Ahmar/manifest.json',
  '/Al-Shafaq-Al-Ahmar/icon-192-maskable.png',
  '/Al-Shafaq-Al-Ahmar/icon-512-maskable.png'
  // ملاحظة: Google Fonts أُزيلت — لا تدعم CORS في الكاش
  // الخطوط تُخزَّن تلقائياً بعد أول زيارة عبر استراتيجية StaleWhileRevalidate
];

// ── مصادر الخطوط — تُخزَّن بـ CacheFirst منفصلة ──────────────
const FONTS_CACHE = 'fuel-station-fonts-v1';
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

// ===== Install: تخزين الملفات الأساسية =====
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

// ===== Activate: حذف الكاشات القديمة =====
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

// ===== Fetch: استراتيجيات متعددة حسب نوع الطلب =====
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // تجاهل طلبات غير GET
  if (event.request.method !== 'GET') return;

  // تجاهل Firebase تماماً — لا تُخزَّن أبداً
  if (
    url.hostname.includes('firebaseio.com') ||
    url.hostname.includes('firebaseapp.com') ||
    url.hostname.includes('firebase.google.com')
  ) return;

  // ── استراتيجية الخطوط: CacheFirst ─────────────────────────
  if (FONT_HOSTS.some(h => url.hostname.includes(h))) {
    event.respondWith(
      caches.open(FONTS_CACHE).then(cache =>
        cache.match(event.request).then(cached => {
          if (cached) return cached;
          return fetch(event.request, { mode: 'cors' }).then(response => {
            if (response && response.status === 200) {
              cache.put(event.request, response.clone());
            }
            return response;
          }).catch(() => cached || new Response('', { status: 408 }));
        })
      )
    );
    return;
  }

  // ── استراتيجية gstatic (Firebase JS): StaleWhileRevalidate ─
  if (url.hostname.includes('gstatic.com')) {
    event.respondWith(
      caches.open(CACHE_NAME).then(cache =>
        cache.match(event.request).then(cached => {
          const fetchPromise = fetch(event.request).then(response => {
            if (response && response.status === 200) {
              cache.put(event.request, response.clone());
            }
            return response;
          }).catch(() => null);
          return cached || fetchPromise;
        })
      )
    );
    return;
  }

  // ── الملفات الأساسية للتطبيق: NetworkFirst مع Fallback ──────
  event.respondWith(
    fetch(event.request, { cache: 'no-cache' })
      .then(networkResponse => {
        if (networkResponse && networkResponse.status === 200) {
          const responseClone = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseClone));
        }
        return networkResponse;
      })
      .catch(() =>
        caches.match(event.request).then(cached => {
          if (cached) return cached;
          // Fallback للصفحة الرئيسية إذا كان الطلب لصفحة HTML
          if (event.request.destination === 'document') {
            return caches.match('/Al-Shafaq-Al-Ahmar/index.html');
          }
          return new Response('غير متاح أوفلاين', { status: 503 });
        })
      )
  );
});

// ===== رسالة من الصفحة =====
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  // رسالة لمعرفة إصدار الكاش الحالي
  if (event.data?.type === 'GET_VERSION') {
    event.ports[0]?.postMessage({ version: CACHE_VERSION, cache: CACHE_NAME });
  }
});
