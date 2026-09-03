function renderMonthlyChart() {
  const canvas = document.getElementById('monthlyRevenueChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  // ✅ [FIX v9] بناء بيانات من الورديات الفعلية لا تواريخ الجهاز
  const cfg = DB.config;
  const byDate = {};
  DB.shifts.filter(s => s.type !== 'audit').forEach(s => {
    if (!byDate[s.date]) byDate[s.date] = 0;
    byDate[s.date] += s.totalMoney || 0;
  });
  const sortedAllDates = Object.keys(byDate).sort().slice(-30);
  const days = sortedAllDates;
  const revenue = days.map(date => byDate[date] || 0);

  const maxVal = Math.max(...revenue, 1);
  const padding = { top: 20, right: 10, bottom: 30, left: 10 };
  const chartW = W - padding.left - padding.right;
  const chartH = H - padding.top - padding.bottom;

  // رسم الخط
  ctx.beginPath();
  ctx.strokeStyle = '#C0392B';
  ctx.lineWidth = 2;
  revenue.forEach((val, i) => {
    const x = padding.left + (i / (revenue.length - 1)) * chartW;
    const y = padding.top + chartH - (val / maxVal) * chartH;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();

  // ملء تحت الخط
  ctx.lineTo(padding.left + chartW, padding.top + chartH);
  ctx.lineTo(padding.left, padding.top + chartH);
  ctx.closePath();
  ctx.fillStyle = 'rgba(192,57,43,0.1)';
  ctx.fill();

  // عناوين المحور
  ctx.fillStyle = '#999';
  ctx.font = '9px Cairo,sans-serif';
  ctx.textAlign = 'center';
  [0, 14, 29].forEach(i => {
    const d = new Date(days[i] + 'T00:00:00');
    ctx.fillText(`${d.getDate()}/${d.getMonth() + 1}`, padding.left + (i / 29) * chartW, H - 8);
  });
}

function getLast7DaysData() {
  // ✅ [FIX v9] استخدام تواريخ الورديات الفعلية لا تاريخ الجهاز
  const result = { labels: [], diesel: [], n91: [], n95: [] };
  if (DB.shifts.length === 0) return result;
  // جمع البيانات حسب التاريخ المسجل فعلاً في الورديات — مستبعداً الجردات
  const byDate = {};
  DB.shifts.filter(s => s.type !== 'audit').forEach(s => {
    if (!byDate[s.date]) byDate[s.date] = { diesel: 0, n91: 0, n95: 0 };
    byDate[s.date].diesel += s.diesel || 0;
    byDate[s.date].n91    += s.n91    || 0;
    byDate[s.date].n95    += s.n95    || 0;
  });
  // آخر 7 تواريخ فعلية (مُسجَّلة في قاعدة البيانات)
  const sortedDates = Object.keys(byDate).sort().slice(-7);
  sortedDates.forEach(dateStr => {
    const d = new Date(dateStr + 'T00:00:00');
    result.labels.push(`${d.getDate()}/${d.getMonth() + 1}`);
    result.diesel.push(byDate[dateStr].diesel);
    result.n91.push(byDate[dateStr].n91);
    result.n95.push(byDate[dateStr].n95);
  });
  return result;
}

// ===========================
// تحسين 9: تصدير PDF (عبر طباعة)
// ===========================
function exportReportPDF() {
  // ═══════════════════════════════════════════════════════════════
  // [FIX v6 - MOBILE PRINT] طباعة عبر iframe مخفي بدلاً من window.open
  // يتجاوز حظر Popup في Safari Mobile و Chrome Mobile و متصفحات التطبيقات
  // ═══════════════════════════════════════════════════════════════
  const reportCard = document.getElementById('reportCard');
  if (!reportCard) { _showToast('⚠️ أنشئ التقرير أولاً', 'warning'); return; }
  const cfg = DB.config;
  const reportContent = reportCard.innerHTML;
  const printTimestamp = new Date().toLocaleString('ar-SA');

  const printStyles = `
    @import url('https://fonts.googleapis.com/css2?family=Cairo:wght@400;700;800&display=swap');
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:Cairo,sans-serif;padding:20px;color:#1a1a1a;direction:rtl;font-size:13px;background:#fff}
    .stats-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:12px 0}
    .stat-box{border:1px solid #ddd;border-radius:8px;padding:10px;text-align:center}
    .stat-label{font-size:11px;color:#666}
    .stat-value{font-size:16px;font-weight:800}
    .stat-sub{font-size:11px;color:#9A7D0A}
    .totals-section{background:#f9f0d5;border:2px solid #D4AC0D;border-radius:8px;padding:12px}
    .totals-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
    .total-item{text-align:center}
    .total-label{font-size:11px;color:#666}
    .total-value{font-size:14px;font-weight:800;color:#922B21}
    .section-title{font-size:14px;font-weight:700;color:#922B21;margin:12px 0 6px;border-right:3px solid #C0392B;padding-right:8px}
    table{width:100%;border-collapse:collapse}
    th{background:#C0392B;color:white;padding:7px;font-size:12px}
    td{padding:6px;border-bottom:1px solid #eee;text-align:center;font-size:12px}
    .fw-bold{font-weight:700}
    .text-muted{color:#888}
    .text-sm{font-size:12px}
    .print-footer{color:#aaa;font-size:11px;margin-top:20px;text-align:center;border-top:1px solid #eee;padding-top:10px}
    @media print{
      body{padding:8px}
      .no-print{display:none!important}
    }
  `;

  // ── أزِل أي iframe طباعة سابق ─────────────────────────────
  const oldFrame = document.getElementById('_printFrame');
  if (oldFrame) oldFrame.remove();

  // ── أنشئ iframe مخفياً ────────────────────────────────────
  const iframe = document.createElement('iframe');
  iframe.id = '_printFrame';
  iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;border:none;opacity:0;';
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument || iframe.contentWindow.document;
  doc.open();
  doc.write(`<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>تقرير — ${sanitize(cfg.stationName || 'محطة الوقود')}</title>
  <style>${printStyles}</style>
</head>
<body>
  ${reportContent}
  <div class="print-footer">تم الإنشاء بواسطة نظام إدارة محطة الوقود | ${printTimestamp}</div>
</body>
</html>`);
  doc.close();

  // ── انتظر تحميل الخطوط ثم اطبع ──────────────────────────
  iframe.onload = () => {
    try {
      // تأخير قصير لضمان رسم الخطوط (Cairo font)
      setTimeout(() => {
        try {
          iframe.contentWindow.focus();
          iframe.contentWindow.print();
        } catch(printErr) {
          // fallback: طباعة من النافذة الرئيسية مع print media
          console.warn('[Print] iframe.print() failed, fallback to window.print', printErr);
          window.print();
        }
        // تنظيف بعد الطباعة
        setTimeout(() => { if (iframe.parentNode) iframe.remove(); }, 3000);
      }, 600);
    } catch(e) {
      console.warn('[Print] onload error', e);
      iframe.remove();
    }
  };
}

// ===========================
// تحسين 10: إشعارات داخل التطبيق (Toast)
// ===========================
function _showToast(message, type = 'success', duration = 3500) {
  const colors = {
    success: { bg: '#1B5E20', icon: '✅' },
    error: { bg: '#B71C1C', icon: '❌' },
    warning: { bg: '#7D5C00', icon: '⚠️' },
    info: { bg: '#1565C0', icon: 'ℹ️' }
  };
  const c = colors[type] || colors.info;
  const old = document.getElementById('_toastMsg');
  if (old) old.remove();
  const toast = document.createElement('div');
  toast.id = '_toastMsg';
  toast.style.cssText = `
    position:fixed;bottom:75px;left:12px;right:12px;z-index:9999;
    background:${c.bg};color:white;border-radius:12px;padding:12px 16px;
    display:flex;align-items:center;gap:10px;
    box-shadow:0 4px 20px rgba(0,0,0,0.4);font-family:Cairo,sans-serif;font-size:13px;
    animation:slideUp 0.3s ease;
  `;
  toast.innerHTML = `
    <span style="font-size:18px">${c.icon}</span>
    <span style="flex:1">${message}</span>
    <button onclick="this.parentElement.remove()" style="background:rgba(255,255,255,0.2);border:none;border-radius:6px;padding:3px 8px;color:white;cursor:pointer;font-size:12px">✕</button>
  `;
  document.body.appendChild(toast);
  setTimeout(() => toast?.remove(), duration);
}

// ===========================
// تحسين 11: وضع الكاشير (واجهة مبسطة للموظف)
// ===========================
function toggleCashierMode() {
  document.body.classList.toggle('cashier-mode');
  const isCashier = document.body.classList.contains('cashier-mode');
  localStorage.setItem('cashierMode', isCashier ? '1' : '0');
  const btn = document.getElementById('cashierModeBtn');
  if (btn) btn.textContent = isCashier ? '🖥️ وضع عادي' : '🧾 وضع الكاشير';
  _showToast(isCashier ? '🧾 تم تفعيل وضع الكاشير' : '🖥️ تم الرجوع للوضع العادي', 'info');
}

// ===========================
// تحسين 12: بحث سريع في السجل
// ===========================
function filterLog(query) {
  const q = query.toLowerCase().trim();
  document.querySelectorAll('.shift-row').forEach(row => {
    if (!q) { row.style.display = ''; return; }
    const text = row.textContent.toLowerCase();
    row.style.display = text.includes(q) ? '' : 'none';
  });
}

// ===========================
// تحسين 13: ملخص شهري مقارن (للوحة التحكم)
// ===========================
function getMonthlyComparison() {
  const cfg = DB.config;
  const now = new Date();
  const ms = cfg.monthStart || 1;
  const months = [];

  for (let m = 0; m < 3; m++) {
    const year = now.getFullYear();
    const month = now.getMonth() - m;
    let fromDate, toDate;
    if (m === 0) {
      fromDate = new Date(year, month < 0 ? 12 + month : month, ms).toISOString().split('T')[0];
      toDate = now.toISOString().split('T')[0];
    } else {
      const d1 = new Date(year, month < 0 ? 12 + month : month, ms);
      const d2 = new Date(year, (month + 1 < 0 ? 12 + month + 1 : month + 1), ms - 1);
      fromDate = d1.toISOString().split('T')[0];
      toDate = d2.toISOString().split('T')[0];
    }
    const shifts = DB.shifts.filter(s => s.date >= fromDate && s.date <= toDate && s.type !== 'audit');
    const revenue = shifts.reduce((a, s) => a + (s.totalMoney || 0), 0);
    const diesel = shifts.reduce((a, s) => a + (s.diesel || 0), 0);
    const n91 = shifts.reduce((a, s) => a + (s.n91 || 0), 0);
    const n95 = shifts.reduce((a, s) => a + (s.n95 || 0), 0);
    const d = new Date(fromDate + 'T00:00:00');
    const mNames = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
    months.push({ label: mNames[d.getMonth()], revenue, diesel, n91, n95, shifts: shifts.length });
  }
  return months.reverse();
}


// ===========================
// BOOT (first)
// ===========================
async function bootApp() {
  initDarkMode();

  // ── أظهر شاشة تحميل ─────────────────────────────────────────
  const loginOverlay = document.getElementById('loginOverlay');
  const isOffline = !navigator.onLine;
  loginOverlay.innerHTML = `
    <div class="login-card" style="text-align:center;padding:40px 20px">
      <div style="font-size:50px;margin-bottom:16px">${isOffline ? '📴' : '⛽'}</div>
      <div style="font-size:18px;font-weight:800;color:var(--red-dark);margin-bottom:8px">
        ${isOffline ? 'وضع عدم الاتصال' : 'جارٍ تحميل البيانات...'}
      </div>
      <div style="font-size:13px;color:var(--gray-500);margin-bottom:20px">
        ${isOffline ? 'يتم تحميل البيانات المحفوظة محلياً...' : 'يتم الاتصال بقاعدة البيانات'}
      </div>
      ${!isOffline ? `<div style="width:60px;height:4px;background:var(--gray-200);border-radius:4px;margin:0 auto;overflow:hidden">
        <div style="width:40%;height:100%;background:var(--red);border-radius:4px;animation:loadBar 1s infinite alternate"></div>
      </div>
      <style>@keyframes loadBar{from{transform:translateX(0)}to{transform:translateX(150%)}}</style>` : ''}
    </div>`;
  loginOverlay.classList.add('open');

  // ═══════════════════════════════════════════════════════════════
  // [FIX v10] CRITICAL: Firebase هي المصدر الوحيد لقرار "هل المحطة موجودة؟"
  //
  // المشكلة القديمة:
  //   loadDB() يحمّل localStorage أولاً → إذا كان localStorage فارغاً
  //   (جهاز جديد / مستخدم جديد / Private Browsing) → DB.config = null
  //   → يُظهر Setup Wizard حتى لو كانت المحطة موجودة في Firebase
  //
  // الحل:
  //   1) إذا كان المتصفح متصلاً: اسأل Firebase مباشرة عن وجود config
  //   2) فقط إذا أجاب Firebase بـ null (لا توجد محطة): أظهر Setup Wizard
  //   3) إذا كان offline: استخدم localStorage كـ fallback
  //   4) لا تعتمد على localStorage لقرار "هل المحطة موجودة؟" أبداً
  // ═══════════════════════════════════════════════════════════════

  let _firebaseHasStation = null; // true | false | null (unknown)

  if (navigator.onLine) {
    try {
      // فحص مباشر لوجود config في Firebase (بدون تحميل كل البيانات)
      const configSnap = await Promise.race([
        DB_REF.child('config').once('value'),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 10000))
      ]);
      _firebaseHasStation = configSnap.val() !== null;
      console.log('🔥 [bootApp] Firebase config check:', _firebaseHasStation ? 'موجودة' : 'غير موجودة');
    } catch(err) {
      console.warn('⚠️ [bootApp] فشل فحص Firebase:', err.message, '— الانتقال إلى localStorage');
      _firebaseHasStation = null; // unknown — سنستخدم localStorage
    }
  }

  // ── تحميل البيانات الكاملة ──────────────────────────────────
  await loadDB();
  _migrateSchemaIfNeeded();

  // ✅ [FIX v14] تأجيل runRetroactiveMigration — على البيانات الكبيرة تُجمّد الـ UI
  // تُشغَّل بعد ظهور شاشة الدخول بـ 3 ثوان لا تسبق تسجيل دخول المستخدم
  if (!DB.config?._retroMigrationV1) {
    setTimeout(() => {
      try { runRetroactiveMigration(); } catch(e) { console.warn('[bootApp] migration err:', e); }
    }, 3000);
  }

  if (typeof _hasPendingSync !== 'undefined' && _hasPendingSync) {
    console.log('📦 يوجد بيانات offline معلّقة سيتم رفعها عند الاتصال');
  }

  // ── قرار Setup Wizard أو Login ──────────────────────────────
  // المنطق:
  //   • إذا Firebase قال "لا توجد محطة" → Setup Wizard
  //   • إذا Firebase قال "موجودة" أو غير معروف (offline) → Login
  //   • localStorage لوحده لا يكفي لإظهار Setup Wizard

  const stationExists = _firebaseHasStation === true
    || (_firebaseHasStation === null && DB.config !== null); // offline fallback

  if (!stationExists && _firebaseHasStation !== null) {
    // Firebase أجاب صراحةً: لا توجد محطة → Setup Wizard
    loginOverlay.classList.remove('open');
    initSetupWizard();
  } else if (!stationExists && _firebaseHasStation === null && !DB.config) {
    // Offline + localStorage فارغ → Setup Wizard (لا يوجد خيار آخر)
    loginOverlay.classList.remove('open');
    initSetupWizard();
  } else if (_localAuthMode) {
    // وضع محلي — تحقق من الجلسة المحفوظة
    const session = localStorage.getItem('_localSession');
    if (session) {
      try {
        const { email } = JSON.parse(session);
        const userRecord = _findUserByEmail(email);
        if (userRecord) { _clearLoginAttempts(); currentUser = userRecord; loginOverlay.classList.remove('open'); _openMainApp(); return; }
      } catch(e) {}
    }
    _rebuildLoginScreen();
  } else {
    _rebuildLoginScreen();
  }
}

function _rebuildLoginScreen() {
  const loginOverlay = document.getElementById('loginOverlay');
  loginOverlay.innerHTML = `
    <div class="login-card">
      <div class="login-header">
        <div class="login-logo">⛽</div>
        <div class="gold-line"></div>
        <h2 id="stationNameLogin">${DB.config?.stationName || 'محطة الوقود'}</h2>
        <p>نظام إدارة المحطة المتكامل</p>
      </div>
      <div class="login-body">
        <div class="form-group">
          <label class="form-label">البريد الإلكتروني</label>
          <input type="email" class="form-input" id="loginEmail" placeholder="example@email.com">
        </div>
        <div class="form-group">
          <label class="form-label">كلمة المرور</label>
          <input type="password" class="form-input" id="loginPassword" placeholder="••••••••"
            onkeydown="if(event.key==='Enter')doLogin()">
        </div>
        <div id="loginError" class="alert alert-danger" style="display:none">بيانات الدخول غير صحيحة</div>
        <button class="btn btn-primary btn-full mt-8" onclick="doLogin()">🔐 دخول</button>
        <button class="btn btn-ghost btn-full mt-8" style="font-size:12px" onclick="forgotPassword()">نسيت كلمة المرور؟</button>
        <div class="text-center mt-8 text-sm text-muted">نظام إدارة محطات الوقود v2.0</div>
      </div>
    </div>`;
}

// ── استعادة كلمة المرور ───────────────────────────────────────
async function forgotPassword() {
  const email = document.getElementById('loginEmail')?.value?.trim();
  if (!email) { alert('أدخل بريدك الإلكتروني أولاً في حقل البريد'); return; }
  try {
    await fbAuth.sendPasswordResetEmail(email);
    alert(`✅ تم إرسال رابط استعادة كلمة المرور إلى:\n${email}\nتحقق من بريدك (وصندوق الرسائل غير المرغوب فيها)`);
  } catch(err) {
    alert('⚠️ ' + (err.code === 'auth/user-not-found' ? 'هذا البريد غير مسجل' : err.message));
  }
}

// ═══════════════════════════════════════════════════════════════
// FACTORY RESET — إعادة تهيئة المحطة (للمالك فقط)
// يحذف البيانات التشغيلية ويُبقي على الإعدادات الافتتاحية
// ═══════════════════════════════════════════════════════════════
async function factoryResetStation() {
  if (currentUser?.role !== 'owner') {
    alert('⛔ هذه الصلاحية متاحة للمالك فقط');
    return;
  }

  // ─── رسالة التأكيد الأولى ───────────────────────────────────
  const confirmed = confirm(
    '⚠️ تحذير شديد — إعادة تهيئة المحطة\n\n' +
    'سيتم حذف نهائياً:\n' +
    '  • جميع سجلات الورديات\n' +
    '  • جميع قراءات العدادات (عدا الافتتاحية)\n' +
    '  • جميع سجلات المخزون (عدا الافتتاحية)\n' +
    '  • جميع سجلات التوريد\n' +
    '  • سجل الأنشطة\n' +
    '  • بيانات عدادات اليوم\n\n' +
    'سيتم الاحتفاظ بـ:\n' +
    '  ✅ إعدادات المحطة والأسعار\n' +
    '  ✅ بيانات المستخدمين\n' +
    '  ✅ القراءات والأرصدة الافتتاحية الأولى\n\n' +
    'هذا الإجراء لا يمكن التراجع عنه!\nهل تريد المتابعة؟'
  );
  if (!confirmed) return;

  // ─── تأكيد ثانٍ بكتابة كلمة "تهيئة" ────────────────────────
  const typed = prompt(
    '🔐 للتأكيد النهائي، اكتب كلمة  تهيئة  بالعربية ثم اضغط موافق:'
  );
  if (typed === null) return; // ألغى
  if (typed.trim() !== 'تهيئة') {
    alert('❌ تم إلغاء العملية — الكلمة المدخلة غير صحيحة');
    return;
  }

  // ─── احتفظ بالصفوف الافتتاحية فقط ─────────────────────────
  const openingMeters    = DB.meters.filter(m => m.type === 'opening');
  const openingInventory = DB.inventory.filter(r => r.type === 'opening');

  // ─── أعد المخزون إلى الأرصدة الافتتاحية ──────────────────
  if (DB.config?.openingStock) {
    DB.config.currentStock = {
      diesel: DB.config.openingStock.diesel || 0,
      n91:    DB.config.openingStock.n91    || 0,
      n95:    DB.config.openingStock.n95    || 0
    };
  }

  // ─── صفّر البيانات التشغيلية ────────────────────────────────
  DB.shifts       = [];
  DB.meters       = openingMeters;
  DB.inventory    = openingInventory;
  DB.supply       = [];
  DB.activityLog  = [];

  try {
    // ─── رفع إلى Firebase (update لتجنب مسح counters) ──────────
    await DB_REF.update({
      shifts:      [],
      meters:      openingMeters.length   > 0 ? openingMeters   : [],
      inventory:   openingInventory.length > 0 ? openingInventory : [],
      supply:      [],
      activityLog: [],
      config:      DB.config
    });

    // ─── مسح عدادات اليوم في Firebase ───────────────────────
    try {
      await rtdb.ref(STATION_KEY + '/counters').remove();
    } catch(cErr) { console.warn('counters reset skipped:', cErr); }

    // ─── مسح CountersAPI المحلي ──────────────────────────────
    if (window.CountersAPI) {
      if (typeof CountersAPI.resetAll === 'function') CountersAPI.resetAll();
      else if (typeof CountersAPI.reset === 'function') CountersAPI.reset();
    }

    // ─── تحديث localStorage ─────────────────────────────────
    localStorage.setItem('fuelStationDB', JSON.stringify({ ...DB, _savedAt: Date.now() }));
    localStorage.removeItem('fuelStationPendingSync');

    // ─── تسجيل نشاط + تحديث الواجهة ─────────────────────────
    logActivity('factory_reset', 'إعادة تهيئة كاملة للمحطة — تم بواسطة المالك');

    renderLog();
    renderMetersTable();
    renderInventoryTable();
    updateHomePage();

    // ─── رسالة نجاح ──────────────────────────────────────────
    _showToast('✅ تمت إعادة تهيئة المحطة — جاهزة للعمل من جديد', 'success');
    setTimeout(() => {
      alert('✅ تمت إعادة تهيئة المحطة بنجاح!\n\nالتطبيق الآن في الحالة الصفرية الجاهزة للعمل\nبناءً على الأرقام الافتتاحية المحفوظة.');
      showPage('home', document.querySelector('.nav-btn'));
    }, 400);

  } catch(err) {
    console.error('Factory reset error:', err);
    alert('⚠️ حدث خطأ أثناء إعادة التهيئة:\n' + err.message + '\n\nيرجى المحاولة مرة أخرى أو مراجعة الاتصال.');
  }
}

bootApp();

// ===========================
// مؤشر المزامنة (v2.5) — التعريف الموحد والوحيد
// يُستدعى من counters-handler.js عبر _updateSyncIndicator(state)
// ✅ FIX #5: دمج التعريفين في تعريف واحد شامل لجميع الحالات
// ===========================
/**
 * _updateSyncIndicator(state) — تحديث مؤشر الرأس فقط
 * تُستدعى من counters-handler.js الذي يمتلك منطق الحالة الكامل
 * @param {string} state - 'online' | 'offline' | 'syncing' | 'error' | 'pending' | 'saved'
 */
function _updateSyncIndicator(state) {
  const headerInd = document.getElementById('syncIndicator');
  if (!headerInd) return;

  const map = {
    online:  { text: '🟢 متصل',              color: '#27AE60' },
    offline: { text: '🔴 غير متصل',          color: '#C0392B' },
    syncing: { text: '🔄 جارٍ المزامنة',     color: '#F39C12' },
    error:   { text: '⚠️ خطأ في الحفظ',      color: '#C0392B' },
    pending: { text: '⏳ بانتظار الاتصال',    color: '#E67E22' },
    saved:   { text: '✅ متزامن',             color: '#27AE60' }
  };

  const s = map[state] || map.saved;
  headerInd.textContent = s.text;
  headerInd.style.color = s.color;

  // [FIX v10] تحديث آخر مزامنة في لوحة التحكم إن كانت مفتوحة
  const dashSync = document.getElementById('dashLastSync');
  if (dashSync) {
    dashSync.textContent = state === 'saved' || state === 'online'
      ? `✅ ${new Date().toLocaleTimeString('ar-SA', {hour:'2-digit',minute:'2-digit'})}`
      : s.text;
    dashSync.style.color = s.color;
  }
}

/**
 * updateSyncIndicator() — للتوافق مع أي استدعاء مباشر من الكود القديم
 * تُفوِّض إلى CountersAPI.updateSyncIndicator() إن كان محمَّلاً
 */
function updateSyncIndicator() {
  if (window.CountersAPI && typeof window.CountersAPI.updateSyncIndicator === 'function') {
    window.CountersAPI.updateSyncIndicator();
    return;
  }
  // احتياطي قبل تحميل معالج العدادات
  const indicator = document.querySelector('[data-sync-indicator]');
  if (indicator) {
    if (navigator.onLine) {
      indicator.textContent = '✅ متزامن';
      indicator.style.color = '#27AE60';
    } else {
      indicator.textContent = '📴 يعمل بدون اتصال';
      indicator.style.color = '#e74c3c';
    }
  }
  const headerInd = document.getElementById('syncIndicator');
  if (headerInd) {
    headerInd.textContent = navigator.onLine ? '✅ متزامن' : '📴 بدون اتصال';
    headerInd.style.color = navigator.onLine ? '#27AE60' : '#e74c3c';
  }
}

// ===========================
// PWA — Service Worker + Install Prompt
// ===========================

// تسجيل Service Worker
// ✅ [إصلاح]: scope ديناميكي بدلاً من مسار ثابت — يعمل مع أي رابط أو استضافة
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    const swScope = window.location.pathname.replace(/\/[^/]*$/, '/') || '/';
    navigator.serviceWorker.register('./sw.js', { scope: swScope })
      .then(reg => {
        console.log('✅ SW registered:', reg.scope);

        // إشعار بالتحديث إذا كان هناك إصدار جديد
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              _showUpdateBanner();
            }
          });
        });
      })
      .catch(err => console.warn('SW registration failed:', err));
  });
}

