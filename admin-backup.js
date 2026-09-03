function clearActivityLog() {
  if (currentUser?.role !== 'owner') return;
  _showConfirmDialog(
    '🗑️ مسح سجل الأنشطة',
    'هل تريد مسح <strong>جميع سجلات الأنشطة</strong>؟ لا يمكن التراجع عن هذا.',
    () => { DB.activityLog = []; saveDB(); renderActivityLog(); _showToast('تم مسح سجل الأنشطة', 'info'); },
    true
  );
}

// ═══════════════════════════════════════════════════════════════
// [v13] renderAuditLogPage — عرض سجل تقارير الجرد التاريخية
// ═══════════════════════════════════════════════════════════════
function renderAuditLogPage() {
  const container = document.getElementById('auditLogContainer');
  if (!container) return;

  const auditRecords = [...DB.meters]
    .filter(m => m.type === 'audit')
    .sort((a, b) => (b.id || 0) - (a.id || 0));

  if (auditRecords.length === 0) {
    container.innerHTML = '<div class="alert alert-info">لا توجد سجلات جرد بعد. سجّل جرداً أولاً من صفحة الإدخال.</div>';
    return;
  }

  const cfg = DB.config;
  const prices = cfg.prices || {};

  container.innerHTML = auditRecords.map((audit, idx) => {
    const diffColor = !audit.auditDiff ? '#27AE60'
      : audit.auditDiff > 0 ? '#27AE60' : '#E74C3C';
    const diffLabel = !audit.auditDiff ? 'مطابق'
      : audit.auditDiff > 0 ? `فائض +${fmt(audit.auditDiff, 2)} ر.س`
      : `عجز ${fmt(audit.auditDiff, 2)} ر.س`;

    // الفترة المشمولة
    const nextAudit = idx < auditRecords.length - 1 ? auditRecords[idx + 1] : null;
    const shiftsInPeriod = nextAudit
      ? DB.shifts.filter(s => (s.id || 0) > (nextAudit.id || 0) && (s.id || 0) <= (audit.id || 0) && s.type !== 'audit')
      : DB.shifts.filter(s => (s.id || 0) <= (audit.id || 0) && s.type !== 'audit');

    const pumpReadings = (cfg.pumps || []).map(p => {
      const pd = audit.pumps?.find(x => x.pumpId === p.id);
      const typeLabel = p.type === 'diesel' ? 'ديزل' : (p.type === 'n91' || p.type === '91') ? '91' : '95';
      const typeColor = p.type === 'diesel' ? '#7D6608' : (p.type === 'n91' || p.type === '91') ? '#1E8449' : '#922B21';
      return pd ? `<div style="text-align:center;padding:6px 4px;background:rgba(47,79,79,0.08);border-radius:6px;border:1px solid rgba(47,79,79,0.2)">
        <div style="font-size:9px;color:${typeColor};font-weight:700">${escapeHTML(p.name)} (${typeLabel})</div>
        <div style="font-size:15px;font-weight:900;color:#1B2631">${fmt(pd.reading)}</div>
      </div>` : '';
    }).filter(Boolean).join('');

    return `<div class="shift-row audit-row" style="margin-bottom:10px;cursor:pointer" onclick="this.classList.toggle('expanded')">
      <div class="shift-row-header" style="background:linear-gradient(90deg,rgba(47,79,79,0.15),transparent)">
        <div>
          <div style="display:flex;align-items:center;gap:8px">
            <span class="audit-row-badge">📑 جرد #${auditRecords.length - idx}</span>
            <span style="font-size:12px;font-weight:700;color:#2F4F4F">${audit.date} — ${audit.time || ''}</span>
          </div>
          ${audit.hijriDate ? `<div style="font-size:10px;color:#5D6D7E;margin-top:2px">🌙 ${audit.hijriDate}</div>` : ''}
          <div style="font-size:10px;color:var(--gray-500);margin-top:2px">بواسطة: ${escapeHTML(audit.enteredBy || '—')} | ${shiftsInPeriod.length} وردية في الفترة</div>
        </div>
        <div style="text-align:left">
          <div style="font-size:12px;font-weight:800;color:${diffColor}">${diffLabel}</div>
          <div style="font-size:10px;color:var(--gray-500)">${fmt(audit.expectedRevenue || 0, 2)} ر.س متوقع</div>
        </div>
      </div>
      <div class="shift-row-body" style="padding:12px">
        <!-- قراءات العدادات -->
        <div style="font-size:12px;font-weight:800;color:#2F4F4F;margin-bottom:8px">🔢 قراءات العدادات</div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(90px,1fr));gap:6px;margin-bottom:12px">
          ${pumpReadings || '<div style="color:var(--gray-500);font-size:11px">لا توجد قراءات</div>'}
        </div>

        <!-- استهلاك الفترة -->
        <div style="font-size:12px;font-weight:800;color:#2F4F4F;margin-bottom:8px">📊 استهلاك الفترة</div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:12px">
          <div style="text-align:center;background:rgba(212,172,13,0.1);border-radius:6px;padding:8px;border:1px solid #F9E87A">
            <div style="font-size:10px;font-weight:700;color:#7D6608">⬛ ديزل</div>
            <div style="font-size:16px;font-weight:900;color:#5D4E00">${fmt(audit.periodDiesel || 0)}</div>
            <div style="font-size:9px;color:#9A7D0A">لتر | ${fmt((audit.periodDiesel||0)*prices.diesel, 0)} ر.س</div>
          </div>
          <div style="text-align:center;background:rgba(39,174,96,0.1);border-radius:6px;padding:8px;border:1px solid #52BE80">
            <div style="font-size:10px;font-weight:700;color:#1E8449">🟢 بنزين 91</div>
            <div style="font-size:16px;font-weight:900;color:#1B5E20">${fmt(audit.periodN91 || 0)}</div>
            <div style="font-size:9px;color:#27AE60">لتر | ${fmt((audit.periodN91||0)*prices.n91, 0)} ر.س</div>
          </div>
          <div style="text-align:center;background:rgba(192,57,43,0.1);border-radius:6px;padding:8px;border:1px solid #E74C3C">
            <div style="font-size:10px;font-weight:700;color:#922B21">🔴 بنزين 95</div>
            <div style="font-size:16px;font-weight:900;color:#7B0000">${fmt(audit.periodN95 || 0)}</div>
            <div style="font-size:9px;color:#C0392B">لتر | ${fmt((audit.periodN95||0)*prices.n95, 0)} ر.س</div>
          </div>
        </div>

        <!-- الأرصدة النقدية -->
        <div style="font-size:12px;font-weight:800;color:#2F4F4F;margin-bottom:8px">💰 الأرصدة النقدية المُدخَلة</div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:10px">
          <div style="text-align:center;background:rgba(212,172,13,0.08);border-radius:6px;padding:8px;border:1px solid #F9E87A">
            <div style="font-size:9px;color:#7D6608;font-weight:700">💵 نقدية</div>
            <div style="font-size:14px;font-weight:900;color:#5D4E00">${fmt(audit.auditCash || 0, 2)}</div>
          </div>
          <div style="text-align:center;background:rgba(21,101,192,0.08);border-radius:6px;padding:8px;border:1px solid #90CAF9">
            <div style="font-size:9px;color:#1565C0;font-weight:700">🌐 شبكة</div>
            <div style="font-size:14px;font-weight:900;color:#0D47A1">${fmt(audit.auditNetwork || 0, 2)}</div>
          </div>
          <div style="text-align:center;background:rgba(0,0,0,0.04);border-radius:6px;padding:8px;border:1px solid #E0E0E0">
            <div style="font-size:9px;color:#555;font-weight:700">📄 فواتير</div>
            <div style="font-size:14px;font-weight:900;color:#333">${fmt(audit.auditInvoices || 0, 2)}</div>
          </div>
        </div>

        <!-- النتيجة الإجمالية -->
        <div style="background:linear-gradient(135deg,#1B2631,#2F4F4F);color:white;border-radius:8px;padding:10px;display:flex;justify-content:space-between;align-items:center">
          <div>
            <div style="font-size:10px;opacity:0.8">الإجمالي الكلي</div>
            <div style="font-size:18px;font-weight:900;color:#A9D5D5">${fmt(audit.auditTotal || 0, 2)} ر.س</div>
          </div>
          <div style="text-align:left">
            <div style="font-size:10px;opacity:0.8">المتوقع</div>
            <div style="font-size:14px;font-weight:800;color:#A9D5D5">${fmt(audit.expectedRevenue || 0, 2)} ر.س</div>
          </div>
          <div style="text-align:left">
            <div style="font-size:10px;opacity:0.8">الفرق</div>
            <div style="font-size:16px;font-weight:900;color:${diffColor.replace('#','') === 'E74C3C' ? '#FF8888' : '#7DFFB3'}">${diffLabel}</div>
          </div>
        </div>
      </div>
    </div>`;
  }).join('');
}

