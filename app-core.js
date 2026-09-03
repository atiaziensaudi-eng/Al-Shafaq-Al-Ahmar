// ═══════════════════════════════════════════════════════════════
// FIREBASE INIT — تم نقل الإعدادات إلى firebase-config.js
// هنا فقط: المتغيرات الإضافية التي تحتاجها الصفحة
// ═══════════════════════════════════════════════════════════════
// ملاحظة: rtdb, fbAuth, STATION_KEY, DB_REF معرَّفة في firebase-config.js
const APP_VERSION = '13.0';
const SCHEMA_VERSION = 4; // v4: إضافة نظام الجرد (audit rows in DB.meters)

// ── ترقية تلقائية لهيكل البيانات إذا كان الإصدار أقدم ──────────
function _migrateSchemaIfNeeded() {
  const current = DB.config?._schemaVersion || 1;
  if (current >= SCHEMA_VERSION) return;
  console.log(`🔄 ترقية البيانات من v${current} إلى v${SCHEMA_VERSION}`);
  // v1 → v2: تحويل users من array إلى object
  if (current < 2 && Array.isArray(DB.users)) {
    DB.users = _migrateUsersToObject(DB.users);
  }
  // v2 → v3: ضمان وجود جميع الحقول الأساسية
  if (current < 3) {
    if (!DB.activityLog) DB.activityLog = [];
    if (!DB.supply) DB.supply = [];
    if (!DB.archives) DB.archives = [];
  }
  // v3 → v4: دعم نظام الجرد — لا تغيير هيكلي مطلوب (type:'audit' في DB.meters)
  if (current < 4) {
    // مسح ميزة الهجرة الرجعية للإعادة مع نظام الجرد الجديد
    if (DB.config) delete DB.config._auditSystemInitialized;
  }
  if (DB.config) DB.config._schemaVersion = SCHEMA_VERSION;
  saveDB();
  console.log('✅ ترقية البيانات اكتملت');
}

// تم حذف _checkFirebaseSecurityRules — كانت لا تفعل شيئاً فعلياً

// ═══════════════════════════════════════════════════════════════
// runRetroactiveMigration — هجرة رجعية تلقائية تُشغَّل مرة واحدة
// ═══════════════════════════════════════════════════════════════
// تُحدِّث جميع سجلات المخزون القديمة التي احتُسب فيها "استهلاك اليوم"
// (dayD/day91/day95) بناءً على التاريخ التقويمي (المنطق الخاطئ القديم)
// لتصبح مبنية على القاعدة الجديدة الصحيحة:
//   مجموع آخر X ورديات متتالية حسب تسلسل الإدخال الفعلي (FIFO بالـ ID)
//   حيث X = DB.config.shiftsPerDay (عدد الورديات اليومية من الإعدادات)
//
// الخطوات:
//   1) ترتيب جميع الورديات تصاعدياً بالـ ID (= تسلسل الإدخال الفعلي)
//   2) إعادة احتساب dayD/day91/day95 لكل صف مخزون بنافذة FIFO
//   3) إعادة احتساب أرصدة المخزون المتراكمة (running stock) بالترتيب الصحيح
//   4) وضع علامة إتمام (_retroMigrationV1) ومنع إعادة التشغيل
// ═══════════════════════════════════════════════════════════════
function runRetroactiveMigration() {
  // إذا لم تُحمَّل البيانات بعد أو فارغة — ضع علامة وانتهِ
  if (!DB.config) return;
  if (DB.config._retroMigrationV1) return; // مكتملة مسبقاً — لا تُعاد

  if (!DB.shifts || DB.shifts.length === 0) {
    DB.config._retroMigrationV1 = true;
    saveDB();
    return;
  }

  console.log('🔄 [Migration v1] تطبيق الهجرة الرجعية على البيانات القديمة...');

  const shiftsPerDay = parseInt(DB.config.shiftsPerDay || DB.config.shifts?.length || 2);

  // ── الخطوة 1: ترتيب الورديات تصاعدياً (الأقدم إدخالاً أولاً) بحسب ID ──
  const sortedAsc = [...DB.shifts].sort((a, b) => (a.id || 0) - (b.id || 0));

  // ── الخطوة 2: إعادة احتساب dayD/day91/day95 في كل صف مخزون ──
  sortedAsc.forEach((shift, idx) => {
    // نافذة آخر X ورديات حتى هذه الوردية (شاملةً إياها)
    const windowStart = Math.max(0, idx - shiftsPerDay + 1);
    const win = sortedAsc.slice(windowStart, idx + 1);
    const newDayD  = win.reduce((a, s) => a + (s.diesel || 0), 0);
    const newDay91 = win.reduce((a, s) => a + (s.n91    || 0), 0);
    const newDay95 = win.reduce((a, s) => a + (s.n95    || 0), 0);

    // تحديث الصف المقابل في DB.inventory
    const invRow = DB.inventory.find(
      r => r.type === 'shift' && r.date === shift.date && r.shiftType === shift.shiftType
    );
    if (invRow) {
      invRow.dayD  = newDayD;
      invRow.day91 = newDay91;
      invRow.day95 = newDay95;
    }
  });

  // ── الخطوة 3: إعادة احتساب أرصدة المخزون المتراكمة من الصفر ──
  const openingRow = DB.inventory.find(r => r.type === 'opening');
  let stock = {
    diesel: openingRow ? (openingRow.diesel || 0) : (DB.config.openingStock?.diesel || 0),
    n91:    openingRow ? (openingRow.n91    || 0) : (DB.config.openingStock?.n91    || 0),
    n95:    openingRow ? (openingRow.n95    || 0) : (DB.config.openingStock?.n95    || 0),
  };

  // خريطة: "date|shiftType" → index في sortedAsc (لترتيب صفوف المخزون)
  const shiftIdxMap = {};
  sortedAsc.forEach((s, i) => { shiftIdxMap[s.date + '|' + s.shiftType] = i; });

  // ترتيب صفوف المخزون (عدا الافتتاحي) بالتسلسل الزمني الصحيح
  const nonOpeningInv = DB.inventory.filter(r => r.type !== 'opening');
  nonOpeningInv.sort((a, b) => {
    const ai = a.type === 'shift' ? (shiftIdxMap[a.date + '|' + a.shiftType] ?? 99999) : 99999;
    const bi = b.type === 'shift' ? (shiftIdxMap[b.date + '|' + b.shiftType] ?? 99999) : 99999;
    if (a.type === 'shift' && b.type === 'shift') return ai - bi;
    if (a.date !== b.date) return a.date.localeCompare(b.date);
    // نفس التاريخ: الوردية أولاً ثم التوريد/المعادلة
    if (a.type === 'shift' && b.type !== 'shift') return -1;
    if (a.type !== 'shift' && b.type === 'shift') return  1;
    return ai - bi;
  });

  nonOpeningInv.forEach(row => {
    if (row.type === 'shift') {
      stock.diesel -= (row.consD  || 0);
      stock.n91    -= (row.cons91 || 0);
      stock.n95    -= (row.cons95 || 0);
    } else if (row.type === 'supply') {
      const k = row.supplyFuel === 'diesel' ? 'diesel'
              : row.supplyFuel === '91'     ? 'n91'
              : 'n95';
      stock[k] += (row.supplyQty || 0);
    } else if (row.type === 'adjust') {
      stock.diesel += (row.adjD  || 0);
      stock.n91    += (row.adj91 || 0);
      stock.n95    += (row.adj95 || 0);
    }
    // تحديث الرصيد المتراكم في كل صف
    row.diesel = stock.diesel;
    row.n91    = stock.n91;
    row.n95    = stock.n95;
  });

  // تحديث currentStock ليتطابق مع الرصيد المُعاد احتسابه
  DB.config.currentStock.diesel = stock.diesel;
  DB.config.currentStock.n91    = stock.n91;
  DB.config.currentStock.n95    = stock.n95;

  // ── الخطوة 4: وضع علامة الإتمام ومنع إعادة التشغيل ──────────
  DB.config._retroMigrationV1 = true;
  saveDB();

  console.log('✅ [Migration v1] اكتملت — dayD/day91/day95 والأرصدة محدَّثة بالمنطق الجديد');

  // إشعار للمستخدم (يظهر فقط إذا كانت الواجهة مفتوحة)
  setTimeout(() => {
    try {
      if (typeof _showToast === 'function') {
        _showToast('✅ تم تحديث جميع البيانات التاريخية بالمنطق الجديد الصحيح', 'success', 6000);
      }
    } catch(e) {}
  }, 2500);
}


