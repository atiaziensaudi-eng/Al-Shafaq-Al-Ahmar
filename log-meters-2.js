function showDeleteMeterOptions() {
  if (currentUser?.role !== 'owner') { alert('⛔ هذه الصلاحية للمالك فقط'); return; }
  const nonOpening = DB.meters.filter(m => m.type !== 'opening');
  if (nonOpening.length === 0) { alert('لا توجد بيانات عدادات للحذف'); return; }
  const choice = confirm(
    `اختر نوع الحذف:\n\n` +
    `✅ موافق → حذف آخر صف عداد فقط (${nonOpening.length} صف متاح)\n` +
    `❌ إلغاء → عرض خيار حذف جميع العدادات`
  );
  if (choice) {
    // حذف آخر صف فقط
    const lastNonOpening = [...DB.meters].map((m,i)=>({m,i})).filter(x=>x.m.type!=='opening').pop();
    if (!lastNonOpening) return;
    const lm = lastNonOpening.m;
    const shiftLabel = DB.config.shifts.find(s => s.abbr === lm.shiftType)?.name || lm.shiftType;
    if (!confirm(`حذف آخر صف:\n${formatDate(lm.date)} — ${shiftLabel}؟`)) return;
    DB.meters.splice(lastNonOpening.i, 1);
    saveDB();
    renderMetersTable();
    logActivity('meter_delete', `حذف آخر صف عدادات: ${shiftLabel} — ${lm.date}`);
    alert('✅ تم حذف آخر صف عدادات');
  } else {
    if (!confirm(`⛔ تحذير: سيتم حذف جميع صفوف العدادات (${nonOpening.length} صف)\nهذا الإجراء لا يمكن التراجع عنه!\nهل أنت متأكد تماماً؟`)) return;
    DB.meters = DB.meters.filter(m => m.type === 'opening');
    saveDB();
    renderMetersTable();
    logActivity('meter_delete_all', `حذف جميع سجلات العدادات (${nonOpening.length} صف)`);
    alert('✅ تم حذف جميع سجلات العدادات');
  }
}

// ===========================
// LOG PAGE
// ===========================
function renderLog() {
  // ترتيب صارم بتسلسل الإدخال الفعلي (ID تنازلياً) — يشمل الورديات والجردات
  const shifts = [...DB.shifts].sort((a, b) => (b.id || 0) - (a.id || 0));
  const cfg = DB.config;
  let html = '';
  if (shifts.length === 0) {
    html = '<div class="alert alert-info">لا توجد ورديات مسجلة بعد</div>';
  } else {
    shifts.forEach((s, i) => {
      const isAudit = s.type === 'audit';

      // ══════════════════════════════════════════════════════════
      // [v15.1] عرض الجرد بتنسيق مميز
      // ══════════════════════════════════════════════════════════
      if (isAudit) {
        const diffLabel = !s.auditDiff ? 'مطابق'
          : s.auditDiff > 0 ? `فائض +${fmt(s.auditDiff,2)} ر.س`
          : `عجز ${fmt(s.auditDiff,2)} ر.س`;
        const diffColor = !s.auditDiff ? '#27AE60'
          : s.auditDiff > 0 ? '#27AE60' : '#E74C3C';

        html += `<div class="shift-row" onclick="this.classList.toggle('expanded')"
          style="border:2px solid rgba(47,79,79,0.5);margin-bottom:8px">
          <div class="shift-row-header" style="background:linear-gradient(135deg,#1B2631,#2F4F4F)">
            <div>
              <span class="fw-bold" style="color:#A9D5D5">${formatDate(s.date)}</span>
              <span style="background:rgba(47,79,79,0.8);color:#A9D5D5;border:1px solid #5D6D7E;border-radius:6px;padding:2px 10px;font-size:12px;font-weight:800;margin-right:6px">📑 جرد</span>
              ${s.time ? `<span style="font-size:10px;color:#7FB3B3;margin-right:4px">${s.time}</span>` : ''}
              ${currentUser?.role === 'owner' ? `<button class="btn btn-sm" onclick="event.stopPropagation();deleteAuditFromLog('${s.id}')" style="font-size:10px;padding:3px 6px;background:#FFEBEE;border:1px solid var(--red);color:var(--red);border-radius:6px" title="حذف الجرد">🗑️</button>` : ''}
            </div>
            <div style="text-align:left">
              <div style="font-size:13px;font-weight:800;color:${diffColor}">${diffLabel}</div>
              <div style="font-size:11px;color:#7FB3B3">${fmt(s.totalMoney,0)} ر.س قيمة الاستهلاك</div>
            </div>
          </div>
          <div class="shift-row-body" style="background:#1C2833">
            <!-- استهلاك الأنواع -->
            <div class="stats-grid mb-8" style="gap:6px">
              <div class="stat-box diesel" style="padding:8px;background:rgba(212,172,13,0.08)">
                <div class="stat-label" style="color:#7D6608">ديزل</div>
                <div class="stat-value" style="font-size:14px;color:#D4AC0D">${fmt(s.diesel)} لتر</div>
                <div style="font-size:12px;color:#9A7D0A;margin-top:4px;font-weight:600">💰 ${fmt(s.diesel * (cfg.prices?.diesel||0),2)} ر.س</div>
              </div>
              <div class="stat-box n91" style="padding:8px;background:rgba(39,174,96,0.08)">
                <div class="stat-label" style="color:#1E8449">91</div>
                <div class="stat-value" style="font-size:14px;color:#27AE60">${fmt(s.n91)} لتر</div>
                <div style="font-size:12px;color:#1E8449;margin-top:4px;font-weight:600">💰 ${fmt(s.n91 * (cfg.prices?.n91||0),2)} ر.س</div>
              </div>
              <div class="stat-box n95" style="padding:8px;background:rgba(192,57,43,0.08)">
                <div class="stat-label" style="color:#922B21">95</div>
                <div class="stat-value" style="font-size:14px;color:#E74C3C">${fmt(s.n95)} لتر</div>
                <div style="font-size:12px;color:#922B21;margin-top:4px;font-weight:600">💰 ${fmt(s.n95 * (cfg.prices?.n95||0),2)} ر.س</div>
              </div>
            </div>
            <!-- الأرصدة النقدية -->
            <div class="payment-grid" style="grid-template-columns:repeat(3,1fr);gap:6px">
              <div class="payment-item" style="padding:6px;background:rgba(212,172,13,0.08)">
                <div class="payment-label" style="color:#7FB3B3">💵 نقدية</div>
                <div class="payment-value" style="font-size:13px;color:#A9D5D5">${fmt(s.cash,2)}</div>
              </div>
              <div class="payment-item" style="padding:6px;background:rgba(47,79,79,0.2)">
                <div class="payment-label" style="color:#7FB3B3">🌐 شبكة</div>
                <div class="payment-value" style="font-size:13px;color:#A9D5D5">${fmt(s.network,2)}</div>
              </div>
              <div class="payment-item" style="padding:6px;background:rgba(47,79,79,0.2)">
                <div class="payment-label" style="color:#7FB3B3">📄 فواتير</div>
                <div class="payment-value" style="font-size:13px;color:#A9D5D5">${fmt(s.invoices,2)}</div>
              </div>
            </div>
            <!-- مقارنة المتوقع والفعلي -->
            <div style="margin-top:8px;background:rgba(47,79,79,0.3);border-radius:8px;padding:8px;display:flex;justify-content:space-between;align-items:center">
              <div style="font-size:11px;color:#7FB3B3">المتوقع من الورديات: <strong style="color:#A9D5D5">${fmt(s.expectedRevenue||0,2)} ر.س</strong></div>
              <div style="font-size:13px;font-weight:800;color:${diffColor}">${diffLabel}</div>
            </div>
            <div style="margin-top:6px;font-size:10px;color:#5D6D7E;text-align:center">بواسطة: ${escapeHTML(s.enteredBy||'—')}</div>
          </div>
        </div>`;
        return;
      }

      // ══════════════════════════════════════════════════════════
      // عرض الوردية العادية
      // ══════════════════════════════════════════════════════════
      const shiftName = cfg.shifts.find(x => x.abbr === s.shiftType)?.name || s.shiftType;
      html += `<div class="shift-row" onclick="this.classList.toggle('expanded')">
        <div class="shift-row-header">
          <div>
            <span class="fw-bold">${formatDate(s.date)}</span>
            <span class="tag tag-morning" style="margin-right:6px">${shiftName}</span>
            ${currentUser?.role === 'owner' ? `<button class="btn btn-sm" onclick="event.stopPropagation();editShiftFull('${s.id}')" style="font-size:11px;padding:3px 8px;background:linear-gradient(135deg,#1565C0,#1976D2);color:white;border:none;border-radius:6px" title="تعديل الوردية كاملة">✏️ تعديل</button>` : ''}
            <button class="btn btn-sm" onclick="event.stopPropagation();shareShiftImage(this,'${s.id}',event)" data-shiftid="${s.id}" style="font-size:11px;padding:2px 2px;background:transparent;border:none;cursor:pointer;" title="مشاركة الوردية صورة"><span style="display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;background:#25D366;border-radius:50%;box-shadow:0 1px 4px rgba(37,211,102,0.4)"><svg viewBox='0 0 24 24' width='15' height='15' fill='white'><path d='M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z'/><path d='M12 0C5.373 0 0 5.373 0 12c0 2.115.554 4.1 1.523 5.823L.044 23.419a.5.5 0 0 0 .613.613l5.606-1.474A11.939 11.939 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.818a9.808 9.808 0 0 1-5.02-1.381l-.36-.214-3.327.875.887-3.241-.234-.373A9.787 9.787 0 0 1 2.182 12c0-5.417 4.401-9.818 9.818-9.818S21.818 6.583 21.818 12 17.417 21.818 12 21.818z'/></svg></span></button>
            <button class="btn btn-sm btn-ghost" onclick="event.stopPropagation();printShiftReport('${s.id}')" style="font-size:10px;padding:3px 6px">🖨️</button>
            ${currentUser?.role === 'owner' ? `<button class="btn btn-sm" onclick="event.stopPropagation();deleteShiftFromLog('${s.id}')" style="font-size:10px;padding:3px 6px;background:#FFEBEE;border:1px solid var(--red);color:var(--red);border-radius:6px" title="حذف الوردية">🗑️</button>` : ''}
          </div>
          <span class="text-gold fw-bold">${fmt(s.totalMoney, 2)} ر.س</span>
        </div>
        <div class="shift-row-body">
          <div class="stats-grid mb-8" style="gap:6px">
            <div class="stat-box diesel" style="padding:8px">
              <div class="stat-label">ديزل</div>
              <div class="stat-value" style="font-size:14px">${fmt(s.diesel)} لتر</div>
              <div style="font-size:12px;color:#666;margin-top:4px;font-weight:600">💰 ${fmt(s.diesel * (cfg.prices?.diesel || 0), 2)} ر.س</div>
            </div>
            <div class="stat-box n91" style="padding:8px">
              <div class="stat-label">91</div>
              <div class="stat-value" style="font-size:14px">${fmt(s.n91)} لتر</div>
              <div style="font-size:12px;color:#666;margin-top:4px;font-weight:600">💰 ${fmt(s.n91 * (cfg.prices?.n91 || 0), 2)} ر.س</div>
            </div>
            <div class="stat-box n95" style="padding:8px">
              <div class="stat-label">95</div>
              <div class="stat-value" style="font-size:14px">${fmt(s.n95)} لتر</div>
              <div style="font-size:12px;color:#666;margin-top:4px;font-weight:600">💰 ${fmt(s.n95 * (cfg.prices?.n95 || 0), 2)} ر.س</div>
            </div>
          </div>
          <div class="payment-grid" style="grid-template-columns:repeat(4,1fr);gap:6px">
            <div class="payment-item" style="padding:6px"><div class="payment-label">شبكة</div><div class="payment-value" style="font-size:13px">${fmt(s.network, 2)}</div></div>
            <div class="payment-item" style="padding:6px"><div class="payment-label">فواتير</div><div class="payment-value" style="font-size:13px">${fmt(s.invoices, 2)}</div></div>
            <div class="payment-item" style="padding:6px"><div class="payment-label">توريد</div><div class="payment-value" style="font-size:13px">${fmt(s.supplied, 2)}</div></div>
            <div class="payment-item cash" style="padding:6px"><div class="payment-label">نقدية</div><div class="payment-value" style="font-size:13px">${fmt(s.cash, 2)}</div></div>
          </div>
        </div>
      </div>`;
    });
  }
  document.getElementById('logContainer').innerHTML = html;
}

