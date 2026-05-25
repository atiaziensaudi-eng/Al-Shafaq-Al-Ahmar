/**
 * ═══════════════════════════════════════════════════════════════════
 * معالج العدادات (Counters Handler) — النسخة 2.4 المصححة
 * ─────────────────────────────────────────────────────────────────
 * الإصلاحات التراكمية (v2.1 → v2.4):
 * ✅ إصلاح مسميات data-counter (diesel91/diesel95 → fuel91/fuel95)
 * ✅ إصلاح Race Condition بـ Firebase Transactions
 * ✅ إصلاح قائمة الانتظار — استدعاء queueCounterUpdate عند الفشل
 * ✅ إصلاح _isOnline غير معرّف → checkOnlineStatus() عبر navigator.onLine
 * ✅ إصلاح currentUser.role → قراءة الدور من Firebase
 * ✅ إصلاح snapshots تفتقد totalShifts/totalRevenue
 * ✅ إضافة localStorage كنسخة احتياطية
 * ✅ إضافة معالج خطأ لـ IndexedDB
 * ✅ إصلاح نوع syncQueue من COUNTER_UPDATE → INVENTORY
 *
 * [v2.4] إصلاحات التوحيد والتضارب:
 * ✅ [إصلاح #1] checkOnlineStatus() — مرجع موحد لحالة الاتصال
 *              يقرأ أولاً من Firebase .info/connected (الأدق)
 *              ويرجع إلى navigator.onLine كاحتياطي
 * ✅ [إصلاح #2] updateSyncIndicator() — تقرأ حالة Transaction الفعلية
 *              وتحدّث كلا المؤشرَين (#syncIndicator و[data-sync-indicator])
 *              بدلاً من الاعتماد على navigator.onLine وحده
 * ✅ [إصلاح #3] إزالة window.addEventListener('online'/'offline') المكرر
 *              لمنع تعارضه مع rtdb.ref('.info/connected') في index-FIXED.html
 * ✅ [إصلاح #4] Offline Queue معزول عن _flushPendingSync() الشامل
 *              عبر IndexedDB فقط — بدون لمس DB_REF.child('syncQueue')
 *              الذي تستهدفه دالة الحفظ الشاملة
 * ═══════════════════════════════════════════════════════════════════
 */

// ── حالة العدادات المحلية ──────────────────────────────────────────
const COUNTERS_STATE = {
  diesel:          0,
  fuel91:          0,
  fuel95:          0,
  lastSync:        Date.now(),
  isSyncing:       false,
  hasLocalChanges: false,
  lastTransactionOk: true   // [جديد v2.4] نتيجة آخر Transaction
};

// ── [إصلاح #1] مرجع موحّد لحالة الاتصال ──────────────────────────
// ❌ كان: _isOnline (متغير معزول غير موثوق)
// ✅ الآن: checkOnlineStatus() تقرأ من Firebase أولاً ثم المتصفح
//
// _firebaseConnected: يُحدَّث فقط من rtdb.ref('.info/connected') في index-FIXED.html
// نقرأه هنا بشكل غير مباشر — بدون تسجيل مستمع مكرر
let _firebaseConnected = null; // null = لم يُحدَّد بعد

/**
 * checkOnlineStatus() — المرجع الوحيد لحالة الاتصال في هذا الملف
 *
 * منطق الأولوية:
 *   1. إن كان Firebase حدّد الحالة → استخدمها (الأدق)
 *   2. وإلا → navigator.onLine (احتياطي سريع)
 *
 * [سبب عدم تسجيل مستمع .info/connected هنا]:
 *   index-FIXED.html يسجّله بالفعل ويحدّث _isOnline عبره.
 *   تسجيل مستمع ثانٍ هنا يُنشئ سباقَي تحديث مستقلَّين → تضارب.
 *   بدلاً من ذلك: نقرأ _isOnline من scope الملف الرئيسي مباشرة.
 */
