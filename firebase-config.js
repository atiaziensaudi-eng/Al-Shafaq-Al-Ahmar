// ═══════════════════════════════════════════════════════════════
// FIREBASE CONFIG — fuel-station-app
// ملف إعداد Firebase منفصل | يُستدعى بعد تحميل Firebase CDN
// ✅ [مُحدَّث] يتضمن STATION_KEY و DB_REF مرتبطَين بالمسار الصحيح
// ═══════════════════════════════════════════════════════════════

// ⚠️ ملاحظة أمنية:
// مفاتيح Firebase Web مصمّمة لتكون عامة (public).
// الأمان الحقيقي يأتي من Firebase Security Rules في قاعدة البيانات.
// تأكد من ضبط Rules بشكل صحيح في Firebase Console.

// ── التحقق من تحميل Firebase SDK قبل المتابعة ──────────────────
if (typeof firebase === 'undefined') {
  throw new Error('[firebase-config] Firebase SDK لم يُحمَّل بعد! تأكد من إضافة سكريبتات CDN قبل هذا الملف.');
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

// تهيئة Firebase باستخدام Compat SDK
// getApps() يمنع الخطأ "Firebase App already exists" عند إعادة التحميل
if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

// ── مراجع قاعدة البيانات والمصادقة — تُستخدم في index.html ──────
const rtdb   = firebase.database();
const fbAuth = firebase.auth();
fbAuth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);

// ── مسار البيانات الرئيسي للمحطة ────────────────────────────────
// ✅ هذان المتغيران ضروريان لربط كل عمليات القراءة/الكتابة بالمسار الصحيح
// المسار الكامل: stations/station_main/...
// يجب أن يُعرَّفا هنا مباشرةً بعد rtdb لضمان توفرهما لجميع الملفات التالية
const STATION_KEY = 'station_main';
const DB_REF      = rtdb.ref('stations/' + STATION_KEY);

console.log('[firebase-config] ✅ تم التهيئة | DB_REF path:', DB_REF.toString());