// ── حذف جرد من السجل ──────────────────────────────────────────
function deleteAuditFromLog(id) {
  if (currentUser?.role !== 'owner') { alert('⛔ هذه الصلاحية للمالك فقط'); return; }
  const audit = DB.shifts.find(s => s.id == id && s.type === 'audit');
  if (!audit) { alert('⚠️ الجرد غير موجود'); return; }
  if (!confirm(`⚠️ تأكيد حذف الجرد:\n${formatDate(audit.date)} ${audit.time||''}\nهذا الإجراء لا يمكن التراجع عنه!`)) return;
  // حذف من shifts
  const si = DB.shifts.findIndex(s => s.id == id && s.type === 'audit');
  if (si !== -1) DB.shifts.splice(si, 1);
  // حذف من meters
  const mi = DB.meters.findIndex(m => m.id == id && m.type === 'audit');
  if (mi !== -1) DB.meters.splice(mi, 1);
  // حذف من inventory
  const ii = DB.inventory.findIndex(r => r.id == id && r.type === 'audit');
  if (ii !== -1) DB.inventory.splice(ii, 1);
  // إعادة حساب المخزون
  recomputeCurrentStock();
  saveDB();
  triggerGlobalRecalculation();
  logActivity('audit_delete', `حذف جرد بتاريخ ${audit.date}`);
  _showToast('✅ تم حذف الجرد', 'success');
}