// [FIX v10] دالة مساعدة موحّدة للتحقق من الصلاحيات
// تُستخدم بدلاً من if(role !== 'owner') المبعثرة في الكود
function _canDo(permission) {
  if (!currentUser) return false;
  if (!window._userPermissions) {
    // fallback إذا لم تُبنَ بعد — owner يملك كل شيء
    return currentUser.role === 'owner';
  }
  return window._userPermissions[permission] === true;
}

// ── تنظيف HTML لمنع XSS ──────────────────────────────────────
function escapeHTML(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// وضع المصادقة المحلية — يُفعَّل تلقائياً إذا فشل Firebase Auth
let _localAuthMode = localStorage.getItem('_localAuthMode') === '1';

// ✅ [FIX v14] إذا المتصفح متصل وكان _localAuthMode محفوظاً من جلسة offline قديمة — امسحه
// يحل مشكلة: تسجيل الدخول لا يعمل لأن التطبيق يعتقد Firebase غير متاح
if (_localAuthMode && navigator.onLine) {
  _localAuthMode = false;
  localStorage.removeItem('_localAuthMode');
  console.log('🔄 [FIX v14] مسح _localAuthMode القديم — المتصفح متصل');
}

// ── تشفير كلمة المرور بـ SHA-256 + Salt فريد للجهاز ──────────
async function _hashPass(pass) {
  if (!crypto?.subtle) {
    throw new Error('متصفحك لا يدعم التشفير الآمن. يرجى استخدام متصفح حديث (Chrome/Firefox/Safari).');
  }
  // salt فريد لكل جهاز — يُنشأ مرة واحدة ويُحفظ دائماً
  let salt = localStorage.getItem('_deviceSalt');
  if (!salt) {
    salt = Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map(b => b.toString(16).padStart(2,'0')).join('');
    localStorage.setItem('_deviceSalt', salt);
  }
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + pass));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,'0')).join('');
}

// ═══════════════════════════════════════════════════════════════
// OFFLINE / SYNC SYSTEM
// ═══════════════════════════════════════════════════════════════
let _isOnline = navigator.onLine;
let _hasPendingSync = false;
let _syncRetryTimer = null;

// ── تحديث مؤشر الاتصال في الواجهة ──────────────────────────
// ✅ FIX #5: التعريف الأول أُزيل — تعريف مكرر كان يُطغى على التعريف الثاني (السطر ~6037)
// _updateSyncIndicator معرَّفة لاحقاً بنسخة موحدة أشمل تدعم جميع الحالات
// هذا التعليق يحل محل التعريف الأصلي لمنع التضارب

// ── الاستماع لـ Firebase Realtime connection state ──────────
// ✅ [FIX v10] نحتفظ بمرجع الـ listener لإمكانية إلغاء الاشتراك عند الحاجة
let _connListenerRegistered = false;
let _connListenerRef = null; // [FIX v10] للـ cleanup

if (!_connListenerRegistered) {
  _connListenerRegistered = true;
  _connListenerRef = rtdb.ref('.info/connected');
  _connListenerRef.on('value', snap => {
    const connected = snap.val() === true;
    _isOnline = connected;
    if (connected) {
      _updateSyncIndicator('online');
      _flushPendingSync();
      document.dispatchEvent(new CustomEvent('connectionRestored')); // [FIX] يُشغّل تفريغ طابور عدادات الأوفلاين
    } else {
      _updateSyncIndicator(_hasPendingSync ? 'pending' : 'offline');
    }
  });
}

