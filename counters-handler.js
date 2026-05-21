/**
 * ═══════════════════════════════════════════════════════════════════
 * معالج العدادات (Counters Handler) — النسخة المصححة
 * ─────────────────────────────────────────────────────────────────
 * الإصلاحات:
 * ✅ إصلاح مسميات data-counter (diesel91/diesel95 → fuel91/fuel95)
 * ✅ إصلاح Race Condition بـ Firebase Transactions
 * ✅ إصلاح قائمة الانتظار — استدعاء queueCounterUpdate عند الفشل
 * ✅ إصلاح _isOnline غير معرّف → navigator.onLine
 * ✅ إصلاح currentUser.role → قراءة الدور من Firebase
 * ✅ إصلاح snapshots تفتقد totalShifts/totalRevenue
 * ✅ إضافة localStorage كنسخة احتياطية
 * ✅ إضافة معالج خطأ لـ IndexedDB
 * ✅ إصلاح نوع syncQueue من COUNTER_UPDATE → INVENTORY
 * ═══════════════════════════════════════════════════════════════════
 */

// ── حالة العدادات المحلية ──────────────────────────────────────
const COUNTERS_STATE = {
  diesel: 0,
  fuel91: 0,
  fuel95: 0,
  lastSync: Date.now(),
  isSyncing: false,
  hasLocalChanges: false
};

// ── [إصلاح] متغير الاتصال الصحيح ─────────────────────────────
// ❌ كان: _isOnline (غير معرّف)
// ✅ الآن: navigator.onLine (متاح في كل المتصفحات)

/**
 * ✅ حفظ العدادات في localStorage كنسخة احتياطية
 * [جديد] — لم يكن موجوداً رغم ذكره في الوثائق
 */
function saveCountersToLocalStorage() {
  try {
    localStorage.setItem('counters_backup', JSON.stringify({
      diesel: COUNTERS_STATE.diesel,
      fuel91: COUNTERS_STATE.fuel91,
      fuel95: COUNTERS_STATE.fuel95,
      savedAt: Date.now()
    }));
  } catch (e) {
    console.warn('⚠️ تعذر الحفظ في localStorage:', e);
  }
}

/**
 * ✅ تحميل النسخة الاحتياطية من localStorage عند الحاجة
 * [جديد] — يُستدعى إذا فشل تحميل Firebase
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

/**
 * ✅ تحديث عرض العدادات - بدون رسائل أثناء الكتابة
 * [إصلاح] data-counter: diesel91/diesel95 → fuel91/fuel95
 * @param {Object} counters - قيم العدادات
 */
function displayCounters(counters = {}) {
  COUNTERS_STATE.diesel  = counters.diesel  || 0;
  COUNTERS_STATE.fuel91  = counters.fuel91  || 0;
  COUNTERS_STATE.fuel95  = counters.fuel95  || 0;

  // ── ❌ كان: [data-counter="diesel95"] — لا يطابق HTML الصحيح
  // ── ✅ الآن: [data-counter="fuel95"]
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

  // ── ❌ كان: [data-counter="diesel91"]
  // ── ✅ الآن: [data-counter="fuel91"]
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

  // حفظ نسخة احتياطية في localStorage عند كل تحديث
  saveCountersToLocalStorage();
  updateSyncIndicator();
}

/**
 * ✅ تحميل العدادات من Firebase
 * [إصلاح] إضافة fallback إلى localStorage عند الفشل
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

    COUNTERS_STATE.isSyncing      = false;
    COUNTERS_STATE.hasLocalChanges = false;
    COUNTERS_STATE.lastSync        = Date.now();
    updateSyncIndicator();

  } catch (error) {
    console.error('❌ خطأ في تحميل العدادات من Firebase:', error);
    COUNTERS_STATE.isSyncing = false;

    // [جديد] Fallback إلى localStorage عند فشل Firebase
    const backup = loadCountersFromLocalStorage();
    if (backup) {
      console.log('📦 تم تحميل النسخة الاحتياطية من localStorage');
      displayCounters(backup);
    }

    updateSyncIndicator();
  }
}

/**
 * ✅ مراقبة تغييرات العدادات من Firebase
 * [إصلاح] تجاهل التحديثات أثناء الكتابة المحلية (hasLocalChanges)
 */
