// ═══════════════════════════════════════════════════════════════
// FIREBASE CONFIG — fuel-station-app
// ملف إعداد Firebase منفصل | يُستدعى بعد تحميل Firebase CDN
// ═══════════════════════════════════════════════════════════════

// ⚠️ ملاحظة أمنية:
// مفاتيح Firebase Web مصمّمة لتكون عامة (public).
// الأمان الحقيقي يأتي من Firebase Security Rules في قاعدة البيانات.
// تأكد من ضبط Rules بشكل صحيح في Firebase Console.

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
firebase.initializeApp(firebaseConfig);

// مراجع قاعدة البيانات والمصادقة — تُستخدم في index.html
const rtdb   = firebase.database();
const fbAuth = firebase.auth();
fbAuth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);

const STATION_KEY = 'station_main';
const DB_REF      = rtdb.ref('stations/' + STATION_KEY);
