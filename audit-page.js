/**
 * ═══════════════════════════════════════════════════════════════════════
 * AUDIT PAGE — صفحة الجرد المستقلة v1.0
 * ─────────────────────────────────────────────────────────────────────
 * يحل هذا الملف محل النظام القديم (openAuditModal / auditInlinePanel)
 * الذي كان يُظهر الجرد كلوحة منبثقة داخل صفحة "إدخال الوردية".
 *
 * الجرد الآن صفحة كاملة مستقلة في القائمة الرئيسية، بنفس أسلوب
 * صفحة "📝 إدخال الوردية" تماماً (نفس الفئات/التنسيقات: card, form-group,
 * form-input, stat-box...) — وليس نافذة أو قائمة منبثقة.
 *
 * قواعد التوقيت في هذه الصفحة:
 *   - التاريخ الميلادي + الهجري + اسم اليوم (بلا تدخل يدوي، عبر formatDateFull)
 *   - الوقت: ساعة ودقيقة فقط (HH:MM) — بلا ثوانٍ في أي مكان
 *
 * هذا الملف لا يحسب أي رقم محاسبي بنفسه — كل الاستهلاك/المخزون/الفروقات
 * تُحسَب حصراً بواسطة AccountingEngine بعد الحفظ (rebuild تلقائي من
 * داخل saveDB()). هذا الملف يجمع المُدخلات ويكتب "حدثاً خاماً" فقط.
 * ═══════════════════════════════════════════════════════════════════════
 */