// بانر تحديث التطبيق
function _showUpdateBanner() {
  const banner = document.createElement('div');
  banner.style.cssText = `
    position:fixed;bottom:calc(70px + env(safe-area-inset-bottom, 0px));left:12px;right:12px;z-index:9999;
    background:#1A1A1A;color:white;border-radius:12px;padding:12px 16px;
    display:flex;align-items:center;justify-content:space-between;
    box-shadow:0 4px 20px rgba(0,0,0,0.4);font-family:Cairo,sans-serif;font-size:13px;
  `;
  banner.innerHTML = `
    <span>🔄 يوجد تحديث جديد للتطبيق</span>
    <button onclick="location.reload()" style="background:var(--red,#C0392B);color:white;border:none;border-radius:8px;padding:6px 12px;font-family:Cairo,sans-serif;font-size:12px;cursor:pointer;font-weight:700">تحديث الآن</button>
  `;
  document.body.appendChild(banner);
  setTimeout(() => banner.remove(), 15000);
}

// زر تثبيت التطبيق (Install Prompt)
let _deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  _deferredInstallPrompt = e;
  // أظهر زر التثبيت في الهيدر بعد ثانية
  setTimeout(() => {
    const header = document.getElementById('mainHeader');
    if (!header || document.getElementById('installPwaBtn')) return;
    const btn = document.createElement('button');
    btn.id = 'installPwaBtn';
    btn.textContent = '📲 تثبيت';
    btn.style.cssText = 'background:rgba(255,255,255,0.2);border:1px solid rgba(255,255,255,0.4);border-radius:20px;padding:3px 10px;font-size:11px;cursor:pointer;color:white;font-family:Cairo,sans-serif;font-weight:700';
    btn.onclick = async () => {
      if (!_deferredInstallPrompt) return;
      _deferredInstallPrompt.prompt();
      const { outcome } = await _deferredInstallPrompt.userChoice;
      if (outcome === 'accepted') btn.remove();
      _deferredInstallPrompt = null;
    };
    document.querySelector('.header-right')?.prepend(btn);
  }, 2000);
});

