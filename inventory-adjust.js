function _updateInventorySummaryCard() {
  if (!DB.config) return;
  const stock = DB.config.currentStock || {};
  const avg   = getAvgConsumption(10);
  const types = [
    { key: 'diesel', label: '⬛ ديزل', color: '#7D5C00' },
    { key: 'n91',    label: '🟢 91',   color: '#145A32' },
    { key: 'n95',    label: '🔴 95',   color: '#922B21' }
  ];
  types.forEach(t => {
    const val    = Math.max(0, stock[t.key] || 0);
    const avgVal = avg[t.key] || 0;
    const days   = avgVal > 0 ? (val / avgVal) : null;
    const valEl  = document.getElementById(`invSum_${t.key}`);
    const avgEl  = document.getElementById(`invAvg_${t.key}`);
    const daysEl = document.getElementById(`invDays_${t.key}`);
    if (valEl)  valEl.textContent  = fmt(val) + ' لتر';
    if (avgEl)  avgEl.textContent  = avgVal > 0 ? `متوسط ${fmt(avgVal)} ل/يوم` : 'لا بيانات كافية';
    if (daysEl) daysEl.textContent = days !== null
      ? (days < 1 ? '⚠️ أقل من يوم!' : `⏱ ${days.toFixed(1)} يوم`)
      : '⏱ —';
    if (daysEl && days !== null && days < 2) daysEl.style.color = '#C0392B';
  });
}

function toggleAdjustStock() {
  const panel = document.getElementById('adjustStockPanel');
  panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
}

function applyAdjustment() {
  const fuelType  = document.getElementById('adj_fuelType').value;
  const operation = document.getElementById('adj_operation').value;
  const qty       = parseFloat(document.getElementById('adj_qty').value) || 0;

  if (!fuelType)   { alert('⚠️ يرجى اختيار نوع الوقود'); return; }
  if (!operation)  { alert('⚠️ يرجى اختيار العملية (إضافة أو خصم)'); return; }
  if (qty <= 0)    { alert('⚠️ يرجى إدخال كمية صحيحة أكبر من صفر'); return; }

  const amount = operation === 'add' ? qty : -qty;
  const stockBefore = { ...DB.config.currentStock };

  let d = 0, n91 = 0, n95 = 0;
  if (fuelType === 'diesel') d   = amount;
  else if (fuelType === 'n91') n91 = amount;
  else if (fuelType === 'n95') n95 = amount;

  // [FIX v10] منع المخزون السالب عند الخصم
  const newDiesel = (DB.config.currentStock.diesel || 0) + d;
  const newN91    = (DB.config.currentStock.n91    || 0) + n91;
  const newN95    = (DB.config.currentStock.n95    || 0) + n95;
  if (newDiesel < 0 || newN91 < 0 || newN95 < 0) {
    const fuelLabel = fuelType === 'diesel' ? 'ديزل' : fuelType === 'n91' ? '91' : '95';
    alert(`⚠️ لا يمكن خصم ${qty.toLocaleString()} لتر من ${fuelLabel}\nالمخزون الحالي أقل من الكمية المطلوبة`);
    return;
  }

  DB.config.currentStock.diesel = newDiesel;
  DB.config.currentStock.n91    = newN91;
  DB.config.currentStock.n95    = newN95;

  const today = new Date().toISOString().split('T')[0];
  DB.inventory.push({
    date: today, shiftType: '',
    diesel: DB.config.currentStock.diesel,
    n91:    DB.config.currentStock.n91,
    n95:    DB.config.currentStock.n95,
    consD: 0, cons91: 0, cons95: 0,
    dayD:  0, day91:  0, day95:  0,
    adjD: d, adj91: n91, adj95: n95,
    type: 'adjust'
  });

  saveDB();
  renderInventoryTable();
  updateHomePage();
  document.getElementById('adjustStockPanel').style.display = 'none';
  document.getElementById('adj_fuelType').value   = '';
  document.getElementById('adj_operation').value  = '';
  document.getElementById('adj_qty').value        = '';

  const fuelLabel = fuelType === 'diesel' ? 'ديزل' : fuelType === 'n91' ? '91' : '95';
  const opLabel   = operation === 'add'   ? 'إضافة' : 'خصم';
  logActivity('stock_adjust',
    `معادلة مخزون: ${opLabel} ${qty.toLocaleString()} لتر من ${fuelLabel}`,
    { before: stockBefore, after: { ...DB.config.currentStock } }
  );
  _showToast(`تم تطبيق معادلة المخزون: ${opLabel} ${qty.toLocaleString()} لتر من ${fuelLabel}`, 'success');
}

// ===========================
// INSTANT PAGE
// ===========================
function renderInstantPumps() {
  const pumps = DB.config.pumps;
  const types = ['diesel','n91','n95'];
  const labels = {diesel:'ديزل', n91:'بنزين 91', n95:'بنزين 95'};
  const colors = {diesel:'#D4AC0D', n91:'#1E8449', n95:'#C0392B'};
  const bgColors = {diesel:'rgba(212,172,13,0.08)', n91:'rgba(30,132,73,0.07)', n95:'rgba(192,57,43,0.06)'};
  const borderColors = {diesel:'#F9E87A', n91:'#52BE80', n95:'#E74C3C'};
  const icons = {diesel:'⛽', n91:'🟢', n95:'🔴'};

  let html = '';
  types.forEach(type => {
    const typePumps = pumps.filter(p => normType(p.type) === type);
    if (typePumps.length === 0) return;

    html += `<div class="card" style="margin-bottom:12px">
      <div class="card-header" style="background:linear-gradient(90deg,${bgColors[type]},transparent)">
        <span class="card-title" style="color:${colors[type]};font-size:15px">${icons[type]} ${labels[type]}</span>
      </div>
      <div class="card-body" style="padding:10px 14px">
        <div style="display:flex;flex-direction:column;gap:8px;">`;

    typePumps.forEach(p => {
      html += `<div style="display:flex;align-items:center;gap:10px;background:var(--gray-100);border-radius:8px;padding:8px 12px;border-right:3px solid ${borderColors[type]}">
        <div style="min-width:90px;font-size:13px;font-weight:800;color:var(--text-primary)">${p.name}</div>
        <div style="flex:1">
          <input type="number" class="form-input" id="inst_pump_${p.id}" placeholder="القراءة الحالية"
            oninput="showInstCons(${p.id})"
            style="font-size:15px;font-weight:700;text-align:center;padding:8px 6px;border:2px solid var(--gray-300)">
        </div>
        <div class="consumption-display" id="inst_cons_${p.id}" style="min-width:80px;font-size:12px;min-height:18px;text-align:center"></div>
      </div>`;
    });
    html += '</div></div></div>';
  });

  if (!html) html = '<div class="alert alert-info">لا توجد طلمبات مضافة.</div>';
  document.getElementById('instantPumpsContainer').innerHTML = html;
}