function monitorCountersChanges() {
  if (!DB_REF) return;

  DB_REF.child('inventory').on('value', snapshot => {
    // [إصلاح] تجاهل التحديث إذا كان هناك تغييرات محلية معلقة
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

/**
 * ✅ تحديث العداد — بدون رسائل خطأ
 * [إصلاح #1] Race Condition: استخدام Transaction بدلاً من update مباشر
 * [إصلاح #2] استدعاء queueCounterUpdate عند فشل Firebase (كان مفقوداً)
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

  // ── تحديث محلي فوري ────────────────────────────────────────
  COUNTERS_STATE[pumpType]       = (COUNTERS_STATE[pumpType] || 0) + numLiters;
  COUNTERS_STATE.hasLocalChanges = true;
  displayCounters(COUNTERS_STATE);

  // ── [إصلاح] Transaction بدلاً من update لمنع Race Condition ─
  // ❌ كان: DB_REF.child('inventory').update({ [pumpType]: COUNTERS_STATE[pumpType] })
  //         خطر: مستخدمان يقرآن نفس القيمة ويكتبان → تضيع إحدى العمليتين
  // ✅ الآن: transaction تضمن أن كل إضافة تُبنى على القيمة الأخيرة في الخادم
  DB_REF.child('inventory').child(pumpType).transaction(
    currentValue => (currentValue || 0) + numLiters,
    (error, committed) => {
      if (error || !committed) {
        // ── [إصلاح] استدعاء queueCounterUpdate عند الفشل ───────
        // ❌ كان: console.warn فقط — البيانات تُفقد عند Offline
        // ✅ الآن: حفظ في قائمة الانتظار للمزامنة لاحقاً
        console.warn('⚠️ فشل التحديث — جاري الحفظ في قائمة الانتظار');
        queueCounterUpdate(pumpType, numLiters);
      } else {
        COUNTERS_STATE.hasLocalChanges = false;
        // تحديث timestamp منفصلاً
        DB_REF.child('inventory').child('timestamp').set(Date.now());
        updateSyncIndicator();
      }
    }
  );

  return true;
}

/**
 * ✅ إضافة عملية إلى قائمة الانتظار للمزامنة
 * [إصلاح #1] نوع syncQueue: COUNTER_UPDATE → INVENTORY (ليطابق Firebase Rules)
 * [إصلاح #2] إضافة onerror لـ IndexedDB (كان غائباً)
 * [إصلاح #3] استخدام navigator.onLine بدلاً من _isOnline
 */
function queueCounterUpdate(pumpType, liters) {
  if (!currentUser) return;

  const syncId = `counter-${pumpType}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

  // ── [إصلاح] نوع INVENTORY ليطابق Firebase Rules ─────────────
  // ❌ كان: type: 'COUNTER_UPDATE' — مرفوض من Firebase Rules
  // ✅ الآن: type: 'INVENTORY' — مقبول في قواعد syncQueue
  const queueItem = {
    type: 'INVENTORY',
    data: { pumpType, liters },
    timestamp: Date.now(),
    userId: currentUser.uid,
    syncId,
    status: 'pending'
  };

  // حفظ في IndexedDB
  if (window.indexedDB) {
    const request = indexedDB.open('FuelStationDB', 1);

    // ── [إصلاح] إضافة معالج الخطأ المفقود ──────────────────────
    request.onerror = (e) => {
      console.warn('⚠️ تعذر فتح IndexedDB:', e.target.error);
    };

    request.onsuccess = (e) => {
      try {
        const db = e.target.result;
        const tx = db.transaction('syncQueue', 'readwrite');
        tx.objectStore('syncQueue').add(queueItem);
        tx.onerror = (err) => console.warn('⚠️ خطأ في IndexedDB transaction:', err);
      } catch (err) {
        console.warn('⚠️ خطأ في الكتابة إلى IndexedDB:', err);
      }
    };

    request.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('syncQueue')) {
        db.createObjectStore('syncQueue', { keyPath: 'syncId' });
      }
    };
  }

  // ── [إصلاح] navigator.onLine بدلاً من _isOnline ──────────────
  // ❌ كان: if (_isOnline && DB_REF) — _isOnline غير معرّف
  // ✅ الآن: navigator.onLine
  if (navigator.onLine && DB_REF) {
    DB_REF.child('syncQueue').push(queueItem).catch(err => {
      console.warn('⚠️ سيتم المزامنة لاحقاً:', err);
    });
  }
}

/**
 * ✅ تحديث مؤشر حالة المزامنة
 */
function updateSyncIndicator() {
  const indicator = document.querySelector('[data-sync-indicator]');
  if (!indicator) return;

  if (COUNTERS_STATE.isSyncing) {
    indicator.textContent = '🔄 جاري المزامنة...';
    indicator.style.color = 'var(--gold)';
  } else if (COUNTERS_STATE.hasLocalChanges) {
    indicator.textContent = '⏳ في انتظار الاتصال';
    indicator.style.color = 'var(--red, #c0392b)';
  } else {
    indicator.textContent = '✅ متزامن';
    indicator.style.color = 'var(--green, #27ae60)';
  }
}

/**
 * ✅ إعادة تعيين العدادات (للمشرفين فقط)
 * [إصلاح #1] currentUser.role لا يوجد في Firebase Auth
 *            → قراءة الدور من قاعدة البيانات
 * [إصلاح #2] snapshots كانت تفتقد totalShifts و totalRevenue
 *            اللذين تطلبهما Firebase Rules كحقول إلزامية
 */
async function resetCountersForNewDay() {
  if (!currentUser) {
    console.error('❌ لم يتم تسجيل الدخول');
    return false;
  }

  try {
    // ── [إصلاح] قراءة الدور من Firebase بدلاً من currentUser.role ─
    // ❌ كان: currentUser.role !== 'admin'
    //         Firebase Auth لا يحتوي على .role
    // ✅ الآن: قراءة من users/{uid}/role
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

    // حساب الإجماليات قبل الإعادة
    const totalLiters =
      COUNTERS_STATE.diesel + COUNTERS_STATE.fuel91 + COUNTERS_STATE.fuel95;

    // ── [إصلاح] إضافة totalShifts و totalRevenue المطلوبَين في Rules ─
    // ❌ كان: { diesel, fuel91, fuel95, timestamp } فقط
    //         Firebase Rules ترفض لأن totalShifts و totalRevenue مفقودان
    // ✅ الآن: جميع الحقول الإلزامية موجودة
    await new Promise((resolve, reject) => {
      DB_REF.child('snapshots').child(yesterdayKey).set({
        diesel      : COUNTERS_STATE.diesel,
        fuel91      : COUNTERS_STATE.fuel91,
        fuel95      : COUNTERS_STATE.fuel95,
        totalShifts : 0,   // يُحدَّث لاحقاً من سجل الورديات
        totalRevenue: 0,   // يُحدَّث لاحقاً من سجل الورديات
        timestamp   : Date.now()
      }, err => err ? reject(err) : resolve());
    });

    // إعادة تعيين العدادات
    await new Promise((resolve, reject) => {
      DB_REF.child('inventory').set({
        diesel   : 0,
        fuel91   : 0,
        fuel95   : 0,
        timestamp: Date.now()
      }, err => err ? reject(err) : resolve());
    });

    COUNTERS_STATE.diesel = 0;
    COUNTERS_STATE.fuel91 = 0;
    COUNTERS_STATE.fuel95 = 0;
    displayCounters(COUNTERS_STATE);

    console.log('✅ تم إعادة تعيين العدادات بنجاح');
    return true;

  } catch (error) {
    console.error('❌ خطأ في إعادة التعيين:', error);
    return false;
  }
}

// ── مستمعو الأحداث ──────────────────────────────────────────────

document.addEventListener('userLoggedIn', () => {
  console.log('📊 جاري تحميل العدادات...');
  loadCountersFromFirebase();
  monitorCountersChanges();
});

window.addEventListener('offline', () => {
  COUNTERS_STATE.isSyncing = false;
  updateSyncIndicator();
  console.log('📴 وضع عدم الاتصال — العدادات محفوظة محلياً');
});

window.addEventListener('online', () => {
  console.log('📡 تم استعادة الاتصال — جاري المزامنة...');
  loadCountersFromFirebase();
});

// ── واجهة برمجية عامة ────────────────────────────────────────────
window.CountersAPI = {
  displayCounters,
  loadCountersFromFirebase,
  updateCounter,
  queueCounterUpdate,
  resetCountersForNewDay,
  getState: () => ({ ...COUNTERS_STATE })
};