window.addEventListener('appinstalled', () => {
  document.getElementById('installPwaBtn')?.remove();
  _deferredInstallPrompt = null;
  console.log('✅ PWA installed');
});

// ── حفظ فوري قبل إغلاق المتصفح أو التطبيق ────────────────────
// ✅ [إصلاح Race Condition]: أُزيل DB_REF.update({...}) الشامل من هنا
// لأنه كان يتعارض مع معالج العدادات (counters-handler) ويسبب:
//   - Race Condition: كلا المعالجَين يكتبان في نفس اللحظة
//   - تضارب بيانات: قد يُعيد beforeunload قيماً قديمة فوق تحديثات جديدة
//   - خطأ "فشل الحفظ" الناتج عن تعارض الكتابتين المتزامنتين
// الاستراتيجية الصحيحة: الاعتماد على الحفظ الجزئي الفوري لكل قسم
// عبر _saveDB() بالـ Debounce، والحفظ المحلي هنا كشبكة أمان فقط.
window.addEventListener('beforeunload', () => {
  if (!DB.config || !currentUser) return;
  clearTimeout(_saveTimer);
  // حفظ محلي فوري دائماً — شبكة أمان للاسترداد عند إعادة الفتح
  try {
    localStorage.setItem('fuelStationDB', JSON.stringify({ ...DB, _savedAt: Date.now() }));
  } catch(e) {}
  // ❌ أُزيل: DB_REF.update({...}) الشامل — كان يسبب Race Condition مع counters-handler
  // التحديث الجزئي لكل قسم يعمل بشكل مستقل عبر _saveDB() في كل تغيير
});