// ── دعم إضافي: أحداث المتصفح للشبكة ──────────────────────────
window.addEventListener('online',  () => { _isOnline = true;  _flushPendingSync(); });
window.addEventListener('offline', () => { _isOnline = false; _updateSyncIndicator(_hasPendingSync ? 'pending' : 'offline'); });

// ── رفع البيانات المعلّقة عند عودة الاتصال ──────────────────
function _flushPendingSync() {
  if (!_hasPendingSync || !DB.config) return;
  _updateSyncIndicator('syncing');
  // ✅ [إصلاح جذري] استبدال set() بـ update() لمنع حذف مسار 'counters'
  // set() يمحو كامل المسار في Firebase بما فيه counters → يُدمّر بيانات العدادات
  // update() يكتب فقط المفاتيح المحددة دون المساس بـ 'counters'
  DB_REF.update({
    config:      DB.config,
    users:       DB.users,
    shifts:      DB.shifts,
    meters:      DB.meters,
    inventory:   DB.inventory,
    supply:      DB.supply,
    archives:    DB.archives,
    activityLog: DB.activityLog
    // 'counters' مُستثنى عمداً — يُدار من counters-handler.js حصراً
  })
    .then(() => {
      _hasPendingSync = false;
      localStorage.removeItem('fuelStationPendingSync');
      _updateSyncIndicator('saved');
      _showSyncSuccessBanner();
      setTimeout(() => _updateSyncIndicator('online'), 3000);
    })
    .catch(err => {
      console.warn('Flush sync error:', err);
      _updateSyncIndicator('error');
      // أعد المحاولة بعد 10 ثوان
      clearTimeout(_syncRetryTimer);
      _syncRetryTimer = setTimeout(_flushPendingSync, 10000);
    });
}

// ── بانر إشعار نجاح المزامنة ────────────────────────────────
function _showSyncSuccessBanner() {
  const old = document.getElementById('_syncBanner');
  if (old) old.remove();
  const banner = document.createElement('div');
  banner.id = '_syncBanner';
  banner.style.cssText = `
    position:fixed;bottom:calc(70px + env(safe-area-inset-bottom, 0px));left:12px;right:12px;z-index:9999;
    background:#1B5E20;color:white;border-radius:12px;padding:12px 16px;
    display:flex;align-items:center;gap:10px;
    box-shadow:0 4px 20px rgba(0,0,0,0.4);font-family:Cairo,sans-serif;font-size:13px;
    animation:slideUp 0.3s ease;
  `;
  banner.innerHTML = `
    <span style="font-size:20px">✅</span>
    <div>
      <div style="font-weight:800">تمت المزامنة بنجاح</div>
      <div style="font-size:11px;opacity:0.85">تم رفع جميع البيانات المحفوظة أثناء انقطاع الاتصال</div>
    </div>
    <button onclick="this.parentElement.remove()" style="margin-right:auto;background:rgba(255,255,255,0.2);border:none;border-radius:8px;padding:4px 10px;color:white;cursor:pointer;font-size:12px">✕</button>
  `;
  document.body.appendChild(banner);
  setTimeout(() => banner?.remove(), 6000);
}
// ═══════════════════════════════════════════════════════════════
// ===========================
// DATA STORAGE
// ===========================
let DB = {
  config: null,
  users: {},        // { uid: {email, name, role} } — مخزّن بالـ uid لدعم Firebase Rules
  shifts: [],       // {id, date, shiftType, pumps:[{id,current,prev,consumption}], diesel,n91,n95,totalMoney,network,invoices,supplied,cash}
  meters: [],       // {shiftId, date, shiftType, pumps:[{pumpId,reading,consumption}]}
  inventory: [],    // {date, shiftType, diesel,n91,n95, consD,cons91,cons95, dayD,day91,day95, adjD,adj91,adj95, type:'shift'|'supply'|'adjust', qty,fuelType}
  supply: [],       // {id,date,type,qty,invoice,driver,truck,carrier, meters:[], reserve:{d,n91,n95}}
  archives: [],
  activityLog: []   // {id, timestamp, user, action, details}
};

// ── مساعدات للتعامل مع users كـ object بدلاً من array ──────────
// هذه الدوال تُبقي باقي الكود يعمل بدون تغيير كبير
function _usersArray() {
  // تُعيد مصفوفة من المستخدمين مع إضافة uid لكل عنصر
  return Object.entries(DB.users || {}).map(([uid, u]) => ({ ...u, uid }));
}
function _findUserByEmail(email) {
  return _usersArray().find(u => u.email === email) || null;
}
function _findUserByUid(uid) {
  const u = DB.users?.[uid];
  return u ? { ...u, uid } : null;
}
function _addUserToDB(uid, userData) {
  if (!DB.users) DB.users = {};
  DB.users[uid] = userData; // { email, name, role }
}
function _removeUserFromDB(uid) {
  if (DB.users?.[uid]) delete DB.users[uid];
}

// ═══════════════════════════════════════════════════════════════
// DATA STORAGE — Firebase Realtime DB + localStorage (cache)
// ═══════════════════════════════════════════════════════════════

let _saveTimer = null;

// ── معرّف الجهاز الفريد (يُنشأ مرة واحدة ويبقى دائماً) ──────────
const _DEVICE_ID = (() => {
  let id = localStorage.getItem('_deviceId');
  if (!id) {
    id = 'dev_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
    localStorage.setItem('_deviceId', id);
  }
  return id;
})();

// ── مؤشر الإصدار الكلي للبيانات (يزيد عند كل حفظ) ──────────────
// يُستخدم في Last-Write-Wins لمنع الكتابة فوق بيانات أحدث
let _dbWriteVersion = parseInt(localStorage.getItem('_dbWriteVersion') || '0');
function _nextWriteVersion() {
  _dbWriteVersion++;
  localStorage.setItem('_dbWriteVersion', String(_dbWriteVersion));
  return _dbWriteVersion;
}

