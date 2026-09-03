function _openMainApp() {
  console.log('🚀 [_openMainApp] بدأ فتح التطبيق — currentUser:', currentUser?.email, 'role:', currentUser?.role);
  document.getElementById('loginOverlay').classList.remove('open');
  document.getElementById('mainHeader').style.display = 'flex';
  document.getElementById('shiftTimerBar').style.display = 'flex';
  document.getElementById('mainNav').style.display = 'flex';

  const role = currentUser.role;
  // [FIX v10] نظام صلاحيات موسّع: owner | manager | supervisor | employee
  const roleLabels = {
    owner:      '👑 مالك',
    manager:    '📋 مدير',
    supervisor: '🔍 مشرف',
    employee:   '👤 موظف',
    cashier:    '🧾 كاشير'
  };

  // مصفوفة الصلاحيات الموحّدة
  const CAN = {
    settings:    role === 'owner',
    dashboard:   role === 'owner' || role === 'manager',
    activityLog: role === 'owner' || role === 'manager' || role === 'supervisor',
    backup:      role === 'owner',
    supply:      role === 'owner' || role === 'manager' || role === 'supervisor',
    inventory:   role === 'owner' || role === 'manager' || role === 'supervisor',
    editShift:   role === 'owner' || role === 'manager',
    deleteShift: role === 'owner',
    deleteMeters:role === 'owner',
    export:      role === 'owner' || role === 'manager',
    reports:     role !== 'cashier' && role !== 'employee'
  };
  // حفظ الصلاحيات للاستخدام في أي مكان
  window._userPermissions = CAN;

  // تطبيق الصلاحيات على أزرار التنقل
  document.getElementById('settingsNavBtn').style.display  = CAN.settings    ? 'inline-flex' : 'none';
  document.getElementById('dashboardNavBtn').style.display = CAN.dashboard   ? 'inline-flex' : 'none';
  document.getElementById('activityNavBtn').style.display  = CAN.activityLog ? 'inline-flex' : 'none';
  document.getElementById('backupNavBtn').style.display    = CAN.backup      ? 'inline-flex' : 'none';
  // [v13] إظهار زر سجل الجرد للمالك والمدير والمشرف
  const auditLogNavBtn = document.getElementById('auditLogNavBtn');
  if (auditLogNavBtn) auditLogNavBtn.style.display = (CAN.dashboard || CAN.activityLog) ? 'inline-flex' : 'none';
  const supplyBtn = document.querySelector('.nav-btn[onclick*="supply"]');
  if (supplyBtn) supplyBtn.style.display = CAN.supply    ? 'flex' : 'none';
  const invBtn = document.querySelector('.nav-btn[onclick*="inventory"]');
  if (invBtn) invBtn.style.display    = CAN.inventory  ? 'flex' : 'none';
  const editLastBtn = document.getElementById('editLastShiftBtn');
  if (editLastBtn) editLastBtn.style.display = CAN.editShift   ? 'inline-flex' : 'none';
  const deleteMeterBtn = document.getElementById('deleteMeterBtn');
  if (deleteMeterBtn) deleteMeterBtn.style.display = CAN.deleteMeters ? 'inline-flex' : 'none';

  document.getElementById('headerStationName').textContent = DB.config.stationName;
  document.getElementById('headerUser').textContent = (currentUser.name||'') + ' ' + (roleLabels[role]||'👤');
  if (!DB.config._retroMigrationV1) runRetroactiveMigration();
  // ✅ [AE v1] تشغيل المحرك الموحد عند فتح التطبيق لضمان صحة جميع الحسابات
  if (window.AccountingEngine && DB.shifts && DB.shifts.length > 0) {
    setTimeout(() => {
      try { AccountingEngine.rebuild({ silent: true }); } catch(e) {}
    }, 500);
  }
  initApp();
  _startDateRefresh();
  _initShiftTimerFromStorage();
  _initSessionWatcher();

  setTimeout(() => {
    document.dispatchEvent(new CustomEvent('userLoggedIn', { detail: { user: currentUser } }));
  }, 300);

  setTimeout(() => logActivity('login', `تسجيل دخول — ${navigator.userAgent.includes('Mobile')?'📱 هاتف':'🖥️ كمبيوتر'}`), 500);

  // إذا كان هناك بيانات offline معلّقة — أشعر المستخدم
  // ✅ [إصلاح]: فحص آمن لتجنب ReferenceError قبل تحميل counters-handler.js
  if (typeof _hasPendingSync !== 'undefined' && _hasPendingSync) {
    setTimeout(() => {
      const banner = document.createElement('div');
      banner.style.cssText = `
        position:fixed;bottom:70px;left:12px;right:12px;z-index:9999;
        background:#7D5C00;color:white;border-radius:12px;padding:12px 16px;
        display:flex;align-items:center;gap:10px;
        box-shadow:0 4px 20px rgba(0,0,0,0.4);font-family:Cairo,sans-serif;font-size:13px;
      `;
      banner.innerHTML = `
        <span style="font-size:20px">📦</span>
        <div>
          <div style="font-weight:800">بيانات غير مرفوعة</div>
          <div style="font-size:11px;opacity:0.9">يوجد بيانات تم إدخالها أثناء انقطاع الاتصال — ${_isOnline ? 'جارٍ رفعها الآن...' : 'ستُرفع عند عودة الاتصال'}</div>
        </div>
      `;
      document.body.appendChild(banner);
      if (_isOnline) _flushPendingSync();
      setTimeout(() => banner?.remove(), 7000);
    }, 1500);
  }
}