// ── حذف وردية من السجل ──────────────────────────────────────────
function deleteShiftFromLog(id) {
  if (!_canDo('deleteShift')) { alert('⛔ ليس لديك صلاحية حذف الورديات'); return; }
  const shift = DB.shifts.find(s => s.id == id);
  if (!shift) { alert('⚠️ الوردية غير موجودة'); return; }
  // [v15.1] الجردات لها دالة حذف منفصلة
  if (shift.type === 'audit') { deleteAuditFromLog(id); return; }
  const shiftLabel = DB.config.shifts.find(x => x.abbr === shift.shiftType)?.name || shift.shiftType;
  if (!confirm(`⚠️ تأكيد حذف الوردية:\n${formatDate(shift.date)} — ${shiftLabel}\nالإجمالي: ${fmt(shift.totalMoney, 2)} ر.س\n\nهذا الإجراء لا يمكن التراجع عنه!`)) return;
  const shiftSnapshot = { ...shift }; // نسخة للـ Audit Log
  // Remove shift
  const shiftIdx = DB.shifts.findIndex(s => s.id == id);
  if (shiftIdx !== -1) DB.shifts.splice(shiftIdx, 1);
  // Remove matching meter
  const meterIdx = DB.meters.findIndex(m => m.date === shift.date && m.shiftType === shift.shiftType && m.type !== 'opening');
  if (meterIdx !== -1) DB.meters.splice(meterIdx, 1);
  // Remove matching inventory row
  const invIdx = DB.inventory.findIndex(r => r.date === shift.date && r.shiftType === shift.shiftType && r.type === 'shift');
  if (invIdx !== -1) DB.inventory.splice(invIdx, 1);
  saveDB();
  triggerGlobalRecalculation();
  logActivity('shift_delete',
    `حذف وردية: ${shiftLabel} بتاريخ ${shift.date} — ${fmt(shiftSnapshot.totalMoney,2)} ر.س`,
    { before: shiftSnapshot, after: null }
  );
  _showToast('✅ تم حذف الوردية بنجاح', 'success');
}

// ── لقطة شاشة للوردية ─────────────────────────────────────────
async function captureShiftScreenshot(btn, ev) {
  ev.stopPropagation();
  const shiftRow = btn.closest('.shift-row');
  if (!shiftRow) { alert('⚠️ لم يتم العثور على الوردية'); return; }
  // Expand if not already
  const wasExpanded = shiftRow.classList.contains('expanded');
  if (!wasExpanded) shiftRow.classList.add('expanded');

  // Use html2canvas if available, otherwise fallback to Web Share API
  try {
    if (typeof html2canvas !== 'undefined') {
      const canvas = await html2canvas(shiftRow, { scale: 2, useCORS: true, backgroundColor: '#ffffff' });
      canvas.toBlob(async (blob) => {
        if (!wasExpanded) shiftRow.classList.remove('expanded');
        if (navigator.share && navigator.canShare && navigator.canShare({ files: [new File([blob],'shift.png',{type:'image/png'})] })) {
          await navigator.share({ files: [new File([blob],'shift.png',{type:'image/png'})], title: 'وردية' });
        } else {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a'); a.href = url; a.download = 'shift_' + Date.now() + '.png';
          a.click(); URL.revokeObjectURL(url);
        }
      }, 'image/png');
    } else {
      // Fallback: load html2canvas dynamically
      const script = document.createElement('script');
      script.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
      script.onload = () => captureShiftScreenshot(btn, { stopPropagation: ()=>{} });
      document.head.appendChild(script);
      if (!wasExpanded) shiftRow.classList.remove('expanded');
    }
  } catch(e) {
    if (!wasExpanded) shiftRow.classList.remove('expanded');
    alert('⚠️ لا يمكن التقاط الشاشة: ' + e.message);
  }
}