// ── نسخة احتياطية تلقائية يومية في localStorage ──────────────
function _autoBackup() {
  try {
    const today = new Date().toISOString().split('T')[0];
    const lastBackup = localStorage.getItem('_lastAutoBackup');
    if (lastBackup === today || !DB.config) return;
    const backupKey = 'autoBackup_' + today;
    const backupData = {
      ...DB,
      _backupDate:    today,
      _backupTime:    new Date().toISOString(),
      _backupDevice:  _DEVICE_ID,
      _backupVersion: APP_VERSION
    };
    localStorage.setItem(backupKey, JSON.stringify(backupData));
    localStorage.setItem('_lastAutoBackup', today);
    // احتفظ بآخر 7 أيام فقط
    const allKeys = Object.keys(localStorage).filter(k => k.startsWith('autoBackup_')).sort();
    while (allKeys.length > 7) localStorage.removeItem(allKeys.shift());
    // [FIX v10] رفع نسخة احتياطية يومية لـ Firebase أيضاً
    if (_isOnline) {
      try {
        rtdb.ref(STATION_KEY + '/backups/' + today).set({
          date:    today,
          shifts:  (DB.shifts || []).length,
          stock:   DB.config?.currentStock || {},
          savedAt: Date.now()
        }); // نسخة خفيفة فقط — البيانات الكاملة في المسار الرئيسي
      } catch(e) {}
    }
    console.log('💾 نسخة احتياطية تلقائية:', today);
  } catch(e) {}
}