// ── تسجيل الخروج ─────────────────────────────────────────────
async function logout() {
  // [FIX v10] تنظيف جميع الـ timers والـ intervals عند تسجيل الخروج
  if (_dateRefreshInterval) { clearInterval(_dateRefreshInterval); _dateRefreshInterval = null; }
  if (_shiftTimerInterval)  { clearInterval(_shiftTimerInterval);  _shiftTimerInterval  = null; }
  if (_saveTimer)           { clearTimeout(_saveTimer);            _saveTimer           = null; }
  if (_syncRetryTimer)      { clearTimeout(_syncRetryTimer);       _syncRetryTimer      = null; }

  logActivity('logout', 'تسجيل خروج');

  try {
    if (_localAuthMode) {
      localStorage.removeItem('_localSession');
    } else {
      await fbAuth.signOut();
    }
  } catch(e) {
    console.warn('[logout] signOut error:', e);
  }

  // [FIX v16] لا نحذف بيانات المحطة (DB) نفسها — فقط الحالة الجلسية/المؤقتة
  // التي قد تُبقي واجهة حساب سابق عالقة عند دخول مستخدم آخر بجهاز/متصفح مشترك.
  currentUser = null;
  _clearDraft();

  // [FIX v16] إعادة تحميل كاملة للتطبيق بدل تحديث الواجهة يدوياً —
  // يمنع بقاء شاشة بيضاء أو حالة قديمة عالقة عند تسجيل الدخول بحساب مختلف.
  window.location.reload();
}

// ===========================
// APP INIT
// ===========================

// ═══════════════════════════════════════════════════════════════
// [v13] recalculateAndRenderDashboard — دالة مستقلة idempotent
// تُشغَّل في أقرب وقت بعد تحميل البيانات، مستقلة عن أي حدث تنقل
// تُعيد بناء الصفحة الرئيسية كاملة دون أي ارتباط بالتقويم
// ═══════════════════════════════════════════════════════════════
function recalculateAndRenderDashboard() {
  if (!DB.config || !currentUser) return;
  try {
    updateHomePage();
    updateSinceAuditWidget();
  } catch(e) { console.warn('[recalc]', e); }
}

// دالة تحافظ على التوافق مع الاستدعاءات القديمة
function initDashboard() {
  recalculateAndRenderDashboard();
}

function initApp() {
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('todayDate').textContent = formatDate(today);
  document.getElementById('headerDate').textContent = formatDateShort(today);

  // عرض التاريخ الهجري في الهيدر
  try {
    const hijriNow = new Date().toLocaleDateString('ar-SA-u-ca-islamic', { year:'numeric', month:'short', day:'numeric' });
    const hijriEl = document.getElementById('headerHijriDate');
    if (hijriEl) hijriEl.textContent = '| ' + hijriNow;
  } catch(e) {}

  // ✅ FIX #4: إلغاء الملء التلقائي للتاريخ — يجب أن يختاره العامل يدوياً
  document.getElementById('entry_date').value = ''; // حقل فارغ إجبارياً
  document.getElementById('sup_date').value = today;

  // [v16] إصلاح تلقائي صامت لأي جرد قديم ناقص من السجل/المخزون — قبل أي عرض
  // لا يتطلب صلاحية مالك (بخلاف الزر اليدوي) لأنه إصلاح دفاعي غير هدّام
  _autoFixLegacyAudits();

  // [v13 FIX] استدعاء مستقل idempotent لتحميل الداشبورد قبل أي تأخير
  recalculateAndRenderDashboard();

  // Populate shift selects
  populateShiftSelects();
  renderEntryPumps();
  renderInstantPumps();
  updateHomePage();
  renderMetersTable();
  renderLog();
  renderInventoryTable();
  renderSupplyLog();
  renderSettingsPage();
  updateEntryDateDisplay();

  // Enable copyable
  enableCopyable();
  // نسخة احتياطية يومية تلقائية
  _autoBackup();

  // [v16] تفعيل الحفظ التلقائي المؤقت للوردية + استرجاع أي مسودة سابقة لم تُحفظ
  _initDraftAutosave();
  _restoreDraftIfAny();
}

function updateEntryDateDisplay() {
  const d = document.getElementById('entry_date').value;
  const el = document.getElementById('entryDateDisplay');
  if (!d) { el.style.display = 'none'; return; }
  const info = formatDateFull(d);
  el.style.display = 'block';
  el.innerHTML = `<span style="font-weight:800;color:var(--red-dark)">${info.dayName}</span>
    &nbsp;|&nbsp; <span style="font-weight:700">${info.gregorian}</span>
    <br><span style="color:var(--gold-dark);font-weight:700">🌙 ${info.hijri}</span>`;
}

function populateShiftSelects() {
  const shifts = DB.config.shifts;
  const selects = ['entry_shiftType', 'rep_fromShift', 'rep_toShift'];
  selects.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    if (id === 'entry_shiftType') {
      // ✅ FIX #4: خيار فارغ إجباري — يمنع أي قيمة افتراضية
      el.innerHTML = `<option value="">-- اختر الوردية --</option>` +
        shifts.map(s => `<option value="${s.abbr}">${s.name}</option>`).join('');
    } else {
      el.innerHTML = shifts.map(s => `<option value="${s.abbr}">${s.name}</option>`).join('');
    }
  });
}

// ===========================
// HOME PAGE
// ===========================
// ═══════════════════════════════════════════════════════════════
// getLast24hShifts — جلب آخر X ورديات مسجلة (FIFO بأثر رجعي)
// X = عدد الورديات اليومية المحددة في الإعدادات
// لا يعتمد على التاريخ التقويمي — يعتمد على الترتيب الزمني فقط
// ═══════════════════════════════════════════════════════════════
function getLast24hShifts() {
  const shiftsPerDay = parseInt(DB.config?.shiftsPerDay || DB.config?.shifts?.length || 2);
  // [v15.1] استبعاد الجردات — هي ليست ورديات يومية
  const sorted = [...DB.shifts].filter(s => s.type !== 'audit').sort((a, b) => (b.id || 0) - (a.id || 0));
  return sorted.slice(0, shiftsPerDay);
}