function showInstCons(pumpId) {
  // ✅ استخدام الدالة الموحدة — جلب أحدث قراءة مسجلة (الأعلى في القائمة)
  const prev = getLastSavedReading(pumpId);
  const val = parseFloat(document.getElementById(`inst_pump_${pumpId}`).value) || 0;
  const el = document.getElementById(`inst_cons_${pumpId}`);
  
  if (val > 0) {
    const cons = val - prev;
    if (cons < 0) {
      el.textContent = '⚠️ أقل من السابق';
      el.style.color = 'var(--red)';
    } else {
      el.textContent = `↓ ${fmt(cons)} لتر`;
      el.style.color = 'var(--red)';
    }
  } else {
    el.textContent = '';
  }
}

function calcInstant() {
  const pumps = DB.config.pumps;
  let totals = { diesel: 0, n91: 0, n95: 0 };
  let enteredTypes = new Set();

  // ✅ استخدام الدالة الموحدة لكل مضخة
  pumps.forEach(p => {
    const val = parseFloat(document.getElementById(`inst_pump_${p.id}`)?.value) || 0;
    if (val > 0) {
      // ✅ جلب أحدث قراءة مسجلة (بنفس منطق الورديات)
      const prev = getLastSavedReading(p.id);
      const key = normType(p.type);
      totals[key] += val - prev;
      enteredTypes.add(key);
    }
  });
  window._instTotals = totals;
  window._instEnteredTypes = enteredTypes;

  // Build results only for entered types
  const typeLabels = {diesel:'ديزل', n91:'بنزين 91', n95:'بنزين 95'};
  const boxClass = {diesel:'diesel', n91:'n91', n95:'n95'};
  let resultBoxes = '';
  if (enteredTypes.size === 0) {
    resultBoxes = '<div class="alert alert-warning">أدخل قراءة عداد واحد على الأقل</div>';
  } else {
    enteredTypes.forEach(t => {
      resultBoxes += `<div class="stat-box ${boxClass[t]}"><div class="stat-label">${typeLabels[t]}</div><div class="stat-value" id="inst_${t==='diesel'?'diesel':t==='n91'?'91':'95'}">${fmt(totals[t])}</div><div class="stat-sub">لتر</div></div>`;
    });
  }

  // Update static ids too for compatibility
  document.getElementById('inst_diesel').textContent = fmt(totals.diesel);
  document.getElementById('inst_91').textContent = fmt(totals.n91);
  document.getElementById('inst_95').textContent = fmt(totals.n95);

  document.getElementById('instantResults').style.display = 'block';
  document.getElementById('instantReserveResults').innerHTML = '';
  document.getElementById('instantConsumptionBoxes').innerHTML = resultBoxes;
}

function calcInstantReserve() {
  calcInstant();
  const stock = DB.config.currentStock;
  const totals = window._instTotals || { diesel: 0, n91: 0, n95: 0 };
  const enteredTypes = window._instEnteredTypes || new Set();

  if (enteredTypes.size === 0) {
    document.getElementById('instantReserveResults').innerHTML = '<div class="alert alert-warning">⚠️ أدخل قراءات العدادات أولاً</div>';
    return;
  }

  // Only calculate reserve for entered fuel types
  const res = {};
  enteredTypes.forEach(t => {
    res[t] = stock[t] - totals[t];
  });
  window._instReserve = res;
  window._instEnteredTypes = enteredTypes;

  const typeLabels = {diesel:'ديزل', n91:'بنزين 91', n95:'بنزين 95'};
  const boxClass = {diesel:'diesel', n91:'n91', n95:'n95'};

  let resBoxes = '';
  enteredTypes.forEach(t => {
    const val = res[t];
    const color = val < 0 ? 'color:var(--red)' : '';
    resBoxes += `<div class="stat-box ${boxClass[t]}" style="padding:8px">
      <div class="stat-label">${typeLabels[t]}</div>
      <div class="stat-value" style="font-size:14px;${color}">${fmt(val)}</div>
      <div class="stat-sub">لتر</div>
    </div>`;
  });

  document.getElementById('instantReserveResults').innerHTML = `
    <div class="section-title" style="font-size:13px;margin-top:8px">🛢️ الاحتياطي المتبقي في الخزان</div>
    <div style="display:grid;grid-template-columns:repeat(${enteredTypes.size},1fr);gap:8px">${resBoxes}</div>`;
}