// ═══════════════════════════════════════════════════════════════
// shareShiftImage — بطاقة مشاركة شاملة (صورة) تشمل:
//   العدادات + الاستهلاك + النقدية + المخزون + آخر 24 ساعة + التنبيهات
// أيقونة: دائرة خضراء بشعار هاتف/واتساب أبيض
// ═══════════════════════════════════════════════════════════════
async function shareShiftImage(btn, shiftId, ev) {
  if (ev) ev.stopPropagation();
  const shift = DB.shifts.find(s => s.id == shiftId);
  if (!shift) { _showToast('⚠️ الوردية غير موجودة', 'warning'); return; }

  const shiftRow     = btn?.closest?.('.shift-row') || null;
  const originalHTML = btn?.innerHTML;
  if (btn) { btn.innerHTML = '⏳'; btn.disabled = true; }

  const wasExpanded = shiftRow?.classList.contains('expanded');
  if (shiftRow && !wasExpanded) shiftRow.classList.add('expanded');

  try {
    const cfg      = DB.config;
    const prices   = cfg.prices || {};
    const minStock = cfg.minStock || 5000;

    // ── 1. الحقول الأساسية للوردية (الربط الصحيح) ───────────────
    const shiftName   = cfg.shifts.find(x => x.abbr === shift.shiftType)?.name || shift.shiftType || '—';
    const dieselL     = shift.diesel     || 0;
    const n91L        = shift.n91        || 0;
    const n95L        = shift.n95        || 0;
    const totalMoney  = shift.totalMoney || 0;
    const netPay      = shift.network    || 0;
    const invoicesPay = shift.invoices   || 0;
    const suppliedPay = shift.supplied   || 0;
    const cashPay     = shift.cash       || 0;
    const enteredBy   = shift.enteredBy  || '';

    const dieselRial = dieselL * (prices.diesel || 0);
    const n91Rial    = n91L    * (prices.n91    || 0);
    const n95Rial    = n95L    * (prices.n95    || 0);

    // ── 2. قراءات العدادات من DB.meters ─────────────────────────
    const meterEntry = (DB.meters || []).find(
      m => m.date === shift.date && m.shiftType === shift.shiftType && m.type !== 'opening'
    );
    let metersHtml = '';
    if (meterEntry && meterEntry.pumps?.length) {
      // ── جدول العدادات: رأس + صفوف متناسقة مركزية ──
      const tableRows = meterEntry.pumps.map((pd, idx) => {
        const pump      = (cfg.pumps || []).find(x => x.id === pd.pumpId);
        const pumpName  = pump?.name || `طلمبة ${pd.pumpId}`;
        // نوع الوقود بالاسم الكامل والألوان الرسمية
        const rawType   = pump?.type || '';
        const typeLabel = rawType === 'diesel' ? 'ديزل'
                        : (rawType === 'n91' || rawType === '91')  ? 'بنزين 91'
                        : (rawType === 'n95' || rawType === '95')  ? 'بنزين 95' : '—';
        // [v12] ألوان باستيل ناعمة (muted) لكل نوع وقود
        const typeColor  = rawType === 'diesel' ? '#6B5818'
                         : (rawType === 'n91' || rawType === '91') ? '#1C5C38'
                         : (rawType === 'n95' || rawType === '95') ? '#7A2020' : '#444';
        const typeBgBanner = rawType === 'diesel' ? '#FEFCE8'
                           : (rawType === 'n91' || rawType === '91') ? '#F0FAF4'
                           : (rawType === 'n95' || rawType === '95') ? '#FEF2F2' : '#F8F8F8';
        const typeBorder   = rawType === 'diesel' ? '#DDD08A'
                           : (rawType === 'n91' || rawType === '91') ? '#A8D5B5'
                           : (rawType === 'n95' || rawType === '95') ? '#DFA8A8' : '#DDD';
        const fuelBadgeColor = rawType === 'diesel' ? '#92781A'
                             : (rawType === 'n91' || rawType === '91') ? '#2D7A4A'
                             : (rawType === 'n95' || rawType === '95') ? '#9B3232' : '#666';
        const rowBg     = idx % 2 === 0 ? '#FFFFFF' : '#FAFAFA';
        const prevReading = typeof getImmediatePreviousReading === 'function'
          ? getImmediatePreviousReading(pd.pumpId, shift.date, shift.shiftType)
          : pd.reading - (pd.consumption || 0);
        const cons = Math.max(0, pd.reading - prevReading);
        // أرقام العدادات: حجم كبير bold واضح، لون محايد داكن
        return `<tr>
          <td style="padding:9px 6px;font-weight:800;color:${typeColor};font-size:12px;text-align:center;border-bottom:1px solid #EDEDED;background:${typeBgBanner};border-right:2.5px solid ${typeBorder};">${escapeHTML(pumpName)}</td>
          <td style="padding:9px 4px;font-size:9.5px;font-weight:800;color:${fuelBadgeColor};text-align:center;border-bottom:1px solid #EDEDED;background:${typeBgBanner};white-space:nowrap;">${typeLabel}</td>
          <td style="padding:9px 6px;font-size:19px;font-weight:900;color:#1A1A1A;text-align:center;border-bottom:1px solid #EDEDED;background:${rowBg};letter-spacing:0.5px;font-family:'Cairo',sans-serif;">${fmt(pd.reading)}</td>
          <td style="padding:9px 6px;font-size:15px;font-weight:800;color:#2D6A3F;text-align:center;border-bottom:1px solid #EDEDED;background:${rowBg};">↓ ${fmt(cons)}</td>
        </tr>`;
      }).join('');
      metersHtml = `<div style="margin-top:10px;border:1.5px solid #D4AC0D;border-radius:10px;overflow:hidden;">
        <div style="padding:9px 14px;background:#FFF8E1;font-size:13px;font-weight:800;color:#7D6608;border-bottom:1.5px solid #D4AC0D;">🔢 قراءات العدادات</div>
        <table style="width:100%;border-collapse:collapse;table-layout:fixed;background:#fff;">
          <thead>
            <tr style="background:#FFFDE7;">
              <th style="padding:7px 4px;font-size:11px;color:#7D6608;font-weight:800;text-align:center;border-bottom:1.5px solid #D4AC0D;width:30%;">الطلمبة</th>
              <th style="padding:7px 4px;font-size:11px;color:#7D6608;font-weight:800;text-align:center;border-bottom:1.5px solid #D4AC0D;width:22%;">النوع</th>
              <th style="padding:7px 4px;font-size:11px;color:#555;font-weight:800;text-align:center;border-bottom:1.5px solid #D4AC0D;width:28%;">القراءة</th>
              <th style="padding:7px 4px;font-size:11px;color:#1B5E20;font-weight:800;text-align:center;border-bottom:1.5px solid #D4AC0D;width:20%;">استهلاك ل</th>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>`;
    }

    // ── 3. توريدات الوقود — فلتر زمني صارم بحسب توقيت الوردية ──
    // منطق الفلتر: يظهر التوريد فقط إذا كان id (timestamp) الخاص به
    // يقع ضمن النطاق الزمني لهذه الوردية (بداية ساعات الوردية — نهايتها).
    // إذا لم تتوفر ساعات الوردية في الإعدادات نستخدم تاريخ اليوم كاملاً (fallback).
    const supplyLabels = { diesel:'ديزل', '91':'بنزين 91', '95':'بنزين 95' };
    const shiftCfg     = (cfg.shifts || []).find(x => x.abbr === shift.shiftType);
    // ── فلتر التوريد الزمني الصارم ──────────────────────────────
    // الأولوية 1: ساعات الوردية من الإعدادات (startHour/endHour)
    // الأولوية 2: id timestamp الوردية — نحدد التوريد الذي جاء بين
    //             id هذه الوردية و id الوردية التالية (أو نهاية اليوم)
    function _supplyInShift(s) {
      if (s.date !== shift.date) return false;
      if (!s.id) return false; // توريد بدون timestamp لا نعرف وقته → نتجاهله
      // الأولوية 1: فلتر بالساعات المحددة في الإعدادات
      if (shiftCfg?.startHour !== undefined && shiftCfg?.endHour !== undefined) {
        const ts = new Date(s.id);
        const h  = ts.getHours() + ts.getMinutes() / 60;
        const st = shiftCfg.startHour;
        const en = shiftCfg.endHour;
        if (st <= en) return h >= st && h < en;
        else          return h >= st || h < en;
      }
      // الأولوية 2: مقارنة timestamps — التوريد ينتمي للوردية التي سُجِّل بعد بدئها
      // نرتب الورديات تصاعدياً بـ id ونحدد النطاق [shift.id , nextShift.id)
      const sortedShifts = [...DB.shifts].sort((a, b) => (a.id || 0) - (b.id || 0));
      const shiftIdx     = sortedShifts.findIndex(x => x.id === shift.id);
      const thisId       = shift.id || 0;
      const nextId       = shiftIdx >= 0 && shiftIdx < sortedShifts.length - 1
                           ? (sortedShifts[shiftIdx + 1].id || Infinity)
                           : Infinity;
      return s.id >= thisId && s.id < nextId;
    }
    const supplyForShift = (DB.supply || []).filter(_supplyInShift);
    let supplyHtml = '';
    if (supplyForShift.length > 0) {
      const supplyRows = supplyForShift.map(s => {
        const fuelLabel = supplyLabels[s.type] || s.type;
        const fuelColor = s.type === 'diesel' ? '#7D6608' : s.type === '91' ? '#1E8449' : '#922B21';
        const invStr    = s.invoice ? ` | فاتورة: ${escapeHTML(s.invoice)}` : '';
        return `<div style="display:grid;grid-template-columns:1fr auto;align-items:center;padding:8px 10px;background:#fff;border-radius:8px;margin-bottom:5px;border:1px solid #C8E6C9;">
          <span style="color:${fuelColor};font-weight:800;font-size:13px;">🚛 ${fuelLabel}</span>
          <span style="text-align:center;"><strong style="font-size:16px;color:${fuelColor};">${fmt(s.qty)}</strong> <span style="font-size:11px;color:#555;">لتر${invStr}</span></span>
        </div>`;
      }).join('');
      supplyHtml = `<div style="margin-top:10px;background:#F0FFF4;border:1.5px solid #66BB6A;border-radius:10px;overflow:hidden;">
        <div style="padding:8px 12px;font-size:13px;font-weight:800;color:#2E7D32;background:rgba(102,187,106,0.15);border-bottom:1px solid #A5D6A7;">🚛 توريدات خلال الوردية — ${formatDate(shift.date)}</div>
        <div style="padding:8px 10px;">${supplyRows}</div>
      </div>`;
    }

    // ── 4. استهلاك اليوم (مجموع آخر دورة ورديات كاملة) ──
    // نستخدم getLast24hShifts() التي تُعيد آخر N وردية (N = shiftsPerDay)
    const last24 = getLast24hShifts();
    const d24 = last24.reduce((a, s) => a + (s.diesel || 0), 0);
    const n24 = last24.reduce((a, s) => a + (s.n91    || 0), 0);
    const x24 = last24.reduce((a, s) => a + (s.n95    || 0), 0);

    // ── 5. المخزون الفعلي بعد الوردية ──────────────────────────
    // المعادلة: (مخزون قبل الوردية + توريد خلالها) − استهلاك الوردية
    // المصدر الأول: صف DB.inventory المطابق لتاريخ+نوع الوردية (يُسجَّل عند الحفظ).
    // المصدر الاحتياطي: currentStock (آخر قيمة محسوبة).
    const invRow = (DB.inventory || []).find(
      r => r.date === shift.date && r.shiftType === shift.shiftType && r.type === 'shift'
    );
    // حساب إضافة التوريد الذي تزامن مع وقت الوردية (إن لم يكن مدموجاً في invRow)
    const supplyDuringShift = { diesel: 0, n91: 0, n95: 0 };
    supplyForShift.forEach(s => {
      const k = s.type === 'diesel' ? 'diesel' : s.type === '91' ? 'n91' : 'n95';
      supplyDuringShift[k] += (s.qty || 0);
    });
    let stockD, stockN91, stockN95;
    if (invRow) {
      // صف DB.inventory يحتوي على المخزون بعد الوردية مباشرة
      stockD   = invRow.diesel ?? 0;
      stockN91 = invRow.n91    ?? 0;
      stockN95 = invRow.n95    ?? 0;
    } else {
      // احتياطي: currentStock − استهلاك الوردية الحالية + توريد تزامن معها
      const base = cfg.currentStock || {};
      stockD   = (base.diesel ?? 0) - dieselL + supplyDuringShift.diesel;
      stockN91 = (base.n91    ?? 0) - n91L   + supplyDuringShift.n91;
      stockN95 = (base.n95    ?? 0) - n95L   + supplyDuringShift.n95;
    }

    const stockRows = [
      { label: 'ديزل',     v: stockD,   color: '#7D6608', bg: '#FFFDE7', border: '#F9E87A' },
      { label: 'بنزين 91', v: stockN91, color: '#1E8449', bg: '#F1FFF4', border: '#52BE80' },
      { label: 'بنزين 95', v: stockN95, color: '#922B21', bg: '#FFF5F5', border: '#E74C3C' }
    ].map(r => {
      const warn = r.v <= 0 ? '🚨 نفد' : r.v < minStock ? '⚠️ منخفض' : '✅';
      return `<div style="background:${r.bg};border:1.5px solid ${r.border};border-radius:8px;padding:10px 6px;text-align:center;">
        <div style="color:${r.color};font-weight:800;font-size:12px;margin-bottom:4px;">${r.label}</div>
        <div style="font-size:18px;font-weight:800;color:${r.color};">${fmt(r.v)}</div>
        <div style="font-size:11px;color:#888;margin-top:2px;">لتر ${warn}</div>
      </div>`;
    }).join('');

    // ── بناء البطاقة ─────────────────────────────────────────────
    const shareDiv = document.createElement('div');
    shareDiv.style.cssText = 'position:fixed;left:-9999px;top:0;width:390px;background:#ffffff;padding:16px;font-family:Cairo,Tajawal,sans-serif;direction:rtl;border-radius:16px;overflow:hidden;';
    shareDiv.innerHTML = `
      <!-- Header -->
      <div style="background:linear-gradient(135deg,#7B241C,#C0392B);color:white;padding:14px 16px;border-radius:10px;margin-bottom:12px;text-align:center;">
        <div style="font-size:17px;font-weight:800">${escapeHTML(cfg.stationName || 'محطة الوقود')}</div>
        <div style="font-size:11px;opacity:0.85;margin-top:3px">${formatDate(shift.date)} — ${escapeHTML(shiftName)}</div>
        ${enteredBy ? `<div style="font-size:10px;opacity:0.7;margin-top:2px">👤 ${escapeHTML(enteredBy)}</div>` : ''}
      </div>

      <!-- Fuel Consumption — القيم المرتبطة بالحقول الصحيحة -->
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-bottom:10px;">
        <div style="text-align:center;background:#FEFCE8;border:1.5px solid #EDE68A;border-radius:9px;padding:9px 5px;">
          <div style="font-size:10px;color:#92781A;font-weight:800;border-bottom:1px solid #DDD08A;margin-bottom:4px;padding-bottom:3px;">⬛ ديزل</div>
          <div style="font-size:20px;font-weight:900;color:#6B5A18;margin:3px 0;font-family:'Cairo',sans-serif;">${fmt(dieselL)}</div>
          <div style="font-size:9.5px;color:#A08922;font-weight:700;">لتر</div>
          <div style="font-size:10.5px;color:#92781A;font-weight:800;margin-top:3px;">${fmt(dieselRial, 2)} ر.س</div>
        </div>
        <div style="text-align:center;background:#F0FAF4;border:1.5px solid #A8D5B5;border-radius:9px;padding:9px 5px;">
          <div style="font-size:10px;color:#2D7A4A;font-weight:800;border-bottom:1px solid #A8D5B5;margin-bottom:4px;padding-bottom:3px;">🟢 بنزين 91</div>
          <div style="font-size:20px;font-weight:900;color:#1A5C34;margin:3px 0;font-family:'Cairo',sans-serif;">${fmt(n91L)}</div>
          <div style="font-size:9.5px;color:#3A8A56;font-weight:700;">لتر</div>
          <div style="font-size:10.5px;color:#2D7A4A;font-weight:800;margin-top:3px;">${fmt(n91Rial, 2)} ر.س</div>
        </div>
        <div style="text-align:center;background:#FEF2F2;border:1.5px solid #DFA8A8;border-radius:9px;padding:9px 5px;">
          <div style="font-size:10px;color:#9B3232;font-weight:800;border-bottom:1px solid #DFA8A8;margin-bottom:4px;padding-bottom:3px;">🔴 بنزين 95</div>
          <div style="font-size:20px;font-weight:900;color:#7A1E1E;margin:3px 0;font-family:'Cairo',sans-serif;">${fmt(n95L)}</div>
          <div style="font-size:9.5px;color:#B84040;font-weight:700;">لتر</div>
          <div style="font-size:10.5px;color:#9B3232;font-weight:800;margin-top:3px;">${fmt(n95Rial, 2)} ر.س</div>
        </div>
      </div>

      <!-- Totals -->
      <div style="background:linear-gradient(135deg,#7B241C,#C0392B);color:white;border-radius:9px;padding:10px;text-align:center;margin-bottom:10px;">
        <div style="font-size:10px;opacity:0.8;margin-bottom:2px;">إجمالي الوردية</div>
        <div style="font-size:24px;font-weight:800;">${fmt(totalMoney, 2)} ر.س</div>
      </div>

      <!-- Payment Split -->
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:10px;">
        <div style="background:#F5F5F5;border-radius:8px;padding:9px 5px;text-align:center;border:1px solid #E0E0E0;">
          <div style="font-size:10px;color:#555;font-weight:700;margin-bottom:3px;">🌐 شبكة</div>
          <div style="font-size:13px;font-weight:800;color:#1565C0;">${fmt(netPay, 2)}</div>
          <div style="font-size:9px;color:#999;">ر.س</div>
        </div>
        <div style="background:#F5F5F5;border-radius:8px;padding:9px 5px;text-align:center;border:1px solid #E0E0E0;">
          <div style="font-size:10px;color:#555;font-weight:700;margin-bottom:3px;">📄 فواتير</div>
          <div style="font-size:13px;font-weight:800;color:#555;">${fmt(invoicesPay, 2)}</div>
          <div style="font-size:9px;color:#999;">ر.س</div>
        </div>
        <div style="background:#F5F5F5;border-radius:8px;padding:9px 5px;text-align:center;border:1px solid #E0E0E0;">
          <div style="font-size:10px;color:#555;font-weight:700;margin-bottom:3px;">📦 توريد</div>
          <div style="font-size:13px;font-weight:800;color:#555;">${fmt(suppliedPay, 2)}</div>
          <div style="font-size:9px;color:#999;">ر.س</div>
        </div>
        <div style="background:#FFF8E1;border:1.5px solid #F9E87A;border-radius:8px;padding:9px 5px;text-align:center;">
          <div style="font-size:10px;color:#7D6608;font-weight:700;margin-bottom:3px;">💵 نقدية</div>
          <div style="font-size:13px;font-weight:800;color:#7D6608;">${fmt(cashPay, 2)}</div>
          <div style="font-size:9px;color:#9A7D0A;">ر.س</div>
        </div>
      </div>

      <!-- Meters (قراءات العدادات) -->
      ${metersHtml}

      <!-- Supplies (توريدات الوقود — جديد) -->
      ${supplyHtml}

      <!-- 24h Summary -->
      <div style="margin-top:10px;background:#F0F4FF;border:1.5px solid #90CAF9;border-radius:10px;overflow:hidden;">
        <div style="padding:8px 12px;font-size:13px;font-weight:800;color:#1565C0;background:rgba(144,202,249,0.2);border-bottom:1px solid #90CAF9;">⏱️ استهلاك اليوم</div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:0;text-align:center;">
          <div style="padding:10px 6px;border-left:1px solid #BBDEFB;">
            <div style="color:#7D6608;font-weight:800;font-size:12px;margin-bottom:4px;">⬛ ديزل</div>
            <div style="font-weight:800;font-size:18px;color:#7D6608;">${fmt(d24)}</div>
            <div style="font-size:11px;color:#888;">لتر</div>
          </div>
          <div style="padding:10px 6px;border-left:1px solid #BBDEFB;">
            <div style="color:#1E8449;font-weight:800;font-size:12px;margin-bottom:4px;">🟢 بنزين 91</div>
            <div style="font-weight:800;font-size:18px;color:#1E8449;">${fmt(n24)}</div>
            <div style="font-size:11px;color:#888;">لتر</div>
          </div>
          <div style="padding:10px 6px;">
            <div style="color:#922B21;font-weight:800;font-size:12px;margin-bottom:4px;">🔴 بنزين 95</div>
            <div style="font-weight:800;font-size:18px;color:#922B21;">${fmt(x24)}</div>
            <div style="font-size:11px;color:#888;">لتر</div>
          </div>
        </div>
      </div>

      <!-- Stock (المخزون بعد الوردية) -->
      <div style="margin-top:10px;background:#F9F9F9;border:1px solid #ddd;border-radius:10px;overflow:hidden;">
        <div style="padding:8px 12px;font-size:13px;font-weight:800;color:#555;background:#F0F0F0;border-bottom:1px solid #ddd;">🛢️ المخزون بعد الوردية</div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;padding:10px;">
          ${stockRows}
        </div>
      </div>

      <!-- Footer -->
      <div style="text-align:center;font-size:9px;color:#BBBBBB;margin-top:10px;padding-top:7px;border-top:1px dashed #EEE;">
        نظام إدارة محطة الوقود • ${new Date().toLocaleDateString('ar-SA')}
      </div>`;
    document.body.appendChild(shareDiv);

    // ── تحميل html2canvas ─────────────────────────────────────
    if (typeof html2canvas === 'undefined') {
      await new Promise((res, rej) => {
        const sc = document.createElement('script');
        sc.src = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
        sc.onload = res; sc.onerror = rej;
        document.head.appendChild(sc);
      });
    }

    const canvas = await html2canvas(shareDiv, { scale: 2.5, useCORS: true, backgroundColor: '#ffffff', logging: false });
    document.body.removeChild(shareDiv);
    if (shiftRow && !wasExpanded) shiftRow.classList.remove('expanded');

    // ── مشاركة الصورة ─────────────────────────────────────────
    await new Promise(resolve => {
      canvas.toBlob(async (blob) => {
        const fileName = `وردية_${shift.date}_${shift.shiftType||'shift'}.png`;
        const file = new File([blob], fileName, { type: 'image/png' });
        const canShare = navigator.share && navigator.canShare && navigator.canShare({ files: [file] });
        if (canShare) {
          try { await navigator.share({ files: [file], title: `وردية ${shiftName} — ${formatDate(shift.date)}` }); }
          catch(e) { if (e.name !== 'AbortError') _downloadBlob(blob, fileName); }
        } else {
          _downloadBlob(blob, fileName);
          _showToast('📥 تم تنزيل صورة الوردية', 'success');
        }
        resolve();
      }, 'image/png');
    });

  } catch(err) {
    if (shiftRow && !wasExpanded) shiftRow?.classList.remove('expanded');
    console.error('shareShiftImage:', err);
    _showToast('⚠️ خطأ في المشاركة: ' + err.message, 'danger');
  } finally {
    if (btn) { btn.innerHTML = originalHTML; btn.disabled = false; }
  }
}