function updateHomePage() {
  const cfg = DB.config;

  // ── آخر X ورديات = مكافئ 24 ساعة (FIFO) ──────────────────
  const last24Shifts = getLast24hShifts();
  const todayD   = last24Shifts.reduce((a, s) => a + (s.diesel || 0), 0);
  const today91  = last24Shifts.reduce((a, s) => a + (s.n91    || 0), 0);
  const today95  = last24Shifts.reduce((a, s) => a + (s.n95    || 0), 0);
  const todayMoney = todayD * cfg.prices.diesel + today91 * cfg.prices.n91 + today95 * cfg.prices.n95;

  // ── تحديث العناصر المخفية (legacy) ────────────────────────
  const _set = (id, val) => { const el = document.getElementById(id); if (el) el.innerHTML = val; };
  // ✅ [FIX v9] عرض تاريخ آخر وردية فعلية في قاعدة البيانات (ليس تاريخ الجهاز)
  const lastShiftDate_h = last24Shifts.length > 0 ? last24Shifts[0].date : null;
  const lastShiftName_h = last24Shifts.length > 0 ?
    (cfg.shifts.find(s => s.abbr === last24Shifts[0].shiftType)?.name || last24Shifts[0].shiftType) : null;
  // تحديث عنوان اليوم في الصفحة الرئيسية
  const todayDateEl = document.getElementById('todayDate');
  if (todayDateEl) {
    if (lastShiftDate_h) {
      todayDateEl.innerHTML = `آخر وردية: <span style="color:var(--gold-dark)">${formatDateShort(lastShiftDate_h)}</span>${lastShiftName_h ? ' — ' + lastShiftName_h : ''}`;
    } else {
      todayDateEl.textContent = 'لم تُسجَّل ورديات بعد';
    }
  }
  _set('home_todayDiesel',    fmt(todayD)   + ' لتر<span class="copy-hint">نسخ</span>');
  _set('home_todayDieselRial', fmt(todayD * cfg.prices.diesel, 2)  + ' ر.س');
  _set('home_today91',        fmt(today91)  + ' لتر<span class="copy-hint">نسخ</span>');
  _set('home_today91Rial',    fmt(today91 * cfg.prices.n91, 2)     + ' ر.س');
  _set('home_today95',        fmt(today95)  + ' لتر<span class="copy-hint">نسخ</span>');
  _set('home_today95Rial',    fmt(today95 * cfg.prices.n95, 2)     + ' ر.س');
  _set('home_todayTotal',     fmt(todayD + today91 + today95)      + ' لتر<span class="copy-hint">نسخ</span>');
  _set('home_todayMoney',     fmt(todayMoney, 2)                   + ' ر.س<span class="copy-hint">نسخ</span>');

  // ── تحديث بطاقات العداد اليومي (data-counter) ──────────────
  // [FIX v11] ألوان محسّنة تعمل في كلا الوضعين (فاتح/داكن) + نصوص أكبر
  const isDark = document.body.classList.contains('dark-mode');
  const counterCards = {
    diesel: {
      label: 'ديزل',
      val: todayD,
      price: cfg.prices.diesel,
      lightColor:  '#6B4C00',
      darkColor:   '#FFD966',
      lightBorder: '#D4AC0D',
      darkBorder:  '#FFD966',
      lightBg:     'rgba(212,172,13,0.10)',
      darkBg:      'rgba(255,200,0,0.12)',
      icon: '⬛',
      lightMoney:  '#7D5C00',
      darkMoney:   '#FFD966'
    },
    fuel91: {
      label: 'بنزين 91',
      val: today91,
      price: cfg.prices.n91,
      lightColor:  '#145A32',
      darkColor:   '#52D68A',
      lightBorder: '#1E8449',
      darkBorder:  '#52D68A',
      lightBg:     'rgba(30,132,73,0.10)',
      darkBg:      'rgba(39,174,96,0.14)',
      icon: '🟢',
      lightMoney:  '#1A6B3C',
      darkMoney:   '#52D68A'
    },
    fuel95: {
      label: 'بنزين 95',
      val: today95,
      price: cfg.prices.n95,
      lightColor:  '#922B21',
      darkColor:   '#FF6B6B',
      lightBorder: '#C0392B',
      darkBorder:  '#FF6B6B',
      lightBg:     'rgba(192,57,43,0.10)',
      darkBg:      'rgba(231,76,60,0.14)',
      icon: '🔴',
      lightMoney:  '#A93226',
      darkMoney:   '#FF8080'
    }
  };
  Object.entries(counterCards).forEach(([key, c]) => {
    const el = document.querySelector(`[data-counter="${key}"]`);
    if (!el) return;
    const color  = isDark ? c.darkColor  : c.lightColor;
    const border = isDark ? c.darkBorder : c.lightBorder;
    const bg     = isDark ? c.darkBg     : c.lightBg;
    const money  = isDark ? c.darkMoney  : c.lightMoney;
    el.style.borderTop  = `3px solid ${border}`;
    el.style.cssText += `;background:${bg}`;
    el.innerHTML = `
      <div class="dc-label" style="font-size:11px;font-weight:800;color:${color};margin-bottom:4px;letter-spacing:0.3px">${c.icon} ${c.label}</div>
      <div class="dc-value" style="font-size:26px;font-weight:900;color:${color};line-height:1.1;margin:4px 0 2px;font-family:'Cairo',sans-serif">${fmt(c.val)}</div>
      <div class="dc-unit" style="font-size:11px;font-weight:600;color:${isDark?'#9090B0':'#888888'};margin-bottom:6px">لتر</div>
      <div class="dc-money" style="font-size:12px;font-weight:800;color:${money};background:${isDark?'rgba(255,255,255,0.08)':'rgba(0,0,0,0.05)'};border-radius:6px;padding:3px 6px;display:inline-block">${fmt(c.val * c.price, 2)} ر.س</div>`;
  });

  // ── آخر وردية مسجلة ────────────────────────────────────────
  const last = [...DB.shifts].sort((a, b) => (b.id || 0) - (a.id || 0))[0];
  if (last) {
    const shiftName = cfg.shifts.find(s => s.abbr === last.shiftType)?.name || last.shiftType;
    _set('home_lastShiftType', shiftName);
    _set('home_lastDiesel',    fmt(last.diesel));
    _set('home_lastDieselR',   fmt((last.diesel || 0) * cfg.prices.diesel, 2) + ' ر.س');
    _set('home_last91',        fmt(last.n91));
    _set('home_last91R',       fmt((last.n91    || 0) * cfg.prices.n91,    2) + ' ر.س');
    _set('home_last95',        fmt(last.n95));
    _set('home_last95R',       fmt((last.n95    || 0) * cfg.prices.n95,    2) + ' ر.س');
  }

  // ── المخزون والتنبيهات ──────────────────────────────────────
  const stock    = cfg.currentStock;
  const minStock = cfg.minStock || 5000;
  const avg      = getAvgConsumption(10);
  let alertsHtml = '';

  const openingStockCap = cfg.openingStock || {};
  const invHtml = ['diesel','n91','n95'].map(type => {
    const labels    = { diesel:'ديزل', n91:'بنزين 91', n95:'بنزين 95' };
    const icons     = { diesel:'⬛',  n91:'🟢', n95:'🔴' };
    const val       = Math.max(0, stock[type] || 0);
    const capacity  = Math.max(openingStockCap[type] || 0, val, minStock * 4);
    const pct       = capacity > 0 ? Math.min(100, Math.round((val / capacity) * 100)) : 0;
    const avgVal    = avg[type] || 0;
    const daysLeft  = avgVal > 0 ? (val / avgVal) : null;
    // [FIX v10] ألوان أوضح حسب مستوى المخزون
    const color = pct > 50
      ? (type === 'diesel' ? '#7D5C00' : type === 'n91' ? '#145A32' : '#922B21')
      : pct > 25 ? '#E67E22' : '#C0392B';
    const barColor = pct > 50 ? (type === 'diesel' ? '#D4AC0D' : type === 'n91' ? '#27AE60' : '#C0392B') : pct > 25 ? '#F39C12' : '#E74C3C';
    const daysText = daysLeft !== null
      ? (daysLeft < 1 ? `<span style="color:#C0392B;font-weight:900">أقل من يوم!</span>`
        : `${daysLeft.toFixed(1)} يوم`)
      : '∞';
    const avgText = avgVal > 0 ? `متوسط ${fmt(avgVal)} ل/يوم` : 'لا يوجد بيانات';
    const lowAlert = pct <= 25 ? `<div style="font-size:10px;font-weight:800;color:#C0392B;margin-top:2px;background:rgba(192,57,43,0.1);border-radius:4px;padding:2px 4px">⚠️ تحذير</div>` : '';

    return `<div class="stat-box ${type}" style="padding:10px">
      <div class="stat-label" style="font-size:12px;font-weight:800;color:${color}">${icons[type]} ${labels[type]}</div>
      <div class="stat-value" style="font-size:18px;font-weight:900;color:${color}">${fmt(val)}<span style="font-size:10px;font-weight:600;margin-right:2px">لتر</span></div>
      <div style="margin:5px 0 2px"><div class="progress-bar-wrap"><div class="progress-bar" style="width:${pct}%;background:${barColor}"></div></div></div>
      <div style="font-size:10px;color:var(--gray-700);font-weight:600">${pct}%</div>
      <div style="font-size:10px;color:${color};font-weight:700;margin-top:3px">⏱ ${daysText}</div>
      <div style="font-size:9.5px;color:var(--gray-500);margin-top:1px">${avgText}</div>
      ${lowAlert}
    </div>`;
  }).join('');

  if (last24Shifts.length === 0) alertsHtml = `<div class="alert alert-warning">📋 لم تُسجَّل أي ورديات بعد</div>` + alertsHtml;

  // تنبيهات المخزون المنخفض
  const openingStockHome = cfg.openingStock || {};
  ['diesel','n91','n95'].forEach(type => {
    const labels = { diesel:'ديزل', n91:'بنزين 91', n95:'بنزين 95' };
    const stockVal = cfg.currentStock[type] || 0;
    const capacity = Math.max(openingStockHome[type] || 0, stockVal, (cfg.minStock || 5000) * 4);
    const pct = capacity > 0 ? Math.round((stockVal / capacity) * 100) : 0;
    if (pct <= 25 && stockVal >= 0) {
      alertsHtml = `<div class="alert alert-danger">⚠️ مخزون منخفض: ${labels[type]} ${pct}% فقط (${fmt(stockVal)} لتر)</div>` + alertsHtml;
    }
    const v = type === 'diesel' ? todayD : type === 'n91' ? today91 : today95;
    if (avg[type] > 0 && v > avg[type] * 1.5)
      alertsHtml += `<div class="alert alert-info">📈 استهلاك ${labels[type]} مرتفع (${fmt(v)} لتر مقابل معدل ${fmt(avg[type])} لتر)</div>`;
  });

  const alertEl = document.getElementById('homeAlerts');
  const invEl   = document.getElementById('inventoryStatusHome');
  if (alertEl) alertEl.innerHTML = alertsHtml;
  if (invEl)   invEl.innerHTML   = invHtml;

  // ── [v11] لوحة مقارنة اليوم / أمس ─────────────────────────
  try {
    const compEl = document.getElementById('homeDayComparison');
    if (compEl) {
      const shiftsPerDay = parseInt(cfg.shiftsPerDay || cfg.shifts?.length || 2);
      const allSorted = [...DB.shifts].sort((a,b) => (b.id||0)-(a.id||0));
      const yesterdayShifts = allSorted.slice(shiftsPerDay, shiftsPerDay * 2);
      const ystD   = yesterdayShifts.reduce((a,s) => a + (s.diesel||0), 0);
      const yst91  = yesterdayShifts.reduce((a,s) => a + (s.n91||0), 0);
      const yst95  = yesterdayShifts.reduce((a,s) => a + (s.n95||0), 0);
      const todayTotalMoney2 = todayD*cfg.prices.diesel + today91*cfg.prices.n91 + today95*cfg.prices.n95;
      const ystTotalMoney    = ystD*cfg.prices.diesel   + yst91*cfg.prices.n91   + yst95*cfg.prices.n95;
      const pctChange = ystTotalMoney > 0 ? ((todayTotalMoney2 - ystTotalMoney) / ystTotalMoney * 100) : 0;
      const isDarkComp = document.body.classList.contains('dark-mode');
      const pctColor = pctChange >= 0 ? '#27AE60' : '#E74C3C';
      const pctIcon  = pctChange >= 0 ? '📈' : '📉';
      const pctSign  = pctChange >= 0 ? '+' : '';
      compEl.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
          <div style="flex:1;min-width:100px;text-align:center;padding:10px;background:${isDarkComp?'rgba(255,255,255,0.06)':'rgba(0,0,0,0.03)'};border-radius:10px">
            <div style="font-size:10px;font-weight:700;color:${isDarkComp?'#AAA':'#888'};margin-bottom:4px">اليوم</div>
            <div style="font-size:20px;font-weight:900;color:${isDarkComp?'#FFF':'#1a1a1a'}">${fmt(todayTotalMoney2,0)}</div>
            <div style="font-size:10px;color:${isDarkComp?'#CCC':'#666'}">ر.س</div>
          </div>
          <div style="flex:0 0 auto;text-align:center;padding:8px 12px;background:${pctColor}22;border-radius:10px;border:1px solid ${pctColor}44">
            <div style="font-size:16px">${pctIcon}</div>
            <div style="font-size:16px;font-weight:900;color:${pctColor}">${pctSign}${pctChange.toFixed(1)}%</div>
          </div>
          <div style="flex:1;min-width:100px;text-align:center;padding:10px;background:${isDarkComp?'rgba(255,255,255,0.04)':'rgba(0,0,0,0.02)'};border-radius:10px">
            <div style="font-size:10px;font-weight:700;color:${isDarkComp?'#AAA':'#888'};margin-bottom:4px">أمس</div>
            <div style="font-size:20px;font-weight:900;color:${isDarkComp?'#CCC':'#555'}">${fmt(ystTotalMoney,0)}</div>
            <div style="font-size:10px;color:${isDarkComp?'#AAA':'#666'}">ر.س</div>
          </div>
        </div>`;
    }
  } catch(e) {}

  // ── [v11] لوحة حالة المالك السريعة ────────────────────────
  try {
    const ownerEl = document.getElementById('homeOwnerPanel');
    if (ownerEl && currentUser?.role === 'owner') {
      const isDarkOwner = document.body.classList.contains('dark-mode');
      const syncOk = navigator.onLine;
      const lastSyncMs = DB._savedAt || 0;
      const lastSyncStr = lastSyncMs
        ? new Date(lastSyncMs).toLocaleTimeString('ar-SA',{hour:'2-digit',minute:'2-digit'})
        : '—';
      const openShift = DB.shifts?.find(s => !s.closed);
      const todayShiftsCount = last24Shifts.length;
      const totalLiters = todayD + today91 + today95;
      const bg = isDarkOwner ? '#1E1E2E' : '#F8F9FD';
      const border = isDarkOwner ? '#3A3A5C' : '#E0E0F0';
      ownerEl.style.display = 'block';
      ownerEl.innerHTML = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <div style="background:${isDarkOwner?'rgba(39,174,96,0.15)':'rgba(39,174,96,0.08)'};border:1px solid ${isDarkOwner?'#27AE6066':'#C8F0D8'};border-radius:8px;padding:8px;text-align:center">
            <div style="font-size:10px;color:${isDarkOwner?'#8F8':'#1E8449'};font-weight:700">💰 مبيعات اليوم</div>
            <div style="font-size:16px;font-weight:900;color:${isDarkOwner?'#5EF09A':'#145A32'}">${fmt(todayMoney,0)} ر.س</div>
          </div>
          <div style="background:${isDarkOwner?'rgba(52,152,219,0.15)':'rgba(52,152,219,0.08)'};border:1px solid ${isDarkOwner?'#3498DB66':'#BEE3F8'};border-radius:8px;padding:8px;text-align:center">
            <div style="font-size:10px;color:${isDarkOwner?'#7EC8E3':'#2980B9'};font-weight:700">⛽ إجمالي اللترات</div>
            <div style="font-size:16px;font-weight:900;color:${isDarkOwner?'#7EC8E3':'#1A6080'}">${fmt(totalLiters)} ل</div>
          </div>
          <div style="background:${isDarkOwner?'rgba(255,255,255,0.05)':'rgba(0,0,0,0.03)'};border:1px solid ${isDarkOwner?'#444':'#E8E8E8'};border-radius:8px;padding:8px;text-align:center">
            <div style="font-size:10px;color:${isDarkOwner?'#AAA':'#888'};font-weight:700">📋 ورديات اليوم</div>
            <div style="font-size:16px;font-weight:900;color:${isDarkOwner?'#FFF':'#333'}">${todayShiftsCount}</div>
          </div>
          <div style="background:${syncOk?isDarkOwner?'rgba(39,174,96,0.10)':'rgba(39,174,96,0.06)':isDarkOwner?'rgba(231,76,60,0.15)':'rgba(231,76,60,0.08)'};border:1px solid ${syncOk?isDarkOwner?'#27AE6055':'#C8F0D8':isDarkOwner?'#E74C3C66':'#FCC'};border-radius:8px;padding:8px;text-align:center">
            <div style="font-size:10px;color:${syncOk?isDarkOwner?'#8F8':'#1E8449':isDarkOwner?'#F88':'#C0392B'};font-weight:700">${syncOk?'✅ متصل':'❌ غير متصل'}</div>
            <div style="font-size:11px;color:${isDarkOwner?'#AAA':'#888'}">آخر مزامنة: ${lastSyncStr}</div>
          </div>
        </div>
        ${openShift ? `<div style="margin-top:8px;background:rgba(230,126,34,0.15);border:1px solid rgba(230,126,34,0.4);border-radius:8px;padding:8px;font-size:11px;color:#E67E22;font-weight:700;text-align:center">⚠️ يوجد وردية مفتوحة غير مغلقة</div>` : ''}`;
    }
  } catch(e) {}

  setTimeout(renderCharts, 300);

  // ── أسبوعي وشهري ───────────────────────────────────────────
  const w7    = getConsumptionRange(7);
  const mRange = getMonthRange();
  // ✅ [FIX v9] بيانات آخر 7 أيام عمل فعلية
  _set('home_weekDiesel',  fmt(w7.diesel));
  _set('home_week91',      fmt(w7.n91));
  _set('home_week95',      fmt(w7.n95));
  _set('home_weekMoney',   fmt(w7.diesel*cfg.prices.diesel + w7.n91*cfg.prices.n91 + w7.n95*cfg.prices.n95, 2) + ' ر.س');
  _set('home_monthDiesel', fmt(mRange.diesel));
  _set('home_month91',     fmt(mRange.n91));
  _set('home_month95',     fmt(mRange.n95));
  _set('home_monthMoney',  fmt(mRange.diesel*cfg.prices.diesel + mRange.n91*cfg.prices.n91 + mRange.n95*cfg.prices.n95, 2) + ' ر.س');

  // [v12] تحديث لوحة "منذ آخر جرد"
  try { updateSinceAuditWidget(); } catch(e) {}
}

