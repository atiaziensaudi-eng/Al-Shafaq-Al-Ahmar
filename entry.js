function calcEntry() {
  const date = document.getElementById('entry_date').value;
  const shiftType = document.getElementById('entry_shiftType').value;
  if (!shiftType) { alert('⚠️ يرجى اختيار نوع الوردية أولاً قبل إدخال القراءات'); return; }
  if (!date) { alert('⚠️ يرجى تحديد التاريخ أولاً قبل إدخال القراءات'); return; }

  const cfg = DB.config;
  const pumps = cfg.pumps;
  let totals = { diesel: 0, n91: 0, n95: 0 };
  let hasError = false;
  let missingPumps = [];

  pumps.forEach(p => {
    const el = document.getElementById(`pump_${p.id}`);
    if (!el) return;
    const val = parseFloat(el.value);
    if (!val || val === 0) { missingPumps.push(p.name); return; }

    // ═══════════════════════════════════════════════════════════
    // ✅ ENTRY CALC CORE FIX
    // المعادلة: استهلاك الوردية = القراءة الجديدة − آخر عداد محفوظ
    // getLastSavedReading → index 0 في DB.meters المُرتَّبة تنازلياً
    // (الصف المتربع في أعلى جدول العدادات)
    // ═══════════════════════════════════════════════════════════
    const prev = getLastSavedReading(p.id);
    const cons = val - prev;
    const isResetApproved = el.dataset.resetApproved === 'yes';

    showPumpConsumption(p.id); // يُحدِّث العرض بناءً على getLastSavedReading لحظياً

    if (cons < 0) {
      if (!isResetApproved) {
        // يجب أن يوافق المستخدم على إعادة التعيين أولاً
        hasError = true; return;
      }
      // إعادة تعيين موافق عليها: استخدم القراءة الجديدة كنقطة بداية (استهلاك = 0)
      totals[normType(p.type)] += 0; // لا استهلاك محسوب عند Reset
      return;
    }
    if (cons > 100000) { hasError = true; return; }
    totals[normType(p.type)] += cons;
  });

  if (missingPumps.length > 0) {
    alert('⚠️ يرجى إدخال قراءات جميع العدادات:\n' + missingPumps.join(' | '));
    return;
  }
  if (hasError) { alert('⚠️ يوجد عدادات بها أخطاء:\n• العداد الحالي أقل من السابق\n• أو استهلاك غير معقول (أكثر من 100,000 لتر)\nيرجى مراجعة القراءات'); return; }

  // بناء meterEntry — الاستهلاك = القراءة − آخر محفوظ
  const meterEntry = {
    id: Date.now(),
    date,
    shiftType,
    type: 'meter',
    pumps: []
  };
  pumps.forEach(p => {
    const el = document.getElementById(`pump_${p.id}`);
    const val = parseFloat(el?.value) || 0;
    if (val > 0) {
      // ✅ نفس المعادلة: الطرح من آخر عداد محفوظ — لا من وردية سابقة بعينها
      const prev = getLastSavedReading(p.id);
      meterEntry.pumps.push({ pumpId: p.id, reading: val, consumption: Math.max(0, val - prev) });
    }
  });
  window._pendingMeter = meterEntry;
  window._pendingTotals = totals;

  // Display results
  document.getElementById('res_dieselL').textContent = fmt(totals.diesel);
  document.getElementById('res_dieselR').textContent = fmt(totals.diesel * cfg.prices.diesel, 2) + ' ر.س';
  document.getElementById('res_91L').textContent = fmt(totals.n91);
  document.getElementById('res_91R').textContent = fmt(totals.n91 * cfg.prices.n91, 2) + ' ر.س';
  document.getElementById('res_95L').textContent = fmt(totals.n95);
  document.getElementById('res_95R').textContent = fmt(totals.n95 * cfg.prices.n95, 2) + ' ر.س';

  const total = totals.diesel * cfg.prices.diesel + totals.n91 * cfg.prices.n91 + totals.n95 * cfg.prices.n95;
  document.getElementById('res_totalMoney').innerHTML = fmt(total, 2) + ' ر.س<span class="copy-hint">نسخ</span>';
  window._pendingTotal = total;
  document.getElementById('entryResults').style.display = 'block';
  calcCash();

  // Feature 11: Show stock warning after consumption
  const stockWarning = checkStockAfterConsumption(totals);
  let warningEl = document.getElementById('entryStockWarning');
  if (!warningEl) {
    warningEl = document.createElement('div');
    warningEl.id = 'entryStockWarning';
    document.getElementById('entryResults').prepend(warningEl);
  }
  warningEl.innerHTML = stockWarning;

  // لا نحفظ العدادات هنا — ستُحفظ فقط عند الضغط على "حفظ الوردية"
  enableCopyable();
}

function calcCash() {
  const total = window._pendingTotal || 0;
  const network = parseFloat(document.getElementById('pay_network').value) || 0;
  const invoices = parseFloat(document.getElementById('pay_invoices').value) || 0;
  const supplied = parseFloat(document.getElementById('pay_supplied').value) || 0;
  const cash = total - network - invoices - supplied;
  document.getElementById('pay_cash').textContent = fmt(Math.max(0, cash), 2);
}

// ✅ FIX #4 + #1: إلغاء الاحتساب المعلّق عند تغيير التاريخ أو الوردية
// تُمنع بياناتٌ تم احتسابها لتاريخ/وردية قديم من الحفظ بتاريخ/وردية مختلف
function _invalidatePendingEntry() {
  if (window._pendingMeter) {
    window._pendingMeter   = null;
    window._pendingTotals  = null;
    window._pendingTotal   = 0;
    document.getElementById('entryResults').style.display = 'none';
    // مسح عرض الاستهلاك في كل طلمبة
    (DB.config?.pumps || []).forEach(p => {
      const cons = document.getElementById(`cons_${p.id}`);
      if (cons) { cons.textContent = ''; cons.style.color = ''; }
      const inp  = document.getElementById(`pump_${p.id}`);
      if (inp)  { inp.style.borderColor = 'var(--gray-300)'; }
    });
  }
}