function sendToSupply() {
  showPage('supply', document.querySelector('.nav-btn:nth-child(7)'));

  const reserve = window._instReserve;
  const totals = window._instTotals;
  const enteredTypes = window._instEnteredTypes || new Set();
  const pumps = DB.config.pumps;

  if (!reserve && !totals) return;

  const typeLabels = {diesel:'ديزل', n91:'بنزين 91', n95:'بنزين 95'};
  const boxClass = {diesel:'diesel', n91:'n91', n95:'n95'};

  // Build meter rows only for entered pumps
  let meterRows = '';
  pumps.forEach(p => {
    const val = parseFloat(document.getElementById(`inst_pump_${p.id}`)?.value) || 0;
    if (val > 0) {
      // ✅ استخدام الدالة الموحدة
      const prev = getLastSavedReading(p.id);
      const cons = val - prev;
      const label = p.type === 'diesel' ? 'ديزل' : p.type === '91' || p.type === 'n91' ? '91' : '95';
      meterRows += `<div style="display:flex;justify-content:space-between;padding:5px 8px;background:var(--gray-100);border-radius:6px;margin-bottom:4px;font-size:12.5px">
        <span style="font-weight:700">${p.name} <span style="color:var(--gray-500);font-size:11px">(${label})</span></span>
        <span>قراءة: <strong>${fmt(val)}</strong> | استهلاك: <strong style="color:var(--red)">${fmt(cons)}</strong></span>
      </div>`;
    }
  });

  // Build reserve boxes only for entered types
  let reserveBoxes = '';
  if (reserve) {
    enteredTypes.forEach(t => {
      reserveBoxes += `<div class="stat-box ${boxClass[t]}" style="padding:8px">
        <div class="stat-label" style="font-size:10px">احتياطي ${typeLabels[t]}</div>
        <div class="stat-value" style="font-size:13px">${fmt(reserve[t])}</div>
        <div class="stat-sub">لتر</div>
      </div>`;
    });
  }

  const infoBox = document.getElementById('supplyInstantInfo');
  if (infoBox) {
    infoBox.style.display = 'block';
    infoBox.innerHTML = `
      <div class="section-title" style="font-size:13px;margin-bottom:8px">📊 بيانات اللحظي المرسلة</div>
      ${meterRows ? `<div style="margin-bottom:8px"><div style="font-size:12px;color:var(--gray-500);font-weight:600;margin-bottom:4px">قراءات العدادات:</div>${meterRows}</div>` : ''}
      ${reserveBoxes ? `<div><div style="font-size:12px;color:var(--gray-500);font-weight:600;margin-bottom:4px">الاحتياطي المحسوب:</div>
        <div style="display:grid;grid-template-columns:repeat(${enteredTypes.size},1fr);gap:8px;margin-top:4px">${reserveBoxes}</div></div>` : ''}
    `;
  }

  // Store for saving with supply
  window._supplyInstantData = {
    meters: pumps.map(p => {
      const val = parseFloat(document.getElementById(`inst_pump_${p.id}`)?.value) || 0;
      if (val <= 0) return null;
      return { pumpId: p.id, pumpName: p.name, reading: val, consumption: val - getLastReading(p.id) };
    }).filter(Boolean),
    reserve: reserve || null
  };
}

// ===========================
// SUPPLY PAGE
// ===========================
function saveSupply() {
  const type = document.getElementById('sup_type').value;
  const qty = parseFloat(document.getElementById('sup_qty').value) || 0;
  const date = document.getElementById('sup_date').value;
  const invoice = document.getElementById('sup_invoice').value.trim();
  const driver = document.getElementById('sup_driver').value.trim();

  if (qty <= 0) { alert('⚠️ يرجى إدخال الكمية'); return; }
  if (!date) { alert('⚠️ يرجى اختيار تاريخ التوريد'); return; }
  if (!driver) { alert('⚠️ يرجى إدخال اسم السائق'); return; }

  const entry = {
    id: Date.now(),
    date, type, qty,
    invoice: document.getElementById('sup_invoice').value,
    driver: document.getElementById('sup_driver').value,
    truck: document.getElementById('sup_truck').value,
    carrier: document.getElementById('sup_carrier').value,
    instantMeters: window._supplyInstantData?.meters || [],
    instantReserve: window._supplyInstantData?.reserve || null
  };

  DB.supply.push(entry);

  // Update stock: أضف كمية التوريد على المخزون الحالي لنوع الوقود المُورَّد
  const key = type === 'diesel' ? 'diesel' : type === '91' ? 'n91' : 'n95';
  DB.config.currentStock[key] += qty;

  // البحث عن آخر صف في DB.inventory من أي نوع لاستخراج المخزون الكامل قبل التوريد
  let lastStock = { diesel: 0, n91: 0, n95: 0 };
  if (DB.inventory.length > 0) {
    const lastRow = DB.inventory[DB.inventory.length - 1];
    lastStock.diesel = lastRow.diesel || 0;
    lastStock.n91 = lastRow.n91 || 0;
    lastStock.n95 = lastRow.n95 || 0;
  } else {
    lastStock = { ...DB.config.currentStock };
    lastStock[key] -= qty; // قبل الإضافة
  }

  // إنشاء مخزون جديد كامل بعد التوريد
  const newStock = { ...lastStock };
  newStock[key] += qty;

  // إضافة صف جديد من نوع 'supply' يحتوي المخزون الكامل
  DB.inventory.push({
    date: entry.date, shiftType: '🚛',
    diesel: newStock.diesel,
    n91: newStock.n91,
    n95: newStock.n95,
    consD: 0, cons91: 0, cons95: 0,
    dayD: 0, day91: 0, day95: 0,
    adjD: 0, adj91: 0, adj95: 0,
    type: 'supply', supplyQty: qty, supplyFuel: type
  });

  // تحديث DB.config.currentStock ليتطابق مع آخر صف
  DB.config.currentStock.diesel = newStock.diesel;
  DB.config.currentStock.n91 = newStock.n91;
  DB.config.currentStock.n95 = newStock.n95;

  saveDB();
  renderSupplyLog();
  renderInventoryTable();
  updateHomePage();
  logActivity('supply_add', `أضاف توريد ${type === 'diesel' ? 'ديزل' : type} — ${fmt(qty)} لتر | سائق: ${entry.driver} | فاتورة: ${entry.invoice || '—'}`);

  // Clear form
  ['sup_qty','sup_invoice','sup_driver','sup_truck','sup_carrier'].forEach(id => document.getElementById(id).value = '');
  window._supplyInstantData = null;
  const infoBox = document.getElementById('supplyInstantInfo');
  if (infoBox) infoBox.style.display = 'none';
  _showToast('تم تسجيل التوريد بنجاح!', 'success');
}