function getAvgConsumption(days) {
  // [FIX v10] NaN guards + safer division
  const shiftsPerDay = Math.max(1, parseInt(DB.config?.shiftsPerDay || DB.config?.shifts?.length || 2));
  const avg = { diesel: 0, n91: 0, n95: 0 };
  const sorted = [...DB.shifts].sort((a, b) => (b.id || 0) - (a.id || 0));
  const targetShifts = sorted.slice(0, days * shiftsPerDay);
  if (targetShifts.length === 0) return avg;
  const actualDays = Math.max(1, Math.ceil(targetShifts.length / shiftsPerDay));
  targetShifts.forEach(s => {
    avg.diesel += isFinite(s.diesel) ? s.diesel : 0;
    avg.n91    += isFinite(s.n91)    ? s.n91    : 0;
    avg.n95    += isFinite(s.n95)    ? s.n95    : 0;
  });
  avg.diesel = avg.diesel / actualDays;
  avg.n91    = avg.n91    / actualDays;
  avg.n95    = avg.n95    / actualDays;
  // ضمان إخراج أرقام صحيحة دائماً
  if (!isFinite(avg.diesel)) avg.diesel = 0;
  if (!isFinite(avg.n91))    avg.n91    = 0;
  if (!isFinite(avg.n95))    avg.n95    = 0;
  return avg;
}