function saveShift() {
  if (!window._pendingMeter) { alert('⚠️ يرجى احتساب الاستهلاك أولاً'); return; }
  const cfg = DB.config;
  const date = document.getElementById('entry_date').value;
  const shiftType = document.getElementById('entry_shiftType').value;

  // ✅ FIX #4: فحص الحقول الإجبارية أولاً — يوقف العملية تماماً
  if (!date) {
    alert('⚠️ يرجى اختيار التاريخ قبل الحفظ.\nالتاريخ حقل إجباري.');
    return;
  }
  if (!shiftType) {
    alert('⚠️ يرجى اختيار نوع الوردية (ص/م) قبل الحفظ.\nالوردية حقل إجباري.');
    return;
  }

  // ✅ FIX #1: تحقق صارم — تطابق التاريخ والوردية بين الاحتساب والحفظ
  // يمنع حفظ بيانات احتُسبت لتاريخ مختلف عن التاريخ الحالي في الواجهة
  if (window._pendingMeter.date !== date || window._pendingMeter.shiftType !== shiftType) {
    alert(
      '⚠️ تم تغيير التاريخ أو الوردية بعد الاحتساب!\n\n' +
      `الاحتساب كان لـ: ${window._pendingMeter.date} — ${window._pendingMeter.shiftType}\n` +
      `الحقل الحالي: ${date} — ${shiftType}\n\n` +
      'يجب الضغط على "احسب الاستهلاك" مجدداً بالبيانات الجديدة قبل الحفظ.'
    );
    // ✅ إلغاء الاحتساب القديم — لا يُحفظ بأي حال حتى بعد إغلاق التنبيه
    window._pendingMeter   = null;
    window._pendingTotals  = null;
    window._pendingTotal   = 0;
    document.getElementById('entryResults').style.display = 'none';
    return; // ← HARD STOP — لا يصل الكود لقاعدة البيانات
  }

  // ✅ FIX #2: منع حفظ وردية مكررة بنفس (التاريخ + الوردية) — يحمي من الضغط المزدوج وبطء الاتصال
  const duplicate = DB.shifts.find(s => s.date === date && s.shiftType === shiftType);
  if (duplicate) {
    const shiftName = DB.config.shifts.find(s => s.abbr === shiftType)?.name || shiftType;
    alert(`⚠️ تم حفظ وردية ${shiftName} بتاريخ ${date} مسبقاً.\nلا يمكن تسجيل نفس الوردية مرتين.\nإذا أردت التعديل، استخدم زر ✏️ تعديل من سجل الورديات.`);
    return;
  }

  // ✅ [FIX v9] try/catch لحماية عملية الحفظ بالكامل
  let network, invoices, supplied, total, totals;
  try {
    totals = window._pendingTotals;
    total = window._pendingTotal;
    network  = parseFloat(document.getElementById('pay_network').value)  || 0;
    invoices = parseFloat(document.getElementById('pay_invoices').value) || 0;
    supplied = parseFloat(document.getElementById('pay_supplied').value) || 0;

  // [v17] معرّف واحد مشترك للوردية + العداد + صف المخزون — ربط موثوق
  // (كان سابقاً Date.now() يُستدعى مرتين منفصلتين لشيء ولعدّاده، فينتجان
  // id مختلفَين ويصبح الربط بينهما هشّاً يعتمد فقط على تطابق التاريخ+الوردية)
  const sharedId = window._pendingMeter.id;
  const stockBefore = { ...cfg.currentStock };

  const shift = {
    id: sharedId,
    date, shiftType,
    // [v17] القيم الأولية هنا مبدئية فقط — AccountingEngine.rebuild() (يُستدعى
    // تلقائياً من saveDB() أدناه) يُعيد احتسابها من العداد + سجل الأسعار
    // التاريخي فور الحفظ، فتكون totalMoney/diesel/n91/n95/cash نهائية وصحيحة.
    diesel: totals.diesel, n91: totals.n91, n95: totals.n95,
    totalMoney: total,
    network, invoices, supplied, cash: Math.max(0, total - network - invoices - supplied),
    pumps: window._pendingMeter.pumps,
    enteredBy: currentUser?.email || 'غير محدد'
  };

  DB.shifts.push(shift);
  DB.meters.push(window._pendingMeter);

  // صف مخزون خام — dayD/day91/day95 والرصيد التراكمي يحسبها AccountingEngine
  // حصراً بنافذة "آخر N وردية" (N = shiftsPerDay من إعدادات المالك)، وليس
  // بتاريخ اليوم التقويمي كما كان سابقاً (خطأ كان يُنتج رقماً مختلفاً عن
  // بقية الشاشات كلما تغيّر عدد الورديات المُدخلة في نفس اليوم).
  DB.inventory.push({
    id: sharedId, date, shiftType,
    consD: totals.diesel, cons91: totals.n91, cons95: totals.n95,
    adjD: 0, adj91: 0, adj95: 0,
    type: 'shift'
  });

  saveDB(); // ← يستدعي AccountingEngine.rebuild() تلقائياً قبل الحفظ والمزامنة

  logActivity('shift_add',
    `أضاف وردية ${shiftType} بتاريخ ${date} — ديزل: ${fmt(totals.diesel)} | 91: ${fmt(totals.n91)} | 95: ${fmt(totals.n95)} | ${fmt(total,2)} ر.س`,
    { before: stockBefore, after: { ...cfg.currentStock } }
  );

  _clearDraft(); // [v16] مسح المسودة المؤقتة بعد نجاح الحفظ الفعلي في القاعدة

  // Reset form
  DB.config.pumps.forEach(p => {
    const el = document.getElementById(`pump_${p.id}`);
    if (el) el.value = '';
    const cons = document.getElementById(`cons_${p.id}`);
    if (cons) cons.textContent = '';
  });
  document.getElementById('entryResults').style.display = 'none';
  document.getElementById('pay_network').value = '';
  document.getElementById('pay_invoices').value = '';
  document.getElementById('pay_supplied').value = '';
  document.getElementById('pay_cash').textContent = '0';
  window._pendingMeter = null;
  window._pendingTotals = null;
  window._pendingTotal = 0;

  // ✅ تحديث فوري لجميع الشاشات بعد حفظ الوردية مباشرةً
  triggerGlobalRecalculation();
  renderEntryPumps();

  _showToast('تم حفظ الوردية بنجاح!', 'success');
  } catch(err) {
    console.error('❌ saveShift error:', err);
    alert('⚠️ حدث خطأ أثناء حفظ الوردية:\n' + err.message);
  }
}

