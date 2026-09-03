/**
 * ═══════════════════════════════════════════════════════════════════════
 * ACCOUNTING ENGINE — محرك الحسابات الموحد v3.0
 * ─────────────────────────────────────────────────────────────────────
 * هذا الملف هو المصدر الوحيد للحقيقة (Single Source of Truth) لجميع
 * الحسابات المحاسبية في نظام محطة الوقود.
 *
 * التغييرات الجوهرية عن v1:
 *   ① سجل أسعار تاريخي (DB.priceHistory) — كل وردية تُحاسَب بسعر وقتها
 *      الفعلي، وليس بالسعر الحالي في الإعدادات. هذا يمنع تغيّر أرقام
 *      التقارير القديمة تلقائياً عند تعديل السعر لاحقاً.
 *   ② نافذة "اليوم/24 ساعة" موحّدة في مكان واحد فقط (AE_getRecentShifts)
 *      تعتمد حصراً على DB.config.shiftsPerDay — تُستخدم من كل الشاشات
 *      بدل أن يعيد كل ملف/دالة اختراعها بطريقته الخاصة.
 *   ③ الوصل بين الوردية وعدادها يتم عبر id مشترك (لا عبر تاريخ+نوع وردية
 *      الذي ينكسر مع التعديل والحذف وتكرار نفس اليوم).
 *   ④ بدل إخفاء الأخطاء بصمت (Math.max(0,...) فقط)، تُسجَّل علامة anomaly
 *      توضح للواجهة أن هناك قراءة عداد رجعت للخلف أو عجزاً غير مبرر،
 *      مع دعم اختياري لالتفاف العداد (rollover) إن كان مُعرَّفاً بحد أقصى.
 *   ⑤ دالة تقارير موحّدة واحدة (getReportTotals) تُستخدم من كل الشاشات
 *      (لوحة التحكم، التقارير، التصدير) بدل أن يعيد كل واحد حساب
 *      الإيراد بضرب اللترات في السعر الحالي.
 *
 * القاعدة الذهبية:
 *   لا تحسب أي شاشة أو دالة أي رقم بنفسها — كلها تقرأ من هنا فقط.
 *   ويجب استدعاء AccountingEngine.rebuild() بعد أي تعديل على البيانات
 *   (هذا الآن يحدث تلقائياً من داخل saveDB() في index.html).
 * ═══════════════════════════════════════════════════════════════════════
 */

// ══════════════════════════════════════════════════════════════════
// §1 — الثوابت والأنواع
// ══════════════════════════════════════════════════════════════════

/** تحويل نوع المضخة إلى مفتاح موحد */
function AE_normFuelType(type) {
  if (!type) return 'diesel';
  const t = String(type).toLowerCase().trim();
  if (t === '91' || t === 'n91' || t === 'fuel91') return 'n91';
  if (t === '95' || t === 'n95' || t === 'fuel95') return 'n95';
  return 'diesel';
}

/** المفاتيح الثلاثة للوقود */
const AE_FUEL_KEYS = ['diesel', 'n91', 'n95'];

// ══════════════════════════════════════════════════════════════════
// §2 — ترتيب البيانات الزمني
// ══════════════════════════════════════════════════════════════════

/**
 * AE_sortEvents — ترتيب زمني صارم لجميع الأحداث
 * ترتيب الأولوية:
 *   1. التاريخ (YYYY-MM-DD) تصاعدياً
 *   2. نوع الحدث: opening < supply < shift < adjust < audit
 *   3. ID تصاعدياً (وقت الإدخال الفعلي)
 *
 * @param {Array} events - مصفوفة أحداث بها {date, type, id, shiftType?, time?}
 * @returns {Array} مرتبة زمنياً تصاعدياً (الأقدم أولاً)
 */
function AE_sortEvents(events) {
  const typePriority = { opening: 0, supply: 1, shift: 2, adjust: 3, audit: 4, meter: 2 };
  return [...events].sort((a, b) => {
    const dateDiff = (a.date || '').localeCompare(b.date || '');
    if (dateDiff !== 0) return dateDiff;
    const pa = typePriority[a.type] ?? 5;
    const pb = typePriority[b.type] ?? 5;
    if (pa !== pb) return pa - pb;
    return (a.id || 0) - (b.id || 0);
  });
}

// ══════════════════════════════════════════════════════════════════
// §3 — سجل الأسعار التاريخي (Price History)
// ══════════════════════════════════════════════════════════════════