function getConsumptionRange(days) {
  // ✅ [FIX v9] استخدام آخر (days * shiftsPerDay) وردية — لا تاريخ تقويمي
  const shiftsPerDay = parseInt(DB.config?.shiftsPerDay || DB.config?.shifts?.length || 2);
  const sorted = [...DB.shifts].sort((a, b) => (b.id || 0) - (a.id || 0));
  const targetShifts = sorted.slice(0, days * shiftsPerDay);
  const res = { diesel: 0, n91: 0, n95: 0 };
  targetShifts.forEach(s => {
    res.diesel += s.diesel || 0;
    res.n91    += s.n91    || 0;
    res.n95    += s.n95    || 0;
  });
  return res;
}

function getMonthRange() {
  // ✅ [FIX v9] اعتماد على تواريخ الورديات الفعلية
  const now = new Date();
  const day = now.getDate();
  const monthStart = DB.config.monthStart || 1;
  let from;
  if (day >= monthStart) {
    from = new Date(now.getFullYear(), now.getMonth(), monthStart);
  } else {
    from = new Date(now.getFullYear(), now.getMonth() - 1, monthStart);
  }
  const fromStr = from.toISOString().split('T')[0];
  const res = { diesel: 0, n91: 0, n95: 0, shifts: 0 };
  // [v15.1] استبعاد الجردات من إحصاءات الشهر — هي ليست ورديات
  DB.shifts.filter(s => s.date >= fromStr && s.type !== 'audit').forEach(s => {
    res.diesel += s.diesel || 0;
    res.n91    += s.n91    || 0;
    res.n95    += s.n95    || 0;
    res.shifts++;
  });
  // أيام العمل الفعلية = عدد الورديات ÷ الورديات اليومية
  const shiftsPerDay = parseInt(DB.config?.shiftsPerDay || DB.config?.shifts?.length || 2);
  res.actualWorkDays = Math.max(1, Math.ceil(res.shifts / shiftsPerDay));
  return res;
}