// [FIX v10] قائمة النسخ الاحتياطية المتاحة للاستعادة
function renderBackupList() {
  const container = document.getElementById('backupListContainer');
  if (!container) return;
  const keys = Object.keys(localStorage).filter(k => k.startsWith('autoBackup_')).sort().reverse();
  if (keys.length === 0) {
    container.innerHTML = '<div class="alert alert-info">لا توجد نسخ احتياطية محلية متاحة</div>';
    return;
  }
  container.innerHTML = keys.map(key => {
    let data = {};
    try { data = JSON.parse(localStorage.getItem(key)); } catch(e) {}
    const date    = data._backupDate    || key.replace('autoBackup_','');
    const shifts  = (data.shifts || []).length;
    const device  = data._backupDevice  ? `(${data._backupDevice.slice(-6)})` : '';
    return `<div style="display:flex;align-items:center;justify-content:space-between;padding:10px;border-bottom:1px solid var(--gray-200);font-size:13px">
      <div>
        <div style="font-weight:700">📅 ${date}</div>
        <div style="font-size:11px;color:var(--gray-500)">${shifts} وردية ${device}</div>
      </div>
      <div style="display:flex;gap:6px">
        <button class="btn btn-ghost btn-sm" onclick="_downloadLocalBackup('${key}')" style="font-size:11px">⬇️ تنزيل</button>
        <button class="btn btn-sm" onclick="_restoreLocalBackup('${key}')" style="font-size:11px;background:#C0392B;color:white">♻️ استعادة</button>
      </div>
    </div>`;
  }).join('');
}