// ── مساعد: تنزيل blob كملف ─────────────────────────────────────
function _downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = fileName; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

// ── تعديل وردية ─────────────────────────────────────────────────
// ── تعديل الوردية كاملة (تاريخ + عدادات + مدفوعات) ─────────────────
function editShiftFull(id) {
  if (!_canDo('editShift')) { alert('⛔ ليس لديك صلاحية تعديل الورديات'); return; }
  const shift = DB.shifts.find(s => s.id == id);
  if (!shift) { alert('⚠️ الوردية غير موجودة'); return; }
  editShift(id);
}

function editShift(id) {
  if (!_canDo('editShift')) { alert('⛔ ليس لديك صلاحية تعديل الورديات'); return; }
  const shift = DB.shifts.find(s => s.id == id);
  if (!shift) return;
  const cfg = DB.config;
  const shiftOptions = cfg.shifts.map(s => `<option value="${s.abbr}" ${s.abbr === shift.shiftType ? 'selected' : ''}>${s.name}</option>`).join('');
  
  // Find corresponding meter entry
  const meter = DB.meters.find(m => m.date === shift.date && m.shiftType === shift.shiftType);
  
  // Build pump fields
  let pumpsHtml = '';
  cfg.pumps.forEach(p => {
    const pumpData = meter?.pumps.find(x => x.pumpId === p.id);
    const reading = pumpData ? pumpData.reading : '';
    const typeLabel = p.type === 'diesel' ? 'ديزل' : p.type === '91' || p.type === 'n91' ? '91' : '95';
    pumpsHtml += `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;background:var(--gray-100);border-radius:8px;padding:6px 10px">
      <div style="min-width:80px;font-size:12px;font-weight:700">${p.name} <span style="color:var(--gray-500);font-size:10px">(${typeLabel})</span></div>
      <input type="number" class="form-input" id="edit_pump_${p.id}" value="${reading}" placeholder="قراءة العداد" style="font-size:13px;text-align:center">
    </div>`;
  });

  const body = document.getElementById('shiftDetailBody');
  const title = document.getElementById('shiftDetailTitle');
  title.textContent = `✏️ تعديل الوردية — ${formatDate(shift.date)}`;
  body.innerHTML = `
    <div class="form-group">
      <label class="form-label">التاريخ</label>
      <input type="date" class="form-input" id="edit_date" value="${shift.date}">
    </div>
    <div class="form-group">
      <label class="form-label">الوردية</label>
      <select class="form-select" id="edit_shiftType">${shiftOptions}</select>
    </div>
    <div class="section-title" style="font-size:13px;margin-top:12px">🔢 قراءات العدادات</div>
    ${pumpsHtml}
    <div class="section-title" style="font-size:13px;margin-top:12px">💰 المبالغ</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
      <div class="form-group">
        <label class="form-label">الإجمالي الكلي (ر.س)</label>
        <input type="number" class="form-input" id="edit_total" value="${shift.totalMoney}" step="0.01">
      </div>
      <div class="form-group">
        <label class="form-label">شبكة</label>
        <input type="number" class="form-input" id="edit_network" value="${shift.network || 0}" step="0.01">
      </div>
      <div class="form-group">
        <label class="form-label">فواتير</label>
        <input type="number" class="form-input" id="edit_invoices" value="${shift.invoices || 0}" step="0.01">
      </div>
      <div class="form-group">
        <label class="form-label">توريد</label>
        <input type="number" class="form-input" id="edit_supplied" value="${shift.supplied || 0}" step="0.01">
      </div>
    </div>
    <div class="flex-row mt-8" style="gap:8px">
      <button class="btn btn-primary btn-full" onclick="saveEditedShift('${id}')">💾 حفظ التعديلات</button>
      <button class="btn btn-ghost" onclick="closeModal('shiftDetailModal')" style="flex:0 0 auto">إلغاء</button>
    </div>
  `;
  document.getElementById('shiftDetailModal').classList.add('open');
}