// ── saveDB ────────────────────────────────────────────────────
// يحفظ فوراً في localStorage مع timestamp، ثم يرفع لـ Firebase
// إذا كان الاتصال منقطعاً: يضع علامة pending ويرفع عند العودة
function saveDB() {
  // [v17] نقطة إعادة البناء المحاسبي المركزية والوحيدة — كانت سابقاً تُستدعى
  // مرة واحدة فقط عند فتح التطبيق، فكانت كل الشاشات تعتمد على حسابات مؤقتة
  // مُدخلة يدوياً في كل دالة حفظ بدل المحرك الموحّد. الآن أي تعديل (وردية،
  // جرد، توريد، تصحيح، حذف، تعديل، استرجاع نسخة احتياطية) يمر من هنا أولاً،
  // فتُعاد كل الحسابات (المخزون، استهلاك اليوم، الإيراد بسعر وقته) من الصفر
  // قبل أي حفظ محلي أو مزامنة مع Firebase.
  if (window.AccountingEngine && DB.config) {
    try { AccountingEngine.rebuild({ silent: true }); } catch (e) { console.warn('[saveDB] AE.rebuild failed:', e); }
  }

  // ✅ تأكد أن جميع العدادات لها معرّفات فريدة
  if (DB.meters && Array.isArray(DB.meters)) {
    DB.meters.forEach((meter, idx) => {
      if (!meter.id && meter.id !== 0) {
        // للعداد الافتتاحي: ID ثابت = 0 (يضمن بقاءه دائماً في الأسفل)
        // لباقي العدادات: ID = وقت الإنشاء التقريبي (متسلسل)
        meter.id = meter.type === 'opening' ? 0 : (Date.now() - (DB.meters.length - idx) * 1000);
      }
    });
    
    // ✅ ترتيب حسب معرّف الإدخال تنازليّاً (آخر عداد في الأعلى = index 0)
    // هذا الترتيب هو المرجع الأساسي لحسابات الاستهلاك:
    //   index 0   = الوردية الأحدث   (قراءتها هي المرجع للاستهلاك اللحظي)
    //   index 1   = الوردية السابقة لها مباشرة
    //   index N   = العداد الافتتاحي (type='opening', id=0)
    DB.meters.sort((a, b) => {
      if (a.type === 'opening' && b.type !== 'opening') return 1;
      if (a.type !== 'opening' && b.type === 'opening') return -1;
      if (a.type === 'opening' && b.type === 'opening') return 0;
      return (b.id || 0) - (a.id || 0);
    });
  }
  
  // ✅ FIX #5A: تحديد حجم سجل الأنشطة — احتفظ بآخر 2000 (رُفع من 500)
  if (DB.activityLog && DB.activityLog.length > 2000) {
    DB.activityLog = DB.activityLog.slice(-2000);
  }
  // ✅ FIX #5B: تحديد عدد أشهر الأرشيف المحفوظة في localStorage (آخر 24 شهراً)
  const MAX_ARCHIVE_LOCAL = 24;
  const archivesToSave = DB.archives.length > MAX_ARCHIVE_LOCAL
    ? DB.archives.slice(-MAX_ARCHIVE_LOCAL) : DB.archives;
  
  // [FIX v10] إضافة metadata للمزامنة: deviceId + writeVersion + lastSyncTime
  // يُستخدم في Last-Write-Wins لمنع الكتابة فوق بيانات أحدث
  const _wv = _nextWriteVersion();
  const _syncMeta = {
    _savedAt:     Date.now(),
    _deviceId:    _DEVICE_ID,
    _writeVersion: _wv,
    _lastSyncTime: new Date().toISOString()
  };
  
  // 1) حفظ فوري في localStorage مع metadata
  const snapshot = { ...DB, archives: archivesToSave, ..._syncMeta };
  // ✅ FIX #5C: معالجة QuotaExceededError بذكاء — احذف الأرشيف القديم تدريجياً
  function _tryLocalSave(data, attempt) {
    try {
      localStorage.setItem('fuelStationDB', JSON.stringify(data));
    } catch(e) {
      if (e.name === 'QuotaExceededError' || e.code === 22) {
        if (attempt === 0) {
          // المحاولة الأولى: احذف فقط الأرشيف من النسخة المحلية (موجود في Firebase)
          const slim = { ...data, archives: [] };
          _tryLocalSave(slim, 1);
        } else if (attempt === 1) {
          // المحاولة الثانية: احذف سجل الأنشطة أيضاً
          const slim = { ...data, archives: [], activityLog: [] };
          _tryLocalSave(slim, 2);
        } else {
          // فشل كلياً — أخبر المستخدم
          console.error('localStorage ممتلئ تماماً:', e);
          _showToast('⚠️ مساحة التخزين المحلي ممتلئة. يُنصح بتنزيل نسخة احتياطية وأرشفة الشهر.', 'warning');
        }
      }
    }
  }
  _tryLocalSave(snapshot, 0);

  // 2) إذا غير متصل — ضع علامة pending وانتهِ
  if (!_isOnline) {
    _hasPendingSync = true;
    localStorage.setItem('fuelStationPendingSync', '1');
    _updateSyncIndicator('pending');
    return;
  }

  // 3) متصل — Debounce 800ms لتجميع التغييرات المتتالية
  _updateSyncIndicator('syncing');
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(() => {
    // [FIX v10] Last-Write-Wins: أرفق metadata لكل كتابة
    // هذا يمنع الجهاز الأبطأ من الكتابة فوق بيانات جهاز أسرع
    const firebasePayload = {
      config:      DB.config,
      users:       DB.users,
      shifts:      DB.shifts,
      meters:      DB.meters,
      inventory:   DB.inventory,
      supply:      DB.supply,
      archives:    DB.archives,
      activityLog: DB.activityLog,
      // metadata المزامنة — يُقرأ من أي جهاز للمقارنة
      _syncMeta: {
        savedAt:      Date.now(),
        deviceId:     _DEVICE_ID,
        writeVersion: _wv,
        syncTime:     new Date().toISOString()
      }
      // ✅ 'counters' مُستثنى عمداً — يُدار حصراً من counters-handler.js
    };
    DB_REF.update(firebasePayload)
      .then(() => {
        _hasPendingSync = false;
        localStorage.removeItem('fuelStationPendingSync');
        _updateSyncIndicator('saved');
        setTimeout(() => _updateSyncIndicator('online'), 2500);
      })
      .catch(err => {
        console.warn('Firebase save error:', err);
        _hasPendingSync = true;
        localStorage.setItem('fuelStationPendingSync', '1');
        _updateSyncIndicator('error');
        clearTimeout(_syncRetryTimer);
        _syncRetryTimer = setTimeout(_flushPendingSync, 15000);
      });
  }, 800);
}