// ═══════════════════════════════════════════════════════════════
// [v17] نظام الجرد — أصبح صفحة مستقلة (page-audit) بدل لوحة منبثقة
// داخل صفحة إدخال الوردية. كل المنطق الفعلي انتقل إلى audit-page.js
// وهذه أغلفة توافق رجعي فقط لأي استدعاء قديم متبقٍّ في الصفحة.
// ═══════════════════════════════════════════════════════════════
function openAuditModal() {
  showPage('audit', document.querySelector('.nav-btn'));
}
function exitAuditMode() {
  showPage('home', document.querySelector('.nav-btn'));
}

// ═══════════════════════════════════════════════════════════════
// [v15] fixHistoricalAuditRecords — إصلاح عدادات الجرد القديمة
// تفحص جميع سجلات الجرد في DB.meters وتضيف:
//   1. استهلاك محسوب لكل طلمبة (reading - prevReading)
//   2. صفوف مخزون في DB.inventory إن لم تكن موجودة
//   3. صف في DB.shifts إن لم يكن موجوداً (ليظهر الجرد في السجل كوردية)
//   4. تُعيد حساب cfg.currentStock من الصفر بناءً على كل الأحداث
// ═══════════════════════════════════════════════════════════════
// [v16] فُصل المنطق الأساسي إلى _runAuditHistoricalFix() بلا شروط
// صلاحية ولا تنبيهات، بحيث يمكن استدعاؤه تلقائياً وبصمت من initApp()
// (عبر _autoFixLegacyAudits) بالإضافة إلى الزر اليدوي الخاص بالمالك.
// ═══════════════════════════════════════════════════════════════
function _runAuditHistoricalFix() {
  const cfg = DB.config;
  if (!cfg || !cfg.pumps || cfg.pumps.length === 0) return null;

  // رتّب جميع العدادات تصاعدياً (الأقدم أولاً)
  const allMeters = [...DB.meters].sort((a, b) => {
    if (a.type === 'opening') return -1;
    if (b.type === 'opening') return 1;
    return (a.id || 0) - (b.id || 0);
  });

  const auditMeters = allMeters.filter(m => m.type === 'audit');
  if (auditMeters.length === 0) return null;

  let fixedMeters = 0, fixedInv = 0, fixedShifts = 0;

  for (const auditM of auditMeters) {
    // [v16] معالجة الجردات القديمة جداً التي أُنشئت قبل نظام المعرّفات (id)
    // بلا id إطلاقاً: نمنحها id ثابتاً ومستقراً مبنياً على التاريخ+الوقت
    // بدلاً من ترك id = undefined (وهو ما كان يعمل بالصدفة فقط طالما
    // بقي القيد type==='audit' في كل مقارنة، لكنه هش وغير قابل للتتبع).
    if (auditM.id === undefined || auditM.id === null) {
      const parsed = Date.parse(`${auditM.date}T${(auditM.time || '00:00:00')}`);
      auditM.id = Number.isFinite(parsed) ? parsed : Date.now();
      // اعكس نفس id على السجل الأصلي داخل DB.meters (auditM قد يكون نسخة مرتبة)
      const rawIdx = DB.meters.findIndex(m => m === auditM || (m.date === auditM.date && m.time === auditM.time && m.type === 'audit' && (m.id === undefined || m.id === null)));
      if (rawIdx !== -1) DB.meters[rawIdx].id = auditM.id;
    }

    // احسب الاستهلاك لكل طلمبة
    let consD = 0, cons91 = 0, cons95 = 0;
    const updatedPumps = [];
    for (const pd of (auditM.pumps || [])) {
      const pumpCfg = cfg.pumps.find(p => p.id === pd.pumpId);
      if (!pumpCfg) { updatedPumps.push(pd); continue; }
      const prevRead = getImmediatePreviousReading(pd.pumpId, auditM.date, auditM.shiftType);
      const cons = Math.max(0, pd.reading - prevRead);
      const fuelType = normType(pumpCfg.type);
      if (fuelType === 'diesel') consD  += cons;
      else if (fuelType === 'n91') cons91 += cons;
      else if (fuelType === 'n95') cons95 += cons;
      updatedPumps.push({ ...pd, consumption: cons });
    }

    // تحديث سجل العداد في DB.meters
    const mIdx = DB.meters.findIndex(m => m.id === auditM.id && m.type === 'audit');
    if (mIdx !== -1) {
      DB.meters[mIdx].pumps  = updatedPumps;
      DB.meters[mIdx].consD  = consD;
      DB.meters[mIdx].cons91 = cons91;
      DB.meters[mIdx].cons95 = cons95;
      fixedMeters++;
    }

    // أضف/حدّث صف في DB.inventory
    const existsInInv = DB.inventory.find(r => r.id === auditM.id && r.type === 'audit');
    if (!existsInInv) {
      DB.inventory.push({
        id:       auditM.id,
        date:     auditM.date,
        shiftType:'جرد',
        diesel:   0, n91: 0, n95: 0,
        consD, cons91, cons95,
        dayD: consD, day91: cons91, day95: cons95,
        adjD: 0, adj91: 0, adj95: 0,
        type: 'audit'
      });
      fixedInv++;
    } else {
      const iIdx = DB.inventory.findIndex(r => r.id === auditM.id && r.type === 'audit');
      if (iIdx !== -1) {
        DB.inventory[iIdx].consD  = consD;
        DB.inventory[iIdx].cons91 = cons91;
        DB.inventory[iIdx].cons95 = cons95;
      }
    }

    // ── [v15.1] أضف الجرد لـ DB.shifts إن لم يكن موجوداً ─────
    const existsInShifts = DB.shifts.find(s => s.id === auditM.id && s.type === 'audit');
    if (!existsInShifts) {
      const totalMoney = consD  * (cfg.prices?.diesel || 0)
                       + cons91 * (cfg.prices?.n91    || 0)
                       + cons95 * (cfg.prices?.n95    || 0);
      DB.shifts.push({
        id:           auditM.id,
        type:         'audit',
        date:         auditM.date,
        hijriDate:    auditM.hijriDate || '',
        time:         auditM.time || '',
        shiftType:    'جرد',
        diesel:       consD,
        n91:          cons91,
        n95:          cons95,
        totalMoney,
        network:      auditM.auditNetwork  || 0,
        invoices:     auditM.auditInvoices || 0,
        supplied:     0,
        cash:         auditM.auditCash     || 0,
        auditTotal:   auditM.auditTotal    || 0,
        expectedRevenue: auditM.expectedRevenue || 0,
        auditDiff:    auditM.auditDiff     || 0,
        enteredBy:    auditM.enteredBy     || '',
        periodDiesel: auditM.periodDiesel  || 0,
        periodN91:    auditM.periodN91     || 0,
        periodN95:    auditM.periodN95     || 0,
      });
      fixedShifts++;
    }
  }

  // إعادة حساب المخزون من الصفر
  recomputeCurrentStock();

  return { total: auditMeters.length, fixedMeters, fixedInv, fixedShifts };
}