function renderSupplyLog() {
  const entries = [...DB.supply].reverse();
  const labels = {diesel:'ديزل', '91':'91', '95':'95'};
  let html = '';
  if (entries.length === 0) {
    html = '<div class="alert alert-info">لا توجد توريدات مسجلة</div>';
  } else {
    entries.forEach(s => {
      // Build instant meters section if available
      let instantSection = '';
      if (s.instantMeters && s.instantMeters.length > 0) {
        const mRows = s.instantMeters.map(m =>
          `<div style="display:flex;justify-content:space-between;font-size:12px;padding:3px 0">
            <span>${m.pumpName}</span>
            <span>قراءة: <strong>${fmt(m.reading)}</strong> | استهلاك: <strong style="color:var(--red)">${fmt(m.consumption)}</strong></span>
          </div>`
        ).join('');
        instantSection += `<div style="margin-top:8px;padding:8px;background:rgba(212,172,13,0.08);border-radius:6px;border:1px solid var(--gold)">
          <div style="font-size:11px;font-weight:700;color:var(--gold-dark);margin-bottom:4px">📊 عدادات اللحظي</div>${mRows}</div>`;
      }
      if (s.instantReserve) {
        const r = s.instantReserve;
        // ✅ FIX #3: إظهار احتياطي النوع المُوَرَّد فقط — إخفاء الأنواع الأخرى (قيمة 0)
        // s.type = 'diesel' | '91' | '95' — نحوّله إلى مفتاح المخزون
        const supplyKey   = s.type === 'diesel' ? 'diesel' : s.type === '91' ? 'n91' : 'n95';
        const supplyLabel = s.type === 'diesel' ? 'ديزل' : s.type;
        const supplyClass = supplyKey === 'diesel' ? 'diesel' : supplyKey === 'n91' ? 'n91' : 'n95';
        const supplyVal   = r[supplyKey] || 0;
        instantSection += `<div style="margin-top:6px">
          <div style="font-size:11px;color:var(--gray-500);font-weight:600;margin-bottom:4px">🛢️ احتياطي ${supplyLabel} بعد التوريد</div>
          <div class="stat-box ${supplyClass}" style="padding:8px;max-width:160px">
            <div class="stat-label" style="font-size:10px">احتياطي ${supplyLabel}</div>
            <div class="stat-value" style="font-size:14px">${fmt(supplyVal)}</div>
            <div class="stat-sub">لتر</div>
          </div>
        </div>`;
      }

      html += `<div class="shift-row" onclick="this.classList.toggle('expanded')">
        <div class="shift-row-header">
          <div><span class="fw-bold">${formatDateShort(s.date)}</span> 
            <span class="badge badge-${s.type==='diesel'?'diesel':s.type==='91'?'91':'95'}" style="margin-right:6px">${labels[s.type]}</span>
          </div>
          <span class="text-gold fw-bold">${fmt(s.qty)} لتر</span>
        </div>
        <div class="shift-row-body">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:12.5px">
            <div>🧾 فاتورة: <strong>${s.invoice || '—'}</strong></div>
            <div>🚚 سائق: <strong>${s.driver || '—'}</strong></div>
            <div>🚛 سيارة: <strong>${s.truck || '—'}</strong></div>
            <div>🏢 ناقل: <strong>${s.carrier || '—'}</strong></div>
          </div>
          ${instantSection}
        </div>
      </div>`;
    });
  }
  document.getElementById('supplyLog').innerHTML = html;
}

// ===========================
// REPORTS PAGE
// ===========================
function toggleReportOptions() {
  const type = document.getElementById('rep_type').value;
  document.getElementById('customReportOptions').style.display = type === 'custom' ? 'block' : 'none';
}