/**
 * AE_ensurePriceHistory — يضمن وجود DB.priceHistory ويُهيّئه من السعر
 * الحالي عند أول تشغيل (توافق رجعي مع قواعد بيانات لا تملك سجل أسعار).
 */
function AE_ensurePriceHistory() {
  if (!window.DB || !DB.config) return;
  if (!Array.isArray(DB.priceHistory)) DB.priceHistory = [];
  if (DB.priceHistory.length === 0 && DB.config.prices) {
    DB.priceHistory.push({
      id: 0, // أقدم من أي id حقيقي (Date.now()) — يغطي كل البيانات القديمة
      date: DB.shifts?.[0]?.date || new Date().toISOString().split('T')[0],
      diesel: DB.config.prices.diesel || 0,
      n91:    DB.config.prices.n91    || 0,
      n95:    DB.config.prices.n95    || 0,
    });
  }
}

/**
 * AE_priceAt — يُعيد الأسعار الفعلية عند لحظة (id) معينة.
 * يبحث عن آخر سجل سعر بـ id أقل أو يساوي id الحدث، وإلا يستخدم أقدم سعر.
 * @param {number} refId - معرّف الحدث (Date.now() وقت إدخاله)
 */
function AE_priceAt(refId) {
  AE_ensurePriceHistory();
  const hist = [...(DB.priceHistory || [])].sort((a, b) => (a.id || 0) - (b.id || 0));
  if (hist.length === 0) return DB.config?.prices || { diesel: 0, n91: 0, n95: 0 };
  let applicable = hist[0];
  for (const h of hist) {
    if ((h.id || 0) <= (refId || 0)) applicable = h;
    else break;
  }
  return applicable;
}

/**
 * AE_recordPriceChange — يُسجَّل عند تغيير الأسعار من الإعدادات
 * (يُستدعى من savePrices() في index.html)
 */
function AE_recordPriceChange(newPrices) {
  if (!window.DB) return;
  AE_ensurePriceHistory();
  DB.priceHistory.push({
    id: Date.now(),
    date: new Date().toISOString().split('T')[0],
    diesel: newPrices.diesel,
    n91:    newPrices.n91,
    n95:    newPrices.n95,
  });
}

// ══════════════════════════════════════════════════════════════════
// §4 — نافذة "اليوم / آخر 24 ساعة" الموحّدة
// ══════════════════════════════════════════════════════════════════

/** عدد الورديات المُقرَّرة لليوم الواحد من إعدادات المالك (لا قيمة ثابتة أبداً) */
function AE_shiftsPerDay() {
  return Math.max(1, parseInt(DB.config?.shiftsPerDay || DB.config?.shifts?.length || 2));
}

/**
 * AE_getRecentShifts — آخر N وردية حقيقية (وليس N يوم تقويمي)، بالترتيب
 * الزمني الصحيح (الأحدث أولاً)، مستبعدة الجردات.
 * هذا هو المصدر الوحيد لتعريف "اليوم / آخر 24 ساعة" في كامل التطبيق.
 * @param {number} [n] - عدد الورديات (افتراضياً shiftsPerDay من الإعدادات)
 */
function AE_getRecentShifts(n) {
  if (!window.DB) return [];
  const count = n || AE_shiftsPerDay();
  const sorted = AE_sortEvents(DB.shifts.filter(s => s.type !== 'audit')).reverse(); // الأحدث أولاً
  return sorted.slice(0, count);
}

// ══════════════════════════════════════════════════════════════════
// §5 — إعادة بناء العدادات (المضخات + عدادات الجرد)
// ══════════════════════════════════════════════════════════════════

/**
 * AE_rebuildMeterConsumptions — إعادة احتساب استهلاك جميع العدادات من الصفر
 *
 * يدعم التفاف العداد (rollover) إن كان للمضخة حد أقصى مُعرَّف (maxReading):
 * إن كانت القراءة الجديدة أقل من السابقة بسبب تصفير/استبدال العداد الفعلي،
 * يُحتسَب الاستهلاك كـ (الحد الأقصى - السابقة) + الجديدة بدل اعتباره صفراً.
 * إن لم يوجد حد أقصى مُعرَّف، يُعامَل التراجع كـ "علامة شذوذ" (anomaly)
 * ويُصفَّر الاستهلاك مع الإبقاء على أثر ذلك ظاهراً للواجهة بدل إخفائه.
 */
