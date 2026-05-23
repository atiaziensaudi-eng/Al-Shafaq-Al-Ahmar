// ═══════════════════════════════════════════════════════════════
// FIREBASE CONFIG — EXAMPLE TEMPLATE
// انسخ هذا الملف إلى firebase-config.js وضع قيمك الحقيقية
// ═══════════════════════════════════════════════════════════════

const firebaseConfig = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_PROJECT.firebaseapp.com",
  databaseURL:       "https://YOUR_PROJECT-default-rtdb.firebaseio.com",
  projectId:         "YOUR_PROJECT",
  storageBucket:     "YOUR_PROJECT.firebasestorage.app",
  messagingSenderId: "YOUR_SENDER_ID",
  appId:             "YOUR_APP_ID"
};

firebase.initializeApp(firebaseConfig);

const rtdb   = firebase.database();
const fbAuth = firebase.auth();
fbAuth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);

const STATION_KEY = 'station_main';
const DB_REF      = rtdb.ref('stations/' + STATION_KEY);