// زر يدوي (لوحة المالك) — يفرض التنفيذ فوراً مع تنبيهات واضحة
function fixHistoricalAuditRecords() {
  if (currentUser?.role !== 'owner') {
    alert('⛔ هذه الصلاحية للمالك فقط');
    return;
  }

  const result = _runAuditHistoricalFix();
  if (!result) {
    alert('ℹ️ لا توجد سجلات جرد لإصلاحها، أو لا توجد بيانات طلمبات');
    return;
  }

  saveDB();
  triggerGlobalRecalculation();
  logActivity('system_fix',
    `إصلاح ${result.total} سجل جرد — meters:${result.fixedMeters} | inventory:${result.fixedInv} | shifts:${result.fixedShifts}`
  );
  _showToast(
    `✅ تم إصلاح ${result.total} جرد — أُضيف ${result.fixedShifts} في السجل — وأُعيد حساب المخزون`,
    'success', 4000
  );
}

// ═══════════════════════════════════════════════════════════════
// [v16] إصلاح تلقائي صامت عند فتح التطبيق — لا يتطلب صلاحية مالك ولا
// أي تدخل من المستخدم. يفحص فقط: هل يوجد جرد في DB.meters بلا صف
// مقابل في DB.shifts أو DB.inventory؟ إن وُجد، يُشغّل نفس منطق
// الإصلاح اليدوي، ثم يحفظ ويُظهر تنبيهاً بسيطاً بما تم إصلاحه.
// هذا يحل مشكلة: جرد قديم لا يظهر في السجل ولا يُخصم من المخزون،
// حتى لو كان المستخدم الحالي المسجّل دخوله ليس "مالك" (مثل "مشرف").
// ═══════════════════════════════════════════════════════════════
function _autoFixLegacyAudits() {
  try {
    const cfg = DB.config;
    if (!cfg || !Array.isArray(DB.meters) || !Array.isArray(DB.shifts) || !Array.isArray(DB.inventory)) return;

    const auditMeters = DB.meters.filter(m => m.type === 'audit');
    if (auditMeters.length === 0) return;

    const needsFix = auditMeters.some(m =>
      (m.id === undefined || m.id === null) ||
      !DB.shifts.find(s => s.id === m.id && s.type === 'audit') ||
      !DB.inventory.find(r => r.id === m.id && r.type === 'audit')
    );
    if (!needsFix) return;

    const result = _runAuditHistoricalFix();
    if (result && (result.fixedShifts > 0 || result.fixedInv > 0)) {
      saveDB();
      logActivity('system_fix_auto',
        `إصلاح تلقائي عند فتح التطبيق: ${result.total} جرد — shifts:${result.fixedShifts} | inventory:${result.fixedInv}`);
      // نؤجل التنبيه قليلاً ليظهر بعد استقرار الواجهة
      setTimeout(() => {
        _showToast(`🔧 تم إصلاح ${result.fixedShifts} جرد قديم كان مفقوداً من السجل والمخزون تلقائياً`, 'success', 5000);
      }, 800);
    }
  } catch(e) {
    console.warn('[_autoFixLegacyAudits] فشل الإصلاح التلقائي:', e);
  }
}

// ═══════════════════════════════════════════════════════════════
// [v15] recomputeCurrentStock — إعادة حساب المخزون الحالي كاملاً
// يمشي على جميع أحداث المخزون بالترتيب الزمني ويحسب الرصيد النهائي
// ═══════════════════════════════════════════════════════════════
function recomputeCurrentStock() {
  const cfg = DB.config;
  const openingRow = DB.inventory.find(r => r.type === 'opening');

  // ابدأ من المخزون الافتتاحي
  let stock = {
    diesel: openingRow?.diesel || cfg.openingStock?.diesel || 0,
    n91:    openingRow?.n91    || cfg.openingStock?.n91    || 0,
    n95:    openingRow?.n95    || cfg.openingStock?.n95    || 0,
  };

  // رتّب جميع الأحداث تصاعدياً (الأقدم أولاً) مستبعداً افتتاحي
  const events = [...DB.inventory]
    .filter(r => r.type !== 'opening')
    .sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return (a.id || 0) - (b.id || 0);
    });

  for (const r of events) {
    if (r.type === 'shift' || r.type === 'audit') {
      // خصم الاستهلاك
      stock.diesel = Math.max(0, stock.diesel - (r.consD  || 0));
      stock.n91    = Math.max(0, stock.n91    - (r.cons91 || 0));
      stock.n95    = Math.max(0, stock.n95    - (r.cons95 || 0));
    } else if (r.type === 'supply') {
      // إضافة التوريد
      const k = r.supplyFuel === 'diesel' ? 'diesel' : r.supplyFuel === '91' ? 'n91' : 'n95';
      stock[k] += (r.supplyQty || 0);
    } else if (r.type === 'adjust') {
      stock.diesel += (r.adjD  || 0);
      stock.n91    += (r.adj91 || 0);
      stock.n95    += (r.adj95 || 0);
    }
    // تحديث حقل الرصيد في الصف نفسه
    const rIdx = DB.inventory.findIndex(x => x.id === r.id && x.type === r.type);
    if (rIdx !== -1) {
      DB.inventory[rIdx].diesel = stock.diesel;
      DB.inventory[rIdx].n91   = stock.n91;
      DB.inventory[rIdx].n95   = stock.n95;
    }
  }

  // حفظ الرصيد النهائي في cfg.currentStock
  cfg.currentStock.diesel = stock.diesel;
  cfg.currentStock.n91    = stock.n91;
  cfg.currentStock.n95    = stock.n95;
}

// ═══════════════════════════════════════════════════════════════
// [v17] محرك التحليل منذ آخر جرد — أصبح غلافاً رقيقاً يُفوِّض بالكامل
// إلى AccountingEngine.calcSinceLastAudit() (المصدر الوحيد للحقيقة).
// كان هذا سابقاً يُعيد حساب الإيراد بضرب إجمالي اللترات في السعر
// *الحالي* فقط — الآن يُجمَع من totalMoney لكل وردية (محسوب بسعرها
// الفعلي وقتها عبر سجل الأسعار التاريخي)، فلا يتغيّر رجعياً بعد أي
// تعديل سعر لاحق.
// ═══════════════════════════════════════════════════════════════
function _calcSinceLastAudit() {
  return AccountingEngine.calcSinceLastAudit();
}