// ===========================
// ENTRY PAGE
// ===========================
function normType(t) {
  // Normalize pump type: '91' -> 'n91', '95' -> 'n95', 'diesel' -> 'diesel'
  if (t === '91') return 'n91';
  if (t === '95') return 'n95';
  return t; // 'diesel', 'n91', 'n95'
}

function renderEntryPumps() {
  const pumps = DB.config.pumps;
  const types = ['diesel','n91','n95'];
  const labels = {diesel:'ديزل', n91:'بنزين 91', n95:'بنزين 95'};
  const colors = {diesel:'#D4AC0D', n91:'#1E8449', n95:'#C0392B'};
  const bgColors = {diesel:'rgba(212,172,13,0.08)', n91:'rgba(30,132,73,0.07)', n95:'rgba(192,57,43,0.06)'};
  const borderColors = {diesel:'#F9E87A', n91:'#52BE80', n95:'#E74C3C'};
  const icons  = {diesel:'⛽', n91:'🟢', n95:'🔴'};

  let html = '';
  types.forEach(type => {
    const typePumps = pumps.filter(p => normType(p.type) === type);
    if (typePumps.length === 0) return;

    html += `<div class="card" style="margin-bottom:14px">
      <div class="card-header" style="background:linear-gradient(90deg,${bgColors[type]},transparent)">
        <span class="card-title" style="color:${colors[type]};font-size:15px">${icons[type]} ${labels[type]}</span>
      </div>
      <div class="card-body" style="padding:10px 14px">
        <div style="display:flex; flex-direction:column; gap:8px;">`;

    typePumps.forEach(p => {
      // ═══════════════════════════════════════════════════════════
      // ✅ ENTRY PAGE CORE FIX
      // القاعدة الثابتة: الطرح دائماً من آخر عداد محفوظ فعلاً في القاعدة
      //   الاستهلاك = القراءة الجديدة − getLastSavedReading(pumpId)
      //
      // لماذا getLastSavedReading وليس getImmediatePreviousReading؟
      //   لأن الوردية الجديدة لم تُحفَظ بعد في DB.meters.
      //   getImmediatePreviousReading تبحث عن وردية بنفس التاريخ/الوردية في القاعدة
      //   فلا تجدها (لم تُحفَظ) → تنتقل للـ else-branch → تعيد أحدث قراءة.
      //   لكن هذا السلوك غير مضمون عند تغيير التاريخ/الوردية بعد بناء HTML.
      //
      // الحل الصحيح: نمرر pumpId فقط لـ onblur — الدالة تجلب القراءة
      // من DB.meters لحظة الاستدعاء (وليس رقماً مجمّداً وقت بناء HTML).
      // ═══════════════════════════════════════════════════════════
      const prevDisplay = getLastSavedReading(p.id); // للعرض فقط في placeholder

      html += `<div style="display:flex;align-items:center;gap:10px;background:var(--gray-100);border-radius:8px;padding:8px 12px;border-right:3px solid ${borderColors[type]}">
        <div style="min-width:90px">
          <div style="font-size:13px;font-weight:800;color:var(--text-primary)">${p.name}</div>
          <div style="font-size:10px;color:var(--gray-500);margin-top:1px">السابق: ${fmt(prevDisplay)}</div>
        </div>
        <div style="flex:1">
          <input type="number" class="form-input" id="pump_${p.id}" placeholder="قراءة الاختتام"
            onblur="showPumpConsumption(${p.id})"
            style="font-size:15px;font-weight:700;text-align:center;padding:8px 6px;border:2px solid var(--gray-300)">
        </div>
        <div class="consumption-display" id="cons_${p.id}" style="min-width:80px;font-size:12px;min-height:18px;text-align:center"></div>
      </div>`;
    });
    html += '</div></div></div>';
  });

  if (!html) {
    html = '<div class="alert alert-info">لا توجد طلمبات مضافة. يرجى الإعداد من الإعدادات.</div>';
  }

  document.getElementById('pumpsEntryContainer').innerHTML = html;
}