// ═══════════════════════════════════════════════════════════════
// [v13] triggerGlobalRecalculation — محرك إعادة الحساب الشامل
// يُستدعى عند أي تعديل أو حذف لأي سجل
// ═══════════════════════════════════════════════════════════════
function triggerGlobalRecalculation() {
  try {
    recalculateAndRenderDashboard();
    renderMetersTable();
    renderLog();
    renderInventoryTable();
    updateSinceAuditWidget();
    if (typeof renderCharts === 'function') setTimeout(renderCharts, 150);
  } catch(e) { console.warn('[triggerGlobalRecalculation]', e); }
}

// ===========================
// FEATURE 19: BACKUP & RESTORE
// ===========================
// ✅ FIX #3: تحقق عميق من صحة ملف النسخة الاحتياطية قبل تطبيقه
function _validateBackupData(d) {
  const errors = [];
  if (!d || typeof d !== 'object') { errors.push('البيانات غير صالحة'); return errors; }
  if (!d.config || typeof d.config !== 'object') errors.push('إعدادات المحطة مفقودة');
  if (!Array.isArray(d.shifts))    errors.push('بيانات الورديات غير صالحة');
  if (!Array.isArray(d.meters))    errors.push('بيانات العدادات غير صالحة');
  if (!Array.isArray(d.inventory)) errors.push('بيانات المخزون غير صالحة');
  if (!Array.isArray(d.supply))    errors.push('بيانات التوريد غير صالحة');
  if (!d.users || (typeof d.users !== 'object') || Object.keys(d.users).length === 0) errors.push('قائمة المستخدمين مفقودة');
  if (d.config && !d.config.stationName) errors.push('اسم المحطة مفقود في الإعدادات');
  if (d.config && !Array.isArray(d.config.pumps)) errors.push('إعدادات الطلمبات غير صالحة');
  // تحقق من أن الأرقام منطقية
  if (d.shifts && d.shifts.length > 50000) errors.push('عدد الورديات كبير جداً — الملف قد يكون تالفاً');
  return errors;
}

function _doRestoreBackup() {
  if (!window._backupData) { _showToast('يرجى اختيار ملف النسخة الاحتياطية أولاً', 'warning'); return; }
  // ✅ تحقق من صحة البيانات قبل تطبيقها
  const validationErrors = _validateBackupData(window._backupData);
  if (validationErrors.length > 0) {
    alert('⚠️ الملف يحتوي على بيانات غير صالحة:\n' + validationErrors.join('\n'));
    return;
  }
  DB = window._backupData;
  if (!DB.activityLog) DB.activityLog = [];
  saveDB();
  _showToast('تم استعادة البيانات بنجاح! سيتم إعادة تحميل التطبيق...', 'success', 2000);
  setTimeout(() => window.location.reload(), 2000);
}