function AE_rebuildMeterConsumptions() {
  if (!window.DB) return {};

  const allMeters = AE_sortEvents(DB.meters);
  const lastReading = {};

  const openingMeter = allMeters.find(m => m.type === 'opening');
  if (openingMeter && openingMeter.pumps) {
    openingMeter.pumps.forEach(pd => { lastReading[pd.pumpId] = pd.reading || 0; });
  }
  (DB.config?.pumps || []).forEach(p => {
    if (lastReading[p.id] === undefined) lastReading[p.id] = p.opening || 0;
  });

  allMeters.forEach(meter => {
    if (meter.type === 'opening') return;
    if (!meter.pumps) return;

    meter.pumps.forEach(pd => {
      const prev = lastReading[pd.pumpId] ?? 0;
      const reading = pd.reading || 0;
      let cons;
      pd.anomaly = null;

      if (reading >= prev) {
        cons = reading - prev;
      } else {
        // القراءة أقل من السابقة — تراجع غير طبيعي أو التفاف عداد
        const pumpCfg = (DB.config?.pumps || []).find(p => p.id === pd.pumpId);
        const maxReading = pumpCfg?.maxReading;
        if (maxReading && maxReading > prev) {
          // التفاف عداد حقيقي: أكمل العدّاد من الحد الأقصى ثم أضف القراءة الجديدة
          cons = (maxReading - prev) + reading;
          pd.anomaly = 'rollover';
        } else {
          // لا يوجد حد أقصى مُعرَّف — لا يمكن الجزم بأنه التفاف فعلي
          // يُصفَّر الاستهلاك لكن يُعلَّم بوضوح ليظهر تنبيه في الواجهة
          cons = 0;
          pd.anomaly = 'backward_reading';
        }
      }

      pd.consumption = cons;
      lastReading[pd.pumpId] = reading || prev;
    });
  });

  return lastReading;
}

// ══════════════════════════════════════════════════════════════════
// §6 — المحرك الرئيسي: إعادة بناء المخزون من الصفر
// ══════════════════════════════════════════════════════════════════

/**
 * AE_rebuildInventory — إعادة بناء جميع سجلات المخزون من الصفر
 *
 * المعادلة لكل فترة زمنية:
 *   مخزون_جديد = مخزون_سابق + توريدات - استهلاك_مضخات - استهلاك_جرد ± تصحيحات
 *
 * الربط بين صف المخزون وعداده يتم عبر id مشترك أولاً (موثوق)، مع Fallback
 * على تاريخ+نوع الوردية لدعم السجلات القديمة التي لا تملك id مشتركاً.
 */
