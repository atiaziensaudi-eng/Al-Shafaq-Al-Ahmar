// ===================================================
// Service Worker — نظام إدارة محطة الوقود
// الإصدار: 2.3 (مُصحَّح) | تاريخ: 2026
// ✅ [إصلاح] Scope وOffline Sync متوافقان مع /Al-Shafaq-Al-Ahmar/
// ===================================================

const CACHE_VERSION = '2026-05-25';
const CACHE_NAME  = 'fuel-station-v2.3-' + CACHE_VERSION;
const FONTS_CACHE = 'fuel-station-fonts-v1';

// ── Scope: جميع المسارات ضمن /Al-Shafaq-Al-Ahmar/ ───────────────
// ✅ يجب أن يتطابق هذا مع scope في navigator.serviceWorker.register()
//    مثال: navigator.serviceWorker.register('/Al-Shafaq-Al-Ahmar/sw-7.js',
//            { scope: '/Al-Shafaq-Al-Ahmar/' })
const APP_SCOPE = '/Al-Shafaq-Al-Ahmar/';

const PRECACHE_URLS = [
  APP_SCOPE,
  APP_SCOPE + 'index.html',
  APP_SCOPE + 'manifest.json'
  // ملاحظة: أُزيلت الصور من هنا — إذا كانت غير موجودة تسبب فشل Install كاملاً
  // أضفها فقط إذا كنت متأكداً من وجودها على الخادم:
  // APP_SCOPE + 'icon-192-maskable.png',
  // APP_SCOPE + 'icon-512-maskable.png'
];

const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

// ── أنواع الملفات الثابتة التي تُخزَّن مؤقتاً بقوة ────────────────
const STATIC_EXTENSIONS = ['.js', '.css', '.woff', '.woff2', '.ttf', '.png', '.jpg', '.svg', '.ico', '.webp'];

// ===== Install =====
self.addEventListener('install', event => {
  console.log('[SW v2.3] Installing, scope:', self.registration.scope);
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
      .catch(err => {
        // [إصلاح] لا نفشل Install بسبب خطأ في كاش واحد — نكمل على أي حال
        console.warn('[SW] Install cache error (non-fatal):', err);
        return self.skipWaiting();
      })
  );
});

// ===== Activate =====
self.addEventListener('activate', event => {
  console.log('[SW v2.3] Activating...');
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
      .then(() => console.log('[SW v2.3] ✅ Active and controlling clients'))
  );
});

// ===== Fetch =====
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // تجاهل طلبات غير GET (POST/PUT/DELETE) — تذهب مباشرة للشبكة
  if (event.request.method !== 'GET') return;

  // ── تجاهل Firebase RTDB تماماً ───────────────────────────────
  // [سبب] Firebase يدير اتصاله الخاص (WebSocket + REST) مع Offline Persistence
  // تدخل SW هنا يُعطل آلية الـ Offline Sync الداخلية لـ Firebase
  if (
    url.hostname.includes('firebaseio.com')  ||
    url.hostname.includes('firebaseapp.com') ||
    url.hostname.includes('firebase.google.com') ||
    url.hostname.includes('identitytoolkit.googleapis.com')
  ) return;

  // ── خطوط Google: CacheFirst ──────────────────────────────────
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
            // ✅ 503 Service Unavailable — الكود الصحيح للـ Offline
            .catch(() => new Response('', {
              status: 503,
              statusText: 'Font unavailable offline'
            }));
        })
      )
    );
    return;
  }

  // ── Firebase JS SDK من gstatic: StaleWhileRevalidate ─────────
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
          // أعد الكاش فوراً وجدّد في الخلفية
          return cached || fetchPromise;
        })
      )
    );
    return;
  }

  // ── ملفات التطبيق الأساسية: NetworkFirst مع Fallback ─────────
  // [منطق]:
  //   1. حاول الشبكة أولاً (للحصول على أحدث نسخة)
  //   2. عند فشلها (أوفلاين أو خطأ مؤقت) → ارجع للكاش
  //   3. إن لم يوجد في الكاش → أعد صفحة index.html (للـ SPA)
  //      أو استجابة 503 واضحة للموارد الأخرى
  event.respondWith(
    fetch(event.request, {
      // no-cache للـ HTML فقط: دائماً نريد أحدث نسخة من الصفحة الرئيسية
      // default للملفات الثابتة: نسمح بكاش المتصفح لتسريع التحميل
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
        // [إصلاح أساسي] Offline Sync: عند انقطاع الشبكة اللحظي أثناء تحديث العدادات
        // SW لا يتدخل في طلبات Firebase (مُعفاة أعلاه)، لكن لطلبات التطبيق:
        caches.match(event.request).then(cached => {
          if (cached) return cached;

          // ✅ [إصلاح] للـ HTML navigation: ارجع لـ index.html ضمن نفس الـ Scope
          if (event.request.destination === 'document' ||
              event.request.mode === 'navigate') {
            return caches.match(APP_SCOPE + 'index.html')
              .then(indexPage => indexPage || new Response(
                '<h1>غير متاح أوفلاين</h1><p>يرجى التحقق من الاتصال بالإنترنت</p>',
                { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
              ));
          }

          // ✅ [إصلاح] 503 Service Unavailable — الكود الصحيح للموارد غير المتاحة أوفلاين
          // (سابقاً كان يُعيد استجابة بدون status code أو 408 — كلاهما خاطئ)
          return new Response('غير متاح أوفلاين', {
            status: 503,
            statusText: 'Service Unavailable',
            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
          });
        })
      )
  );
});

// ===== رسائل من الصفحة =====
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') {
    console.log('[SW] SKIP_WAITING received');
    self.skipWaiting();
  }
  if (event.data?.type === 'GET_VERSION') {
    event.ports[0]?.postMessage({ version: CACHE_VERSION, cache: CACHE_NAME });
  }
  // ✅ [إضافة] دعم رسالة SYNC_PENDING: تُرسَل من التطبيق عند عودة الاتصال
  if (event.data?.type === 'SYNC_PENDING') {
    console.log('[SW] SYNC_PENDING — Firebase سيعالج المزامنة تلقائياً عبر Offline Persistence');
    // لا نتدخل — Firebase RTDB يمتلك آلية Offline Sync داخلية أموثوقية
  }
});