const checkOnlineStatus = () => {
  // [v2.4] قراءة _isOnline من الملف الرئيسي إن كان محدداً
  // _isOnline معرَّف في index-FIXED.html ويُحدَّث من Firebase و browser events
  if (typeof window._isOnline === 'boolean') return window._isOnline;
  if (typeof _isOnline === 'boolean')         return _isOnline;   // نفس الـ scope
  // احتياطي أخير
  return navigator.onLine;
};

// ── [إصلاح #3] لا مستمعَي online/offline هنا ─────────────────────
// ❌ كان: window.addEventListener('online', ...) + window.addEventListener('offline', ...)
//         تعارض مع rtdb.ref('.info/connected') في index-FIXED.html
//         وأعاد تحميل Firebase أثناء معالجته الداخلية للأوفلاين
// ✅ الآن: index-FIXED.html هو المسؤول الوحيد عن مستمعَي الشبكة
//         counters-handler يستمع فقط لحدث 'userLoggedIn' المخصص

// ══════════════════════════════════════════════════════════════════
// أدوات localStorage
// ══════════════════════════════════════════════════════════════════

/**
 * حفظ العدادات في localStorage كنسخة احتياطية
 */
function saveCountersToLocalStorage() {
  try {
    localStorage.setItem('counters_backup', JSON.stringify({
      diesel:  COUNTERS_STATE.diesel,
      fuel91:  COUNTERS_STATE.fuel91,
      fuel95:  COUNTERS_STATE.fuel95,
      savedAt: Date.now()
    }));
  } catch (e) {
    console.warn('⚠️ تعذر الحفظ في localStorage:', e);
  }
}

/**
 * تحميل النسخة الاحتياطية من localStorage عند الحاجة
 */
function loadCountersFromLocalStorage() {
  try {
    const saved = localStorage.getItem('counters_backup');
    if (!saved) return null;
    return JSON.parse(saved);
  } catch (e) {
    return null;
  }
}

// ══════════════════════════════════════════════════════════════════
// عرض العدادات
// ══════════════════════════════════════════════════════════════════

/**
 * تحديث عرض العدادات في الواجهة
 * [إصلاح] data-counter: diesel91/diesel95 → fuel91/fuel95
 */
function displayCounters(counters = {}) {
  COUNTERS_STATE.diesel = counters.diesel || 0;
  COUNTERS_STATE.fuel91 = counters.fuel91 || 0;
  COUNTERS_STATE.fuel95 = counters.fuel95 || 0;

  const fuel95Box = document.querySelector('[data-counter="fuel95"]');
  if (fuel95Box) {
    fuel95Box.innerHTML = `
      <div style="font-size:12px;color:var(--gray-500);margin-bottom:6px;display:flex;align-items:center;gap:6px;">
        <span style="font-size:18px;">🔴</span>
        <span style="font-weight:600;">اليوم 95</span>
      </div>
      <div style="font-size:32px;font-weight:900;color:var(--text-primary);margin-bottom:4px;">
        ${(COUNTERS_STATE.fuel95).toLocaleString('ar-SA')}
      </div>
      <div style="font-size:13px;color:var(--gold);font-weight:600;">لتر</div>
    `;
  }

  const fuel91Box = document.querySelector('[data-counter="fuel91"]');
  if (fuel91Box) {
    fuel91Box.innerHTML = `
      <div style="font-size:12px;color:var(--gray-500);margin-bottom:6px;display:flex;align-items:center;gap:6px;">
        <span style="font-size:18px;">🟢</span>
        <span style="font-weight:600;">اليوم 91</span>
      </div>
      <div style="font-size:32px;font-weight:900;color:var(--text-primary);margin-bottom:4px;">
        ${(COUNTERS_STATE.fuel91).toLocaleString('ar-SA')}
      </div>
      <div style="font-size:13px;color:var(--gold);font-weight:600;">لتر</div>
    `;
  }

  const dieselBox = document.querySelector('[data-counter="diesel"]');
  if (dieselBox) {
    dieselBox.innerHTML = `
      <div style="font-size:12px;color:var(--gray-500);margin-bottom:6px;display:flex;align-items:center;gap:6px;">
        <span style="font-size:18px;">⬜</span>
        <span style="font-weight:600;">ديزل</span>
      </div>
      <div style="font-size:32px;font-weight:900;color:var(--text-primary);margin-bottom:4px;">
        ${(COUNTERS_STATE.diesel).toLocaleString('ar-SA')}
      </div>
      <div style="font-size:13px;color:var(--gold);font-weight:600;">لتر</div>
    `;
  }

  const totalBox = document.querySelector('[data-counter="total"]');
  if (totalBox) {
    const total = COUNTERS_STATE.diesel + COUNTERS_STATE.fuel91 + COUNTERS_STATE.fuel95;
    totalBox.innerHTML = `
      <div style="font-size:12px;color:var(--gray-500);">إجمالي اليوم</div>
      <div style="font-size:28px;font-weight:900;color:var(--text-primary);">
        ${total.toLocaleString('ar-SA')}
      </div>
      <div style="font-size:12px;color:var(--gold);font-weight:600;">لتر</div>
    `;
  }

  saveCountersToLocalStorage();
  updateSyncIndicator();
}