function downloadBackup() {
  const backupData = { version:'30', exportDate:new Date().toISOString(), stationName:DB.config?.stationName||'', data:DB };
  const json = JSON.stringify(backupData, null, 2);
  const blob = new Blob([json], {type:'application/json;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const dateStr = new Date().toISOString().split('T')[0];
  a.href = url; a.download = `backup_${(DB.config?.stationName||'station').replace(/\s+/g,'_')}_${dateStr}.json`; a.click(); URL.revokeObjectURL(url);
  logActivity('backup', `تم تنزيل نسخة احتياطية بتاريخ ${dateStr}`);
  alert('✅ تم تنزيل النسخة الاحتياطية بنجاح');
}
function previewBackup(input) {
  const file = input.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const parsed = JSON.parse(e.target.result);
      if (!parsed.data || !parsed.data.config) { alert('⚠️ الملف غير صالح أو تالف'); return; }
      const d = parsed.data;
      const preview = document.getElementById('backupPreview');
      preview.style.display = 'block';
      preview.innerHTML = `<div style="font-weight:800;font-size:14px;margin-bottom:8px;color:var(--red-dark)">📋 معاينة النسخة الاحتياطية</div><div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:12.5px"><div>🏢 المحطة: <strong>${parsed.stationName||'—'}</strong></div><div>📅 التصدير: <strong>${parsed.exportDate?new Date(parsed.exportDate).toLocaleDateString('ar'):'—'}</strong></div><div>📝 الورديات: <strong>${(d.shifts||[]).length}</strong></div><div>🚛 التوريدات: <strong>${(d.supply||[]).length}</strong></div><div>👥 المستخدمون: <strong>${Object.keys(d.users||{}).length}</strong></div><div>📦 الأرشيف: <strong>${(d.archives||[]).length} شهر</strong></div></div>`;
      window._backupData = d;
      document.getElementById('restoreBtn').style.display = 'block';
    } catch(err) { alert('⚠️ خطأ في قراءة الملف: ' + err.message); }
  };
  reader.readAsText(file);
}
function restoreBackup() {
  if (currentUser?.role !== 'owner') { alert('⛔ هذه الصلاحية للمالك فقط'); return; }
  if (!window._backupData) { alert('⚠️ يرجى اختيار ملف النسخة الاحتياطية أولاً'); return; }
  // نستخدم dialog مؤكد بدلاً من confirm
  _showConfirmDialog(
    '⚠️ تأكيد الاستعادة',
    'سيتم استبدال <strong>جميع البيانات الحالية</strong> بالبيانات المستعادة.<br>هذا الإجراء لا يمكن التراجع عنه!',
    () => _doRestoreBackup(),
    true
  );
  // _doRestoreBackup() تتكفل بتنفيذ الاستعادة عند تأكيد المستخدم
}


