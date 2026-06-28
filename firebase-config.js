// ═══════════════════════════════════════════════════════════════
// firebase-config.js — إعدادات Firebase لنظام إدارة محطة الوقود
// يُهيّئ: firebase app, rtdb, fbAuth, STATION_KEY, DB_REF
// ⚠️ يعتمد على Compat SDK v10 المحمَّل في index.html — لا تغيّر إلى ESModule
// ═══════════════════════════════════════════════════════════════

// ⛔ تحقق من تحميل Firebase Compat SDK قبل المتابعة
if (typeof firebase === 'undefined') {
  console.error('❌ [firebase-config] Firebase Compat SDK غير محمَّل! تأكد من وجود سكريبت Firebase compat في index.html قبل هذا الملف.');
}

const firebaseConfig = {
  apiKey:            "AIzaSyBnLJFz1QX1J1_lqdGRZns2pMksDXyGLzM",
  authDomain:        "fuel-station-app-cf2b4.firebaseapp.com",
  databaseURL:       "https://fuel-station-app-cf2b4-default-rtdb.firebaseio.com",
  projectId:         "fuel-station-app-cf2b4",
  storageBucket:     "fuel-station-app-cf2b4.firebasestorage.app",
  messagingSenderId: "716210861433",
  appId:             "1:716210861433:web:2a42ba925670137217aba8"
};

// ── تهيئة Firebase (Compat API) ──────────────────────────────
// ⚠️ نستخدم firebase.* العالمي (Compat) — وليس import من ESModule
// السبب: جميع كود التطبيق يستخدم firebase.auth() و firebase.database() مباشرة
const app    = firebase.initializeApp(firebaseConfig);
const rtdb   = firebase.database();
const fbAuth = firebase.auth();

// ── مفتاح المحطة ومسار قاعدة البيانات ───────────────────────
const STATION_KEY = "al-shafaq-al-ahmar";
const DB_REF      = rtdb.ref("stations/" + STATION_KEY);

// ── تفعيل الاتصال الدائم بـ Firebase RTDB ───────────────────
rtdb.goOnline();