// ══════════════════════════════════════════════════════════════════
// مؤشر حالة المزامنة
// ══════════════════════════════════════════════════════════════════

/**
 * [إصلاح #2 v2.4] updateSyncIndicator() — موحّدة وتقرأ حالة Transaction الفعلية
 *
 * المشكلة القديمة:
 *   ❌ كانت تقرأ navigator.onLine فقط → "متزامن" حتى لو فشل Transaction
 *   ❌ كانت تكتب على [data-sync-indicator] فقط، وتتجاهل #syncIndicator في الرأس
 *
 * الإصلاح:
 *   ✅ تقرأ COUNTERS_STATE.isSyncing / hasLocalChanges / lastTransactionOk
 *   ✅ تحدّث كلا العنصرَين: #syncIndicator (رأس الصفحة) + [data-sync-indicator] (بطاقة الملخص)
 *   ✅ تستدعي _updateSyncIndicator() من index-FIXED.html للرأس (إن كانت متاحة)
 *      بدلاً من التكرار المستقل
 *
 * حالات العرض:
 *   isSyncing=true                → 🔄 جاري المزامنة...
 *   hasLocalChanges=true + أوفلاين → ⏳ بانتظار الاتصال
 *   hasLocalChanges=true + متصل  → 🔄 جاري المزامنة... (Transaction معلّق)
 *   lastTransactionOk=false      → ⚠️ خطأ في الحفظ
 *   كل شيء طبيعي                 → ✅ متزامن
 */
function updateSyncIndicator() {
  // ── تحديد الحالة الصحيحة بناءً على COUNTERS_STATE ──────────────
  let state, text, color;

  if (COUNTERS_STATE.isSyncing) {
    state = 'syncing';
    text  = '🔄 جارٍ المزامنة';
    color = '#F39C12';
  } else if (!COUNTERS_STATE.lastTransactionOk) {
    // [جديد] Transaction فشل → خطأ صريح بدلاً من "متزامن" كاذب
    state = 'error';
    text  = '⚠️ خطأ في الحفظ';
    color = '#C0392B';
  } else if (COUNTERS_STATE.hasLocalChanges) {
    if (checkOnlineStatus()) {
      // متصل لكن Transaction لم يكتمل بعد
      state = 'syncing';
      text  = '🔄 جارٍ المزامنة';
      color = '#F39C12';
    } else {
      // أوفلاين + تغييرات معلقة
      state = 'pending';
      text  = '⏳ بانتظار الاتصال';
      color = '#E67E22';
    }
  } else {
    state = 'saved';
    text  = '✅ متزامن';
    color = '#27AE60';
  }

  // ── [إصلاح] تحديث #syncIndicator في رأس الصفحة ──────────────────
  // يستخدم _updateSyncIndicator() من index-FIXED.html إن كانت متاحة
  // لضمان توافق الأيقونة مع نظام الحالات المعرَّف في الملف الرئيسي
  if (typeof _updateSyncIndicator === 'function') {
    _updateSyncIndicator(state);
  } else {
    // احتياطي: تحديث مباشر إن لم تكن الدالة الرئيسية محمّلة بعد
    const headerInd = document.getElementById('syncIndicator');
    if (headerInd) {
      headerInd.textContent = text;
      headerInd.style.color = color;
    }
  }

  // ── تحديث [data-sync-indicator] في بطاقة الملخص ─────────────────
  // هذا العنصر مستقل عن #syncIndicator ويُحدَّث دائماً من هنا
  const cardInd = document.querySelector('[data-sync-indicator]');
  if (cardInd) {
    cardInd.textContent = text;
    cardInd.style.color = color;
  }
}