// ── loadDB ────────────────────────────────────────────────────
// يجلب البيانات من Firebase، إن فشل يستخدم localStorage
// يقارن timestamp + writeVersion لـ Last-Write-Wins الصحيح
function loadDB() {
  return new Promise(resolve => {
    // أولاً: حمّل من localStorage فوراً (يُشغّل التطبيق بلا تأخير)
    const cached = localStorage.getItem('fuelStationDB');
    let localSavedAt = 0;
    let localWriteVersion = 0;
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        localSavedAt = parsed._savedAt || 0;
        localWriteVersion = parsed._writeVersion || 0;
        // نظّف metadata قبل تحميل DB
        delete parsed._savedAt;
        delete parsed._writeVersion;
        delete parsed._deviceId;
        delete parsed._lastSyncTime;
        DB = parsed;
        if (!DB.activityLog) DB.activityLog = [];
        if (!DB.users || Array.isArray(DB.users)) DB.users = _migrateUsersToObject(DB.users);
        if (localStorage.getItem('fuelStationPendingSync') === '1') {
          _hasPendingSync = true;
        }
      } catch(e) {
        console.warn('خطأ في قراءة localStorage:', e);
      }
    }

    // حدّ زمني 8 ثوان للـ Firebase — إذا تجاوزه يستمر بالنسخة المحلية
    let _resolved = false;
    const _resolveOnce = () => { if (!_resolved) { _resolved = true; resolve(); } };
    setTimeout(_resolveOnce, 8000);

    // ثانياً: جلب من Firebase في الخلفية
    DB_REF.once('value')
      .then(snap => {
        const data = snap.val();
        if (data && typeof data === 'object') {
          // [FIX v10] Last-Write-Wins بـ writeVersion أولاً، ثم timestamp
          // writeVersion أدق لأنه يزيد مع كل حفظ (لا يتأثر بفروق الساعة بين الأجهزة)
          const cloudMeta = data._syncMeta || {};
          const cloudWriteVersion = cloudMeta.writeVersion || data._writeVersion || 0;
          const cloudSavedAt = cloudMeta.savedAt || data._savedAt || 0;
          const cloudDeviceId = cloudMeta.deviceId || data._deviceId || '';

          // قرار: هل البيانات المحلية أحدث من السحابة؟
          const localIsNewer = _hasPendingSync && (
            localWriteVersion > cloudWriteVersion ||
            (localWriteVersion === cloudWriteVersion && localSavedAt > cloudSavedAt)
          );

          if (localIsNewer) {
            console.log(`🔄 [LWW] البيانات المحلية أحدث (v${localWriteVersion} > v${cloudWriteVersion}) — سيتم رفعها`);
            // لا تغيّر DB، سيرفعها _flushPendingSync عند الاتصال
          } else {
            if (cloudDeviceId && cloudDeviceId !== _DEVICE_ID) {
              console.log(`🔄 [LWW] بيانات من جهاز آخر (${cloudDeviceId}) v${cloudWriteVersion} — تحميل`);
            }
            // السحابة أحدث أو لا يوجد pending — استخدم السحابة
            let meters = _toArray(data.meters);
            
            // ✅ تأكد أن جميع العدادات لها معرّفات فريدة
            meters.forEach((meter, idx) => {
              if (!meter.id) {
                // للعدادات القديمة بدون ID: أنشئ ID بناءً على الترتيب
                meter.id = idx === 0 && meter.type === 'opening' ? 0 : (Date.now() - (meters.length - idx) * 1000);
              }
            });
            
            // ✅ ترتيب حسب معرّف الإدخال تنازليّاً (تسلسل الإدخال الفعلي)
            // عدادات 'opening' دائماً في الأسفل (ID = 0)
            meters = meters.sort((a, b) => {
              // opening meters دائماً في الآخر
              if (a.type === 'opening' && b.type !== 'opening') return 1;
              if (a.type !== 'opening' && b.type === 'opening') return -1;
              if (a.type === 'opening' && b.type === 'opening') return 0;
              
              // الباقي: ترتيب حسب ID تنازليّاً (الأحدث أولاً)
              return (b.id || 0) - (a.id || 0);
            });
            
            DB = {
              config:      data.config      || null,
              users:       (data.users && !Array.isArray(data.users)) ? data.users : _migrateUsersToObject(data.users),
              shifts:      _toArray(data.shifts),
              meters:      meters,
              inventory:   _toArray(data.inventory),
              supply:      _toArray(data.supply),
              archives:    _toArray(data.archives),
              activityLog: _toArray(data.activityLog)
              // data.counters مُتجاهَل عمداً — يُقرأ فقط من counters-handler.js
            };
            _hasPendingSync = false;
            localStorage.removeItem('fuelStationPendingSync');
            localStorage.setItem('fuelStationDB', JSON.stringify({ ...DB, _savedAt: Date.now() }));
            console.log('✅ Firebase: تم تحميل البيانات من السحابة');
            // [FIX v11] تحديث الصفحة الرئيسية فوراً بعد وصول بيانات Firebase
            // لأن initApp() قد تُشغَّل قبل اكتمال Firebase (من localStorage)
            if (typeof updateHomePage === 'function' && typeof currentUser !== 'undefined' && currentUser) {
              try { updateHomePage(); } catch(e) {}
            }
          }
        }
        _resolveOnce();
      })
      .catch(err => {
        console.warn('Firebase load error — using local cache:', err);
        _resolveOnce(); // استمر بالنسخة المحلية
      });
  });
}

