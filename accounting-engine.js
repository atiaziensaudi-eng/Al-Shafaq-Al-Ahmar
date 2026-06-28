/**
 * ═══════════════════════════════════════════════════════════════════════
 * ACCOUNTING ENGINE — محرك الحسابات الموحد v1.0
 * ─────────────────────────────────────────────────────────────────────
 * هذا الملف هو المصدر الوحيد للحقيقة (Single Source of Truth) لجميع
 * الحسابات المحاسبية في نظام محطة الوقود.
 *
 * المسؤوليات:
 *   ① ترتيب البيانات زمنياً (التاريخ + الوقت + ترتيب العملية)
 *   ② حساب استهلاك جميع العدادات (المضخات + عدادات الجرد)
 *   ③ حساب المخزون التراكمي بالمعادلة الموحدة
 *   ④ حساب فروقات الجرد (عجز / فائض)
 *   ⑤ إعادة بناء جميع السجلات من الصفر عند أي تعديل
 *   ⑥ تحديث DB.inventory + DB.config.currentStock
 *   ⑦ تحديث DB.meters بالاستهلاكات المُعاد احتسابها
 *
 * القاعدة الذهبية:
 *   لا تحسب أي شاشة أو دالة أي رقم بنفسها — كلها تقرأ من هنا فقط.
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
    // 1. تاريخ
    const dateDiff = (a.date || '').localeCompare(b.date || '');
    if (dateDiff !== 0) return dateDiff;
    // 2. نوع الحدث
    const pa = typePriority[a.type] ?? 5;
    const pb = typePriority[b.type] ?? 5;
    if (pa !== pb) return pa - pb;
    // 3. ID (وقت الإدخال)
    return (a.id || 0) - (b.id || 0);
  });
}

// ══════════════════════════════════════════════════════════════════
// §3 — إعادة بناء العدادات (المضخات + عدادات الجرد)
// ══════════════════════════════════════════════════════════════════

/**
 * AE_rebuildMeterConsumptions — إعادة احتساب استهلاك جميع العدادات من الصفر
 *
 * يُعيد بناء حقل `consumption` لكل عداد في كل صف من DB.meters
 * بناءً على القراءة السابقة مرتبة زمنياً.
 *
 * يعامل عدادات الجرد (type='audit') كعدادات حقيقية تماماً.
 *
 * @returns {Object} خريطة استهلاك لكل مضخة: { pumpId → [{ meterId, consumption }] }
 */
function AE_rebuildMeterConsumptions() {
  if (!window.DB) return {};

  // رتّب جميع سجلات العدادات زمنياً تصاعدياً (الأقدم أولاً)
  const allMeters = AE_sortEvents(DB.meters);

  // لكل مضخة: آخر قراءة معروفة (تبدأ من الافتتاحي)
  const lastReading = {}; // pumpId → آخر قراءة

  // تهيئة من القراءات الافتتاحية
  const openingMeter = allMeters.find(m => m.type === 'opening');
  if (openingMeter && openingMeter.pumps) {
    openingMeter.pumps.forEach(pd => {
      lastReading[pd.pumpId] = pd.reading || 0;
    });
  }
  // احتياط من DB.config.pumps
  (DB.config?.pumps || []).forEach(p => {
    if (lastReading[p.id] === undefined) {
      lastReading[p.id] = p.opening || 0;
    }
  });

  // معالجة كل سجل عدادات بالترتيب الزمني
  allMeters.forEach(meter => {
    if (meter.type === 'opening') return; // تم تهيئته فوق
    if (!meter.pumps) return;

    meter.pumps.forEach(pd => {
      const prev = lastReading[pd.pumpId] ?? 0;
      // استهلاك = القراءة الحالية - القراءة السابقة (لا يقل عن صفر)
      const cons = Math.max(0, (pd.reading || 0) - prev);
      pd.consumption = cons;
      // تحديث آخر قراءة
      lastReading[pd.pumpId] = pd.reading || prev;
    });
  });

  return lastReading; // يُعيد آخر قراءة لكل مضخة (للاستخدام لاحقاً)
}

// ══════════════════════════════════════════════════════════════════
// §4 — المحرك الرئيسي: إعادة بناء المخزون من الصفر
// ══════════════════════════════════════════════════════════════════

/**
 * AE_rebuildInventory — إعادة بناء جميع سجلات المخزون من الصفر
 *
 * المعادلة لكل فترة زمنية:
 *   مخزون_جديد = مخزون_سابق
 *              + توريدات
 *              - استهلاك_مضخات_عادية
 *              - استهلاك_عدادات_جرد
 *              ± تصحيحات_جرد
 *
 * @returns {Object} { rows: DB.inventory المُحدَّثة, currentStock }
 */