function saveEditedShift(id) {
  if (currentUser?.role !== 'owner') { alert('⛔ هذه الصلاحية للمالك فقط'); return; }
  const shift = DB.shifts.find(s => s.id == id);
  if (!shift) return;
  const cfg = DB.config;
  const newDate = document.getElementById('edit_date').value;
  const newShiftType = document.getElementById('edit_shiftType').value;
  const newTotal = parseFloat(document.getElementById('edit_total').value) || shift.totalMoney;
  const newNetwork = parseFloat(document.getElementById('edit_network').value) || 0;
  const newInvoices = parseFloat(document.getElementById('edit_invoices').value) || 0;
  const newSupplied = parseFloat(document.getElementById('edit_supplied').value) || 0;
  const newCash = Math.max(0, newTotal - newNetwork - newInvoices - newSupplied);
  if (!newDate) { alert('⚠️ يرجى اختيار التاريخ'); return; }
  if (!newShiftType) { alert('⚠️ يرجى اختيار الوردية'); return; }

  // --- Update pump readings & recalculate consumption ---
  const oldTotals = { diesel: shift.diesel || 0, n91: shift.n91 || 0, n95: shift.n95 || 0 };
  const newTotals = { diesel: 0, n91: 0, n95: 0 };
  const newPumps = [];

  cfg.pumps.forEach(p => {
    const el = document.getElementById(`edit_pump_${p.id}`);
    if (!el) return;
    const newReading = parseFloat(el.value);
    if (isNaN(newReading) || newReading === 0) return;

    // ✅ CORE FIX: استخدام getImmediatePreviousReading بدلاً من المقارنة بالتاريخ
    // هذه الدالة تجلب القراءة من الصف الملاصق أسفل هذه الوردية مباشرة
    const prevReading = getImmediatePreviousReading(p.id, newDate, newShiftType);

    const consumption = Math.max(0, newReading - prevReading);
    newPumps.push({ pumpId: p.id, reading: newReading, consumption });
    newTotals[normType(p.type)] += consumption;
  });

  // Update stock: undo old consumption, apply new
  cfg.currentStock.diesel += oldTotals.diesel - newTotals.diesel;
  cfg.currentStock.n91   += oldTotals.n91   - newTotals.n91;
  cfg.currentStock.n95   += oldTotals.n95   - newTotals.n95;

  // Save old date/shiftType before updating shift record
  const _oldDate = shift.date;
  const _oldShiftType = shift.shiftType;

  // Update shift record
  shift.date = newDate;
  shift.shiftType = newShiftType;
  shift.totalMoney = newTotal;
  shift.network = newNetwork;
  shift.invoices = newInvoices;
  shift.supplied = newSupplied;
  shift.cash = newCash;
  if (newPumps.length > 0) {
    shift.diesel = newTotals.diesel;
    shift.n91    = newTotals.n91;
    shift.n95    = newTotals.n95;
    shift.pumps  = newPumps;
  }

  // Update corresponding meter entry — use OLD date/shiftType before shift record was mutated
  const oldMeterIdx = DB.meters.findIndex(m => m.date === _oldDate && m.shiftType === _oldShiftType && m.type !== 'opening');
  // ✅ FIX #1 (Use-After-Delete): اقرأ الـ ID قبل الحذف — البحث بعد splice يعيد undefined دائماً
  const preservedId = oldMeterIdx !== -1 ? DB.meters[oldMeterIdx].id : Date.now();
  if (oldMeterIdx !== -1) {
    DB.meters.splice(oldMeterIdx, 1);
  }
  if (newPumps.length > 0) {
    DB.meters.push({ id: preservedId, date: newDate, shiftType: newShiftType, type: 'meter', pumps: newPumps });
  }

  // Update inventory row for this shift — find by old date/shiftType
  const invIdx = DB.inventory.findIndex(r => r.date === _oldDate && r.shiftType === _oldShiftType && r.type === 'shift');
  if (invIdx !== -1 && newPumps.length > 0) {
    const todayShifts = DB.shifts.filter(s => s.date === newDate && s.type !== 'audit');
    const dayD  = todayShifts.reduce((a, s) => a + (s.diesel || 0), 0);
    const day91 = todayShifts.reduce((a, s) => a + (s.n91   || 0), 0);
    const day95 = todayShifts.reduce((a, s) => a + (s.n95   || 0), 0);
    DB.inventory[invIdx].date     = newDate;
    DB.inventory[invIdx].shiftType= newShiftType;
    DB.inventory[invIdx].diesel  = cfg.currentStock.diesel;
    DB.inventory[invIdx].n91     = cfg.currentStock.n91;
    DB.inventory[invIdx].n95     = cfg.currentStock.n95;
    DB.inventory[invIdx].consD   = newTotals.diesel;
    DB.inventory[invIdx].cons91  = newTotals.n91;
    DB.inventory[invIdx].cons95  = newTotals.n95;
    DB.inventory[invIdx].dayD    = dayD;
    DB.inventory[invIdx].day91   = day91;
    DB.inventory[invIdx].day95   = day95;
  }

  saveDB();
  closeModal('shiftDetailModal');
  triggerGlobalRecalculation();
  logActivity('shift_edit', `عدّل وردية ${newShiftType} بتاريخ ${newDate} — إجمالي: ${fmt(newTotal,2)} ر.س`);
  alert('✅ تم حفظ التعديلات بنجاح');
}