function generateReport() {
  const type = document.getElementById('rep_type').value;
  const cfg = DB.config;
  let fromDate, toDate;
  const today = new Date().toISOString().split('T')[0];

  if (type === 'today') { fromDate = toDate = today; }
  else if (type === 'week') {
    // ✅ [FIX v9] آخر 7 أيام = 6 أيام قبل اليوم + اليوم = 7 أيام فعلية
    const d = new Date(); d.setDate(d.getDate() - 6);
    fromDate = d.toISOString().split('T')[0]; toDate = today;
  } else if (type === 'month') {
    const m = getMonthStartDate();
    fromDate = m; toDate = today;
  } else {
    fromDate = document.getElementById('rep_from').value;
    toDate = document.getElementById('rep_to').value;
  }

  // ✅ [v17] مصدر واحد موحّد لكل أرقام التقرير — بدل إعادة حساب الإيراد هنا
  // بضرب اللترات في السعر الحالي (كان يُخطئ إن تغيّر السعر أثناء الفترة)
  const rep = AccountingEngine.getReportTotals(fromDate, toDate);
  const { totals, revenueByFuel, actualWorkDays, avgD, avg91, avg95, auditsInPeriod } = rep;
  const filtered = rep.filtered;
  if (filtered.length === 0) { document.getElementById('reportOutput').innerHTML = '<div class="alert alert-warning">لا توجد بيانات لهذه الفترة</div>'; return; }

  const supplyInPeriod = DB.supply.filter(s => s.date >= fromDate && s.date <= toDate);
  // ✅ استخدام العدادات والمخزون التاريخي عند نهاية الفترة
  const lastMeters = DB.config.pumps.map(p => ({
    name: p.name,
    reading: getLastReadingBeforeDate(p.id, toDate)
  }));
  const stock = getHistoricalStock(toDate);

  // [v16] تفصيل الاستهلاك والإيراد لكل طلمبة على حدة (وليس فقط إجمالي نوع الوقود)
  // يجمع من جميع سجلات DB.meters ضمن الفترة (ورديات عادية + جردات)، مستبعداً الافتتاحي
  // [v17] الإيراد يُحسَب بسعر الوقود وقت كل عداد (AccountingEngine.getPriceAt) لا بالسعر الحالي
  const pumpBreakdown = (cfg.pumps || []).map(p => {
    let liters = 0, revenue = 0;
    (DB.meters || []).forEach(m => {
      if (m.type === 'opening') return;
      if (m.date < fromDate || m.date > toDate) return;
      const pd = (m.pumps || []).find(x => x.pumpId === p.id);
      if (!pd) return;
      const cons = pd.consumption || 0;
      liters += cons;
      const fuelKey = normType(p.type);
      const priceAtMeter = AccountingEngine.getPriceAt(m.id)?.[fuelKey] || 0;
      revenue += cons * priceAtMeter;
    });
    const fuelKey = normType(p.type);
    const label = fuelKey === 'diesel' ? 'ديزل' : fuelKey === 'n91' ? 'بنزين 91' : 'بنزين 95';
    return { name: p.name, label, liters, revenue };
  });

  const html = `<div class="card" id="reportCard">
    <div class="card-header">
      <span class="card-title">📊 التقرير</span>
      <span class="text-sm text-muted">${formatDateShort(fromDate)} — ${formatDateShort(toDate)}</span>
    </div>
    <div class="card-body">
      <div class="fw-bold mb-8" style="font-size:16px">🏢 ${cfg.stationName}</div>
      <div class="text-muted text-sm mb-8">📍 ${cfg.stationLocation || ''} | الفترة: ${formatDate(fromDate)} إلى ${formatDate(toDate)}</div>
      
      <div class="section-title">⛽ إجمالي الاستهلاك</div>
      <div class="stats-grid mb-8">
        <div class="stat-box diesel"><div class="stat-label">ديزل</div><div class="stat-value">${fmt(totals.diesel)}</div><div class="stat-sub">${fmt(revenueByFuel.diesel,2)} ر.س</div></div>
        <div class="stat-box n91"><div class="stat-label">91</div><div class="stat-value">${fmt(totals.n91)}</div><div class="stat-sub">${fmt(revenueByFuel.n91,2)} ر.س</div></div>
        <div class="stat-box n95"><div class="stat-label">95</div><div class="stat-value">${fmt(totals.n95)}</div><div class="stat-sub">${fmt(revenueByFuel.n95,2)} ر.س</div></div>
      </div>
      
      <div class="totals-section">
        <div class="totals-grid">
          <div class="total-item"><div class="total-label">إجمالي المبلغ</div><div class="total-value">${fmt(totals.money,2)} ر.س</div></div>
          <div class="total-item"><div class="total-label">عدد الورديات</div><div class="total-value">${filtered.length}</div></div>
        </div>
        <div style="font-size:11px;color:var(--gray-500);text-align:center;margin-top:6px">
          📌 إجمالي المُدخلات المستخدمة في هذا التقرير: <strong>${filtered.length + auditsInPeriod.length}</strong>
          (${filtered.length} وردية${auditsInPeriod.length > 0 ? ` + ${auditsInPeriod.length} جرد` : ''})
        </div>
      </div>

      <div class="section-title mt-12">⛽ تفصيل كل طلمبة على حدة</div>
      <div style="border:1px solid var(--gray-300);border-radius:8px;overflow:hidden;margin-bottom:8px">
        <table style="width:100%;border-collapse:collapse;font-size:12px">
          <thead>
            <tr style="background:var(--gray-100)">
              <th style="padding:6px;text-align:right">الطلمبة</th>
              <th style="padding:6px;text-align:center">النوع</th>
              <th style="padding:6px;text-align:center">لتر</th>
              <th style="padding:6px;text-align:center">إيراد (ر.س)</th>
            </tr>
          </thead>
          <tbody>
            ${pumpBreakdown.map(pb => `<tr>
              <td style="padding:6px;border-top:1px solid var(--gray-200)">${pb.name}</td>
              <td style="padding:6px;text-align:center;border-top:1px solid var(--gray-200)">${pb.label}</td>
              <td style="padding:6px;text-align:center;border-top:1px solid var(--gray-200);font-weight:700">${fmt(pb.liters)}</td>
              <td style="padding:6px;text-align:center;border-top:1px solid var(--gray-200)">${fmt(pb.revenue,2)}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>

      <div class="section-title mt-12">💳 تقسيم المبالغ</div>
      <div class="payment-grid">
        <div class="payment-item"><div class="payment-label">شبكة</div><div class="payment-value">${fmt(totals.network,2)}</div></div>
        <div class="payment-item"><div class="payment-label">فواتير</div><div class="payment-value">${fmt(totals.invoices,2)}</div></div>
        <div class="payment-item"><div class="payment-label">تم توريده</div><div class="payment-value">${fmt(totals.supplied,2)}</div></div>
      </div>

      <div class="section-title mt-12">📈 متوسط الاستهلاك اليومي</div>
      <div style="font-size:11px;color:var(--gray-500);margin-bottom:6px">📌 محسوب على أساس ${actualWorkDays} يوم عمل فعلي (${filtered.length} وردية)</div>
      <div class="stats-grid">
        <div class="stat-box diesel" style="padding:8px"><div class="stat-label">ديزل/يوم</div><div class="stat-value" style="font-size:14px">${fmt(avgD,0)}</div></div>
        <div class="stat-box n91" style="padding:8px"><div class="stat-label">91/يوم</div><div class="stat-value" style="font-size:14px">${fmt(avg91,0)}</div></div>
        <div class="stat-box n95" style="padding:8px"><div class="stat-label">95/يوم</div><div class="stat-value" style="font-size:14px">${fmt(avg95,0)}</div></div>
      </div>

      <div class="section-title mt-12">🛢️ المخزون المتبقي</div>
      <div class="stats-grid">
        <div class="stat-box diesel" style="padding:8px"><div class="stat-label">ديزل</div><div class="stat-value" style="font-size:14px">${fmt(stock.diesel)}</div></div>
        <div class="stat-box n91" style="padding:8px"><div class="stat-label">91</div><div class="stat-value" style="font-size:14px">${fmt(stock.n91)}</div></div>
        <div class="stat-box n95" style="padding:8px"><div class="stat-label">95</div><div class="stat-value" style="font-size:14px">${fmt(stock.n95)}</div></div>
      </div>

      <div class="section-title mt-12">🔢 آخر قراءات العدادات</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:8px;">
        ${lastMeters.map(m => `<div class="payment-item" style="padding:8px"><div class="payment-label">${m.name}</div><div class="payment-value" style="font-size:13px">${fmt(m.reading)}</div></div>`).join('')}
      </div>

      ${supplyInPeriod.length > 0 ? `
      <div class="section-title mt-12">🚛 التوريدات (${supplyInPeriod.length} صهريج)</div>
      ${supplyInPeriod.map(s => `<div style="background:var(--gray-100);border-radius:6px;padding:8px;margin-bottom:6px;font-size:12px">
        <span class="badge badge-${s.type==='diesel'?'diesel':s.type==='91'?'91':'95'}">${s.type==='diesel'?'ديزل':s.type}</span>
        <strong style="margin-right:6px">${fmt(s.qty)} لتر</strong> — ${formatDateShort(s.date)}
        ${s.invoice ? `| فاتورة: ${s.invoice}` : ''}
      </div>`).join('')}` : ''}
    </div>
  </div>`;

  document.getElementById('reportOutput').innerHTML = html;
}

function getMonthStartDate() {
  const now = new Date();
  const day = now.getDate();
  const ms = DB.config.monthStart || 1;
  if (day >= ms) return new Date(now.getFullYear(), now.getMonth(), ms).toISOString().split('T')[0];
  return new Date(now.getFullYear(), now.getMonth() - 1, ms).toISOString().split('T')[0];
}

function printReport() {
  generateReport();
  setTimeout(() => window.print(), 300);
}

// ===========================
// SETTINGS PAGE
// ===========================
function renderSettingsPage() {
  if (!DB.config) return;
  document.getElementById('cfg_stationName').value = DB.config.stationName || '';
  document.getElementById('cfg_stationLocation').value = DB.config.stationLocation || '';
  document.getElementById('cfg_monthStart').value = DB.config.monthStart || 1;
  document.getElementById('cfg_minStock').value = DB.config.minStock || 5000;
  document.getElementById('cfg_dieselPrice').value = DB.config.prices.diesel;
  document.getElementById('cfg_91Price').value = DB.config.prices.n91;
  document.getElementById('cfg_95Price').value = DB.config.prices.n95;
  renderUsersList();
}

function savePrices() {
  if (currentUser?.role !== 'owner') { alert('⛔ هذه الصلاحية للمالك فقط'); return; }
  DB.config.prices.diesel = parseFloat(document.getElementById('cfg_dieselPrice').value) || DB.config.prices.diesel;
  DB.config.prices.n91 = parseFloat(document.getElementById('cfg_91Price').value) || DB.config.prices.n91;
  DB.config.prices.n95 = parseFloat(document.getElementById('cfg_95Price').value) || DB.config.prices.n95;
  // [v17] سجّل نقطة تغيير السعر — من الآن فصاعداً، الورديات السابقة تحتفظ
  // بالإيراد الذي حقّقته فعلاً بسعرها وقتها، ولا تتغيّر أرقام التقارير
  // القديمة تلقائياً عند رفع/خفض السعر لاحقاً.
  if (window.AccountingEngine) AccountingEngine.recordPriceChange(DB.config.prices);
  saveDB();
  _showToast('تم حفظ الأسعار بنجاح', 'success');
}

function saveStationInfo() {
  if (currentUser?.role !== 'owner') { alert('⛔ هذه الصلاحية للمالك فقط'); return; }
  DB.config.stationName = document.getElementById('cfg_stationName').value;
  DB.config.stationLocation = document.getElementById('cfg_stationLocation').value;
  DB.config.monthStart = parseInt(document.getElementById('cfg_monthStart').value) || 1;
  DB.config.minStock = parseInt(document.getElementById('cfg_minStock').value) || 5000;
  saveDB();
  document.getElementById('headerStationName').textContent = DB.config.stationName;
  document.getElementById('stationNameLogin').textContent = DB.config.stationName;
  _showToast('تم حفظ معلومات المحطة', 'success');
}

async function addUser() {
  const email = document.getElementById('newUserEmail').value.trim().toLowerCase();
  const pass  = document.getElementById('newUserPass').value;
  const name  = document.getElementById('newUserName').value.trim();
  const role  = document.getElementById('newUserRole').value;
  if (currentUser?.role !== 'owner') { alert('⛔ هذه الصلاحية للمالك فقط'); return; }
  if (!email || !pass || !name) { alert('يرجى ملء جميع الحقول'); return; }
  if (_findUserByEmail(email)) { alert('البريد مسجل بالفعل'); return; }
  if (pass.length < 6) { alert('كلمة المرور يجب أن تكون 6 أحرف على الأقل'); return; }
  // لا يمكن إضافة مالك آخر — لكن يمكن إضافة مدير/مشرف/كاشير/موظف
  if (role === 'owner') { alert('⛔ لا يمكن إضافة مالك آخر'); return; }
  const allowedRoles = ['employee', 'cashier', 'supervisor', 'manager'];
  if (!allowedRoles.includes(role)) { alert('⛔ دور غير صالح'); return; }

  const btn = document.querySelector('#page-settings .btn-primary');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ جارٍ الإضافة...'; }

  // ─── وضع محلي: احفظ بمفتاح محلي ────────────────────────────
  if (_localAuthMode) {
    const hashedPass = await _hashPass(pass);
    localStorage.setItem('_pwd_' + email, hashedPass);
    const localKey = 'local_' + email.replace(/[^a-zA-Z0-9]/g, '_');
    _addUserToDB(localKey, { email, name, role });
    saveDB();
    renderUsersList();
    logActivity('user_add', `أضاف مستخدم: ${name} (${role==='manager'?'مدير':role==='supervisor'?'مشرف':role==='cashier'?'كاشير':'موظف'}) — ${email}`);
    document.getElementById('newUserEmail').value = '';
    document.getElementById('newUserPass').value = '';
    document.getElementById('newUserName').value = '';
    if (btn) { btn.disabled = false; btn.textContent = '+ إضافة مستخدم'; }
    _showToast('تم إضافة المستخدم بنجاح', 'success');
    return;
  }

  // ─── وضع Firebase: استخدم Secondary App لتجنب تسجيل خروج المالك ─
  try {
    // نستخدم REST API مباشرة لإنشاء المستخدم بدون التأثير على الجلسة الحالية
    const apiKey = firebase.app().options.apiKey;
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: pass, returnSecureToken: true })
      }
    );
    const data = await res.json();
    if (data.error) {
      if (data.error.message !== 'EMAIL_EXISTS') {
        if (btn) { btn.disabled = false; btn.textContent = '+ إضافة مستخدم'; }
        alert('⚠️ خطأ Firebase: ' + data.error.message);
        return;
      }
      // البريد موجود — أضف بمفتاح مؤقت، يُحدَّث عند أول دخول للمستخدم
      const tempKey = 'pending_' + email.replace(/[^a-zA-Z0-9]/g, '_');
      _addUserToDB(tempKey, { email, name, role });
    } else {
      // استخدم الـ localId (uid الحقيقي) المُعاد من Firebase
      _addUserToDB(data.localId, { email, name, role });
    }
  } catch(err) {
    // إذا فشل الاتصال بـ Firebase — تحول للوضع المحلي تلقائياً
    console.warn('Firebase غير متاح — تحول للوضع المحلي:', err.message);
    _localAuthMode = true;
    localStorage.setItem('_localAuthMode', '1');
    const hashedPassFallback = await _hashPass(pass);
    localStorage.setItem('_pwd_' + email, hashedPassFallback);
    const localKey = 'local_' + email.replace(/[^a-zA-Z0-9]/g, '_');
    _addUserToDB(localKey, { email, name, role });
  }

  saveDB();
  renderUsersList();
  logActivity('user_add', `أضاف مستخدم: ${name} (${role==='manager'?'مدير':role==='supervisor'?'مشرف':role==='cashier'?'كاشير':'موظف'}) — ${email}`);
  document.getElementById('newUserEmail').value = '';
  document.getElementById('newUserPass').value = '';
  document.getElementById('newUserName').value = '';
  if (btn) { btn.disabled = false; btn.textContent = '+ إضافة مستخدم'; }
  _showToast('تم إضافة المستخدم بنجاح', 'success');
}

function renderUsersList() {
  const html = _usersArray().map(u => `
    <div class="flex-between" style="padding:8px;border-bottom:1px solid var(--gray-200)">
      <div>
        <div class="fw-bold text-sm">${u.name}</div>
        <div class="text-muted" style="font-size:11px">${u.email} | ${
          u.role === 'owner'      ? '👑 مالك' :
          u.role === 'manager'    ? '📋 مدير' :
          u.role === 'supervisor' ? '🔍 مشرف' :
          u.role === 'cashier'    ? '🧾 كاشير' : '👤 موظف'}</div>
      </div>
      ${u.role !== 'owner' ? `<button class="btn btn-ghost btn-sm" onclick="removeUser('${u.uid}')" style="color:var(--red)">🗑️</button>` : ''}
    </div>
  `).join('');
  document.getElementById('usersList').innerHTML = html || '<div class="text-muted text-sm">لا يوجد مستخدمون</div>';
}

function removeUser(uid) {
  // ✅ [FIX v9] أمان: التحقق من الصلاحيات
  if (currentUser?.role !== 'owner') { _showToast('⛔ هذه الصلاحية للمالك فقط', 'error'); return; }
  const u = _findUserByUid(uid);
  if (!u) return;
  if (u.role === 'owner') { _showToast('⛔ لا يمكن حذف حساب المالك', 'error'); return; }
  if (u.uid === currentUser?.uid) { _showToast('⛔ لا يمكنك حذف حسابك الخاص', 'error'); return; }
  _showConfirmDialog(
    '🗑️ حذف مستخدم',
    `هل تريد حذف المستخدم <strong>${u.name || ''}</strong>؟`,
    () => {
      logActivity('user_remove', `حذف مستخدم: ${u.name || u.email}`);
      _removeUserFromDB(uid);
      saveDB();
      renderUsersList();
      _showToast('تم حذف المستخدم', 'info');
    },
    true
  );
}

// ── إعادة تعيين عدادات اليوم (المالك فقط) ───────────────────────
async function resetDailyCounters() {
  if (currentUser?.role !== 'owner') { alert('⛔ هذه الصلاحية للمالك فقط'); return; }
  _showConfirmDialog(
    '🔄 تصفير عدادات اليوم',
    'سيتم تصفير عدادات الديزل / 91 / 95 اليومية إلى صفر.<br>هذا لا يؤثر على الورديات أو المخزون.',
    async () => {
      if (window.CountersAPI && typeof window.CountersAPI.resetCountersForNewDay === 'function') {
        const ok = await window.CountersAPI.resetCountersForNewDay();
        if (ok) {
          _showToast('✅ تم تصفير عدادات اليوم بنجاح', 'success');
          logActivity('settings', 'تصفير عدادات اليوم يدوياً');
        } else {
          _showToast('⚠️ تعذّر التصفير — تحقق من الاتصال', 'error');
        }
      } else {
        _showToast('⚠️ معالج العدادات غير محمَّل بعد', 'warning');
      }
    },
    true
  );
}

async function archiveMonth() {
  // ═══════════════════════════════════════════════════════════════
  // [FIX v6 - ATOMIC] أرشفة شهرية ذرية باستخدام Firebase Transaction
  // إما أن تنجح العملية كلها في السيرفر والهاتف معاً أو تفشل كلها
  // بدون خطر فقدان البيانات عند تذبذب الشبكة
  // ═══════════════════════════════════════════════════════════════
  const now = new Date();
  const day = now.getDate();
  const ms = DB.config.monthStart || 1;
  if (day < ms + 1) { alert(`يمكن الأرشفة بعد يوم ${ms + 1} فقط`); return; }

  // ── تحضير البيانات الجديدة محلياً (لا تعديل على DB بعد) ──────
  const archived = {
    date: new Date().toISOString(),
    month: now.toLocaleDateString('ar', { year: 'numeric', month: 'long' }),
    shifts:    [...DB.shifts],
    meters:    [...DB.meters],
    inventory: [...DB.inventory],
    supply:    [...DB.supply]
  };

  const closingStock = {
    diesel: DB.config.currentStock?.diesel || 0,
    n91:    DB.config.currentStock?.n91    || 0,
    n95:    DB.config.currentStock?.n95    || 0,
  };

  const openingMeter = DB.meters.find(m => m.type === 'opening');
  const today = now.toISOString().split('T')[0];
  const openingInventory = {
    date: today, shiftType: 'افتتاح',
    diesel: closingStock.diesel, n91: closingStock.n91, n95: closingStock.n95,
    consD: 0, cons91: 0, cons95: 0,
    dayD: 0, day91: 0, day95: 0,
    adjD: 0, adj91: 0, adj95: 0,
    type: 'opening'
  };

  const archiveLogEntry = {
    id: Date.now(),
    timestamp: new Date().toISOString(),
    user: currentUser?.name || 'غير محدد',
    userEmail: currentUser?.email || '',
    role: currentUser?.role || 'employee',
    action: 'archive',
    icon: '📦',
    details: `تم أرشفة بيانات الشهر السابق — رصيد الإغلاق: ديزل ${fmt(closingStock.diesel)} | 91: ${fmt(closingStock.n91)} | 95: ${fmt(closingStock.n95)}`
  };

  const newArchives = [...DB.archives, archived];
  const newActivityLog = [archiveLogEntry, ...(DB.activityLog || [])].slice(0, 2000);

  // ── الحالة المحلية (بدون Firebase) — تنفيذ مباشر ───────────
  if (_localAuthMode || !DB_REF) {
    DB.archives  = newArchives;
    DB.shifts    = [];
    DB.meters    = openingMeter ? [openingMeter] : [];
    DB.inventory = [openingInventory];
    DB.supply    = [];
    DB.activityLog = newActivityLog;
    saveDB();
    _showToast('✅ تم أرشفة الشهر بنجاح (وضع محلي)', 'success');
    renderLog(); renderInventoryTable();
    return;
  }

  // ── Firebase Transaction: ذرية كاملة ───────────────────────
  _showToast('⏳ جارٍ أرشفة الشهر على السيرفر...', 'info', 8000);

  try {
    await DB_REF.transaction((serverData) => {
      // إذا لم تصل بيانات السيرفر (اتصال منقطع) — أوقف Transaction
      if (serverData === null) return undefined;

      const existingCounters = serverData.counters || null;

      return {
        ...serverData,
        shifts:      [],
        meters:      openingMeter ? [openingMeter] : [],
        inventory:   [openingInventory],
        supply:      [],
        archives:    newArchives,
        activityLog: newActivityLog,
        config:      serverData.config || DB.config,
        users:       serverData.users  || DB.users,
        ...(existingCounters ? { counters: existingCounters } : {})
      };
    });

    // ── نجحت Transaction: حدّث الذاكرة المحلية ────────────────
    DB.archives    = newArchives;
    DB.shifts      = [];
    DB.meters      = openingMeter ? [openingMeter] : [];
    DB.inventory   = [openingInventory];
    DB.supply      = [];
    DB.activityLog = newActivityLog;

    localStorage.setItem('fuelStationDB', JSON.stringify({ ...DB, _savedAt: Date.now() }));
    localStorage.removeItem('fuelStationPendingSync');
    _updateSyncIndicator('saved');
    setTimeout(() => _updateSyncIndicator('online'), 2500);

    _showToast('✅ تم أرشفة الشهر بنجاح — البيانات متزامنة مع السيرفر', 'success');
    renderLog(); renderInventoryTable(); updateHomePage();

  } catch (err) {
    console.error('[Archive Transaction Failed]', err);
    _showToast('❌ فشلت الأرشفة — لم تتغير أي بيانات. تحقق من الاتصال وأعد المحاولة.', 'error', 7000);
  }
}

// ===========================
// NAVIGATION
// ===========================