function AE_rebuildInventory() {
  if (!window.DB || !DB.config) return;

  // ── الخطوة 1: إعادة احتساب استهلاك جميع العدادات أولاً ──────────
  AE_rebuildMeterConsumptions();

  // ── الخطوة 2: رصيد البداية (المخزون الافتتاحي) ─────────────────
  const openingInv = DB.inventory.find(r => r.type === 'opening');
  let stock = {
    diesel: openingInv?.diesel ?? DB.config.openingStock?.diesel ?? 0,
    n91:    openingInv?.n91    ?? DB.config.openingStock?.n91    ?? 0,
    n95:    openingInv?.n95    ?? DB.config.openingStock?.n95    ?? 0,
  };

  // ── الخطوة 3: بناء قائمة مرتبة لجميع الأحداث (عدا الافتتاحي) ───
  const nonOpeningRows = DB.inventory.filter(r => r.type !== 'opening');
  const sortedRows = AE_sortEvents(nonOpeningRows);

  // ── الخطوة 4: إعادة بناء المخزون تراكمياً ──────────────────────
  sortedRows.forEach(row => {
    if (row.type === 'shift') {
      // ① احسب استهلاك المضخات من DB.meters
      const meterEntry = DB.meters.find(
        m => m.type === 'meter' &&
             m.date === row.date &&
             m.shiftType === row.shiftType
      );
      if (meterEntry && meterEntry.pumps) {
        let consD = 0, cons91 = 0, cons95 = 0;
        meterEntry.pumps.forEach(pd => {
          const pump = DB.config.pumps.find(p => p.id === pd.pumpId);
          if (!pump) return;
          const fuelKey = AE_normFuelType(pump.type);
          const cons = pd.consumption || 0;
          if (fuelKey === 'diesel') consD  += cons;
          else if (fuelKey === 'n91') cons91 += cons;
          else                        cons95 += cons;
        });
        row.consD  = consD;
        row.cons91 = cons91;
        row.cons95 = cons95;
      }

      // ② اخصم الاستهلاك من المخزون
      stock.diesel = Math.max(0, stock.diesel - (row.consD  || 0));
      stock.n91    = Math.max(0, stock.n91    - (row.cons91 || 0));
      stock.n95    = Math.max(0, stock.n95    - (row.cons95 || 0));

    } else if (row.type === 'supply') {
      // ③ أضف التوريد
      const key = row.supplyFuel === 'diesel' ? 'diesel'
                : row.supplyFuel === '91'     ? 'n91'
                : 'n95';
      stock[key] += (row.supplyQty || 0);

    } else if (row.type === 'adjust') {
      // ④ تصحيح يدوي
      stock.diesel += (row.adjD  || 0);
      stock.n91    += (row.adj91 || 0);
      stock.n95    += (row.adj95 || 0);

    } else if (row.type === 'audit') {
      // ⑤ جرد — احسب استهلاك عداد الجرد واخصمه
      const auditMeter = DB.meters.find(
        m => m.type === 'audit' && m.id === row.auditMeterId
      );
      if (auditMeter && auditMeter.pumps) {
        let auditConsD = 0, auditCons91 = 0, auditCons95 = 0;
        auditMeter.pumps.forEach(pd => {
          const pump = DB.config.pumps.find(p => p.id === pd.pumpId);
          if (!pump) return;
          const fuelKey = AE_normFuelType(pump.type);
          const cons = pd.consumption || 0;
          if (fuelKey === 'diesel') auditConsD  += cons;
          else if (fuelKey === 'n91') auditCons91 += cons;
          else                        auditCons95 += cons;
        });
        row.auditConsD  = auditConsD;
        row.auditCons91 = auditCons91;
        row.auditCons95 = auditCons95;
        stock.diesel = Math.max(0, stock.diesel - auditConsD);
        stock.n91    = Math.max(0, stock.n91    - auditCons91);
        stock.n95    = Math.max(0, stock.n95    - auditCons95);
      }
      // تصحيح الجرد (عجز/فائض)
      stock.diesel += (row.adjD  || 0);
      stock.n91    += (row.adj91 || 0);
      stock.n95    += (row.adj95 || 0);
    }

    // حدّث الرصيد المتراكم في كل صف
    row.diesel = stock.diesel;
    row.n91    = stock.n91;
    row.n95    = stock.n95;
  });

  // ── الخطوة 5: استهلاك اليوم (نافذة X ورديات) ─────────────────
  AE_rebuildDayTotals(sortedRows);

  // ── الخطوة 6: تحديث currentStock ────────────────────────────
  DB.config.currentStock = { ...stock };

  // ── الخطوة 7: استبدال DB.inventory بالترتيب الصحيح ──────────
  const newInventory = openingInv
    ? [openingInv, ...sortedRows]
    : [...sortedRows];
  DB.inventory = newInventory;

  return { currentStock: stock };
}