// ═══════════════════════════════════════════════════════════════
// [v16] محرك الحفظ التلقائي المؤقت (Draft Auto-Save Emergency Recovery)
// يحمي بيانات العامل من الضياع عند انقطاع الجوال/البطارية/إعادة تحميل الصفحة
// قبل الضغط على "حفظ الوردية". لا علاقة له بحفظ البيانات الفعلي في القاعدة.
// ═══════════════════════════════════════════════════════════════
const DRAFT_KEY = 'active_shift_draft';

function _collectEntryDraft() {
  const cfg = DB.config;
  const draft = {
    shiftType: document.getElementById('entry_shiftType')?.value || '',
    date:      document.getElementById('entry_date')?.value || '',
    pumps:     {},
    network:   document.getElementById('pay_network')?.value  || '',
    invoices:  document.getElementById('pay_invoices')?.value || '',
    supplied:  document.getElementById('pay_supplied')?.value || '',
    savedAt:   Date.now()
  };
  (cfg?.pumps || []).forEach(p => {
    const el = document.getElementById(`pump_${p.id}`);
    if (el && el.value !== '') draft.pumps[p.id] = el.value;
  });
  return draft;
}

function _saveDraft() {
  try {
    const draft = _collectEntryDraft();
    const hasData = Object.keys(draft.pumps).length > 0 || draft.network || draft.invoices || draft.supplied;
    if (hasData) localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    else localStorage.removeItem(DRAFT_KEY);
  } catch(e) { /* تجاهل أخطاء التخزين (مثل وضع التصفح الخاص) */ }
}

function _restoreDraftIfAny() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return;
    const draft = JSON.parse(raw);
    if (!draft) return;

    if (draft.shiftType) { const el = document.getElementById('entry_shiftType'); if (el) el.value = draft.shiftType; }
    if (draft.date) {
      const el = document.getElementById('entry_date');
      if (el) { el.value = draft.date; updateEntryDateDisplay(); }
    }
    Object.entries(draft.pumps || {}).forEach(([pid, val]) => {
      const el = document.getElementById(`pump_${pid}`);
      if (el) { el.value = val; showPumpConsumption(parseInt(pid)); }
    });
    if (draft.network)  { const el = document.getElementById('pay_network');  if (el) el.value = draft.network; }
    if (draft.invoices) { const el = document.getElementById('pay_invoices'); if (el) el.value = draft.invoices; }
    if (draft.supplied) { const el = document.getElementById('pay_supplied'); if (el) el.value = draft.supplied; }
    if (draft.network || draft.invoices || draft.supplied) calcCash();

    _showToast('↩️ تم استرجاع بيانات وردية غير محفوظة', 'info', 3500);
  } catch(e) { /* تجاهل مسودة تالفة */ }
}

function _clearDraft() {
  try { localStorage.removeItem(DRAFT_KEY); } catch(e) {}
}

// تفعيل الحفظ التلقائي اللحظي: تسجيل أي تغيير داخل صفحة الإدخال (تفويض حدث واحد)
function _initDraftAutosave() {
  const page = document.getElementById('page-entry');
  if (!page) return;
  page.addEventListener('input',  () => _saveDraft());
  page.addEventListener('change', () => _saveDraft());
}

// ═══════════════════════════════════════════════════════════════
// getLastSavedReading — دالة موحدة لجلب أحدث قراءة مسجلة
// المنطق: نفصل الافتتاحي آخراً، ونرتب الباقي بـ ID تنازلياً
// أول صف غير افتتاحي يحتوي على الطلمبة هو أحدث قراءة
// ═══════════════════════════════════════════════════════════════
function _sortedMeters() {
  return [...DB.meters].sort((a, b) => {
    if (a.type === 'opening') return 1;
    if (b.type === 'opening') return -1;
    return (b.id || 0) - (a.id || 0);
  });
}