// ── تحديث لوحة "منذ آخر جرد" في الصفحة الرئيسية ──────────
function updateSinceAuditWidget() {
  const card    = document.getElementById('sinceAuditCard');
  const content = document.getElementById('sinceAuditContent');
  if (!card || !content) return;

  const cfg    = DB.config;
  const prices = cfg.prices || {};
  const result = _calcSinceLastAudit();

  // إذا لم يكن هناك ورديات بعد الجرد — أخفِ البطاقة
  if (result.shiftsAfterAudit.length === 0 && !result.lastAudit) {
    card.style.display = 'none';
    return;
  }
  card.style.display = 'block';

  const auditDateStr = result.lastAudit
    ? `منذ جرد ${result.lastAudit.date} ${result.lastAudit.time || ''}`
    : 'منذ بداية التشغيل';

  const isDark = document.body.classList.contains('dark-mode');

  content.innerHTML = `
    <div style="font-size:11px;font-weight:700;color:${isDark?'#A9D5D5':'#2F4F4F'};margin-bottom:10px;padding-bottom:6px;border-bottom:1px solid ${isDark?'rgba(169,213,213,0.3)':'rgba(47,79,79,0.2)'}">
      📌 ${auditDateStr} | ${result.shiftsAfterAudit.length} ورديات
    </div>

    <!-- استهلاك لكل نوع وقود -->
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:10px">
      <div style="background:${isDark?'rgba(212,172,13,0.15)':'rgba(212,172,13,0.08)'};border:1px solid ${isDark?'#D4AC0D66':'#F9E87A'};border-radius:8px;padding:10px;text-align:center">
        <div style="font-size:10px;font-weight:800;color:${isDark?'#FFD966':'#7D6608'};margin-bottom:4px">⬛ ديزل</div>
        <div style="font-size:18px;font-weight:900;color:${isDark?'#FFD966':'#5D4E00'}">${fmt(result.diesel)}</div>
        <div style="font-size:10px;color:${isDark?'#9A7D0A':'#9A7D0A'}">لتر</div>
        <div style="font-size:11px;font-weight:700;color:${isDark?'#FFD966':'#7D6608'};margin-top:2px">${fmt(result.dieselRev,0)} ر.س</div>
      </div>
      <div style="background:${isDark?'rgba(39,174,96,0.15)':'rgba(39,174,96,0.08)'};border:1px solid ${isDark?'#27AE6066':'#52BE80'};border-radius:8px;padding:10px;text-align:center">
        <div style="font-size:10px;font-weight:800;color:${isDark?'#52D68A':'#1E8449'};margin-bottom:4px">🟢 91</div>
        <div style="font-size:18px;font-weight:900;color:${isDark?'#52D68A':'#1B5E20'}">${fmt(result.n91)}</div>
        <div style="font-size:10px;color:${isDark?'#27AE60':'#27AE60'}">لتر</div>
        <div style="font-size:11px;font-weight:700;color:${isDark?'#52D68A':'#1E8449'};margin-top:2px">${fmt(result.n91Rev,0)} ر.س</div>
      </div>
      <div style="background:${isDark?'rgba(192,57,43,0.15)':'rgba(192,57,43,0.08)'};border:1px solid ${isDark?'#C0392B66':'#E74C3C'};border-radius:8px;padding:10px;text-align:center">
        <div style="font-size:10px;font-weight:800;color:${isDark?'#FF6B6B':'#922B21'};margin-bottom:4px">🔴 95</div>
        <div style="font-size:18px;font-weight:900;color:${isDark?'#FF6B6B':'#7B0000'}">${fmt(result.n95)}</div>
        <div style="font-size:10px;color:${isDark?'#C0392B':'#C0392B'}">لتر</div>
        <div style="font-size:11px;font-weight:700;color:${isDark?'#FF6B6B':'#922B21'};margin-top:2px">${fmt(result.n95Rev,0)} ر.س</div>
      </div>
    </div>

    <!-- الذمة المالية الإجمالية -->
    <div style="background:${isDark?'linear-gradient(135deg,rgba(47,79,79,0.6),rgba(27,38,49,0.8))':'linear-gradient(135deg,#1B2631,#2F4F4F)'};color:white;border-radius:8px;padding:10px;margin-bottom:10px">
      <div style="font-size:10px;opacity:0.8;margin-bottom:2px;text-align:center">💼 إجمالي الذمة المالية للفترة</div>
      <div style="font-size:22px;font-weight:900;color:#A9D5D5;text-align:center">${fmt(result.totalRevenue,2)} ر.س</div>
    </div>

    <!-- تفصيل الدفعات -->
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px">
      <div style="background:${isDark?'rgba(255,255,255,0.06)':'#F5F5F5'};border-radius:6px;padding:8px;text-align:center;border:1px solid ${isDark?'#444':'#E0E0E0'}">
        <div style="font-size:9px;color:${isDark?'#AAA':'#555'};font-weight:700">🌐 شبكة</div>
        <div style="font-size:13px;font-weight:800;color:${isDark?'#7EC8E3':'#1565C0'}">${fmt(result.totalNetwork,0)}</div>
      </div>
      <div style="background:${isDark?'rgba(255,255,255,0.06)':'#F5F5F5'};border-radius:6px;padding:8px;text-align:center;border:1px solid ${isDark?'#444':'#E0E0E0'}">
        <div style="font-size:9px;color:${isDark?'#AAA':'#555'};font-weight:700">📄 فواتير</div>
        <div style="font-size:13px;font-weight:800;color:${isDark?'#CCC':'#555'}">${fmt(result.totalInvoices,0)}</div>
      </div>
      <div style="background:${isDark?'rgba(212,172,13,0.15)':'rgba(212,172,13,0.1)'};border-radius:6px;padding:8px;text-align:center;border:1px solid ${isDark?'#D4AC0D66':'#F9E87A'}">
        <div style="font-size:9px;color:${isDark?'#FFD966':'#7D6608'};font-weight:700">💵 نقدية متوقعة</div>
        <div style="font-size:13px;font-weight:800;color:${isDark?'#FFD966':'#7D6608'}">${fmt(result.expectedCash,0)}</div>
      </div>
    </div>`;
}