// ══════════════════════════════════════════════════════════════════
// §5 — إعادة بناء استهلاك اليوم (نافذة FIFO)
// ══════════════════════════════════════════════════════════════════

/**
 * AE_rebuildDayTotals — حساب استهلاك اليوم بنافذة آخر X ورديات
 * يُحدِّث dayD / day91 / day95 في صفوف DB.inventory من نوع 'shift'
 */
function AE_rebuildDayTotals(sortedRows) {
  const shiftsPerDay = parseInt(DB.config?.shiftsPerDay || DB.config?.shifts?.length || 2);
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
// §6 — إعادة بناء بيانات الورديات (DB.shifts)
// ══════════════════════════════════════════════════════════════════

/**
 * AE_rebuildShifts — مزامنة DB.shifts مع النتائج المُعاد احتسابها
 * يُحدِّث diesel / n91 / n95 في كل وردية من DB.meters
 */
function AE_rebuildShifts() {
  if (!window.DB) return;

  DB.shifts.forEach(shift => {
    const meterEntry = DB.meters.find(
      m => m.type === 'meter' &&
           m.date === shift.date &&
           m.shiftType === shift.shiftType
    );
    if (!meterEntry || !meterEntry.pumps) return;

    let newDiesel = 0, newN91 = 0, newN95 = 0;
    meterEntry.pumps.forEach(pd => {
      const pump = DB.config.pumps.find(p => p.id === pd.pumpId);
      if (!pump) return;
      const fuelKey = AE_normFuelType(pump.type);
      const cons = pd.consumption || 0;
      if (fuelKey === 'diesel') newDiesel += cons;
      else if (fuelKey === 'n91') newN91 += cons;
      else                        newN95  += cons;
    });

    shift.diesel = newDiesel;
    shift.n91    = newN91;
    shift.n95    = newN95;
    // إعادة احتساب الإجمالي المالي
    const prices = DB.config.prices || {};
    shift.totalMoney = (newDiesel * (prices.diesel || 0))
                     + (newN91    * (prices.n91    || 0))
                     + (newN95    * (prices.n95    || 0));
    shift.cash = Math.max(0, shift.totalMoney - (shift.network || 0) - (shift.invoices || 0) - (shift.supplied || 0));
  });
}

// ══════════════════════════════════════════════════════════════════
// §7 — إعادة بناء سجلات الجرد (DB.meters من نوع audit)
// ══════════════════════════════════════════════════════════════════

/**
 * AE_rebuildAuditRecords — إعادة احتساب جميع سجلات الجرد
 * يُعيد احتساب:
 *   - استهلاك عداد الجرد لكل مضخة
 *   - الاستهلاك الكلي للفترة (منذ آخر جرد)
 *   - العجز / الفائض
 */
function AE_rebuildAuditRecords() {
  if (!window.DB) return;

  const prices = DB.config?.prices || {};
  // رتّب الجردات زمنياً تصاعدياً
  const auditMeters = AE_sortEvents(DB.meters.filter(m => m.type === 'audit'));

  auditMeters.forEach((audit, auditIdx) => {
    // الجرد السابق
    const prevAudit = auditIdx > 0 ? auditMeters[auditIdx - 1] : null;

    // الورديات بين هذا الجرد والسابق
    const shiftsInPeriod = DB.shifts.filter(s => {
      const sId = s.id || 0;
      const afterPrev = !prevAudit || sId > (prevAudit.id || 0);
      const beforeThis = sId <= (audit.id || 0);
      return afterPrev && beforeThis;
    });

    const diesel = shiftsInPeriod.reduce((a, s) => a + (s.diesel || 0), 0);
    const n91    = shiftsInPeriod.reduce((a, s) => a + (s.n91    || 0), 0);
    const n95    = shiftsInPeriod.reduce((a, s) => a + (s.n95    || 0), 0);

    const dieselRev = diesel * (prices.diesel || 0);
    const n91Rev    = n91    * (prices.n91    || 0);
    const n95Rev    = n95    * (prices.n95    || 0);
    const expectedRevenue = dieselRev + n91Rev + n95Rev;

    // تحديث بيانات الجرد
    audit.periodDiesel = diesel;
    audit.periodN91    = n91;
    audit.periodN95    = n95;
    audit.expectedRevenue = expectedRevenue;
    audit.auditDiff = (audit.auditTotal || 0) - expectedRevenue;

    // مزامنة مع صف DB.inventory المقابل
    const invRow = DB.inventory.find(
      r => r.type === 'audit' && r.auditMeterId === audit.id
    );
    if (invRow) {
      invRow.periodDiesel = diesel;
      invRow.periodN91    = n91;
      invRow.periodN95    = n95;
      invRow.expectedRevenue = expectedRevenue;
      invRow.auditDiff    = audit.auditDiff;
    }
  });
}

// ══════════════════════════════════════════════════════════════════
// §8 — نقطة الدخول الرئيسية: إعادة البناء الكامل
// ══════════════════════════════════════════════════════════════════

/**
 * AccountingEngine.rebuild — إعادة بناء كاملة لجميع الحسابات
 *
 * يُستدعى عند:
 *   - إضافة / تعديل / حذف أي وردية
 *   - إضافة / تعديل / حذف أي عداد
 *   - إضافة / تعديل / حذف أي توريد
 *   - إضافة / تعديل / حذف أي جرد
 *   - تعديل الإعدادات المؤثرة على الحسابات
 *
 * الترتيب الإلزامي للخطوات:
 *   1. إعادة ترتيب البيانات زمنياً
 *   2. إعادة احتساب استهلاك العدادات
 *   3. إعادة بناء المخزون التراكمي
 *   4. مزامنة بيانات الورديات
 *   5. إعادة احتساب سجلات الجرد
 *
 * @param {Object} options
 *   @param {boolean} [options.silent=false] - عدم عرض أي رسالة
 *   @param {Function} [options.onComplete] - callback بعد الانتهاء
 */
window.AccountingEngine = {

  rebuild(options = {}) {
    try {
      if (!window.DB || !DB.config) {
        console.warn('[AE] البيانات غير محمّلة بعد');
        return;
      }

      console.time('[AE] rebuild');

      // ① إعادة احتساب استهلاك العدادات
      AE_rebuildMeterConsumptions();

      // ② إعادة بناء المخزون من الصفر
      AE_rebuildInventory();

      // ③ مزامنة بيانات الورديات
      AE_rebuildShifts();

      // ④ إعادة احتساب سجلات الجرد
      AE_rebuildAuditRecords();

      console.timeEnd('[AE] rebuild');

      if (!options.silent) {
        console.log('✅ [AE] اكتملت إعادة البناء المحاسبي الكامل');
      }

      if (typeof options.onComplete === 'function') {
        options.onComplete();
      }

    } catch (err) {
      console.error('❌ [AE] خطأ في إعادة البناء:', err);
    }
  },

  // ── واجهات قراءة موحدة (تُستخدم من جميع الشاشات) ──────────────

  /**
   * الحصول على آخر قراءة لمضخة معينة (مرتبة زمنياً)
   */
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

  /**
   * الحصول على القراءة مباشرة قبل وردية معينة
   */
  getPrevReading(pumpId, date, shiftType) {
    // رتّب تنازلياً ثم ابحث عن الصف الذي يسبق هذه الوردية مباشرة
    const sorted = AE_sortEvents(DB.meters.filter(m => m.type !== 'opening')).reverse();
    const thisIdx = sorted.findIndex(
      m => m.date === date && m.shiftType === shiftType && m.type !== 'audit'
    );
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

  /**
   * الحصول على المخزون التاريخي في تاريخ معين
   */
  getHistoricalStock(endDate) {
    const openingRow = DB.inventory.find(r => r.type === 'opening');
    let stock = {
      diesel: openingRow?.diesel ?? DB.config?.openingStock?.diesel ?? 0,
      n91:    openingRow?.n91    ?? DB.config?.openingStock?.n91    ?? 0,
      n95:    openingRow?.n95    ?? DB.config?.openingStock?.n95    ?? 0,
    };
    const rows = AE_sortEvents(
      DB.inventory.filter(r => r.type !== 'opening' && r.date <= endDate)
    );
    rows.forEach(r => {
      if (r.type === 'shift') {
        stock.diesel = Math.max(0, stock.diesel - (r.consD  || 0));
        stock.n91    = Math.max(0, stock.n91    - (r.cons91 || 0));
        stock.n95    = Math.max(0, stock.n95    - (r.cons95 || 0));
      } else if (r.type === 'supply') {
        const k = r.supplyFuel === 'diesel' ? 'diesel'
                : r.supplyFuel === '91'     ? 'n91' : 'n95';
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

  /**
   * حساب الاستهلاك منذ آخر جرد
   */
  calcSinceLastAudit() {
    const prices = DB.config?.prices || {};
    const auditMeters = AE_sortEvents(DB.meters.filter(m => m.type === 'audit'));
    const lastAudit   = auditMeters.length > 0 ? auditMeters[auditMeters.length - 1] : null;

    const shiftsAfter = lastAudit
      ? DB.shifts.filter(s => (s.id || 0) > (lastAudit.id || 0))
      : [...DB.shifts];

    const diesel = shiftsAfter.reduce((a, s) => a + (s.diesel || 0), 0);
    const n91    = shiftsAfter.reduce((a, s) => a + (s.n91    || 0), 0);
    const n95    = shiftsAfter.reduce((a, s) => a + (s.n95    || 0), 0);

    const dieselRev = diesel * (prices.diesel || 0);
    const n91Rev    = n91    * (prices.n91    || 0);
    const n95Rev    = n95    * (prices.n95    || 0);
    const totalRevenue = dieselRev + n91Rev + n95Rev;

    const totalNetwork  = shiftsAfter.reduce((a, s) => a + (s.network  || 0), 0);
    const totalInvoices = shiftsAfter.reduce((a, s) => a + (s.invoices || 0), 0);
    const totalSupplied = shiftsAfter.reduce((a, s) => a + (s.supplied || 0), 0);
    const expectedCash  = Math.max(0, totalRevenue - totalNetwork - totalInvoices);

    const supplyAfter = lastAudit
      ? DB.supply.filter(s => (s.id || 0) > (lastAudit.id || 0))
      : [...DB.supply];

    const totalSupplyLiters = {
      diesel: supplyAfter.filter(s => s.type === 'diesel').reduce((a, s) => a + (s.qty || 0), 0),
      n91:    supplyAfter.filter(s => s.type === '91').reduce((a, s) => a + (s.qty || 0), 0),
      n95:    supplyAfter.filter(s => s.type === '95').reduce((a, s) => a + (s.qty || 0), 0),
    };

    const pumpDetails = (DB.config?.pumps || []).map(pump => {
      const lastAuditRead = lastAudit
        ? (lastAudit.pumps?.find(p => p.pumpId === pump.id)?.reading ?? null)
        : null;
      const currentRead = this.getLastReading(pump.id);
      const baseRead    = lastAuditRead !== null ? lastAuditRead : 0;
      const consumption = Math.max(0, currentRead - baseRead);
      const fuelKey     = AE_normFuelType(pump.type);
      const price       = prices[fuelKey] || 0;
      return { pump, consumption, revenue: consumption * price, fuelKey, currentRead, baseRead };
    });

    return {
      lastAudit, shiftsAfterAudit: shiftsAfter,
      diesel, n91, n95,
      dieselRev, n91Rev, n95Rev, totalRevenue,
      totalNetwork, totalInvoices, totalSupplied, expectedCash,
      totalSupplyLiters, pumpDetails
    };
  },

  /**
   * الحصول على متوسط الاستهلاك لآخر X أيام
   */
  getAvgConsumption(days = 10) {
    const today  = new Date();
    const cutoff = new Date(today);
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffStr = cutoff.toISOString().split('T')[0];
    const recent = DB.shifts.filter(s => s.date >= cutoffStr);
    if (recent.length === 0) return { diesel: 0, n91: 0, n95: 0 };
    const dates  = [...new Set(recent.map(s => s.date))];
    const numDays = dates.length || 1;
    return {
      diesel: recent.reduce((a, s) => a + (s.diesel || 0), 0) / numDays,
      n91:    recent.reduce((a, s) => a + (s.n91    || 0), 0) / numDays,
      n95:    recent.reduce((a, s) => a + (s.n95    || 0), 0) / numDays,
    };
  },

  // مرجع للدوال المساعدة (مكشوفة للاختبار)
  _normFuelType:  AE_normFuelType,
  _sortEvents:    AE_sortEvents,
};

// ── تصدير الدوال المساعدة عالمياً للتوافق مع الكود الحالي ──────────
window.AE_normFuelType   = AE_normFuelType;
window.AE_sortEvents     = AE_sortEvents;
window.AE_rebuildInventory = AE_rebuildInventory;
window.AE_rebuildMeterConsumptions = AE_rebuildMeterConsumptions;

console.log('✅ [AE] محرك الحسابات الموحد محمّل وجاهز');