// ── مساعد: يحوّل القيمة إلى مصفوفة دائماً ────────────────────
function _toArray(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val;
  // Firebase يخزّن المصفوفات كـ object أحياناً
  return Object.values(val);
}

// ── مساعد: تحويل users القديمة (مصفوفة) إلى object بـ uid ──────
// يُستخدم مرة واحدة عند أول تشغيل بعد الترقية
function _migrateUsersToObject(usersVal) {
  if (!usersVal) return {};
  const arr = Array.isArray(usersVal) ? usersVal : Object.values(usersVal);
  const obj = {};
  arr.forEach(u => {
    // استخدم email كـ uid مؤقت إذا لم يكن uid موجوداً (بيانات قديمة)
    const key = u.uid || ('local_' + u.email.replace(/[^a-zA-Z0-9]/g, '_'));
    obj[key] = { email: u.email, name: u.name, role: u.role };
  });
  return obj;
}

// ── مزامنة فورية عند عودة الاتصال (تُدار من _flushPendingSync) ──

// ===========================
// SETUP WIZARD
// ===========================
let currentStep = 1;
const totalSteps = 4;
let setupPumps = [];

function initSetupWizard() {
  renderStepIndicator();
  renderShiftNames();
  addPumpConfig();
  document.getElementById('setupOverlay').classList.add('open');
}

function renderStepIndicator() {
  const c = document.getElementById('stepIndicator');
  c.innerHTML = '';
  for (let i = 1; i <= totalSteps; i++) {
    c.innerHTML += `<div class="step-dot ${i <= currentStep ? 'active' : ''}"></div>`;
  }
}