function _downloadLocalBackup(key) {
  try {
    const data = localStorage.getItem(key);
    if (!data) return;
    const blob = new Blob([data], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = key + '.json';
    a.click();
    URL.revokeObjectURL(url);
  } catch(e) { alert('فشل التنزيل: ' + e.message); }
}

function _restoreLocalBackup(key) {
  if (!confirm(`⚠️ استعادة النسخة الاحتياطية: ${key}\n\nسيتم استبدال جميع البيانات الحالية.\nهل تريد المتابعة؟`)) return;
  try {
    const data = JSON.parse(localStorage.getItem(key));
    if (!data?.config) { alert('❌ ملف النسخة الاحتياطية غير صالح'); return; }
    DB = { config: data.config, users: data.users || {}, shifts: data.shifts || [], meters: data.meters || [], inventory: data.inventory || [], supply: data.supply || [], archives: data.archives || [], activityLog: data.activityLog || [] };
    saveDB();
    logActivity('restore', `استعادة من نسخة احتياطية محلية: ${key}`);
    alert('✅ تمت الاستعادة بنجاح. سيتم إعادة تحميل الصفحة.');
    location.reload();
  } catch(e) { alert('❌ فشل الاستعادة: ' + e.message); }
}


let _dateRefreshInterval = null;
function _startDateRefresh() {
  if (_dateRefreshInterval) return;
  _dateRefreshInterval = setInterval(() => {
    const el = document.getElementById('headerDate');
    if (!el || !currentUser) return;
    const now = new Date();
    el.textContent = `${now.getDate()}/${now.getMonth()+1}/${now.getFullYear()}`;
    // تحديث الهجري
    try {
      const hijriEl = document.getElementById('headerHijriDate');
      if (hijriEl) {
        const hijriNow = now.toLocaleDateString('ar-SA-u-ca-islamic', { year:'numeric', month:'short', day:'numeric' });
        hijriEl.textContent = '| ' + hijriNow;
      }
    } catch(e) {}
  }, 60000);
}