// ===========================
// METERS PAGE
// ===========================
function renderMetersTable() {
  // ✅ ترتيب حسب معرّف الإدخال (ID) تنازليّاً — آخر عداد في الأعلى
  const sortedMeters = [...DB.meters].sort((a, b) => {
    // opening meters دائماً في الآخر
    if (a.type === 'opening' && b.type !== 'opening') return 1;
    if (a.type !== 'opening' && b.type === 'opening') return -1;
    if (a.type === 'opening' && b.type === 'opening') return 0;
    
    // الباقي: ترتيب حسب ID تنازليّاً (الأحدث أولاً = آخر ما تم إدخاله)
    return (b.id || 0) - (a.id || 0);
  });
  
  const pumps = DB.config.pumps;
  const header = document.getElementById('metersTableHeader');
  const body = document.getElementById('metersTableBody');
  const isOwner = currentUser?.role === 'owner';

  const typeBg = {diesel:'#F9E87A', '91':'#A9DFBF', '95':'#F1948A'};
  const typeColors = {diesel:'#7D6608', '91':'#1E8449', '95':'#C0392B'};

  header.innerHTML = '<th style="min-width:42px;padding:6px 4px;font-size:11px">وردية</th>' +
    pumps.map(p => {
      const rawType = p.type === 'n91' ? '91' : p.type === 'n95' ? '95' : p.type;
      const bg = typeBg[rawType] || '#ddd';
      const color = typeColors[rawType] || '#333';
      const label = rawType === 'diesel' ? 'ديزل' : rawType;
      return `<th style="background:${bg};color:${color};min-width:110px;padding:6px 8px;font-size:12px">${p.name} <span style="font-size:9px;opacity:0.9;font-weight:600">(${label})</span></th>`;
    }).join('');

  /**
   * ═══════════════════════════════════════════════════════════════
   * ✅ FIX #2 (v5): الترتيب الصارم بتسلسل الإدخال الفعلي
   * ═══════════════════════════════════════════════════════════════
   * المشكلة السابقة: كان الكود يُرتّب الورديات داخل اليوم الواحد
   *   حسب shiftOrder (صباحية أولاً، مسائية ثانياً) وهو يكسر المنطق
   *   الحسابي إذا أُدخلت الورديات بترتيب مختلف.
   *
   * الحل الصارم الجديد:
   *   - معيار الترتيب الوحيد = ID تنازلياً (آخر إدخال في الأعلى)
   *   - إذا أُدخلت الصباحية ثم المسائية → المسائية فوق الصباحية
   *   - التصنيف (ص/م) يظهر بجانب التاريخ لكن لا يؤثر على الترتيب
   * ═══════════════════════════════════════════════════════════════
   */

  // ✅ FIX: استخراج جميع الصفوف غير الافتتاحية بدون عكس
  const rows = sortedMeters.filter(m => m.type !== 'opening');

  // ✅ FIX #4 (shiftOrder): بناء ترتيب الورديات ديناميكياً من DB.config — للعرض فقط
  const shiftOrder = {};
  (DB.config.shifts || []).forEach((s, i) => { shiftOrder[s.abbr] = i; });

  // اختصارات الوردية — تُبنى من DB.config أيضاً للاتساق
  const shiftAbbrs = {};
  (DB.config.shifts || []).forEach(s => { shiftAbbrs[s.abbr] = s.abbr; });

  // تجميع الصفوف حسب التاريخ
  const grouped = {};
  rows.forEach(m => {
    if (!grouped[m.date]) grouped[m.date] = [];
    grouped[m.date].push(m);
  });

  let bodyHtml = '';
  Object.keys(grouped).sort((a,b) => b.localeCompare(a)).forEach(date => {
    // ✅ FIX #2: الترتيب داخل التاريخ = ID تنازلياً (آخر إدخال في الأعلى)
    // ← أُزيل ترتيب shiftOrder الذي كان يُجبر الصباحية على أن تكون دائماً أعلى
    grouped[date].sort((a, b) => (b.id || 0) - (a.id || 0));
    // بناء عنوان التاريخ الأفقي
    const gDate = new Date(date + 'T00:00:00');
    const gFormatted = `${gDate.getDate()}/${gDate.getMonth()+1}/${gDate.getFullYear()}`;
    let hijriShort = '';
    try {
      const hFmt = new Intl.DateTimeFormat('ar-SA-u-ca-islamic', { day:'numeric', month:'numeric' });
      hijriShort = hFmt.format(gDate) + 'هـ';
    } catch(e) {}
    const shiftsInDay = grouped[date];
    const shiftAbbrsList = shiftsInDay.map(m => {
      const abbr = DB.config.shifts.find(s => s.abbr === m.shiftType)?.abbr || m.shiftType;
      return shiftAbbrs[abbr] || shiftAbbrs[m.shiftType] || abbr;
    }).join(' ');

    const colCount = pumps.length + 1 + (isOwner ? 1 : 0);
    
    // إضافة صف فاصل صغير بين الأيام (يظهر فقط بعد أول يوم)
    const isFirstDay = Object.keys(grouped).indexOf(date) === 0;
    if (!isFirstDay) {
      bodyHtml += `<tr><td colspan="${colCount}" style="height:3px;background:transparent;padding:0;border:none"></td></tr>`;
    }
    
    // Full Hijri date
    let hijriFull = '';
    try {
      const hFmtFull = new Intl.DateTimeFormat('ar-SA-u-ca-islamic', { day:'numeric', month:'long', year:'numeric' });
      hijriFull = hFmtFull.format(gDate);
    } catch(e) { hijriFull = hijriShort; }
    // Full Gregorian date with day name
    const dayNames = ['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
    const dayName = dayNames[gDate.getDay()];
    bodyHtml += `<tr>
      <td colspan="${colCount}" style="
        padding:6px 12px;
        text-align:right;
        background:linear-gradient(90deg,rgba(21,101,192,0.12),rgba(21,101,192,0.06),rgba(21,101,192,0.12));
        border-top:2px solid rgba(21,101,192,0.5);
        border-bottom:2px solid rgba(21,101,192,0.4);
        white-space:nowrap;
      ">
        <div style="font-size:14px;font-weight:900;color:#1565C0;letter-spacing:0.5px">${dayName} ${gFormatted} • ${hijriFull}</div>
      </td>
    </tr>`;

    // صفوف العدادات لهذا التاريخ
    shiftsInDay.forEach(m => {
      // إيجاد index في المصفوفة الأصلية لاستخدامه في الحذف
      const origIdx = DB.meters.findIndex(x => x.date === m.date && x.shiftType === m.shiftType && x.type !== 'opening');
      const abbr = DB.config.shifts.find(s => s.abbr === m.shiftType)?.abbr || m.shiftType;
      const shiftLabel = shiftAbbrs[abbr] || shiftAbbrs[m.shiftType] || abbr;

      // [v12/v15] صف الجرد — تنسيق مميز مع عرض الاستهلاك
      if (m.type === 'audit') {
        const colCount2 = pumps.length + 1;
        const pumpReadings = pumps.map(p => {
          const pd = m.pumps?.find(x => x.pumpId === p.id);
          if (!pd) return `<td style="padding:4px;text-align:center;color:#5D6D7E">—</td>`;
          // ── [v15] حساب الاستهلاك: القراءة الحالية - القراءة السابقة من الصف الأسفل مباشرة
          const prevRead = getImmediatePreviousReading(p.id, m.date, m.shiftType);
          const displayCons = Math.max(0, pd.reading - prevRead);
          return `<td style="padding:4px;text-align:center;background:rgba(47,79,79,0.15)">
              <div style="font-size:15px;font-weight:900;color:#A9D5D5;">${fmt(pd.reading)}</div>
              <div style="font-size:11px;font-weight:700;color:#52BE80;margin-top:1px">↓ ${fmt(displayCons)}</div>
             </td>`;
        }).join('');
        const diffLabel = m.auditDiff === 0 ? 'مطابق' : m.auditDiff > 0 ? `فائض +${fmt(m.auditDiff,2)}` : `عجز ${fmt(m.auditDiff,2)}`;
        const diffColor = m.auditDiff === 0 ? '#27AE60' : m.auditDiff > 0 ? '#27AE60' : '#E74C3C';
        bodyHtml += `<tr style="background:linear-gradient(135deg,#1B2631,#2C3E50);color:white;">
          <td style="padding:6px 8px;white-space:nowrap;text-align:center;border-top:2px solid #5D6D7E;border-bottom:2px solid #5D6D7E;">
            <div style="background:linear-gradient(135deg,#2F4F4F,#1B2631);color:#A9D5D5;border:1px solid #5D6D7E;border-radius:6px;padding:3px 7px;font-size:11px;font-weight:800;white-space:nowrap">📑 جرد</div>
            <div style="font-size:9px;color:#7FB3B3;margin-top:2px">${m.time || ''}</div>
            <div style="font-size:9px;color:${diffColor};font-weight:700;margin-top:1px">${diffLabel}</div>
          </td>
          ${pumpReadings}
        </tr>`;
        return; // تخطّ الرندر العادي
      }

      const pumpCells = pumps.map(p => {
        const pd = m.pumps.find(x => x.pumpId === p.id);
        const rawType = p.type === 'n91' ? '91' : p.type === 'n95' ? '95' : p.type;
        
        // Gradient backgrounds for each fuel type
        const bgGradient = {
          'diesel': 'linear-gradient(180deg,rgba(249,232,122,0.22),rgba(249,232,122,0.12))',
          '91': 'linear-gradient(180deg,rgba(39,174,96,0.20),rgba(39,174,96,0.10))',
          '95': 'linear-gradient(180deg,rgba(192,57,43,0.20),rgba(192,57,43,0.10))'
        };
        
        const cellBg = bgGradient[rawType] || 'transparent';
        
        if (!pd) return `<td style="padding:2px 4px;color:var(--gray-300);text-align:center;font-size:10px;background:${cellBg}">—</td>`;

        // ✅ CORE FIX: إعادة حساب الاستهلاك لحظياً من الترتيب الصحيح
        // الاستهلاك = قراءة هذا الصف - قراءة الصف الذي أسفله مباشرة في sortedMeters
        const liveConsumption = getImmediatePreviousReading(p.id, m.date, m.shiftType);
        const displayConsumption = Math.max(0, pd.reading - liveConsumption);

        return `<td style="padding:3px 4px;text-align:center;background:${cellBg}">
          <div style="font-size:16px;font-weight:800;color:var(--text-primary);letter-spacing:-0.3px">${fmt(pd.reading)}</div>
          <div style="font-size:11px;font-weight:700;color:#27AE60;margin-top:1px">↓ ${fmt(displayConsumption)}</div>
        </td>`;
      }).join('');
      const deleteTd = '';
      const editTd = '';
      bodyHtml += `<tr>
        <td style="padding:3px 6px;white-space:nowrap;text-align:center;min-width:40px">
          <span style="background:linear-gradient(135deg,var(--red-dark),var(--red));color:white;padding:2px 8px;border-radius:6px;font-size:12px;font-weight:800">${shiftLabel}</span>
        </td>
        ${pumpCells}
        ${editTd}
        ${deleteTd}
      </tr>`;
    });
  });

  body.innerHTML = bodyHtml || '<tr><td colspan="100" class="text-center text-muted" style="padding:30px">لا توجد بيانات</td></tr>';

  // إضافة صف ثابت "القراءات الافتتاحية" في أسفل الجدول
  const openingMeter = sortedMeters.find(m => m.type === 'opening');
  if (openingMeter) {
    const openingCells = pumps.map(p => {
      const rawType = p.type === 'n91' ? '91' : p.type === 'n95' ? '95' : p.type;
      const bgGradient = {
        'diesel': 'linear-gradient(180deg,rgba(249,232,122,0.22),rgba(249,232,122,0.12))',
        '91': 'linear-gradient(180deg,rgba(39,174,96,0.20),rgba(39,174,96,0.10))',
        '95': 'linear-gradient(180deg,rgba(192,57,43,0.20),rgba(192,57,43,0.10))'
      };
      const cellBg = bgGradient[rawType] || 'transparent';
      
      const pd = openingMeter.pumps.find(x => x.pumpId === p.id);
      const val = pd ? pd.reading : (DB.config.pumps.find(x => x.id === p.id)?.opening || 0);
      return `<td style="padding:3px 6px;text-align:center;background:${cellBg}">
        <div style="font-size:12px;font-weight:700;color:var(--gold-dark)">${fmt(val)}</div>
      </td>`;
    }).join('');
    const emptyEditTd = '';
    const emptyDeleteTd = '';
    body.innerHTML += `<tr style="border-top:2px solid var(--gold)">
      <td style="padding:4px 8px;text-align:center;background:rgba(212,172,13,0.08)">
        <div style="font-size:10px;font-weight:800;color:var(--gold-dark)">📌 افتتاحي</div>
      </td>
      ${openingCells}
    </tr>`;
  }
}

// ── حذف صف عداد واحد ──────────────────────────────────────────
function deleteMeterRow(idx) {
  if (currentUser?.role !== 'owner') { alert('⛔ هذه الصلاحية للمالك فقط'); return; }
  if (idx < 0 || idx >= DB.meters.length) { alert('⚠️ الصف غير موجود'); return; }
  const m = DB.meters[idx];
  if (m.type === 'opening') { alert('⚠️ لا يمكن حذف صف القراءات الافتتاحية'); return; }
  const shiftLabel = DB.config.shifts.find(s => s.abbr === m.shiftType)?.name || m.shiftType;
  if (!confirm(`⚠️ تأكيد حذف عدادات:\n${formatDate(m.date)} — ${shiftLabel}\nهذا الإجراء لا يمكن التراجع عنه`)) return;
  DB.meters.splice(idx, 1);
  saveDB();
  triggerGlobalRecalculation();
  logActivity('meter_delete', `حذف صف عدادات: ${shiftLabel} بتاريخ ${m.date}`);
  alert('✅ تم حذف صف العدادات');
}

// ── تعديل صف عداد ────────────────────────────────────────────────
function editMeterRow(idx) {
  if (currentUser?.role !== 'owner') { alert('⛔ هذه الصلاحية للمالك فقط'); return; }
  if (idx < 0 || idx >= DB.meters.length) { alert('⚠️ الصف غير موجود'); return; }
  
  const m = DB.meters[idx];
  if (m.type === 'opening') { alert('⚠️ لا يمكن تعديل صف القراءات الافتتاحية'); return; }
  
  const shiftLabel = DB.config.shifts.find(s => s.abbr === m.shiftType)?.name || m.shiftType;
  const pumps = DB.config.pumps;
  
  // بناء نموذج التعديل
  let formHtml = `<div style="background:white;padding:16px;border-radius:10px;box-shadow:0 4px 12px rgba(0,0,0,0.15)">
    <div style="font-size:14px;font-weight:800;color:var(--red);margin-bottom:12px">✏️ تعديل العدادات — ${formatDate(m.date)} / ${shiftLabel}</div>`;
  
  pumps.forEach(p => {
    const pd = m.pumps.find(x => x.pumpId === p.id);
    const currentReading = pd ? pd.reading : '';
    const typeLabel = p.type === 'diesel' ? 'ديزل' : p.type === '91' || p.type === 'n91' ? '91' : '95';
    
    formHtml += `
    <div style="margin-bottom:10px;padding:8px;background:var(--gray-100);border-radius:8px">
      <label style="display:block;font-size:12px;font-weight:700;color:var(--gray-700);margin-bottom:4px">
        ${p.name} <span style="color:var(--gray-500);font-size:10px">(${typeLabel})</span>
      </label>
      <input type="number" id="editMeter_${p.id}" value="${currentReading}" placeholder="قراءة العداد" 
        style="width:100%;padding:6px 8px;border:1px solid var(--gold);border-radius:6px;font-size:13px;text-align:center;box-sizing:border-box">
    </div>`;
  });
  
  formHtml += `
    <div style="display:flex;gap:8px;margin-top:14px;justify-content:center">
      <button onclick="document.querySelector('[data-editmodal]')?.remove()" style="padding:6px 16px;background:#ccc;border:none;border-radius:6px;cursor:pointer;font-weight:700">إلغاء</button>
      <button onclick="saveEditedMeter(${idx})" style="padding:6px 16px;background:#1565C0;color:white;border:none;border-radius:6px;cursor:pointer;font-weight:700">حفظ التعديلات</button>
    </div>
  </div>`;
  
  // عرض النموذج في popup
  const modal = document.createElement('div');
  modal.setAttribute('data-editmodal', 'true');
  modal.style.cssText = `
    position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);
    display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px;
  `;
  modal.innerHTML = formHtml;
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
  document.body.appendChild(modal);
  
  // ركز على أول حقل
  setTimeout(() => {
    const firstInput = document.getElementById(`editMeter_${pumps[0].id}`);
    if (firstInput) firstInput.focus();
  }, 100);
}

// ── حفظ العداد المعدّل ──────────────────────────────────────────
function saveEditedMeter(idx) {
  if (idx < 0 || idx >= DB.meters.length) { alert('⚠️ خطأ: الصف غير موجود'); return; }
  
  const m = DB.meters[idx];
  const pumps = DB.config.pumps;
  let hasChanges = false;
  
  pumps.forEach(p => {
    const inputEl = document.getElementById(`editMeter_${p.id}`);
    if (!inputEl) return;
    
    const newValue = parseFloat(inputEl.value) || 0;
    const pumpData = m.pumps.find(x => x.pumpId === p.id);
    
    if (!pumpData) {
      // إنشاء entry جديد — نجلب القراءة السابقة من الصف الذي أسفل هذا الصف مباشرة
      const prevReading = getImmediatePreviousReading(p.id, m.date, m.shiftType);
      m.pumps.push({
        pumpId: p.id,
        reading: newValue,
        consumption: Math.max(0, newValue - prevReading)
      });
      hasChanges = true;
    } else if (pumpData.reading !== newValue) {
      // ✅ CORE FIX: الاستهلاك = القراءة الجديدة - قراءة الصف الأسفل مباشرة
      // وليس: القراءة الجديدة - القراءة القديمة لنفس الصف
      const prevReading = getImmediatePreviousReading(p.id, m.date, m.shiftType);
      pumpData.reading = newValue;
      pumpData.consumption = Math.max(0, newValue - prevReading);
      hasChanges = true;
    }
  });
  
  if (!hasChanges) {
    alert('⚠️ لم تُدخل أي تغييرات');
    return;
  }
  
  saveDB();
  triggerGlobalRecalculation();
  
  // إغلاق النموذج
  const modal = document.querySelector('[data-editmodal]');
  if (modal) modal.remove();
  
  logActivity('meter_edit', `تعديل صف عدادات: ${formatDate(m.date)}`);
  alert('✅ تم حفظ التعديلات بنجاح');
}

// ── خيارات حذف العدادات (كل أو آخر صف) ───────────────────────