function AE_rebuildInventory() {
  if (!window.DB || !DB.config) return;

  AE_rebuildMeterConsumptions();

  const openingInv = DB.inventory.find(r => r.type === 'opening');
  let stock = {
    diesel: openingInv?.diesel ?? DB.config.openingStock?.diesel ?? 0,
    n91:    openingInv?.n91    ?? DB.config.openingStock?.n91    ?? 0,
    n95:    openingInv?.n95    ?? DB.config.openingStock?.n95    ?? 0,
  };

  const findMeterFor = (row, meterType) => {
    let m = DB.meters.find(mm => mm.type === meterType && mm.id === row.id);
    if (m) return m;
    return DB.meters.find(mm => mm.type === meterType && mm.date === row.date && mm.shiftType === row.shiftType);
  };

  const nonOpeningRows = DB.inventory.filter(r => r.type !== 'opening');
  const sortedRows = AE_sortEvents(nonOpeningRows);

  sortedRows.forEach(row => {
    row.anomaly = null;

    if (row.type === 'shift') {
      const meterEntry = findMeterFor(row, 'meter');
      if (meterEntry && meterEntry.pumps) {
        let consD = 0, cons91 = 0, cons95 = 0, hasAnomaly = false;
        meterEntry.pumps.forEach(pd => {
          const pump = DB.config.pumps.find(p => p.id === pd.pumpId);
          if (!pump) return;
          const fuelKey = AE_normFuelType(pump.type);
          const cons = pd.consumption || 0;
          if (pd.anomaly) hasAnomaly = true;
          if (fuelKey === 'diesel') consD += cons;
          else if (fuelKey === 'n91') cons91 += cons;
          else cons95 += cons;
        });
        row.consD = consD; row.cons91 = cons91; row.cons95 = cons95;
        if (hasAnomaly) row.anomaly = 'meter_anomaly';
      }

      const newDiesel = stock.diesel - (row.consD || 0);
      const newN91    = stock.n91    - (row.cons91 || 0);
      const newN95    = stock.n95    - (row.cons95 || 0);
      if (newDiesel < 0 || newN91 < 0 || newN95 < 0) row.anomaly = row.anomaly || 'stock_shortage';
      stock.diesel = Math.max(0, newDiesel);
      stock.n91    = Math.max(0, newN91);
      stock.n95    = Math.max(0, newN95);

    } else if (row.type === 'supply') {
      const key = row.supplyFuel === 'diesel' ? 'diesel' : row.supplyFuel === '91' ? 'n91' : 'n95';
      stock[key] += (row.supplyQty || 0);

    } else if (row.type === 'adjust') {
      stock.diesel += (row.adjD  || 0);
      stock.n91    += (row.adj91 || 0);
      stock.n95    += (row.adj95 || 0);

    } else if (row.type === 'audit') {
      const auditMeter = DB.meters.find(m => m.type === 'audit' && m.id === (row.auditMeterId ?? row.id));
      if (auditMeter && auditMeter.pumps) {
        let auditConsD = 0, auditCons91 = 0, auditCons95 = 0, hasAnomaly = false;
        auditMeter.pumps.forEach(pd => {
          const pump = DB.config.pumps.find(p => p.id === pd.pumpId);
          if (!pump) return;
          const fuelKey = AE_normFuelType(pump.type);
          const cons = pd.consumption || 0;
          if (pd.anomaly) hasAnomaly = true;
          if (fuelKey === 'diesel') auditConsD += cons;
          else if (fuelKey === 'n91') auditCons91 += cons;
          else auditCons95 += cons;
        });
        row.auditConsD = auditConsD; row.auditCons91 = auditCons91; row.auditCons95 = auditCons95;
        if (hasAnomaly) row.anomaly = 'meter_anomaly';
        stock.diesel = Math.max(0, stock.diesel - auditConsD);
        stock.n91    = Math.max(0, stock.n91    - auditCons91);
        stock.n95    = Math.max(0, stock.n95    - auditCons95);
      }
      stock.diesel += (row.adjD  || 0);
      stock.n91    += (row.adj91 || 0);
      stock.n95    += (row.adj95 || 0);
    }

    row.diesel = stock.diesel;
    row.n91    = stock.n91;
    row.n95    = stock.n95;
  });

  AE_rebuildDayTotals(sortedRows);

  DB.config.currentStock = { ...stock };

  const newInventory = openingInv ? [openingInv, ...sortedRows] : [...sortedRows];
  DB.inventory = newInventory;

  return { currentStock: stock };
}

// ══════════════════════════════════════════════════════════════════
// §7 — إعادة بناء استهلاك اليوم (نافذة آخر N وردية حسب إعداد المالك)
// ══════════════════════════════════════════════════════════════════

/**
 * AE_rebuildDayTotals — يُحدِّث dayD / day91 / day95 في كل صف مخزون من نوع
 * 'shift' بنافذة "آخر N وردية" حيث N = shiftsPerDay من إعدادات المالك —
 * نفس التعريف تماماً المستخدم في AE_getRecentShifts، بلا أي ازدواجية.
 */
function AE_rebuildDayTotals(sortedRows) {
  const shiftsPerDay = AE_shiftsPerDay();
  const shiftRows = sortedRows.filter(r => r.type === 'shift');

  shiftRows.forEach((row, idx) => {
    const windowStart = Math.max(0, idx - shiftsPerDay + 1);
    const win = shiftRows.slice(windowStart, idx + 1);
    row.dayD  = win.reduce((a, s) => a + (s.consD  || 0), 0);
    row.day91 = win.reduce((a, s) => a + (s.cons91 || 0), 0);
    row.day95 = win.reduce((a, s) => a + (s.cons95 || 0), 0);
  });
}

// ══════════════════════════════════════════════════════════════════
// §8 — إعادة بناء بيانات الورديات (DB.shifts) — بسعر وقت الوردية الفعلي
// ══════════════════════════════════════════════════════════════════

/**
 * AE_rebuildShifts — مزامنة DB.shifts مع العدادات المُعاد احتسابها.
 * الإيراد يُحسَب بسعر الوقود وقت حدوث الوردية فعلياً (AE_priceAt) وليس
 * بالسعر الحالي — هذا يحل مشكلة تغيّر الإيرادات التاريخية عند تعديل الأسعار.
 */
