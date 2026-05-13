// ═══════════════════════════════════════════════════════════════
// SERVICE WORKER — نظام إدارة محطة الوقود
// يتيح العمل Offline الكامل + تسريع التحميل
// ═══════════════════════════════════════════════════════════════

const CACHE_NAME = 'fuel-station-v3';
const CACHE_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 أيام

// الملفات الأساسية التي تُحفظ عند أول تحميل
const CORE_ASSETS = [
  '/Al-Shafaq-Al-Ahmar/',
  '/Al-Shafaq-Al-Ahmar/index.html',
  '/Al-Shafaq-Al-Ahmar/icon-192.png',
  '/Al-Shafaq-Al-Ahmar/icon-512.png',
  'https://fonts.googleapis.com/css2?family=Cairo:wght@300;400;500;600;700;800&family=Tajawal:wght@300;400;500;700;800&display=swap',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js',
  'https://www.gstatic.com/firebasejs/10.12.2/firebase-database-compat.js'
];

// ── تثبيت SW: حفظ الملفات الأساسية ─────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return Promise.allSettled(
        CORE_ASSETS.map(url =>
          cache.add(url).catch(err => console.warn('Cache skip:', url, err))
        )
      );
    }).then(() => self.skipWaiting())
  );
});

// ── تفعيل SW: حذف الكاشات القديمة ──────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

// ── اعتراض الطلبات ──────────────────────────────────────────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // تجاهل طلبات Firebase — تحتاج شبكة دائماً
  if (
    url.hostname.includes('firebaseio.com') ||
    url.hostname.includes('googleapis.com/identitytoolkit') ||
    url.hostname.includes('securetoken.googleapis.com')
  ) {
    return;
  }

  // Google Fonts — Cache First
  if (url.hostname.includes('fonts.googleapis.com') || url.hostname.includes('fonts.gstatic.com')) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        }).catch(() => new Response('', { status: 408 }));
      })
    );
    return;
  }

  // Firebase SDK JS files — Cache First
  if (url.hostname.includes('gstatic.com')) {
    event.respondWith(
      caches.match(event.request).then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        }).catch(() => new Response('', { status: 408 }));
      })
    );
    return;
  }

  // الملف الرئيسي — Network First مع Fallback للكاش
  if (event.request.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname.endsWith('/')) {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        })
        .catch(() => {
          return caches.match(event.request)
            .then(cached => cached || caches.match('/Al-Shafaq-Al-Ahmar/index.html'));
        })
    );
    return;
  }

  // باقي الملفات — Cache First
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return response;
      });
    })
  );
});

// ── استقبال رسائل من التطبيق ────────────────────────────────
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
  if (event.data === 'CLEAR_CACHE') {
    caches.delete(CACHE_NAME).then(() => {
      event.ports[0]?.postMessage('CACHE_CLEARED');
    });
  }
});