// ===========================
// تحسين 1: حماية من هجمات XSS - تنظيف المدخلات
// ===========================
function sanitize(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ===========================
// تحسين 2: Rate Limiting لمنع هجمات تخمين كلمة المرور
// يُخزَّن في sessionStorage ليبقى فعّالاً عند تحديث الصفحة
// ===========================
function _getLoginState() {
  try { return JSON.parse(sessionStorage.getItem('_loginState') || '{"count":0,"lockedUntil":0}'); }
  catch(e) { return { count: 0, lockedUntil: 0 }; }
}
function _setLoginState(state) {
  try { sessionStorage.setItem('_loginState', JSON.stringify(state)); } catch(e) {}
}

function _checkLoginRateLimit() {
  const now = Date.now();
  const state = _getLoginState();
  if (state.lockedUntil > now) {
    const remaining = Math.ceil((state.lockedUntil - now) / 1000);
    return { allowed: false, message: `⛔ تم تجميد الحساب مؤقتاً. حاول بعد ${remaining} ثانية.` };
  }
  return { allowed: true };
}

function _recordFailedLogin() {
  const state = _getLoginState();
  state.count++;
  if (state.count >= 5) {
    state.lockedUntil = Date.now() + 30000; // 30 ثانية
    state.count = 0;
  }
  _setLoginState(state);
}

function _clearLoginAttempts() {
  _setLoginState({ count: 0, lockedUntil: 0 });
}

// ===========================
// تحسين 3: جلسة تنتهي تلقائياً بعد 8 ساعات من الخمول
// ===========================
let _sessionTimer = null;
const SESSION_TIMEOUT = 8 * 60 * 60 * 1000; // 8 ساعات

function _resetSessionTimer() {
  clearTimeout(_sessionTimer);
  _sessionTimer = setTimeout(() => {
    if (currentUser) {
      alert('⏰ انتهت جلستك تلقائياً بسبب الخمول. يرجى تسجيل الدخول مرة أخرى.');
      logout();
    }
  }, SESSION_TIMEOUT);
}

function _initSessionWatcher() {
  ['click','keydown','touchstart','scroll'].forEach(ev =>
    document.addEventListener(ev, _resetSessionTimer, { passive: true })
  );
  _resetSessionTimer();
}

// ===========================
// تحسين 4: تأكيد ثنائي قبل الحذف والاستعادة (Custom Dialog)
// ===========================
function _showConfirmDialog(title, message, onConfirm, danger = false) {
  const old = document.getElementById('_confirmDialog');
  if (old) old.remove();
  const d = document.createElement('div');
  d.id = '_confirmDialog';
  d.style.cssText = `
    position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9999;
    display:flex;align-items:center;justify-content:center;padding:20px;
    animation:fadeIn 0.15s ease;
  `;
  d.innerHTML = `
    <div style="background:var(--white,#fff);border-radius:16px;max-width:360px;width:100%;box-shadow:0 8px 40px rgba(0,0,0,0.3);overflow:hidden">
      <div style="padding:16px 20px;background:${danger ? 'linear-gradient(135deg,#922B21,#C0392B)' : 'linear-gradient(135deg,#1A5276,#2471A3)'};color:white">
        <div style="font-size:16px;font-weight:800">${title}</div>
      </div>
      <div style="padding:20px">
        <p style="font-size:14px;color:var(--text-secondary,#555);line-height:1.7;margin-bottom:20px">${message}</p>
        <div style="display:flex;gap:8px">
          <button id="_confirmYes" style="flex:1;padding:10px;border-radius:8px;border:none;cursor:pointer;font-family:Cairo,sans-serif;font-weight:700;font-size:14px;background:${danger ? '#C0392B' : '#1A5276'};color:white">تأكيد</button>
          <button id="_confirmNo" style="flex:0 0 auto;padding:10px 20px;border-radius:8px;border:1px solid #ccc;cursor:pointer;font-family:Cairo,sans-serif;font-weight:700;font-size:14px;background:#f5f5f5">إلغاء</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(d);
  document.getElementById('_confirmYes').onclick = () => { d.remove(); onConfirm(); };
  document.getElementById('_confirmNo').onclick = () => d.remove();
  d.onclick = (e) => { if (e.target === d) d.remove(); };
}

// ===========================
// تحسين 5: مشاركة تقرير الوردية عبر واتساب
// ===========================
function shareShiftWhatsApp(shiftId) {
  // ══════════════════════════════════════════════════════════════
  // shareShiftWhatsApp — تقرير واتساب كامل مع حل مشكلة الحقول الفارغة
  // الإصلاحات:
  //   1. ربط صحيح لكل حقل من shift object (diesel/n91/n95/totalMoney/cash…)
  //   2. إضافة قراءات العدادات لكل طلمبة من DB.meters
  //   3. إضافة التوريدات التي تمت في نفس يوم الوردية من DB.supply
  //   4. حساب آخر 24 ساعة الصحيح
  //   5. المخزون الفعلي وقت الوردية من DB.inventory
  // ══════════════════════════════════════════════════════════════
  const shift = DB.shifts.find(s => s.id == shiftId) || DB.shifts[DB.shifts.length - 1];
  if (!shift) { alert('لا توجد وردية'); return; }

  const cfg       = DB.config;
  const prices    = cfg.prices   || {};
  const stock     = cfg.currentStock || {};
  const minStock  = cfg.minStock || 5000;

  // ── 1. بيانات الوردية الأساسية ──────────────────────────────
  // الربط الصحيح للحقول (diesel, n91, n95 وليس fuel1/fuel2/…)
  const shiftName   = cfg.shifts.find(s => s.abbr === shift.shiftType)?.name || shift.shiftType || '—';
  const dieselL     = shift.diesel      || 0;
  const n91L        = shift.n91         || 0;
  const n95L        = shift.n95         || 0;
  const totalMoney  = shift.totalMoney  || 0;
  const netPay      = shift.network     || 0;
  const invoicesPay = shift.invoices    || 0;
  const suppliedPay = shift.supplied    || 0;
  const cashPay     = shift.cash        || 0;
  const enteredBy   = shift.enteredBy   || '—';

  const dieselRial = dieselL * (prices.diesel || 0);
  const n91Rial    = n91L    * (prices.n91    || 0);
  const n95Rial    = n95L    * (prices.n95    || 0);

  // ── 2. قراءات العدادات (DB.meters) ──────────────────────────
  // البحث بالتاريخ + نوع الوردية مطابقاً للـ shift
  const meterEntry = (DB.meters || []).find(
    m => m.date === shift.date && m.shiftType === shift.shiftType && m.type !== 'opening'
  );
  let metersSection = '';
  if (meterEntry && meterEntry.pumps?.length) {
    const metersLines = meterEntry.pumps.map(pd => {
      const pump     = (cfg.pumps || []).find(x => x.id === pd.pumpId);
      const pumpName = pump?.name || `طلمبة ${pd.pumpId}`;
      const typeLabel = pump?.type === 'diesel' ? 'ديزل' : pump?.type === 'n91' ? 'بنزين 91' : pump?.type === 'n95' ? 'بنزين 95' : '—';
      // الاستهلاك = القراءة الحالية ناقص القراءة السابقة
      const prevReading = typeof getImmediatePreviousReading === 'function'
        ? getImmediatePreviousReading(pd.pumpId, shift.date, shift.shiftType)
        : (pd.reading - (pd.consumption || 0));
      const cons = Math.max(0, pd.reading - prevReading);
      return `    ${pumpName} (${typeLabel}): قراءة ${fmt(pd.reading)} | استهلاك ↓${fmt(cons)} ل`;
    }).join('\n');
    metersSection = `\n🔢 قراءات العدادات:\n${metersLines}`;
  }

  // ── 3. توريدات الوقود — فلتر زمني صارم بحسب توقيت الوردية ──
  // يظهر قسم التوريد فقط إذا وُجد توريد مسجَّل خلال ساعات هذه الوردية تحديداً.
  const supplyLabels = { diesel: 'ديزل', '91': 'بنزين 91', '95': 'بنزين 95' };
  const shiftCfgWA   = (cfg.shifts || []).find(x => x.abbr === shift.shiftType);
  function _supplyInShiftWA(s) {
    if (s.date !== shift.date) return false;
    if (!s.id) return false;
    // الأولوية 1: ساعات الوردية
    if (shiftCfgWA?.startHour !== undefined && shiftCfgWA?.endHour !== undefined) {
      const ts = new Date(s.id);
      const h  = ts.getHours() + ts.getMinutes() / 60;
      const st = shiftCfgWA.startHour;
      const en = shiftCfgWA.endHour;
      if (st <= en) return h >= st && h < en;
      else          return h >= st || h < en;
    }
    // الأولوية 2: نطاق id الوردية
    const sortedShifts = [...DB.shifts].sort((a, b) => (a.id || 0) - (b.id || 0));
    const shiftIdx     = sortedShifts.findIndex(x => x.id === shift.id);
    const thisId       = shift.id || 0;
    const nextId       = shiftIdx >= 0 && shiftIdx < sortedShifts.length - 1
                         ? (sortedShifts[shiftIdx + 1].id || Infinity)
                         : Infinity;
    return s.id >= thisId && s.id < nextId;
  }
  const supplyForShiftWA = (DB.supply || []).filter(_supplyInShiftWA);
  let supplySection = '';
  if (supplyForShiftWA.length > 0) {
    const supplyLines = supplyForShiftWA.map(s => {
      const fuelLabel  = supplyLabels[s.type] || s.type;
      const invoiceStr = s.invoice ? ` | فاتورة: ${s.invoice}` : '';
      const driverStr  = s.driver  ? ` | السائق: ${s.driver}`  : '';
      return `    🚛 ${fuelLabel}: ${fmt(s.qty)} لتر${invoiceStr}${driverStr}`;
    }).join('\n');
    supplySection = `\n🚛 توريدات خلال الوردية (${shift.date}):\n${supplyLines}`;
  }

  // ── 4. استهلاك اليوم (مجموع آخر دورة ورديات كاملة) ──
  const last24    = getLast24hShifts();
  const cons24D   = last24.reduce((a, s) => a + (s.diesel || 0), 0);
  const cons24_91 = last24.reduce((a, s) => a + (s.n91    || 0), 0);
  const cons24_95 = last24.reduce((a, s) => a + (s.n95    || 0), 0);

  // ── 5. المخزون الفعلي بعد الوردية ──────────────────────────
  // المعادلة: مخزون قبل الوردية + توريد خلالها − استهلاك الوردية
  const invRowWA = (DB.inventory || []).find(
    r => r.date === shift.date && r.shiftType === shift.shiftType && r.type === 'shift'
  );
  const supplyDuringShiftWA = { diesel: 0, n91: 0, n95: 0 };
  supplyForShiftWA.forEach(s => {
    const k = s.type === 'diesel' ? 'diesel' : s.type === '91' ? 'n91' : 'n95';
    supplyDuringShiftWA[k] += (s.qty || 0);
  });
  let stockD, stockN91, stockN95;
  if (invRowWA) {
    stockD   = invRowWA.diesel ?? 0;
    stockN91 = invRowWA.n91    ?? 0;
    stockN95 = invRowWA.n95    ?? 0;
  } else {
    stockD   = (stock.diesel ?? 0) - dieselL + supplyDuringShiftWA.diesel;
    stockN91 = (stock.n91    ?? 0) - n91L   + supplyDuringShiftWA.n91;
    stockN95 = (stock.n95    ?? 0) - n95L   + supplyDuringShiftWA.n95;
  }

  // ── تنبيهات المخزون ─────────────────────────────────────────
  let stockAlerts = '';
  [{ k:'diesel', v: stockD, lb:'ديزل' }, { k:'n91', v: stockN91, lb:'91' }, { k:'n95', v: stockN95, lb:'95' }].forEach(r => {
    if (r.v <= 0)          stockAlerts += `\n  🚨 نفد مخزون ${r.lb}!`;
    else if (r.v < minStock) stockAlerts += `\n  ⚠️ مخزون ${r.lb} منخفض (${fmt(r.v)} لتر)`;
  });

  // ── بناء أقسام النص ─────────────────────────────────────────
  // استهلاك الوردية (يُظهر فقط أنواع الوقود النشطة)
  let consLines = '';
  if (dieselL > 0) consLines += `  ⬛ ديزل: ${fmt(dieselL)} لتر → ${fmt(dieselRial, 2)} ر.س\n`;
  if (n91L   > 0) consLines += `  🟢 بنزين 91: ${fmt(n91L)} لتر → ${fmt(n91Rial, 2)} ر.س\n`;
  if (n95L   > 0) consLines += `  🔴 بنزين 95: ${fmt(n95L)} لتر → ${fmt(n95Rial, 2)} ر.س\n`;
  if (!consLines) consLines = '  (لا استهلاك مسجَّل)\n';

  // المالي (يُظهر دائماً الإجمالي + النقدية، والباقي عند وجود قيمة)
  // الإصلاح 3: عرض جميع طرق الدفع دائماً بقيمها الحقيقية
  let moneyLines = `  💰 الإجمالي: ${fmt(totalMoney, 2)} ر.س\n`;
  moneyLines += `  🌐 شبكة: ${fmt(netPay, 2)} ر.س\n`;
  moneyLines += `  📄 فواتير: ${fmt(invoicesPay, 2)} ر.س\n`;
  if (suppliedPay > 0) moneyLines += `  📦 توريد مالي: ${fmt(suppliedPay, 2)} ر.س\n`;
  moneyLines += `  💵 نقدية: ${fmt(cashPay, 2)} ر.س`;

  // المخزون
  let stockLines = '';
  if (stockD   > 0) stockLines += `  ⬛ ديزل: ${fmt(stockD)} لتر\n`;
  if (stockN91 > 0) stockLines += `  🟢 بنزين 91: ${fmt(stockN91)} لتر\n`;
  if (stockN95 > 0) stockLines += `  🔴 بنزين 95: ${fmt(stockN95)} لتر\n`;
  if (!stockLines) stockLines = '  (لا بيانات مخزون)\n';

  // آخر 24 ساعة
  let cons24Lines = '';
  if (cons24D   > 0) cons24Lines += `  ⬛ ديزل: ${fmt(cons24D)} لتر\n`;
  if (cons24_91 > 0) cons24Lines += `  🟢 بنزين 91: ${fmt(cons24_91)} لتر\n`;
  if (cons24_95 > 0) cons24Lines += `  🔴 بنزين 95: ${fmt(cons24_95)} لتر\n`;
  if (!cons24Lines) cons24Lines = '  لا توجد بيانات\n';

  // ── تجميع الرسالة النهائية ───────────────────────────────────
  const text = [
    `📊 تقرير الوردية`,
    `🏢 ${cfg.stationName}${cfg.stationLocation ? ' — ' + cfg.stationLocation : ''}`,
    `📅 ${formatDate(shift.date)} | ⏰ ${shiftName}`,
    enteredBy !== '—' ? `👤 بواسطة: ${enteredBy}` : null,
    `━━━━━━━━━━━━━━━━━━━`,
    `⛽ الاستهلاك:`,
    consLines.trimEnd(),
    metersSection ? `━━━━━━━━━━━━━━━━━━━${metersSection}` : null,
    supplySection ? `━━━━━━━━━━━━━━━━━━━${supplySection}` : null,
    `━━━━━━━━━━━━━━━━━━━`,
    `💳 المالي:`,
    moneyLines.trimEnd(),
    `━━━━━━━━━━━━━━━━━━━`,
    `🕐 استهلاك اليوم:`,
    cons24Lines.trimEnd(),
    `━━━━━━━━━━━━━━━━━━━`,
    `🛢️ المخزون بعد الوردية:`,
    stockLines.trimEnd() + (stockAlerts || ''),
    `━━━━━━━━━━━━━━━━━━━`,
    `📱 نظام إدارة محطة الوقود`
  ].filter(l => l !== null).join('\n');

  const url = 'https://wa.me/?text=' + encodeURIComponent(text);
  window.open(url, '_blank');
}

// ===========================
// تحسين 6: طباعة تقرير الوردية
// ===========================
function printShiftReport(shiftId) {
  const shift = shiftId ? DB.shifts.find(s => s.id == shiftId) : DB.shifts[DB.shifts.length - 1];
  if (!shift) { alert('لا توجد وردية'); return; }
  const cfg      = DB.config;
  const prices   = cfg.prices || {};
  const shiftName = cfg.shifts.find(s => s.abbr === shift.shiftType)?.name || shift.shiftType;

  // ── الحقول الأساسية (الربط الصحيح) ─────────────────────────
  const dieselL     = shift.diesel     || 0;
  const n91L        = shift.n91        || 0;
  const n95L        = shift.n95        || 0;
  const totalMoney  = shift.totalMoney || 0;
  const cashPay     = shift.cash       || 0;
  const netPay      = shift.network    || 0;
  const invoicesPay = shift.invoices   || 0;
  const suppliedPay = shift.supplied   || 0;
  const enteredBy   = shift.enteredBy  || '—';

  // ── قراءات العدادات ─────────────────────────────────────────
  const meterEntry = (DB.meters || []).find(
    m => m.date === shift.date && m.shiftType === shift.shiftType && m.type !== 'opening'
  );
  let metersTableHtml = '';
  if (meterEntry?.pumps?.length) {
    const rows = meterEntry.pumps.map(pd => {
      const pump = (cfg.pumps || []).find(x => x.id === pd.pumpId);
      const pumpName = pump?.name || `طلمبة ${pd.pumpId}`;
      const typeLabel = pump?.type === 'diesel' ? 'ديزل' : pump?.type === 'n91' ? 'بنزين 91' : pump?.type === 'n95' ? 'بنزين 95' : '—';
      const prev = typeof getImmediatePreviousReading === 'function'
        ? getImmediatePreviousReading(pd.pumpId, shift.date, shift.shiftType)
        : pd.reading - (pd.consumption || 0);
      const cons = Math.max(0, pd.reading - prev);
      return `<tr><td>${sanitize(pumpName)}</td><td>${typeLabel}</td><td>${fmt(prev)}</td><td>${fmt(pd.reading)}</td><td style="color:#27AE60;font-weight:700">${fmt(cons)}</td></tr>`;
    }).join('');
    metersTableHtml = `
      <h3 style="color:#C0392B;margin-top:20px">🔢 قراءات العدادات</h3>
      <table>
        <tr><th>الطلمبة</th><th>النوع</th><th>القراءة السابقة</th><th>القراءة الحالية</th><th>الاستهلاك (ل)</th></tr>
        ${rows}
      </table>`;
  }

  // ── التوريدات في يوم الوردية ─────────────────────────────────
  const supplyLabels = { diesel: 'ديزل', '91': 'بنزين 91', '95': 'بنزين 95' };
  const supplyOnDay  = (DB.supply || []).filter(s => s.date === shift.date);
  let supplyTableHtml = '';
  if (supplyOnDay.length > 0) {
    const rows = supplyOnDay.map(s => {
      const fuelLabel = supplyLabels[s.type] || s.type;
      return `<tr>
        <td>${fuelLabel}</td>
        <td style="font-weight:700">${fmt(s.qty)} لتر</td>
        <td>${sanitize(s.invoice || '—')}</td>
        <td>${sanitize(s.driver  || '—')}</td>
      </tr>`;
    }).join('');
    supplyTableHtml = `
      <h3 style="color:#2E7D32;margin-top:20px">🚛 توريدات الوقود</h3>
      <table>
        <tr><th>نوع الوقود</th><th>الكمية</th><th>رقم الفاتورة</th><th>السائق</th></tr>
        ${rows}
      </table>`;
  }

  // ── المخزون بعد الوردية ─────────────────────────────────────
  const invRow = (DB.inventory || []).find(
    r => r.date === shift.date && r.shiftType === shift.shiftType && r.type === 'shift'
  );
  const stockD   = invRow?.diesel ?? cfg.currentStock?.diesel ?? 0;
  const stockN91 = invRow?.n91    ?? cfg.currentStock?.n91    ?? 0;
  const stockN95 = invRow?.n95    ?? cfg.currentStock?.n95    ?? 0;

  const win = window.open('', '_blank');
  win.document.write(`<!DOCTYPE html><html dir="rtl"><head>
    <meta charset="UTF-8">
    <title>تقرير الوردية - ${sanitize(cfg.stationName)}</title>
    <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800;900&display=swap" rel="stylesheet">
    <style>
      *{box-sizing:border-box;margin:0;padding:0}
      body{font-family:'Cairo',Tajawal,sans-serif;background:#F5F5F5;color:#1a1a1a;direction:rtl;font-size:13px;min-height:100vh}
      .page{background:white;max-width:800px;margin:20px auto;border-radius:12px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,0.12)}
      /* رأس الصفحة */
      .report-header{background:linear-gradient(135deg,#C0392B 0%,#922B21 60%,#7B241C 100%);color:white;padding:24px 28px 20px;position:relative}
      .report-header::after{content:'';position:absolute;bottom:0;right:0;left:0;height:4px;background:linear-gradient(90deg,#D4AC0D,#F4D03F,#D4AC0D)}
      .station-name{font-size:22px;font-weight:900;letter-spacing:0.5px;margin-bottom:4px}
      .report-title{font-size:13px;opacity:0.85;font-weight:600}
      .header-meta{display:flex;gap:20px;flex-wrap:wrap;margin-top:14px;font-size:12px}
      .header-meta .badge{background:rgba(255,255,255,0.18);border:1px solid rgba(255,255,255,0.3);border-radius:20px;padding:4px 12px;display:flex;align-items:center;gap:6px;font-weight:700}
      /* المحتوى */
      .report-body{padding:20px 24px}
      /* بطاقات الوقود */
      .fuel-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:16px 0}
      .fuel-card{border-radius:10px;padding:14px 10px;text-align:center;border:1px solid #e8e8e8;position:relative;overflow:hidden}
      .fuel-card::before{content:'';position:absolute;top:0;right:0;left:0;height:4px}
      .fuel-card.diesel::before{background:#D4AC0D}
      .fuel-card.n91::before{background:#27AE60}
      .fuel-card.n95::before{background:#E74C3C}
      .fuel-card .fc-type{font-size:11px;font-weight:800;color:#666;margin-bottom:6px}
      .fuel-card .fc-liters{font-size:26px;font-weight:900;line-height:1;margin-bottom:2px}
      .fuel-card .fc-unit{font-size:11px;color:#888;margin-bottom:6px}
      .fuel-card .fc-rial{font-size:13px;font-weight:800;background:#f5f5f5;border-radius:6px;padding:3px 8px;display:inline-block}
      .fuel-card.diesel .fc-liters{color:#7D6608}
      .fuel-card.diesel .fc-rial{color:#7D6608;background:rgba(212,172,13,0.1)}
      .fuel-card.n91    .fc-liters{color:#1E8449}
      .fuel-card.n91    .fc-rial{color:#1E8449;background:rgba(39,174,96,0.1)}
      .fuel-card.n95    .fc-liters{color:#C0392B}
      .fuel-card.n95    .fc-rial{color:#C0392B;background:rgba(192,57,43,0.1)}
      /* الإجمالي */
      .total-banner{background:linear-gradient(135deg,#1A1A2E,#16213E);color:white;border-radius:10px;padding:16px 20px;margin:16px 0;display:flex;align-items:center;justify-content:space-between}
      .total-banner .tb-label{font-size:13px;opacity:0.8;font-weight:600}
      .total-banner .tb-value{font-size:28px;font-weight:900;color:#FFD700}
      /* بطاقات المدفوعات */
      .payment-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin:12px 0}
      .pay-card{border-radius:8px;padding:10px 8px;text-align:center;border:1px solid #e8e8e8;background:#fafafa}
      .pay-card .pc-label{font-size:10px;color:#888;font-weight:700;margin-bottom:4px}
      .pay-card .pc-value{font-size:15px;font-weight:800;color:#1a1a1a}
      .pay-card.highlight{background:linear-gradient(135deg,#FFF9E6,#FFF3CD);border-color:#D4AC0D}
      .pay-card.highlight .pc-value{color:#7D6608}
      /* الجداول */
      .section-title{font-size:14px;font-weight:800;color:#C0392B;margin:20px 0 10px;padding-bottom:6px;border-bottom:2px solid #C0392B;display:flex;align-items:center;gap:8px}
      table{width:100%;border-collapse:collapse;margin-top:4px;font-size:12px}
      th{background:linear-gradient(135deg,#C0392B,#922B21);color:white;padding:9px 10px;font-weight:700;text-align:center}
      td{padding:8px 10px;border-bottom:1px solid #f0f0f0;text-align:center}
      tr:nth-child(even) td{background:#FAFAFA}
      tr:hover td{background:#FFF5F5}
      /* المخزون */
      .stock-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:12px 0}
      .stock-card{border-radius:10px;padding:14px 10px;text-align:center;border:1px solid #e8e8e8}
      .stock-card.diesel{border-top:3px solid #D4AC0D;background:rgba(212,172,13,0.06)}
      .stock-card.n91{border-top:3px solid #27AE60;background:rgba(39,174,96,0.06)}
      .stock-card.n95{border-top:3px solid #E74C3C;background:rgba(192,57,43,0.06)}
      .stock-card .sc-type{font-size:11px;font-weight:800;margin-bottom:6px}
      .stock-card.diesel .sc-type{color:#7D6608}
      .stock-card.n91    .sc-type{color:#1E8449}
      .stock-card.n95    .sc-type{color:#C0392B}
      .stock-card .sc-value{font-size:22px;font-weight:900;line-height:1}
      .stock-card.diesel .sc-value{color:#7D6608}
      .stock-card.n91    .sc-value{color:#1E8449}
      .stock-card.n95    .sc-value{color:#C0392B}
      /* تذييل */
      .report-footer{background:#f9f9f9;border-top:1px solid #eee;padding:12px 24px;font-size:11px;color:#aaa;display:flex;justify-content:space-between;align-items:center}
      .report-footer .system-name{color:#C0392B;font-weight:700}
      @media print{
        body{background:white}
        .page{box-shadow:none;margin:0;border-radius:0}
        .no-print{display:none!important}
      }
    </style>
  </head><body>
    <div class="page">
      <!-- رأس الصفحة -->
      <div class="report-header">
        <div style="display:flex;justify-content:space-between;align-items:flex-start">
          <div>
            <div class="station-name">⛽ ${sanitize(cfg.stationName)}</div>
            <div class="report-title">تقرير الوردية — نظام إدارة محطة الوقود</div>
          </div>
          <div style="text-align:center;background:rgba(255,255,255,0.15);border-radius:10px;padding:8px 14px">
            <div style="font-size:11px;opacity:0.8">إجمالي الوردية</div>
            <div style="font-size:20px;font-weight:900;color:#FFD700">${fmt(totalMoney,2)}</div>
            <div style="font-size:11px;opacity:0.8">ر.س</div>
          </div>
        </div>
        <div class="header-meta">
          <div class="badge">📅 ${formatDate(shift.date)}</div>
          <div class="badge">⏰ ${sanitize(shiftName)}</div>
          ${enteredBy !== '—' ? `<div class="badge">👤 ${sanitize(enteredBy)}</div>` : ''}
          <div class="badge">🕐 ${new Date().toLocaleTimeString('ar-SA',{hour:'2-digit',minute:'2-digit'})}</div>
        </div>
      </div>

      <div class="report-body">
        <!-- بطاقات الوقود -->
        <div class="section-title">⛽ استهلاك الوقود</div>
        <div class="fuel-grid">
          <div class="fuel-card diesel">
            <div class="fc-type">⬛ ديزل</div>
            <div class="fc-liters">${fmt(dieselL)}</div>
            <div class="fc-unit">لتر</div>
            <div class="fc-rial">${fmt(dieselL*(prices.diesel||0),2)} ر.س</div>
          </div>
          <div class="fuel-card n91">
            <div class="fc-type">🟢 بنزين 91</div>
            <div class="fc-liters">${fmt(n91L)}</div>
            <div class="fc-unit">لتر</div>
            <div class="fc-rial">${fmt(n91L*(prices.n91||0),2)} ر.س</div>
          </div>
          <div class="fuel-card n95">
            <div class="fc-type">🔴 بنزين 95</div>
            <div class="fc-liters">${fmt(n95L)}</div>
            <div class="fc-unit">لتر</div>
            <div class="fc-rial">${fmt(n95L*(prices.n95||0),2)} ر.س</div>
          </div>
        </div>

        <!-- الإجمالي -->
        <div class="total-banner">
          <div class="tb-label">💰 إجمالي مبيعات الوردية</div>
          <div class="tb-value">${fmt(totalMoney,2)} <span style="font-size:14px;opacity:0.8">ر.س</span></div>
        </div>

        <!-- طرق الدفع -->
        <div class="section-title">💳 تفاصيل المدفوعات</div>
        <div class="payment-grid">
          <div class="pay-card highlight">
            <div class="pc-label">💵 نقدية</div>
            <div class="pc-value">${fmt(cashPay,2)}</div>
          </div>
          <div class="pay-card">
            <div class="pc-label">🌐 شبكة</div>
            <div class="pc-value">${fmt(netPay,2)}</div>
          </div>
          <div class="pay-card">
            <div class="pc-label">📄 فواتير</div>
            <div class="pc-value">${fmt(invoicesPay,2)}</div>
          </div>
          <div class="pay-card">
            <div class="pc-label">📦 توريد مالي</div>
            <div class="pc-value">${fmt(suppliedPay,2)}</div>
          </div>
        </div>

        ${metersTableHtml}
        ${supplyTableHtml}

        <!-- المخزون بعد الوردية -->
        <div class="section-title">🛢️ المخزون بعد الوردية</div>
        <div class="stock-grid">
          <div class="stock-card diesel">
            <div class="sc-type">⬛ ديزل</div>
            <div class="sc-value">${fmt(stockD)}</div>
            <div style="font-size:11px;color:#888;margin-top:4px">لتر</div>
          </div>
          <div class="stock-card n91">
            <div class="sc-type">🟢 بنزين 91</div>
            <div class="sc-value">${fmt(stockN91)}</div>
            <div style="font-size:11px;color:#888;margin-top:4px">لتر</div>
          </div>
          <div class="stock-card n95">
            <div class="sc-type">🔴 بنزين 95</div>
            <div class="sc-value">${fmt(stockN95)}</div>
            <div style="font-size:11px;color:#888;margin-top:4px">لتر</div>
          </div>
        </div>
      </div>

      <!-- تذييل -->
      <div class="report-footer">
        <span class="system-name">⛽ الشفق الأحمر — نظام إدارة محطة الوقود</span>
        <span>طُبع: ${new Date().toLocaleString('ar-SA')}</span>
      </div>
    </div>
    <div class="no-print" style="text-align:center;margin:16px;display:flex;gap:10px;justify-content:center">
      <button onclick="window.print()" style="background:#C0392B;color:white;border:none;border-radius:8px;padding:10px 24px;font-family:Cairo,sans-serif;font-size:14px;font-weight:700;cursor:pointer">🖨️ طباعة</button>
      <button onclick="window.close()" style="background:#666;color:white;border:none;border-radius:8px;padding:10px 24px;font-family:Cairo,sans-serif;font-size:14px;font-weight:700;cursor:pointer">✕ إغلاق</button>
    </div>
    <script>setTimeout(()=>window.print(),800)<\/script>
  </body></html>`);
  win.document.close();
}

// ===========================
// تحسين 7: مؤقت الوردية
// ===========================
let _shiftTimerInterval = null;
let _shiftStartTime = null;

function startShiftTimer() {
  if (_shiftTimerInterval) return;
  _shiftStartTime = localStorage.getItem('_shiftStart')
    ? new Date(localStorage.getItem('_shiftStart'))
    : new Date();
  localStorage.setItem('_shiftStart', _shiftStartTime.toISOString());
  _shiftTimerInterval = setInterval(_updateShiftTimer, 1000);
  _updateShiftTimer();
  document.getElementById('shiftTimerWidget').style.display = 'flex';
  document.getElementById('startTimerBtn').style.display = 'none';
  document.getElementById('stopTimerBtn').style.display = 'inline-flex';
}

function stopShiftTimer() {
  clearInterval(_shiftTimerInterval);
  _shiftTimerInterval = null;
  _shiftStartTime = null;
  localStorage.removeItem('_shiftStart');
  document.getElementById('shiftTimerWidget').style.display = 'none';
  document.getElementById('startTimerBtn').style.display = 'inline-flex';
  document.getElementById('stopTimerBtn').style.display = 'none';
  document.getElementById('shiftTimerDisplay').textContent = '00:00:00';
}

function _updateShiftTimer() {
  if (!_shiftStartTime) return;
  const elapsed = Math.floor((Date.now() - _shiftStartTime.getTime()) / 1000);
  const h = Math.floor(elapsed / 3600).toString().padStart(2, '0');
  const m = Math.floor((elapsed % 3600) / 60).toString().padStart(2, '0');
  const s = (elapsed % 60).toString().padStart(2, '0');
  const el = document.getElementById('shiftTimerDisplay');
  if (el) el.textContent = `${h}:${m}:${s}`;
}

function _initShiftTimerFromStorage() {
  const saved = localStorage.getItem('_shiftStart');
  if (saved) {
    _shiftStartTime = new Date(saved);
    _shiftTimerInterval = setInterval(_updateShiftTimer, 1000);
    _updateShiftTimer();
    const w = document.getElementById('shiftTimerWidget');
    if (w) w.style.display = 'flex';
    const startBtn = document.getElementById('startTimerBtn');
    if (startBtn) startBtn.style.display = 'none';
    const stopBtn = document.getElementById('stopTimerBtn');
    if (stopBtn) stopBtn.style.display = 'inline-flex';
  }
}

// ===========================
// تحسين 8: رسوم بيانية بسيطة (بدون مكتبات خارجية)
// ===========================
function renderCharts() {
  renderConsumptionChart();
  renderMonthlyChart();
}

function renderConsumptionChart() {
  const canvas = document.getElementById('consumptionChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const last7 = getLast7DaysData();
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  if (last7.labels.length === 0) {
    ctx.fillStyle = '#999';
    ctx.font = '14px Cairo,sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('لا توجد بيانات بعد', W / 2, H / 2);
    return;
  }

  const padding = { top: 20, right: 10, bottom: 40, left: 10 };
  const chartW = W - padding.left - padding.right;
  const chartH = H - padding.top - padding.bottom;
  const series = [
    { data: last7.diesel, color: '#D4AC0D', label: 'ديزل' },
    { data: last7.n91, color: '#27AE60', label: '91' },
    { data: last7.n95, color: '#C0392B', label: '95' }
  ];
  const allVals = series.flatMap(s => s.data);
  const maxVal = Math.max(...allVals, 1);
  const barGroupW = chartW / last7.labels.length;
  const barW = barGroupW / (series.length + 1);

  series.forEach((s, si) => {
    s.data.forEach((val, di) => {
      const x = padding.left + di * barGroupW + si * barW + barW * 0.4;
      const barH = (val / maxVal) * chartH;
      const y = padding.top + chartH - barH;
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(x, y, barW * 0.85, barH, 3) : ctx.rect(x, y, barW * 0.85, barH);
      ctx.fill();
    });
  });

  // Labels
  ctx.fillStyle = '#666';
  ctx.font = '10px Cairo,sans-serif';
  ctx.textAlign = 'center';
  last7.labels.forEach((label, i) => {
    ctx.fillText(label, padding.left + i * barGroupW + barGroupW / 2, H - 8);
  });

  // Legend
  const legendX = padding.left;
  series.forEach((s, i) => {
    ctx.fillStyle = s.color;
    ctx.fillRect(legendX + i * 60, 4, 12, 12);
    ctx.fillStyle = '#333';
    ctx.font = '10px Cairo,sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(s.label, legendX + i * 60 + 28, 14);
  });
}