function AE_rebuildShifts() {
  if (!window.DB) return;
  AE_ensurePriceHistory();

  const findMeterFor = (shift) => {
    let m = DB.meters.find(mm => mm.type === 'meter' && mm.id === shift.id);
    if (m) return m;
    return DB.meters.find(mm => mm.type === 'meter' && mm.date === shift.date && mm.shiftType === shift.shiftType);
  };

  DB.shifts.forEach(shift => {
    if (shift.type === 'audit') return; // للجردات مسار منفصل تماماً (AE_rebuildAuditRecords)

    const meterEntry = findMeterFor(shift);
    if (!meterEntry || !meterEntry.pumps) return;

    let newDiesel = 0, newN91 = 0, newN95 = 0;
    meterEntry.pumps.forEach(pd => {
      const pump = DB.config.pumps.find(p => p.id === pd.pumpId);
      if (!pump) return;
      const fuelKey = AE_normFuelType(pump.type);
      const cons = pd.consumption || 0;
      if (fuelKey === 'diesel') newDiesel += cons;
      else if (fuelKey === 'n91') newN91 += cons;
      else newN95 += cons;
    });

    const priceAtShift = AE_priceAt(shift.id);
    shift.diesel = newDiesel;
    shift.n91    = newN91;
    shift.n95    = newN95;
    shift.priceUsed = { diesel: priceAtShift.diesel, n91: priceAtShift.n91, n95: priceAtShift.n95 };
    shift.totalMoney = (newDiesel * (priceAtShift.diesel || 0))
                     + (newN91    * (priceAtShift.n91    || 0))
                     + (newN95    * (priceAtShift.n95    || 0));
    const cashBeforeClamp = shift.totalMoney - (shift.network || 0) - (shift.invoices || 0) - (shift.supplied || 0);
    shift.anomaly = cashBeforeClamp < 0 ? 'negative_cash' : null;
    shift.cash = Math.max(0, cashBeforeClamp);
  });
}

// ══════════════════════════════════════════════════════════════════
// §9 — إعادة بناء سجلات الجرد (DB.meters من نوع audit)
// ══════════════════════════════════════════════════════════════════

/**
 * AE_rebuildAuditRecords — إعادة احتساب جميع سجلات الجرد.
 * الإيراد المتوقع للفترة = مجموع totalMoney لكل وردية ضمن الفترة (وهي
 * محسوبة أصلاً بسعر وقتها الفعلي بواسطة AE_rebuildShifts) — وليس
 * (مجموع اللترات × سعر واحد)، لأن ذلك يُخطئ إن تغيّر السعر أثناء الفترة.
 */
function AE_rebuildAuditRecords() {
  if (!window.DB) return;

  const auditMeters = AE_sortEvents(DB.meters.filter(m => m.type === 'audit'));

  auditMeters.forEach((audit, auditIdx) => {
    const prevAudit = auditIdx > 0 ? auditMeters[auditIdx - 1] : null;

    const shiftsInPeriod = DB.shifts.filter(s => {
      if (s.type === 'audit') return false;
      const sId = s.id || 0;
      const afterPrev = !prevAudit || sId > (prevAudit.id || 0);
      const beforeThis = sId <= (audit.id || 0);
      return afterPrev && beforeThis;
    });

    const diesel = shiftsInPeriod.reduce((a, s) => a + (s.diesel || 0), 0);
    const n91    = shiftsInPeriod.reduce((a, s) => a + (s.n91    || 0), 0);
    const n95    = shiftsInPeriod.reduce((a, s) => a + (s.n95    || 0), 0);
    const expectedRevenue = shiftsInPeriod.reduce((a, s) => a + (s.totalMoney || 0), 0);

    audit.periodDiesel = diesel;
    audit.periodN91    = n91;
    audit.periodN95    = n95;
    audit.expectedRevenue = expectedRevenue;
    audit.auditDiff = (audit.auditTotal || 0) - expectedRevenue;

    const invRow = DB.inventory.find(r => r.type === 'audit' && (r.auditMeterId ?? r.id) === audit.id);
    if (invRow) {
      invRow.periodDiesel = diesel;
      invRow.periodN91    = n91;
      invRow.periodN95    = n95;
      invRow.expectedRevenue = expectedRevenue;
      invRow.auditDiff    = audit.auditDiff;
    }

    const shiftRow = DB.shifts.find(s => s.type === 'audit' && s.id === audit.id);
    if (shiftRow) {
      shiftRow.periodDiesel = diesel;
      shiftRow.periodN91    = n91;
      shiftRow.periodN95    = n95;
      shiftRow.expectedRevenue = expectedRevenue;
      shiftRow.auditDiff    = audit.auditDiff;
    }
  });
}