function renderShiftNames() {
  const n = parseInt(document.getElementById('s_shiftsCount').value);
  const defaults = [['صباحية','ص'],['مسائية','م'],['بعد الظهر','ب'],['منتصف الليل','ل']];
  let html = '';
  for (let i = 0; i < n; i++) {
    html += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:6px;">
      <div class="form-group" style="margin:0">
        <label class="form-label">اسم الوردية ${i+1}</label>
        <input type="text" class="form-input" id="shiftName_${i}" value="${defaults[i][0]}" placeholder="صباحية">
      </div>
      <div class="form-group" style="margin:0">
        <label class="form-label">الاختصار</label>
        <input type="text" class="form-input" id="shiftAbbr_${i}" value="${defaults[i][1]}" placeholder="ص">
      </div>
    </div>`;
  }
  document.getElementById('shiftNamesContainer').innerHTML = html;
}

function addPumpConfig() {
  setupPumps.push({ name: `طلمبة ${setupPumps.length + 1}`, type: 'diesel', opening: 0 });
  renderPumpsConfig();
}

function removePump(i) {
  setupPumps.splice(i, 1);
  renderPumpsConfig();
}

function renderPumpsConfig() {
  const c = document.getElementById('pumpsContainer');
  c.innerHTML = setupPumps.map((p, i) => `
    <div class="pump-config-item">
      <div class="form-group" style="margin:0">
        <label class="form-label">الاسم</label>
        <input type="text" class="form-input" value="${p.name}" onchange="setupPumps[${i}].name=this.value" placeholder="طلمبة 1">
      </div>
      <div class="form-group" style="margin:0">
        <label class="form-label">النوع</label>
        <select class="form-select" onchange="setupPumps[${i}].type=this.value">
          <option value="diesel" ${p.type==='diesel'?'selected':''}>ديزل</option>
          <option value="91" ${p.type==='91'?'selected':''}>91</option>
          <option value="95" ${p.type==='95'?'selected':''}>95</option>
        </select>
      </div>
      <div class="form-group" style="margin:0">
        <label class="form-label">العداد الافتتاحي</label>
        <input type="number" class="form-input" value="${p.opening}" onchange="setupPumps[${i}].opening=parseFloat(this.value)||0" placeholder="0">
      </div>
      <button class="btn btn-ghost btn-sm" onclick="removePump(${i})" style="align-self:flex-end">🗑️</button>
    </div>
  `).join('');
}

function nextStep() {
  if (!validateStep(currentStep)) return;
  if (currentStep < totalSteps) {
    document.getElementById(`step${currentStep}`).classList.remove('active');
    currentStep++;
    document.getElementById(`step${currentStep}`).classList.add('active');
    renderStepIndicator();
    document.getElementById('prevStepBtn').style.display = 'inline-flex';
    if (currentStep === totalSteps) {
      document.getElementById('nextStepBtn').textContent = '✅ بدء العمل';
      document.getElementById('nextStepBtn').onclick = finishSetup;
    }
  }
}

function prevStep() {
  if (currentStep > 1) {
    document.getElementById(`step${currentStep}`).classList.remove('active');
    currentStep--;
    document.getElementById(`step${currentStep}`).classList.add('active');
    renderStepIndicator();
    document.getElementById('nextStepBtn').textContent = 'التالي ←';
    document.getElementById('nextStepBtn').onclick = nextStep;
    if (currentStep === 1) document.getElementById('prevStepBtn').style.display = 'none';
  }
}

function validateStep(step) {
  if (step === 1) {
    const name = document.getElementById('s_stationName').value.trim();
    const email = document.getElementById('s_ownerEmail').value.trim();
    const pass = document.getElementById('s_ownerPass').value;
    if (!name || !email || !pass) { alert('يرجى ملء جميع الحقول المطلوبة'); return false; }
  }
  if (step === 3 && setupPumps.length === 0) { alert('يرجى إضافة طلمبة واحدة على الأقل'); return false; }
  return true;
}

async function finishSetup() {
  const btn = document.getElementById('nextStepBtn');
  btn.disabled = true;
  btn.textContent = '⏳ جارٍ الإعداد...';

  const shiftsCount = parseInt(document.getElementById('s_shiftsCount').value);
  const shifts = [];
  for (let i = 0; i < shiftsCount; i++) {
    shifts.push({
      name: document.getElementById(`shiftName_${i}`).value || `وردية ${i+1}`,
      abbr: document.getElementById(`shiftAbbr_${i}`).value || (i+1).toString()
    });
  }

  const ownerEmail = document.getElementById('s_ownerEmail').value.trim().toLowerCase();
  const ownerPass  = document.getElementById('s_ownerPass').value;

  // 1) إنشاء حساب المالك — Firebase أولاً، وإن فشل يكمل محلياً
  try {
    await fbAuth.createUserWithEmailAndPassword(ownerEmail, ownerPass);
  } catch(err) {
    btn.disabled = false;
    btn.textContent = '✅ بدء العمل';
    if (err.code === 'auth/email-already-in-use') {
      try { await fbAuth.signInWithEmailAndPassword(ownerEmail, ownerPass); }
      catch(e) { /* نكمل بالوضع المحلي */ }
    } else if (err.code === 'auth/configuration-not-found' || err.code === 'auth/network-request-failed' || err.code === 'auth/internal-error') {
      // Firebase Auth غير مُفعّل — استخدم المصادقة المحلية
      console.warn('Firebase Auth غير متاح — وضع محلي:', err.code);
      _localAuthMode = true;
    } else {
      alert('⚠️ خطأ في إنشاء الحساب: ' + err.message); return;
    }
  }

  DB.config = {
    stationName: document.getElementById('s_stationName').value.trim(),
    stationLocation: document.getElementById('s_stationLocation').value.trim(),
    ownerEmail,
    monthStart: parseInt(document.getElementById('s_monthStart').value) || 1,
    prices: {
      diesel: parseFloat(document.getElementById('s_dieselPrice').value) || 0.69,
      n91: parseFloat(document.getElementById('s_91Price').value) || 1.29,
      n95: parseFloat(document.getElementById('s_95Price').value) || 1.79
    },
    shifts,
    shiftsPerDay: shiftsCount,
    minStock: parseInt(document.getElementById('s_minStock').value) || 5000,
    pumps: setupPumps.map((p, i) => ({ id: i, name: p.name, type: p.type, opening: p.opening })),
    openingStock: {
      diesel: parseFloat(document.getElementById('s_dieselStock').value) || 0,
      n91: parseFloat(document.getElementById('s_91Stock').value) || 0,
      n95: parseFloat(document.getElementById('s_95Stock').value) || 0
    },
    currentStock: {
      diesel: parseFloat(document.getElementById('s_dieselStock').value) || 0,
      n91: parseFloat(document.getElementById('s_91Stock').value) || 0,
      n95: parseFloat(document.getElementById('s_95Stock').value) || 0
    },
    _schemaVersion: SCHEMA_VERSION,
    _createdAt: Date.now()
  };

  // 2) حفظ المستخدم في DB بـ uid الحقيقي من Firebase Auth
  const ownerUid = fbAuth.currentUser?.uid || ('local_' + ownerEmail.replace(/[^a-zA-Z0-9]/g, '_'));
  DB.users = {};
  _addUserToDB(ownerUid, { email: ownerEmail, name: 'المالك', role: 'owner' });

  // إضافة صف المخزون الافتتاحي
  const today = new Date().toISOString().split('T')[0];
  DB.inventory.push({
    date: today, shiftType: '',
    diesel: DB.config.openingStock.diesel, n91: DB.config.openingStock.n91, n95: DB.config.openingStock.n95,
    consD: 0, cons91: 0, cons95: 0, dayD: 0, day91: 0, day95: 0, adjD: 0, adj91: 0, adj95: 0,
    type: 'opening'
  });

  // إضافة صف العدادات الافتتاحية
  DB.meters.push({
    id: 0, // ✅ معرّف خاص لـ opening meter (يبقى دائماً في الأسفل)
    date: today,
    shiftType: '',
    type: 'opening',
    pumps: DB.config.pumps.map(p => ({ pumpId: p.id, reading: p.opening || 0, consumption: 0 }))
  });

  await saveDB();
  if (_localAuthMode) {
    localStorage.setItem('_localAuthMode', '1');
    // في الوضع المحلي: احفظ بيانات الجلسة وافتح التطبيق مباشرة
    localStorage.setItem('_localSession', JSON.stringify({ email: ownerEmail }));
    document.getElementById('setupOverlay').classList.remove('open');
    currentUser = _findUserByEmail(ownerEmail) || _usersArray()[0];
    _openMainApp();
  } else {
    document.getElementById('setupOverlay').classList.remove('open');
    // onAuthStateChanged سيفتح التطبيق تلقائياً
  }
}

// ═══════════════════════════════════════════════════════════════
// AUTH — Firebase Authentication + Role system
// ═══════════════════════════════════════════════════════════════
let currentUser = null;

function showLoginScreen() {
  document.getElementById('stationNameLogin').textContent = DB.config?.stationName || 'محطة الوقود';
  document.getElementById('loginOverlay').classList.add('open');
}

// ── تسجيل الدخول ─────────────────────────────────────────────
async function doLogin() {
  console.log('🔐 [doLogin] بدأ تنفيذ دالة تسجيل الدخول');
  const email = document.getElementById('loginEmail').value.trim().toLowerCase();
  const pass  = document.getElementById('loginPassword').value;
  const errEl = document.getElementById('loginError');
  const btn   = document.querySelector('#loginOverlay .btn-primary');

  console.log('🔐 [doLogin] البريد:', email, '| btn موجود:', !!btn, '| errEl موجود:', !!errEl);

  if (!email || !pass) { errEl.textContent = 'يرجى إدخال البريد وكلمة المرور'; errEl.style.display = 'flex'; return; }

  // تحقق من Rate Limiting قبل محاولة الدخول
  const rateCheck = _checkLoginRateLimit();
  if (!rateCheck.allowed) {
    errEl.textContent = rateCheck.message;
    errEl.style.display = 'flex';
    return;
  }

  btn.disabled = true;
  btn.textContent = '⏳ جارٍ الدخول...';
  errEl.style.display = 'none';

  // وضع المصادقة المحلية (Firebase Auth غير متاح)
  if (_localAuthMode) {
    const userRecord = _findUserByEmail(email);
    if (!userRecord) {
      _recordFailedLogin();
      btn.disabled = false; btn.textContent = '🔐 دخول';
      errEl.textContent = 'البريد الإلكتروني غير مسجل'; errEl.style.display = 'flex'; return;
    }
    // التحقق من كلمة المرور (مخزنة كـ hash)
    const storedHash = localStorage.getItem('_pwd_' + email);
    const inputHash = await _hashPass(pass);
    if (storedHash && storedHash !== inputHash) {
      _recordFailedLogin();
      btn.disabled = false; btn.textContent = '🔐 دخول';
      errEl.textContent = 'كلمة المرور غير صحيحة'; errEl.style.display = 'flex'; return;
    }
    if (!storedHash) localStorage.setItem('_pwd_' + email, inputHash);
    _clearLoginAttempts();
    localStorage.setItem('_localSession', JSON.stringify({ email }));
    currentUser = userRecord;
    _openMainApp();
    return;
  }

  try {
    // 1) تسجيل الدخول عبر Firebase Auth
    console.log('🔐 [doLogin] جارٍ الاتصال بـ Firebase Auth... fbAuth:', typeof fbAuth);
    // ✅ [FIX v14] مهلة 12 ثانية — يُعيد الزر لحالته ولا يتجمد على شبكات بطيئة
    const loginTimeout = new Promise((_, rej) =>
      setTimeout(() => rej({ code: 'auth/network-request-failed', message: 'انتهت مهلة الاتصال' }), 12000)
    );
    await Promise.race([ fbAuth.signInWithEmailAndPassword(email, pass), loginTimeout ]);
    // onAuthStateChanged سيكمل الباقي تلقائياً — سجّل نجاح الدخول
    console.log('✅ [doLogin] نجح signInWithEmailAndPassword — في انتظار onAuthStateChanged');
    _clearLoginAttempts();

  } catch(err) {
    btn.disabled = false;
    btn.textContent = '🔐 دخول';
    // إذا فشل Firebase Auth بسبب التهيئة — جرّب المحلي
    if (err.code === 'auth/configuration-not-found' || err.code === 'auth/network-request-failed') {
      _localAuthMode = true;
      localStorage.setItem('_localAuthMode', '1');
      await doLogin(); return;
    }
    // سجّل المحاولة الفاشلة للـ rate limiting
    if (err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential' || err.code === 'auth/user-not-found') {
      _recordFailedLogin();
    }
    const msgs = {
      'auth/user-not-found':    'البريد الإلكتروني غير مسجل',
      'auth/wrong-password':    'كلمة المرور غير صحيحة',
      'auth/invalid-credential':'بيانات الدخول غير صحيحة',
      'auth/too-many-requests': 'محاولات كثيرة — حاول بعد قليل',
      'auth/network-request-failed': 'تحقق من اتصال الإنترنت'
    };
    errEl.textContent = msgs[err.code] || 'خطأ: ' + err.message;
    errEl.style.display = 'flex';
  }
}

// ── مراقب حالة Auth — يعمل تلقائياً عند كل تغيير ────────────
// ✅ [FIX v9] Guard لمنع تسجيل المستمع أكثر من مرة
let _authListenerRegistered = false;
if (!_authListenerRegistered) {
  _authListenerRegistered = true;
fbAuth.onAuthStateChanged(async (firebaseUser) => {
  console.log('🔄 [onAuthStateChanged] fired — firebaseUser:', firebaseUser ? firebaseUser.email : 'null', '| _localAuthMode:', _localAuthMode);
  if (_localAuthMode) {
    const session = localStorage.getItem('_localSession');
    if (session) {
      try {
        const { email } = JSON.parse(session);
        const userRecord = _findUserByEmail(email);
        if (userRecord) { currentUser = userRecord; _openMainApp(); return; }
      } catch(e) {}
    }
    currentUser = null;
    if (DB.config) showLoginScreen();
    return;
  }

  if (firebaseUser) {
    // مستخدم مسجّل — ابحث عن دوره بالـ uid أولاً، ثم بالإيميل كـ fallback
    let userRecord = _findUserByUid(firebaseUser.uid) || _findUserByEmail(firebaseUser.email);
    if (!userRecord) {
      // هذا البريد في Firebase Auth لكن ليس في DB — اطرده
      await fbAuth.signOut();
      return;
    }
    // إذا وجدناه بالإيميل ولم يكن uid محفوظاً — أضف uid الحقيقي وحدّث
    if (!DB.users[firebaseUser.uid]) {
      const oldKey = Object.keys(DB.users).find(k => DB.users[k].email === firebaseUser.email);
      if (oldKey && oldKey !== firebaseUser.uid) {
        DB.users[firebaseUser.uid] = DB.users[oldKey];
        delete DB.users[oldKey];
        saveDB(); // احفظ التحديث
      }
    }
    currentUser = { ...(DB.users[firebaseUser.uid] || {}), uid: firebaseUser.uid };
    console.log('✅ [onAuthStateChanged] currentUser جاهز:', currentUser?.email, '— جارٍ فتح التطبيق...');
    _openMainApp();
  } else {
    // لا يوجد مستخدم — أظهر شاشة الدخول
    currentUser = null;
    if (DB.config) showLoginScreen();
  }
});
} // end authListenerRegistered guard

// ── فتح التطبيق بعد تسجيل الدخول ────────────────────────────