function editLastShift() {
  if (currentUser?.role !== 'owner') { alert('⛔ هذه الصلاحية للمالك فقط'); return; }
  if (DB.shifts.length === 0) { alert('لا توجد ورديات'); return; }
  editShift(DB.shifts[DB.shifts.length - 1].id);
}

// ═══════════════════════════════════════════════════════════════
// _computeLiveDayTotals — احتساب استهلاك اليوم لحظياً من DB.shifts
// ═══════════════════════════════════════════════════════════════
// تُستدعى من renderInventoryTable لكل صف من نوع 'shift'
// تضمن أن الأرقام المعروضة في عمود "استهلاك اليوم" دائماً صحيحة
// حتى لو كانت القيم المخزنة (dayD/day91/day95) من منطق قديم
// ═══════════════════════════════════════════════════════════════
function _computeLiveDayTotals(row) {
  if (row.type !== 'shift') return { dayD: row.dayD || 0, day91: row.day91 || 0, day95: row.day95 || 0 };
  const shiftsPerDay = parseInt(DB.config?.shiftsPerDay || DB.config?.shifts?.length || 2);
  // ترتيب الورديات تصاعدياً (الأقدم أولاً)
  const sortedAsc = [...DB.shifts].sort((a, b) => (a.id || 0) - (b.id || 0));
  const idx = sortedAsc.findIndex(s => s.date === row.date && s.shiftType === row.shiftType);
  if (idx === -1) return { dayD: row.dayD || 0, day91: row.day91 || 0, day95: row.day95 || 0 };
  const windowStart = Math.max(0, idx - shiftsPerDay + 1);
  const win = sortedAsc.slice(windowStart, idx + 1);
  return {
    dayD:  win.reduce((a, s) => a + (s.diesel || 0), 0),
    day91: win.reduce((a, s) => a + (s.n91    || 0), 0),
    day95: win.reduce((a, s) => a + (s.n95    || 0), 0),
  };
}