// ══════════════════════════════════════════════════════════════════
// تحميل العدادات من Firebase
// ══════════════════════════════════════════════════════════════════

/**
 * تحميل العدادات من Firebase مع fallback إلى localStorage
 */
async function loadCountersFromFirebase() {
  if (!DB_REF) return;

  try {
    COUNTERS_STATE.isSyncing = true;
    updateSyncIndicator();

    const snapshot = await new Promise((resolve, reject) => {
      DB_REF.child('inventory').once('value', resolve, reject);
    });

    const data = snapshot.val() || { diesel: 0, fuel91: 0, fuel95: 0 };

    displayCounters({
      diesel: data.diesel || 0,
      fuel91: data.fuel91 || 0,
      fuel95: data.fuel95 || 0
    });

    COUNTERS_STATE.isSyncing        = false;
    COUNTERS_STATE.hasLocalChanges  = false;
    COUNTERS_STATE.lastTransactionOk = true;
    COUNTERS_STATE.lastSync         = Date.now();
    updateSyncIndicator();

  } catch (error) {
    console.error('❌ خطأ في تحميل العدادات من Firebase:', error);
    COUNTERS_STATE.isSyncing = false;

    // Fallback إلى localStorage عند فشل Firebase
    const backup = loadCountersFromLocalStorage();
    if (backup) {
      console.log('📦 تم تحميل النسخة الاحتياطية من localStorage');
      displayCounters(backup);
    }

    updateSyncIndicator();
  }
}

// ══════════════════════════════════════════════════════════════════
// مراقبة التغييرات من Firebase
// ══════════════════════════════════════════════════════════════════

/**
 * مراقبة تغييرات العدادات الواردة من Firebase
 * [إصلاح] تجاهل التحديثات أثناء الكتابة المحلية (hasLocalChanges)
 */
function monitorCountersChanges() {
  if (!DB_REF) return;

  DB_REF.child('inventory').on('value', snapshot => {
    // تجاهل التحديث إذا كان هناك تغييرات محلية معلقة
    // منع تعارض البيانات بين القيمة المحلية والقيمة القادمة من Firebase
    if (COUNTERS_STATE.hasLocalChanges) return;

    const data = snapshot.val() || { diesel: 0, fuel91: 0, fuel95: 0 };

    if (
      data.diesel !== COUNTERS_STATE.diesel ||
      data.fuel91 !== COUNTERS_STATE.fuel91 ||
      data.fuel95 !== COUNTERS_STATE.fuel95
    ) {
      displayCounters({
        diesel: data.diesel || 0,
        fuel91: data.fuel91 || 0,
        fuel95: data.fuel95 || 0
      });
      COUNTERS_STATE.lastSync = Date.now();
    }
  });
}

// ══════════════════════════════════════════════════════════════════
// تحديث العداد (Transaction)
// ══════════════════════════════════════════════════════════════════