// [v17] أصبحت جميع هذه الدوال أغلفة رقيقة تُفوِّض مباشرة إلى AccountingEngine
// (المصدر الوحيد للحقيقة) بدل تكرار نفس منطق الترتيب/الحساب هنا محلياً.
function getLastSavedReading(pumpId) {
  return AccountingEngine.getLastReading(pumpId);
}
// alias للتوافق مع أي استدعاء قديم
const getLastReading = getLastSavedReading;

function getLastReadingBeforeDate(pumpId, endDate) {
  return AccountingEngine.getLastReadingBeforeDate(pumpId, endDate);
}

function getHistoricalStock(endDate) {
  return AccountingEngine.getHistoricalStock(endDate);
}

// ═══════════════════════════════════════════════════════════════
// getImmediatePreviousReading — قراءة الصف الذي أسفل الوردية مباشرة
// المعادلة: استهلاك الوردية = قراءتها - قراءة الصف الأسفل منها
// ═══════════════════════════════════════════════════════════════
function getImmediatePreviousReading(pumpId, currentDate, currentShiftType) {
  const sorted = _sortedMeters();
  const idx = sorted.findIndex(m => m.type !== 'opening' && m.date === currentDate && m.shiftType === currentShiftType);
  const start = idx !== -1 ? idx + 1 : 0;
  for (let i = start; i < sorted.length; i++) {
    if (sorted[i].type === 'opening') break;
    const pd = sorted[i].pumps.find(p => p.pumpId === pumpId);
    if (pd) return pd.reading;
  }
  const opening = DB.meters.find(m => m.type === 'opening');
  if (opening) { const pd = opening.pumps.find(p => p.pumpId === pumpId); if (pd) return pd.reading; }
  return DB.config.pumps.find(p => p.id === pumpId)?.opening || 0;
}

// ═══════════════════════════════════════════════════════════════
// [FIX v10] showPumpConsumption — حماية العدادات المحسّنة
// يمنع CurrentReading < PreviousReading إلا في حالة Reset Counter
// ═══════════════════════════════════════════════════════════════
function showPumpConsumption(pumpId) {
  const el    = document.getElementById(`cons_${pumpId}`);
  const input = document.getElementById(`pump_${pumpId}`);
  const current = parseFloat(input.value);
  const MAX_CONSUMPTION_PER_SHIFT = 100000;
  // الحد الأقصى المعقول للقراءة (10 مليون لتر كحد أعلى)
  const MAX_METER_READING = 10000000;

  if (!input.value || isNaN(current)) {
    el.textContent = '';
    input.style.borderColor = 'var(--gray-300)';
    input.dataset.resetApproved = '';
    return;
  }

  if (current < 0) {
    el.textContent = '⛔ قراءة سالبة غير مقبولة';
    el.style.color = 'var(--red)';
    input.style.borderColor = 'var(--red)';
    return;
  }

  if (current > MAX_METER_READING) {
    el.textContent = `⚠️ قراءة غير معقولة (أكبر من ${fmt(MAX_METER_READING)})`;
    el.style.color = '#E67E22';
    input.style.borderColor = '#E67E22';
    return;
  }

  const prevReading = getLastSavedReading(pumpId);
  const cons = current - prevReading;
  const pumpName = DB.config?.pumps?.find(p => p.id === pumpId)?.name || `طلمبة ${pumpId}`;

  if (current < prevReading) {
    // [FIX v10] عرض خيار Reset Counter بدلاً من مجرد التحذير
    const alreadyApproved = input.dataset.resetApproved === 'yes';
    if (alreadyApproved) {
      // تمت الموافقة مسبقاً على Reset
      el.innerHTML = `<span style="color:#E67E22;font-weight:700">🔄 إعادة تعيين العداد (${fmt(prevReading)} ← ${fmt(current)})</span>`;
      el.style.color = '#E67E22';
      input.style.borderColor = '#E67E22';
    } else {
      el.innerHTML = `<span style="color:var(--red);font-weight:700">⚠️ أقل من السابق (${fmt(prevReading)}) — <a href="#" onclick="event.preventDefault();_approveCounterReset(${pumpId})" style="color:#1565C0;text-decoration:underline">إعادة تعيين؟</a></span>`;
      el.style.color = 'var(--red)';
      input.style.borderColor = 'var(--red)';
    }
  } else if (cons > MAX_CONSUMPTION_PER_SHIFT) {
    el.textContent = `⚠️ استهلاك مرتفع جداً (${fmt(cons)} لتر)`;
    el.style.color = '#E67E22';
    input.style.borderColor = '#E67E22';
  } else {
    el.textContent = `${fmt(cons)} لتر`;
    el.style.color = '#27AE60';
    input.style.borderColor = '#27AE60';
    input.dataset.resetApproved = '';
  }
}

// [FIX v10] الموافقة على إعادة تعيين العداد مع Audit Log
function _approveCounterReset(pumpId) {
  const input   = document.getElementById(`pump_${pumpId}`);
  const prev    = getLastSavedReading(pumpId);
  const current = parseFloat(input?.value);
  const pumpName = DB.config?.pumps?.find(p => p.id === pumpId)?.name || `طلمبة ${pumpId}`;

  const confirmed = confirm(
    `🔄 تأكيد إعادة تعيين عداد: ${pumpName}\n\n` +
    `القراءة السابقة: ${fmt(prev)}\n` +
    `القراءة الجديدة: ${fmt(current)}\n\n` +
    `⚠️ هذا يعني أن العداد تم إعادة تعيينه (صفّر أو استُبدل).\n` +
    `سيتم تسجيل هذه العملية في سجل الأنشطة.\n\n` +
    `هل تؤكد المتابعة؟`
  );
  if (!confirmed) return;

  // وضع علامة الموافقة على الحقل
  input.dataset.resetApproved = 'yes';
  // تسجيل في Audit Log
  logActivity('counter_reset',
    `إعادة تعيين عداد ${pumpName}: القراءة السابقة ${fmt(prev)} → القراءة الجديدة ${fmt(current)}`
  );
  // تحديث العرض
  showPumpConsumption(pumpId);
  _showToast(`✅ تم تأكيد إعادة تعيين عداد ${pumpName}`, 'warning');
}

