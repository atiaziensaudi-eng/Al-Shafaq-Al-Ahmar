// ═══════════════════════════════════════════════════════════════
// firebase-config.js — إعدادات Firebase لنظام إدارة محطة الوقود
// يُهيّئ: firebase app, rtdb, fbAuth, STATION_KEY, DB_REF
// ⚠️ يعتمد على Compat SDK v10 المحمَّل في index.html — لا تغيّر إلى v12
// ═══════════════════════════════════════════════════════════════

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
// ⚠️ لا تستخدم initializeApp من import — الكود كله يعتمد على firebase.* العالمي
const app    = firebase.initializeApp(firebaseConfig);
const rtdb   = firebase.database();
const fbAuth = firebase.auth();

// ── مفتاح المحطة ومسار قاعدة البيانات ───────────────────────
// هذا هو المفتاح الفريد لمحطة الشفق الأحمر في Firebase RTDB
// يجب أن يتطابق مع المسار: stations/<STATION_KEY>/...
const STATION_KEY = "al-shafaq-al-ahmar";
const DB_REF      = rtdb.ref("stations/" + STATION_KEY);

// ── تفعيل Offline Persistence لـ Firebase RTDB ───────────────
// يسمح للتطبيق بالعمل أوفلاين وتخزين التغييرات حتى عودة الاتصال
rtdb.goOnline();