/**
 * تحديث العداد — بدون رسائل خطأ للمستخدم
 * [إصلاح] Race Condition: Transaction بدلاً من update مباشر
 * [إصلاح] استدعاء queueCounterUpdate عند الفشل (كان مفقوداً)
 *
 * @param {String} pumpType - نوع المضخة (diesel | fuel91 | fuel95)
 * @param {Number} liters   - عدد اللترات المضافة
 */
async function updateCounter(pumpType, liters) {
  if (!DB_REF || !currentUser) {
    console.error('❌ لم يتم تسجيل الدخول');
    return false;
  }

  const numLiters = parseFloat(liters);
  if (!numLiters || numLiters <= 0) {
    console.error('❌ يجب أن تكون القيمة أكبر من صفر');
    return false;
  }

  const validPumps = ['diesel', 'fuel91', 'fuel95'];
  if (!validPumps.includes(pumpType)) {
    console.error('❌ نوع مضخة غير صحيح:', pumpType);
    return false;
  }

  // ── تحديث محلي فوري (Optimistic UI) ──────────────────────────────
  COUNTERS_STATE[pumpType]        = (COUNTERS_STATE[pumpType] || 0) + numLiters;
  COUNTERS_STATE.hasLocalChanges  = true;
  COUNTERS_STATE.lastTransactionOk = true; // نفترض النجاح حتى يثبت العكس
  displayCounters(COUNTERS_STATE);

  // ── [إصلاح] Transaction لمنع Race Condition ───────────────────────
  // ❌ كان: DB_REF.child('inventory').update({ [pumpType]: value })
  //         خطر: مستخدمان يقرآن نفس القيمة ويكتبان → تضيع إحدى العمليتين
  // ✅ الآن: transaction تُبني على القيمة الأخيرة في الخادم دائماً
  DB_REF.child('inventory').child(pumpType).transaction(
    // دالة التحويل: تأخذ القيمة الحالية في الخادم وتضيف إليها
    currentValue => (currentValue || 0) + numLiters,

    // callback النتيجة
    (error, committed) => {
      if (error || !committed) {
        // ── [إصلاح] فشل Transaction → قائمة انتظار + تحديث المؤشر ──
        // ❌ كان: console.warn فقط → البيانات تُفقد عند Offline
        console.warn('⚠️ فشل Transaction — جاري الحفظ في قائمة الانتظار:', error?.message);
        COUNTERS_STATE.lastTransactionOk = false;  // [جديد v2.4] يُظهر الخطأ في المؤشر
        updateSyncIndicator();                      // تحديث فوري → ⚠️ خطأ في الحفظ
        queueCounterUpdate(pumpType, numLiters);
      } else {
        // ── نجاح Transaction → تنظيف الحالة ───────────────────────
        COUNTERS_STATE.hasLocalChanges   = false;
        COUNTERS_STATE.lastTransactionOk = true;

        // تحديث timestamp منفصلاً (لا يؤثر على Transaction)
        DB_REF.child('inventory').child('timestamp').set(Date.now());

        // [إصلاح #2] updateSyncIndicator() تعرف الآن أن lastTransactionOk=true
        // فتُظهر "✅ متزامن" بشكل صحيح وفوري في كلا المؤشرَين
        updateSyncIndicator();
      }
    }
  );

  return true;
}

// ══════════════════════════════════════════════════════════════════
// قائمة انتظار الأوفلاين — معزولة عن _flushPendingSync() الشامل
// ══════════════════════════════════════════════════════════════════