// ══════════════════════════════════════════════════════════════════
// §10 — نقطة الدخول الرئيسية: إعادة البناء الكامل
// ══════════════════════════════════════════════════════════════════

window.AccountingEngine = {

  rebuild(options = {}) {
    try {
      if (!window.DB || !DB.config) {
        console.warn('[AE] البيانات غير محمّلة بعد');
        return;
      }

      AE_ensurePriceHistory();

      AE_rebuildMeterConsumptions();
      AE_rebuildInventory();
      AE_rebuildShifts();
      AE_rebuildAuditRecords();

      if (!options.silent) {
        console.log('✅ [AE] اكتملت إعادة البناء المحاسبي الكامل');
      }
      if (typeof options.onComplete === 'function') options.onComplete();

    } catch (err) {
      console.error('❌ [AE] خطأ في إعادة البناء:', err);
    }
  },

  // ── واجهات قراءة موحدة (تُستخدم من جميع الشاشات) ──────────────

  getLastReading(pumpId) {
    const sorted = AE_sortEvents(DB.meters.filter(m => m.type !== 'opening')).reverse();
    for (const m of sorted) {
      const pd = m.pumps?.find(p => p.pumpId === pumpId);
      if (pd) return pd.reading || 0;
    }
    const opening = DB.meters.find(m => m.type === 'opening');
    if (opening) {
      const pd = opening.pumps?.find(p => p.pumpId === pumpId);
      if (pd) return pd.reading || 0;
    }
    return DB.config?.pumps?.find(p => p.id === pumpId)?.opening || 0;
  },

  getPrevReading(pumpId, date, shiftType) {
    const sorted = AE_sortEvents(DB.meters.filter(m => m.type !== 'opening')).reverse();
    const thisIdx = sorted.findIndex(m => m.date === date && m.shiftType === shiftType && m.type !== 'audit');
    const start = thisIdx !== -1 ? thisIdx + 1 : 0;
    for (let i = start; i < sorted.length; i++) {
      const pd = sorted[i].pumps?.find(p => p.pumpId === pumpId);
      if (pd) return pd.reading || 0;
    }
    const opening = DB.meters.find(m => m.type === 'opening');
    if (opening) {
      const pd = opening.pumps?.find(p => p.pumpId === pumpId);
      if (pd) return pd.reading || 0;
    }
    return DB.config?.pumps?.find(p => p.id === pumpId)?.opening || 0;
  },

  getLastReadingBeforeDate(pumpId, endDate) {
    const sorted = AE_sortEvents(
      DB.meters.filter(m => m.type !== 'opening' && m.date <= endDate)
    ).reverse();
    for (const m of sorted) {
      const pd = m.pumps?.find(p => p.pumpId === pumpId);
      if (pd) return pd.reading || 0;
    }
    const opening = DB.meters.find(m => m.type === 'opening');
    if (opening) {
      const pd = opening.pumps?.find(p => p.pumpId === pumpId);
      if (pd) return pd.reading || 0;
    }
    return DB.config?.pumps?.find(p => p.id === pumpId)?.opening || 0;
  },

  getHistoricalStock(endDate) {
    const openingRow = DB.inventory.find(r => r.type === 'opening');
    let stock = {
      diesel: openingRow?.diesel ?? DB.config?.openingStock?.diesel ?? 0,
      n91:    openingRow?.n91    ?? DB.config?.openingStock?.n91    ?? 0,
      n95:    openingRow?.n95    ?? DB.config?.openingStock?.n95    ?? 0,
    };
    const rows = AE_sortEvents(DB.inventory.filter(r => r.type !== 'opening' && r.date <= endDate));
    rows.forEach(r => {
      if (r.type === 'shift') {
        stock.diesel = Math.max(0, stock.diesel - (r.consD  || 0));
        stock.n91    = Math.max(0, stock.n91    - (r.cons91 || 0));
        stock.n95    = Math.max(0, stock.n95    - (r.cons95 || 0));
      } else if (r.type === 'supply') {
        const k = r.supplyFuel === 'diesel' ? 'diesel' : r.supplyFuel === '91' ? 'n91' : 'n95';
        stock[k] += (r.supplyQty || 0);
      } else if (r.type === 'adjust') {
        stock.diesel += (r.adjD  || 0);
        stock.n91    += (r.adj91 || 0);
        stock.n95    += (r.adj95 || 0);
      } else if (r.type === 'audit') {
        stock.diesel = Math.max(0, stock.diesel - (r.auditConsD  || 0));
        stock.n91    = Math.max(0, stock.n91    - (r.auditCons91 || 0));
        stock.n95    = Math.max(0, stock.n95    - (r.auditCons95 || 0));
        stock.diesel += (r.adjD  || 0);
        stock.n91    += (r.adj91 || 0);
        stock.n95    += (r.adj95 || 0);
      }
    });
    return stock;
  },

  /** آخر N وردية (N = shiftsPerDay من الإعدادات ما لم يُحدَّد غير ذلك) */
  getRecentShifts(n) {
    return AE_getRecentShifts(n);
  },

  /** عدد الورديات المُقرَّرة يومياً من إعدادات المالك */
  getShiftsPerDay() {
    return AE_shiftsPerDay();
  },

  /** الأسعار الفعلية عند لحظة معينة (id) — أو الحالية إن لم يُمرَّر شيء */
  getPriceAt(refId) {
    return refId ? AE_priceAt(refId) : (DB.config?.prices || {});
  },

  /** يُسجَّل من savePrices() في الإعدادات عند تغيير أي سعر */
  recordPriceChange(newPrices) {
    AE_recordPriceChange(newPrices);
  },

  calcSinceLastAudit() {
    const auditMeters = AE_sortEvents(DB.meters.filter(m => m.type === 'audit'));
    const lastAudit   = auditMeters.length > 0 ? auditMeters[auditMeters.length - 1] : null;

    const shiftsAfter = (lastAudit
      ? DB.shifts.filter(s => s.type !== 'audit' && (s.id || 0) > (lastAudit.id || 0))
      : DB.shifts.filter(s => s.type !== 'audit'));

    const diesel = shiftsAfter.reduce((a, s) => a + (s.diesel || 0), 0);
    const n91    = shiftsAfter.reduce((a, s) => a + (s.n91    || 0), 0);
    const n95    = shiftsAfter.reduce((a, s) => a + (s.n95    || 0), 0);

    const totalRevenue = shiftsAfter.reduce((a, s) => a + (s.totalMoney || 0), 0);
    const dieselRev = shiftsAfter.reduce((a, s) => a + (s.diesel||0) * (s.priceUsed?.diesel ?? DB.config?.prices?.diesel ?? 0), 0);
    const n91Rev    = shiftsAfter.reduce((a, s) => a + (s.n91||0)    * (s.priceUsed?.n91    ?? DB.config?.prices?.n91    ?? 0), 0);
    const n95Rev    = shiftsAfter.reduce((a, s) => a + (s.n95||0)    * (s.priceUsed?.n95    ?? DB.config?.prices?.n95    ?? 0), 0);

    const totalNetwork  = shiftsAfter.reduce((a, s) => a + (s.network  || 0), 0);
    const totalInvoices = shiftsAfter.reduce((a, s) => a + (s.invoices || 0), 0);
    const totalSupplied = shiftsAfter.reduce((a, s) => a + (s.supplied || 0), 0);
    const expectedCashRaw = totalRevenue - totalNetwork - totalInvoices;
    const expectedCash  = Math.max(0, expectedCashRaw);

    const supplyAfter = lastAudit
      ? DB.supply.filter(s => (s.id || 0) > (lastAudit.id || 0))
      : [...DB.supply];

    const totalSupplyLiters = {
      diesel: supplyAfter.filter(s => s.type === 'diesel').reduce((a, s) => a + (s.qty || 0), 0),
      n91:    supplyAfter.filter(s => s.type === '91').reduce((a, s) => a + (s.qty || 0), 0),
      n95:    supplyAfter.filter(s => s.type === '95').reduce((a, s) => a + (s.qty || 0), 0),
    };

    const currentPrices = DB.config?.prices || {};
    const pumpDetails = (DB.config?.pumps || []).map(pump => {
      const lastAuditRead = lastAudit
        ? (lastAudit.pumps?.find(p => p.pumpId === pump.id)?.reading ?? null)
        : null;
      const currentRead = this.getLastReading(pump.id);
      const baseRead    = lastAuditRead !== null ? lastAuditRead : 0;
      const consumption = Math.max(0, currentRead - baseRead);
      const fuelKey     = AE_normFuelType(pump.type);
      const price       = currentPrices[fuelKey] || 0;
      return { pump, consumption, revenue: consumption * price, fuelKey, currentRead, baseRead };
    });

    return {
      lastAudit, shiftsAfterAudit: shiftsAfter,
      diesel, n91, n95,
      dieselRev, n91Rev, n95Rev, totalRevenue,
      totalNetwork, totalInvoices, totalSupplied, expectedCash,
      expectedCashNegative: expectedCashRaw < 0,
      totalSupplyLiters, pumpDetails
    };
  },

  getAvgConsumption(days = 10) {
    const shiftsPerDay = AE_shiftsPerDay();
    const sorted = AE_sortEvents(DB.shifts.filter(s => s.type !== 'audit')).reverse();
    const target = sorted.slice(0, days * shiftsPerDay);
    if (target.length === 0) return { diesel: 0, n91: 0, n95: 0 };
    const actualDays = Math.max(1, Math.ceil(target.length / shiftsPerDay));
    return {
      diesel: target.reduce((a, s) => a + (s.diesel || 0), 0) / actualDays,
      n91:    target.reduce((a, s) => a + (s.n91    || 0), 0) / actualDays,
      n95:    target.reduce((a, s) => a + (s.n95    || 0), 0) / actualDays,
    };
  },

  /**
   * getReportTotals — المصدر الموحّد الوحيد لأرقام أي تقرير (لوحة تحكم،
   * صفحة تقارير، تصدير CSV/PDF). كل الإيرادات تُجمَع من totalMoney الجاهز
   * لكل وردية (محسوب بسعر وقتها) — لا يُعاد ضرب اللترات في السعر الحالي.
   * @param {string} fromDate, {string} toDate - YYYY-MM-DD شاملتين
   */
  getReportTotals(fromDate, toDate) {
    const filtered = DB.shifts.filter(s => s.type !== 'audit' && s.date >= fromDate && s.date <= toDate);
    const auditsInPeriod = DB.shifts.filter(s => s.type === 'audit' && s.date >= fromDate && s.date <= toDate);

    const totals = { diesel: 0, n91: 0, n95: 0, money: 0, network: 0, invoices: 0, supplied: 0 };
    filtered.forEach(s => {
      totals.diesel   += s.diesel     || 0;
      totals.n91      += s.n91        || 0;
      totals.n95      += s.n95        || 0;
      totals.money    += s.totalMoney || 0;
      totals.network  += s.network    || 0;
      totals.invoices += s.invoices   || 0;
      totals.supplied += s.supplied   || 0;
    });

    const revenueByFuel = { diesel: 0, n91: 0, n95: 0 };
    filtered.forEach(s => {
      const price = s.priceUsed || DB.config?.prices || {};
      revenueByFuel.diesel += (s.diesel || 0) * (price.diesel || 0);
      revenueByFuel.n91    += (s.n91    || 0) * (price.n91    || 0);
      revenueByFuel.n95    += (s.n95    || 0) * (price.n95    || 0);
    });

    const shiftsPerDay = AE_shiftsPerDay();
    const actualWorkDays = Math.max(1, Math.ceil(filtered.length / shiftsPerDay));

    return {
      fromDate, toDate,
      totals, revenueByFuel,
      shiftsCount: filtered.length,
      auditsCount: auditsInPeriod.length,
      actualWorkDays,
      avgD:  totals.diesel / actualWorkDays,
      avg91: totals.n91    / actualWorkDays,
      avg95: totals.n95    / actualWorkDays,
      filtered, auditsInPeriod,
    };
  },

  // مرجع للدوال المساعدة (مكشوفة للاختبار)
  _normFuelType: AE_normFuelType,
  _sortEvents:   AE_sortEvents,
  _priceAt:      AE_priceAt,
};

// ── تصدير الدوال المساعدة عالمياً للتوافق مع الكود الحالي ──────────
window.AE_normFuelType   = AE_normFuelType;
window.AE_sortEvents     = AE_sortEvents;
window.AE_rebuildInventory = AE_rebuildInventory;
window.AE_rebuildMeterConsumptions = AE_rebuildMeterConsumptions;

console.log('✅ [AE v3] محرك الحسابات الموحد محمّل وجاهز (سجل أسعار تاريخي + نافذة يوم موحّدة)');