// ===========================
// INVENTORY PAGE
// ===========================
function renderInventoryTable() {
  // [FIX v10] تحديث بطاقة ملخص المخزون في أعلى الصفحة
  _updateInventorySummaryCard();

  const rows = [...DB.inventory].reverse().filter(r => r.type !== 'opening');
  const body = document.getElementById('inventoryTableBody');

  body.innerHTML = rows.map(r => {
    // [v15] صف الجرد — تنسيق مميز
    if (r.type === 'audit') {
      const isDark = document.body.classList.contains('dark-mode');
      const timeStr = (() => {
        // جلب الوقت من سجل العداد المقابل
        const auditMeter = DB.meters.find(m => m.id === r.id && m.type === 'audit');
        return auditMeter?.time || '';
      })();
      return `<tr style="background:linear-gradient(90deg,rgba(47,79,79,0.18),rgba(27,38,49,0.12));border-top:2px solid rgba(47,79,79,0.5);border-bottom:2px solid rgba(47,79,79,0.5)">
        <td style="padding:5px 6px;font-weight:700;white-space:nowrap;text-align:center">
          <span style="background:linear-gradient(135deg,#2F4F4F,#1B2631);color:#A9D5D5;padding:2px 7px;border-radius:8px;font-size:10px;font-weight:800;border:1px solid #5D6D7E">📑 جرد</span>
          <div style="font-size:10px;color:#5D6D7E;margin-top:2px">${formatDateShort(r.date)}${timeStr ? ' ' + timeStr : ''}</div>
        </td>
        <td style="padding:5px 6px;font-weight:800;color:#A9D5D5;font-size:12px;background:rgba(47,79,79,0.1)">${fmt(r.diesel)}</td>
        <td style="padding:5px 6px;font-weight:800;color:#A9D5D5;font-size:12px;background:rgba(47,79,79,0.1)">${fmt(r.n91)}</td>
        <td style="padding:5px 6px;font-weight:800;color:#A9D5D5;font-size:12px;background:rgba(47,79,79,0.1)">${fmt(r.n95)}</td>
        <td style="padding:5px 6px;color:#52BE80;font-weight:700;font-size:11px">${fmt(r.consD)}</td>
        <td style="padding:5px 6px;color:#52BE80;font-weight:700;font-size:11px">${fmt(r.cons91)}</td>
        <td style="padding:5px 6px;color:#52BE80;font-weight:700;font-size:11px">${fmt(r.cons95)}</td>
        <td colspan="4" style="padding:5px 6px;text-align:center;color:#7FB3B3;font-size:10px">استهلاك فترة الجرد</td>
      </tr>`;
    }

    const shiftName = DB.config.shifts?.find(s => s.abbr === r.shiftType)?.abbr || r.shiftType || '';
    const typeIcon  = r.type === 'supply' ? ' 🚛' : r.type === 'adjust' ? ' ⚖️' : '';

    // Build معادلة cell: show only non-zero adjustments with fuel label
    const adjParts = [];
    if (r.adjD  && r.adjD  !== 0) adjParts.push(`ديزل: ${fmt(r.adjD)}`);
    if (r.adj91 && r.adj91 !== 0) adjParts.push(`91: ${fmt(r.adj91)}`);
    if (r.adj95 && r.adj95 !== 0) adjParts.push(`95: ${fmt(r.adj95)}`);
    const adjCell = adjParts.length
      ? adjParts.map(a => `<div style="font-size:12px;line-height:1.6">${a}</div>`).join('')
      : '<span style="color:var(--gray-300)">—</span>';

    // ✅ استهلاك اليوم: يُحسَب لحظياً بالمنطق الجديد (FIFO) لتجاوز القيم القديمة المخزنة
    const live = _computeLiveDayTotals(r);

    return `<tr>
      <td style="padding:5px 6px;font-weight:700;white-space:nowrap;text-align:center">
        <span style="background:var(--gray-200);padding:1px 5px;border-radius:10px;font-size:10px;font-weight:700;display:inline-block;margin-bottom:2px">${shiftName}${typeIcon}</span>
        <div style="font-size:11px">${formatDateShort(r.date)}</div>
      </td>
      <td style="padding:5px 6px;font-weight:700;color:#D4AC0D;font-size:12px">${fmt(r.diesel)}</td>
      <td style="padding:5px 6px;font-weight:700;color:#27AE60;font-size:12px">${fmt(r.n91)}</td>
      <td style="padding:5px 6px;font-weight:700;color:var(--red);font-size:12px">${fmt(r.n95)}</td>
      <td style="padding:5px 6px;color:#27AE60;font-weight:700;font-size:11px">${fmt(r.consD)}</td>
      <td style="padding:5px 6px;color:#27AE60;font-weight:700;font-size:11px">${fmt(r.cons91)}</td>
      <td style="padding:5px 6px;color:#27AE60;font-weight:700;font-size:11px">${fmt(r.cons95)}</td>
      <td style="padding:5px 6px;color:#27AE60;font-weight:700;font-size:11px">${fmt(live.dayD)}</td>
      <td style="padding:5px 6px;color:#27AE60;font-weight:700;font-size:11px">${fmt(live.day91)}</td>
      <td style="padding:5px 6px;color:#27AE60;font-weight:700;font-size:11px">${fmt(live.day95)}</td>
      <td style="padding:5px 6px;color:var(--gold-dark)">${adjCell}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="11" class="text-center text-muted" style="padding:30px">لا توجد بيانات</td></tr>';

  // إضافة صف ثابت "المخزون الافتتاحي" في أسفل الجدول
  const openingRow = DB.inventory.find(r => r.type === 'opening');
  if (openingRow) {
    body.innerHTML += `<tr style="border-top:2px solid var(--gold)">
      <td style="padding:6px 6px;text-align:center;background:rgba(212,172,13,0.08)">
        <div style="font-size:11px;font-weight:800;color:var(--gold-dark)">📌 المخزون الافتتاحي</div>
        <div style="font-size:10px;color:var(--gray-500)">${formatDateShort(openingRow.date)}</div>
      </td>
      <td style="padding:5px 6px;font-weight:700;color:#D4AC0D;font-size:12px;background:rgba(212,172,13,0.08)">${fmt(openingRow.diesel)}</td>
      <td style="padding:5px 6px;font-weight:700;color:#27AE60;font-size:12px;background:rgba(212,172,13,0.08)">${fmt(openingRow.n91)}</td>
      <td style="padding:5px 6px;font-weight:700;color:var(--red);font-size:12px;background:rgba(212,172,13,0.08)">${fmt(openingRow.n95)}</td>
      <td colspan="7" style="padding:5px 6px;text-align:center;color:var(--gray-500);font-size:11px;background:rgba(212,172,13,0.08)">—</td>
    </tr>`;
  }
}

// [FIX v10] تحديث بطاقة ملخص المخزون مع المتوسط والأيام المتبقية