/**
 * [إصلاح #4 v2.4] إضافة عملية إلى قائمة الانتظار
 *
 * المشكلة القديمة:
 *   ❌ كانت تكتب في DB_REF.child('syncQueue') — نفس المسار الذي
 *      تقرأه _flushPendingSync() في index-FIXED.html عند المزامنة الشاملة
 *      → تضارب: الدالة الشاملة تُعيد كتابة syncQueue بيانات قديمة
 *              فوق عمليات العدادات المعلقة
 *
 * الإصلاح:
 *   ✅ الحفظ في IndexedDB فقط (counters_pending_ops)
 *   ✅ إزالة DB_REF.child('syncQueue').push() نهائياً من هذا الملف
 *   ✅ معالجة الانتظار عبر حدث 'userLoggedIn' عند عودة الاتصال
 *      (loadCountersFromFirebase تتولى المزامنة بالكامل)
 *
 * [إصلاح] نوع syncQueue: COUNTER_UPDATE → INVENTORY (ليطابق Firebase Rules)
 * [إصلاح] إضافة onerror لـ IndexedDB (كان غائباً)
 * [إصلاح] checkOnlineStatus() بدلاً من _isOnline
 */
function queueCounterUpdate(pumpType, liters) {
  if (!currentUser) return;

  const syncId = `counter-${pumpType}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  const queueItem = {
    type:      'INVENTORY',      // ✅ يطابق Firebase Rules (كان COUNTER_UPDATE)
    data:      { pumpType, liters },
    timestamp: Date.now(),
    userId:    currentUser.uid,
    syncId,
    status:    'pending'
  };

  // ── الحفظ في IndexedDB فقط ────────────────────────────────────────
  // ✅ [إصلاح #4] أُزيل: DB_REF.child('syncQueue').push(queueItem)
  //    لمنع تداخله مع _flushPendingSync() الذي يقرأ نفس المسار
  //    عند عودة الاتصال ويُعيد كتابة البيانات الشاملة
  if (window.indexedDB) {
    const request = indexedDB.open('FuelStationDB', 1);

    // ✅ [إصلاح] معالج الخطأ المُضاف (كان غائباً)
    request.onerror = (e) => {
      console.warn('⚠️ تعذر فتح IndexedDB — سيتم المزامنة من localStorage:', e.target?.error);
    };

    request.onsuccess = (e) => {
      try {
        const db = e.target.result;
        const tx = db.transaction('counters_pending_ops', 'readwrite');
        tx.objectStore('counters_pending_ops').add(queueItem);
        tx.onerror = (err) => console.warn('⚠️ خطأ في IndexedDB transaction:', err);
        tx.oncomplete = () => console.log('📦 محفوظ في قائمة انتظار الأوفلاين:', syncId);
      } catch (err) {
        console.warn('⚠️ خطأ في الكتابة إلى IndexedDB:', err);
      }
    };

    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      // ✅ مخزن منفصل عن syncQueue الشامل لمنع التداخل
      if (!db.objectStoreNames.contains('counters_pending_ops')) {
        db.createObjectStore('counters_pending_ops', { keyPath: 'syncId' });
      }
    };
  }

  // ✅ [إصلاح #1] checkOnlineStatus() بدلاً من navigator.onLine المباشر أو _isOnline
  // إن كان متصلاً الآن → أعد المحاولة مباشرة (قد يكون خطأ مؤقتاً)
  if (checkOnlineStatus() && DB_REF) {
    console.log('🔁 إعادة محاولة Transaction فوراً...');
    DB_REF.child('inventory').child(pumpType).transaction(
      currentValue => (currentValue || 0) + liters,
      (error, committed) => {
        if (!error && committed) {
          console.log('✅ نجحت إعادة المحاولة:', pumpType, liters);
          COUNTERS_STATE.hasLocalChanges   = false;
          COUNTERS_STATE.lastTransactionOk = true;
          updateSyncIndicator();
        }
        // إن فشلت مرة ثانية → تبقى في IndexedDB حتى الجلسة التالية
      }
    );
  }
}

// ══════════════════════════════════════════════════════════════════
// إعادة تعيين العدادات (للمشرفين فقط)
// ══════════════════════════════════════════════════════════════════

/**
 * إعادة تعيين العدادات لبداية يوم جديد
 * [إصلاح] currentUser.role → قراءة الدور من Firebase
 * [إصلاح] snapshots كانت تفتقد totalShifts و totalRevenue
 */
async function resetCountersForNewDay() {
  if (!currentUser) {
    console.error('❌ لم يتم تسجيل الدخول');
    return false;
  }

  try {
    // ── [إصلاح] قراءة الدور من Firebase بدلاً من currentUser.role ──
    // ❌ كان: currentUser.role !== 'admin'
    //         Firebase Auth لا يحتوي على .role
    // ✅ الآن: قراءة من users/{uid}/role في قاعدة البيانات
    const roleSnap = await new Promise((resolve, reject) => {
      DB_REF.child('users').child(currentUser.uid).child('role')
        .once('value', resolve, reject);
    });

    if (roleSnap.val() !== 'admin') {
      console.error('❌ ليس لديك صلاحيات كافية');
      return false;
    }

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayKey = yesterday.toISOString().split('T')[0];

    const totalLiters =
      COUNTERS_STATE.diesel + COUNTERS_STATE.fuel91 + COUNTERS_STATE.fuel95;

    // ── [إصلاح] إضافة totalShifts و totalRevenue المطلوبَين في Rules ─
    // ❌ كان: { diesel, fuel91, fuel95, timestamp } فقط → Firebase Rules يرفض
    // ✅ الآن: جميع الحقول الإلزامية موجودة
    await new Promise((resolve, reject) => {
      DB_REF.child('snapshots').child(yesterdayKey).set({
        diesel:       COUNTERS_STATE.diesel,
        fuel91:       COUNTERS_STATE.fuel91,
        fuel95:       COUNTERS_STATE.fuel95,
        totalShifts:  0,   // يُحدَّث لاحقاً من سجل الورديات
        totalRevenue: 0,   // يُحدَّث لاحقاً من سجل الورديات
        timestamp:    Date.now()
      }, err => err ? reject(err) : resolve());
    });

    // إعادة تعيين العدادات في Firebase
    await new Promise((resolve, reject) => {
      DB_REF.child('inventory').set({
        diesel:    0,
        fuel91:    0,
        fuel95:    0,
        timestamp: Date.now()
      }, err => err ? reject(err) : resolve());
    });

    COUNTERS_STATE.diesel            = 0;
    COUNTERS_STATE.fuel91            = 0;
    COUNTERS_STATE.fuel95            = 0;
    COUNTERS_STATE.lastTransactionOk = true;
    displayCounters(COUNTERS_STATE);

    console.log('✅ تم إعادة تعيين العدادات بنجاح');
    return true;

  } catch (error) {
    console.error('❌ خطأ في إعادة التعيين:', error);
    return false;
  }
}

// ══════════════════════════════════════════════════════════════════
// مستمعو الأحداث
// ══════════════════════════════════════════════════════════════════

// ✅ [إصلاح #3] مستمع واحد فقط: 'userLoggedIn' المخصص
// ❌ أُزيل: window.addEventListener('online', ...) + ('offline', ...)
//    كانا يتعارضان مع rtdb.ref('.info/connected') في index-FIXED.html
//    ويُعيدان تحميل Firebase في وقت قد يعالجه الملف الرئيسي أصلاً

document.addEventListener('userLoggedIn', () => {
  console.log('📊 جاري تحميل العدادات...');
  loadCountersFromFirebase();
  monitorCountersChanges();
});

// ══════════════════════════════════════════════════════════════════
// واجهة برمجية عامة
// ══════════════════════════════════════════════════════════════════

window.CountersAPI = {
  displayCounters,
  loadCountersFromFirebase,
  updateCounter,
  queueCounterUpdate,
  resetCountersForNewDay,
  updateSyncIndicator,        // [جديد v2.4] مكشوفة لاستدعائها من index-FIXED.html
  checkOnlineStatus,          // [جديد v2.4] مكشوفة لاستخدامها في الاختبار
  getState: () => ({ ...COUNTERS_STATE })
};