window.AuditPage = (function () {

  // ── الحالة المحلية للنموذج (لا تُكتب في DB إلا عند الحفظ) ──────────
  let _resetApproved = {}; // pumpId → true بعد موافقة المستخدم على إعادة تعيين عداد

  function _cfg() { return window.DB?.config; }

  function _todayDate() { return new Date().toISOString().split('T')[0]; }
  function _nowTime()   { return new Date().toTimeString().slice(0, 5); } // HH:MM — بلا ثوانٍ

  // ══════════════════════════════════════════════════════════════
  // الرسم الأساسي للصفحة
  // ══════════════════════════════════════════════════════════════
  function render() {
    const cfg = _cfg();
    const container = document.getElementById('page-audit');
    if (!cfg || !container) return;

    _resetApproved = {};

    container.innerHTML = `
      <div class="section-title" style="margin-bottom:12px">📑 تسجيل جرد</div>

      <div class="card" style="margin-bottom:14px">
        <div class="card-header"><span class="card-title">📅 التاريخ والوقت</span></div>
        <div class="card-body" style="padding:14px">
          <div class="form-group" style="margin-bottom:12px">
            <label class="form-label" style="font-size:13px">التاريخ</label>
            <input type="date" class="form-input" id="audit_date" style="font-size:14px;padding:10px"
              value="${_todayDate()}" onchange="AuditPage.updateDateDisplay()">
          </div>
          <div class="form-group" style="margin-bottom:8px">
            <label class="form-label" style="font-size:13px">الوقت (ساعة : دقيقة)</label>
            <input type="time" class="form-input" id="audit_time" style="font-size:14px;padding:10px" value="${_nowTime()}">
          </div>
          <div id="auditDateDisplay" style="background:var(--gray-100);border-radius:8px;padding:8px 12px;font-size:12.5px;color:var(--gray-700);line-height:1.8"></div>
        </div>
      </div>

      <div class="section-title" style="margin-bottom:12px">⛽ قراءات العدادات الحالية</div>
      <div id="auditPumpsContainer"></div>

      <div class="card" style="margin:14px 0">
        <div class="card-header"><span class="card-title">💰 الأرصدة النقدية الفعلية في الصندوق</span></div>
        <div class="card-body" style="padding:14px">
          <div class="payment-grid">
            <div class="payment-item">
              <div class="payment-label">💵 نقدية</div>
              <input type="number" class="form-input" id="audit_cash" placeholder="0" oninput="AuditPage.liveCalc()">
            </div>
            <div class="payment-item">
              <div class="payment-label">🌐 شبكة (مدى)</div>
              <input type="number" class="form-input" id="audit_network" placeholder="0" oninput="AuditPage.liveCalc()">
            </div>
            <div class="payment-item" style="grid-column:1/-1">
              <div class="payment-label">📄 فواتير / آجل</div>
              <input type="number" class="form-input" id="audit_invoices" placeholder="0" oninput="AuditPage.liveCalc()">
            </div>
          </div>
        </div>
      </div>

      <div id="auditLiveIndicator" style="border-radius:8px;padding:10px 12px;margin-bottom:12px;display:none"></div>

      <div style="display:flex;gap:8px">
        <button class="btn btn-full" onclick="AuditPage.save()" style="background:linear-gradient(135deg,#2F4F4F,#1B2631);color:#A9D5D5;border:2px solid #5D6D7E;padding:14px;font-size:15px;font-weight:800;flex:2">
          💾 حفظ الجرد
        </button>
        <button class="btn btn-ghost" onclick="showPage('home', document.querySelector('.nav-btn'))" style="flex:1;padding:14px;font-size:13px;font-weight:800">
          ✖️ إلغاء
        </button>
      </div>
      <p style="font-size:10px;color:var(--gray-500);text-align:center;margin-top:6px">سيتم تسجيل هذا الجرد كنقطة انطلاق جديدة لحساب الاستهلاك اللاحق</p>
    `;

    _renderPumps();
    updateDateDisplay();
    liveCalc();
  }

  function _renderPumps() {
    const cfg = _cfg();
    const box = document.getElementById('auditPumpsContainer');
    if (!box) return;
    box.innerHTML = (cfg.pumps || []).map(p => {
      const rawType = p.type;
      const typeLabel = rawType === 'diesel' ? 'ديزل' : (rawType === 'n91' || rawType === '91') ? 'بنزين 91' : 'بنزين 95';
      const typeColor = rawType === 'diesel' ? '#7D6608' : (rawType === 'n91' || rawType === '91') ? '#1E8449' : '#922B21';
      const lastRead = AccountingEngine.getLastReading(p.id);
      return `<div class="card" style="margin-bottom:8px;border-right:3px solid ${typeColor}">
        <div class="card-body" style="padding:10px 12px;display:flex;align-items:center;gap:10px">
          <div style="min-width:100px">
            <div style="font-size:13px;font-weight:800;color:var(--text-primary)">${p.name}</div>
            <div style="font-size:11px;color:${typeColor};font-weight:700">${typeLabel}</div>
            <div style="font-size:11px;color:var(--gray-500)">السابق: ${fmt(lastRead)}</div>
          </div>
          <div style="flex:1">
            <input type="number" id="audit_pump_${p.id}" class="form-input" placeholder="القراءة الحالية"
              style="font-size:14px;font-weight:700;width:100%" oninput="AuditPage.checkPump(${p.id})">
            <div id="audit_pump_${p.id}_msg" style="font-size:11px;margin-top:4px"></div>
          </div>
        </div>
      </div>`;
    }).join('');
  }

  function updateDateDisplay() {
    const dateEl = document.getElementById('audit_date');
    const displayEl = document.getElementById('auditDateDisplay');
    if (!dateEl || !displayEl || typeof formatDateFull !== 'function') return;
    const info = formatDateFull(dateEl.value);
    displayEl.innerHTML = `
      <div>📆 ${info.dayName} — ${info.gregorian}</div>
      <div>🌙 ${info.hijri}</div>`;
  }

  // ── التحقق من قراءة عداد أقل من السابقة (نفس أسلوب صفحة الإدخال) ──
  function checkPump(pumpId) {
    const input = document.getElementById(`audit_pump_${pumpId}`);
    const msg   = document.getElementById(`audit_pump_${pumpId}_msg`);
    if (!input || !msg) return;
    const current = parseFloat(input.value);
    const prev = AccountingEngine.getLastReading(pumpId);
    if (isNaN(current)) { msg.textContent = ''; liveCalc(); return; }

    if (current < prev) {
      if (_resetApproved[pumpId]) {
        msg.innerHTML = `<span style="color:#E67E22;font-weight:700">🔄 إعادة تعيين العداد (${fmt(prev)} ← ${fmt(current)})</span>`;
      } else {
        msg.innerHTML = `<span style="color:var(--red);font-weight:700">⚠️ أقل من السابق (${fmt(prev)}) — <a href="#" onclick="event.preventDefault();AuditPage.approveReset(${pumpId})" style="color:#1565C0;text-decoration:underline">إعادة تعيين؟</a></span>`;
      }
    } else {
      msg.innerHTML = `<span style="color:#27AE60">استهلاك: ${fmt(current - prev)} لتر</span>`;
      _resetApproved[pumpId] = false;
    }
    liveCalc();
  }

  function approveReset(pumpId) {
    const input = document.getElementById(`audit_pump_${pumpId}`);
    const prev = AccountingEngine.getLastReading(pumpId);
    const current = parseFloat(input?.value);
    const confirmed = confirm(
      `🔄 تأكيد إعادة تعيين عداد الجرد\n\nالقراءة السابقة: ${fmt(prev)}\nالقراءة الجديدة: ${fmt(current)}\n\n` +
      `⚠️ هذا يعني أن العداد صُفِّر أو استُبدل فعلياً.\nسيتم تسجيل هذه العملية في سجل الأنشطة.\n\nهل تؤكد المتابعة؟`
    );
    if (!confirmed) return;
    _resetApproved[pumpId] = true;
    if (typeof logActivity === 'function') {
      logActivity('counter_reset', `إعادة تعيين عداد أثناء الجرد: السابقة ${fmt(prev)} → الجديدة ${fmt(current)}`);
    }
    checkPump(pumpId);
    if (typeof _showToast === 'function') _showToast('✅ تم تأكيد إعادة تعيين العداد', 'warning');
  }

  // ── مؤشر العجز/الفائض اللحظي (يعتمد فقط على AccountingEngine) ─────
  function liveCalc() {
    const indicatorEl = document.getElementById('auditLiveIndicator');
    if (!indicatorEl) return;

    const result = AccountingEngine.calcSinceLastAudit();
    const expectedRevenue = result.totalRevenue;

    const auditCash     = parseFloat(document.getElementById('audit_cash')?.value)     || 0;
    const auditNetwork  = parseFloat(document.getElementById('audit_network')?.value)  || 0;
    const auditInvoices = parseFloat(document.getElementById('audit_invoices')?.value) || 0;
    const auditTotal    = auditCash + auditNetwork + auditInvoices;

    if (auditTotal === 0 && expectedRevenue === 0) { indicatorEl.style.display = 'none'; return; }

    const diff = auditTotal - expectedRevenue;
    const isBalance = Math.abs(diff) < 1;
    const isSurplus = diff > 0;
    const bgColor     = (isBalance || isSurplus) ? '#E8F5E9' : '#FFEBEE';
    const borderColor = (isBalance || isSurplus) ? '#27AE60' : '#E74C3C';
    const textColor   = (isBalance || isSurplus) ? '#1B5E20' : '#7B0000';
    const label       = isBalance ? '✅ مطابق' : isSurplus ? '📈 فائض جرد' : '📉 عجز جرد';
    const sign        = diff >= 0 ? '+' : '';

    indicatorEl.style.display = 'block';
    indicatorEl.style.background = bgColor;
    indicatorEl.style.border = `2px solid ${borderColor}`;
    indicatorEl.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between">
        <div>
          <div style="font-size:12px;font-weight:800;color:${textColor}">${label}</div>
          <div style="font-size:10px;color:var(--gray-500);margin-top:2px">المتوقع: ${fmt(expectedRevenue, 2)} ر.س | الفعلي: ${fmt(auditTotal, 2)} ر.س</div>
        </div>
        <div style="font-size:20px;font-weight:900;color:${textColor}">${sign}${fmt(diff, 2)} ر.س</div>
      </div>`;
  }

  // ══════════════════════════════════════════════════════════════
  // الحفظ — يكتب حدثاً خاماً فقط، والمحرك يحسب كل شيء عند saveDB()
  // ══════════════════════════════════════════════════════════════
  function save() {
    const cfg = _cfg();
    const dateEl = document.getElementById('audit_date');
    const timeEl = document.getElementById('audit_time');
    const date = dateEl?.value;
    const time = timeEl?.value; // HH:MM فقط

    if (!date || !time) { alert('⚠️ يرجى تحديد التاريخ والوقت'); return; }

    const pumps = [];
    let allFilled = true;
    for (const p of cfg.pumps) {
      const val = parseFloat(document.getElementById(`audit_pump_${p.id}`)?.value);
      if (isNaN(val) || val < 0) { allFilled = false; break; }
      const prev = AccountingEngine.getLastReading(p.id);
      if (val < prev && !_resetApproved[p.id]) { allFilled = false; break; }
      pumps.push({ pumpId: p.id, reading: val });
    }
    if (!allFilled) { alert('⚠️ يرجى إدخال قراءة صحيحة لجميع العدادات (ولا تقل عن السابقة إلا بموافقة صريحة على إعادة التعيين)'); return; }

    const auditCash     = parseFloat(document.getElementById('audit_cash')?.value)     || 0;
    const auditNetwork  = parseFloat(document.getElementById('audit_network')?.value)  || 0;
    const auditInvoices = parseFloat(document.getElementById('audit_invoices')?.value) || 0;
    const auditTotal    = auditCash + auditNetwork + auditInvoices;

    // نفس رقم id يُستخدم لعداد الجرد + وردية الجرد + صف المخزون — ربط
    // موثوق لا ينكسر (بدل الربط القديم عبر تاريخ+نوع وردية)
    const sharedId = Date.now();
    const hijriStr = (typeof toHijri === 'function') ? toHijri(date) : '';

    // ── حدث خام في DB.meters — الاستهلاك تحسبه AccountingEngine لاحقاً ──
    DB.meters.push({ id: sharedId, type: 'audit', date, time, hijriDate: hijriStr, pumps });

    // ── حدث خام في DB.shifts — لعرض الجرد في السجل والتقارير ──────────
    DB.shifts.push({
      id: sharedId, type: 'audit', date, time, hijriDate: hijriStr, shiftType: 'جرد',
      diesel: 0, n91: 0, n95: 0, totalMoney: 0,
      network: auditNetwork, invoices: auditInvoices, supplied: 0, cash: auditCash,
      auditCash, auditNetwork, auditInvoices, auditTotal,
      enteredBy: (typeof currentUser !== 'undefined' && currentUser?.email) || 'غير محدد',
    });

    // ── حدث خام في DB.inventory — المخزون/الاستهلاك تحسبهما AccountingEngine لاحقاً ──
    DB.inventory.push({
      id: sharedId, auditMeterId: sharedId, type: 'audit', date, shiftType: 'جرد',
      adjD: 0, adj91: 0, adj95: 0,
    });

    saveDB(); // ← يستدعي AccountingEngine.rebuild() تلقائياً قبل الحفظ والمزامنة

    if (typeof logActivity === 'function') {
      logActivity('audit', `تسجيل جرد بتاريخ ${date} الساعة ${time} — العجز/الفائض: ${fmt(auditTotal - (AccountingEngine.calcSinceLastAudit().totalRevenue), 2)} ر.س`);
    }
    if (typeof _showToast === 'function') _showToast('✅ تم تسجيل الجرد بنجاح', 'success');
    if (typeof triggerGlobalRecalculation === 'function') triggerGlobalRecalculation();
    if (typeof renderEntryPumps === 'function') renderEntryPumps();

    showPage('home', document.querySelector('.nav-btn'));
  }

  return { render, updateDateDisplay, checkPump, approveReset, liveCalc, save };
})();

console.log('✅ [AuditPage] صفحة الجرد المستقلة محمّلة وجاهزة');
