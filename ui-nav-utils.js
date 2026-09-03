function showPage(page, btn) {
  // ═══════════════════════════════════════════════════════
  // [FIX v6 - SECURITY] فحص الصلاحيات مربوط بـ Firebase Auth الحقيقي
  // يمنع تخطي الصلاحيات عبر Console بتعديل currentUser محلياً
  // ═══════════════════════════════════════════════════════
  const _verifyAndShowPage = (verifiedRole) => {
    const restrictedOwnerOnly = ['settings', 'prices'];
    const restrictedForEmployee = ['supply', 'inventory'];

    if (restrictedOwnerOnly.includes(page) && verifiedRole !== 'owner') {
      _showToast('⛔ هذه الصفحة للمالك فقط', 'error');
      return;
    }
    if (verifiedRole === 'employee' && restrictedForEmployee.includes(page)) {
      _showToast('⛔ ليس لديك صلاحية للوصول إلى هذه الصفحة', 'error');
      return;
    }
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    const pageEl = document.getElementById(`page-${page}`);
    if (!pageEl) return;
    pageEl.classList.add('active');
    if (btn) btn.classList.add('active');
    // ✅ تحديث فوري للبيانات عند التنقل بين الصفحات
    if (page === 'home') {
      updateHomePage();
      setTimeout(() => { if (typeof renderCharts === 'function') renderCharts(); }, 300);
    }
    if (page === 'entry') { if (typeof renderEntryPumps === 'function') renderEntryPumps(); }
    if (page === 'audit') { if (typeof AuditPage !== 'undefined') AuditPage.render(); }
    if (page === 'meters') renderMetersTable();
    if (page === 'log') renderLog();
    if (page === 'inventory') renderInventoryTable();
    if (page === 'supply') renderSupplyLog();
    if (page === 'instant') renderInstantPumps();
    if (page === 'dashboard') {
      if (typeof renderDashboard === 'function') renderDashboard();
      if (typeof _renderDashboardAuditSection === 'function') _renderDashboardAuditSection();
      setTimeout(() => {
        if (typeof renderConsumptionChart === 'function') renderConsumptionChart();
        if (typeof renderMonthlyChart === 'function') renderMonthlyChart();
      }, 200);
    }
    if (page === 'activitylog') renderActivityLog();
    if (page === 'auditlog')    renderAuditLogPage();
    if (page === 'settings')    renderSettingsPage();
    if (page === 'backup')      { renderBackupList(); logActivity('backup', 'فتح صفحة النسخ الاحتياطي'); }
  }; // end _verifyAndShowPage

  // ── التحقق من هوية المستخدم ──────────────────────────────────
  // وضع محلي بدون Firebase Auth → استخدم currentUser مباشرة
  if (_localAuthMode) {
    _verifyAndShowPage(currentUser?.role || 'employee');
    return;
  }
  // وضع Firebase: اقرأ الـ UID من firebase.auth().currentUser (لا يمكن تزويره من Console)
  const firebaseUser = fbAuth.currentUser;
  if (!firebaseUser) {
    // لا يوجد جلسة نشطة — أعِد للدخول
    currentUser = null;
    showLoginScreen();
    return;
  }
  // اقرأ الدور من DB.users باستخدام الـ uid الموثّق من Firebase
  const serverRecord = DB.users[firebaseUser.uid];
  if (!serverRecord) {
    _showToast('⛔ لا يوجد سجل مستخدم — يرجى تسجيل الدخول مجدداً', 'error');
    fbAuth.signOut();
    return;
  }
  const verifiedRole = serverRecord.role || 'employee';
  // تأكيد تطابق الـ role مع currentUser المحلي (اكتشاف أي تلاعب)
  if (currentUser && currentUser.role !== verifiedRole) {
    console.warn('[SECURITY] دور currentUser المحلي لا يطابق Firebase — تم التصحيح التلقائي');
    currentUser = { ...serverRecord, uid: firebaseUser.uid };
  }
  _verifyAndShowPage(verifiedRole);
}

function closeModal(id) {
  document.getElementById(id).classList.remove('open');
}

// ===========================
// HELPERS
// ===========================
function fmt(n, decimals = 0) {
  // [FIX v10] NaN + Infinity + null guard
  if (n === null || n === undefined || !isFinite(n) || isNaN(n)) return '0';
  const num = parseFloat(n);
  if (!isFinite(num)) return '0';
  return num.toLocaleString('en', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function formatDate(d) {
  if (!d) return '—';
  const date = new Date(d + 'T00:00:00');
  const days = ['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
  return `${days[date.getDay()]} ${date.getDate()}/${date.getMonth()+1}/${date.getFullYear()}`;
}

function formatDateShort(d) {
  if (!d) return '—';
  const date = new Date(d + 'T00:00:00');
  return `${date.getDate()}/${date.getMonth()+1}`;
}

// Convert Gregorian to Hijri
function toHijri(gDate) {
  const date = new Date(gDate + 'T00:00:00');
  try {
    const hFmt = new Intl.DateTimeFormat('ar-SA-u-ca-islamic', {
      year: 'numeric', month: 'long', day: 'numeric', weekday: 'long'
    });
    return hFmt.format(date);
  } catch(e) { return ''; }
}

// Full dual-date label: day name + Gregorian full + Hijri full
function formatDateFull(d) {
  if (!d) return '—';
  const date = new Date(d + 'T00:00:00');
  const days = ['الأحد','الاثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
  const dayName = days[date.getDay()];
  const mNames = ['يناير','فبراير','مارس','أبريل','مايو','يونيو','يوليو','أغسطس','سبتمبر','أكتوبر','نوفمبر','ديسمبر'];
  const gregorian = `${date.getDate()} ${mNames[date.getMonth()]} ${date.getFullYear()}م`;
  const hijri = toHijri(d);
  return { dayName, gregorian, hijri };
}

function enableCopyable() {
  // ═══════════════════════════════════════════════════════════════
  // [FIX v6 - COPY FALLBACK] نسخ ذكي مع بديل يدوي للمتصفحات الداخلية
  // يعمل في: Chrome، Safari، متصفح واتساب، متصفح فيسبوك، Instagram
  // ═══════════════════════════════════════════════════════════════
  document.querySelectorAll('.copyable').forEach(el => {
    // أزِل المستمعين القديمة لتفادي التكرار
    const newEl = el.cloneNode(true);
    el.parentNode.replaceChild(newEl, el);
    newEl.addEventListener('click', async function() {
      const hint = this.querySelector('.copy-hint');
      const text = this.textContent.replace('نسخ', '').replace('✅ تم النسخ', '').trim();
      if (!text) return;

      // ── محاولة النسخ الآلي ────────────────────────────────
      let copied = false;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        try {
          await navigator.clipboard.writeText(text);
          copied = true;
        } catch(err) {
          // clipboard API رُفضت — نجرب الطريقة القديمة
        }
      }

      if (!copied) {
        // ── Fallback: execCommand (يعمل في معظم المتصفحات القديمة) ──
        try {
          const ta = document.createElement('textarea');
          ta.value = text;
          ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;';
          document.body.appendChild(ta);
          ta.focus(); ta.select();
          copied = document.execCommand('copy');
          ta.remove();
        } catch(e2) { copied = false; }
      }

      if (copied) {
        // ✅ نجح النسخ
        if (hint) { hint.textContent = '✅ تم النسخ'; setTimeout(() => hint.textContent = 'نسخ', 1800); }
        else _showToast('✅ تم النسخ', 'success', 1500);
      } else {
        // ❌ فشل النسخ الآلي — أظهر Modal للنسخ اليدوي
        _showCopyFallbackModal(text);
      }
    });
  });
}

// ── Modal النسخ اليدوي ──────────────────────────────────────────
function _showCopyFallbackModal(text) {
  const oldModal = document.getElementById('_copyFallbackModal');
  if (oldModal) oldModal.remove();

  const modal = document.createElement('div');
  modal.id = '_copyFallbackModal';
  modal.style.cssText = `
    position:fixed;inset:0;z-index:99999;
    background:rgba(0,0,0,0.65);display:flex;align-items:center;justify-content:center;padding:16px;
  `;

  modal.innerHTML = `
    <div style="
      background:#fff;border-radius:16px;padding:20px;max-width:420px;width:100%;
      font-family:Cairo,sans-serif;direction:rtl;box-shadow:0 8px 32px rgba(0,0,0,0.3);
    ">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">
        <span style="font-size:22px">📋</span>
        <strong style="font-size:15px;color:#1a1a1a">انسخ النص يدوياً</strong>
      </div>
      <p style="font-size:12px;color:#666;margin-bottom:10px;line-height:1.6">
        متصفحك لا يدعم النسخ التلقائي. النص محدد بالكامل — اضغط مطولاً ثم اختر <strong>نسخ</strong>:
      </p>
      <textarea id="_copyFallbackText" readonly style="
        width:100%;min-height:90px;padding:10px;font-family:Cairo,sans-serif;font-size:13px;
        border:2px solid #C0392B;border-radius:8px;direction:rtl;resize:vertical;
        background:#FFF9F9;color:#1a1a1a;line-height:1.6;
      ">${text.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</textarea>
      <div style="display:flex;gap:8px;margin-top:14px;justify-content:flex-end">
        <button onclick="
          const ta=document.getElementById('_copyFallbackText');
          ta.focus();ta.select();
          try{document.execCommand('copy');
            this.textContent='✅ تم النسخ';
            setTimeout(()=>document.getElementById('_copyFallbackModal')?.remove(),1200);
          }catch(e){}
        " style="
          background:#C0392B;color:white;border:none;border-radius:8px;
          padding:9px 18px;font-family:Cairo,sans-serif;font-size:13px;cursor:pointer;font-weight:700;
        ">📋 نسخ الآن</button>
        <button onclick="document.getElementById('_copyFallbackModal').remove()" style="
          background:#f5f5f5;color:#333;border:1px solid #ddd;border-radius:8px;
          padding:9px 14px;font-family:Cairo,sans-serif;font-size:13px;cursor:pointer;
        ">إغلاق</button>
      </div>
    </div>
  `;

  document.body.appendChild(modal);

  // تحديد النص فوراً عند فتح الـ Modal
  requestAnimationFrame(() => {
    const ta = document.getElementById('_copyFallbackText');
    if (ta) { ta.focus(); ta.select(); }
  });

  // إغلاق بالنقر خارج الـ Modal
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.remove();
  });
}

// ===========================
// FEATURE 11: SMART LOW STOCK ALERT IN ENTRY
// ===========================
function checkStockAfterConsumption(totals) {
  const cfg = DB.config;
  const stock = cfg.currentStock;
  const minStock = cfg.minStock || 5000;
  const labels = {diesel:'ديزل', n91:'بنزين 91', n95:'بنزين 95'};
  // ✅ [FIX v9] تنبيه عند انخفاض المخزون عن 25% من السعة الافتتاحية
  const openingStock = cfg.openingStock || {};
  let alertsHtml = '';
  ['diesel','n91','n95'].forEach(type => {
    const remaining = (stock[type] || 0) - (totals[type] || 0);
    const capacity = Math.max(openingStock[type] || 0, stock[type] || 0, minStock * 4);
    const pct25 = capacity * 0.25;
    if (remaining < 0) {
      alertsHtml += `<div class="alert alert-danger" style="margin-top:6px">⛔ المخزون سينتهي! ${labels[type]} سيصبح سالباً (${fmt(remaining)} لتر)</div>`;
    } else if (remaining < pct25) {
      const pct = capacity > 0 ? Math.round((remaining / capacity) * 100) : 0;
      alertsHtml += `<div class="alert alert-warning" style="margin-top:6px">⚠️ مخزون منخفض: ${labels[type]} ${pct}% فقط (${fmt(remaining)} لتر متبقي)</div>`;
    } else if (remaining < minStock * 1.1) {
      alertsHtml += `<div class="alert alert-warning" style="margin-top:6px">⚠️ تنبيه: مخزون ${labels[type]} سيقترب من الحد الأدنى (${fmt(remaining)} لتر متبقي)</div>`;
    }
  });
  return alertsHtml;
}

// ===========================
// FEATURE 12: SUPPLY CONFIRMATION MODAL
// ===========================
// ═══════════════════════════════════════════════════════════════
// confirmSupply — كارت تأكيد التوريد: يعرض النوع المورَّد فقط
// ═══════════════════════════════════════════════════════════════
function confirmSupply() {
  const type   = document.getElementById('sup_type').value;
  const qty    = parseFloat(document.getElementById('sup_qty').value) || 0;
  const date   = document.getElementById('sup_date').value;
  const driver = document.getElementById('sup_driver').value.trim();
  if (qty <= 0) { alert('⚠️ يرجى إدخال الكمية'); return; }
  if (!date)    { alert('⚠️ يرجى اختيار تاريخ التوريد'); return; }
  if (!driver)  { alert('⚠️ يرجى إدخال اسم السائق'); return; }

  const key      = type === 'diesel' ? 'diesel' : type === '91' ? 'n91' : 'n95';
  const typeLabel = type === 'diesel' ? 'ديزل' : type;
  const currentVal = DB.config.currentStock[key] || 0;
  const afterVal   = currentVal + qty;

  document.getElementById('supplyConfirmBody').innerHTML = `
    <div style="text-align:center;margin-bottom:16px">
      <div style="font-size:40px;margin-bottom:8px">🚛</div>
      <div style="font-size:15px;font-weight:800;color:var(--text-primary);margin-bottom:4px">توريد ${typeLabel}</div>
    </div>
    <div style="background:var(--gray-100);border-radius:10px;padding:14px;margin-bottom:14px">
      <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid var(--gray-300)">
        <span class="text-muted">المخزون الحالي (${typeLabel})</span>
        <strong>${fmt(currentVal)} لتر</strong>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:8px;padding-bottom:8px;border-bottom:1px solid var(--gray-300)">
        <span style="color:#27AE60;font-weight:700">+ التوريد الجديد</span>
        <strong style="color:#27AE60">${fmt(qty)} لتر</strong>
      </div>
      <div style="display:flex;justify-content:space-between;font-size:15px;font-weight:800">
        <span style="color:var(--red-dark)">المخزون بعد التوريد (${typeLabel})</span>
        <span style="color:var(--red-dark)">${fmt(afterVal)} لتر ✅</span>
      </div>
    </div>
    <div class="flex-row" style="gap:8px">
      <button class="btn btn-primary btn-full" onclick="saveSupply();closeModal('supplyConfirmModal')">✅ تأكيد الحفظ</button>
      <button class="btn btn-ghost" onclick="closeModal('supplyConfirmModal')" style="flex:0 0 auto;padding:8px 16px">إلغاء</button>
    </div>`;
  document.getElementById('supplyConfirmModal').classList.add('open');
}

// ===========================
// FEATURE 13: COPY TODAY SUMMARY
// ===========================
function copySummary() {
  const cfg = DB.config;
  const shiftsPerDay = parseInt(cfg.shiftsPerDay || cfg.shifts?.length || 2);
  const allSorted = [...DB.shifts].sort((a,b) => (b.id||0)-(a.id||0));
  const last24 = allSorted.slice(0, shiftsPerDay);
  const yesterday = allSorted.slice(shiftsPerDay, shiftsPerDay * 2);

  const todayD   = last24.reduce((a, s) => a + (s.diesel || 0), 0);
  const today91  = last24.reduce((a, s) => a + (s.n91    || 0), 0);
  const today95  = last24.reduce((a, s) => a + (s.n95    || 0), 0);
  const todayMoney = todayD * cfg.prices.diesel + today91 * cfg.prices.n91 + today95 * cfg.prices.n95;

  const ystD   = yesterday.reduce((a, s) => a + (s.diesel || 0), 0);
  const yst91  = yesterday.reduce((a, s) => a + (s.n91    || 0), 0);
  const yst95  = yesterday.reduce((a, s) => a + (s.n95    || 0), 0);
  const ystMoney = ystD * cfg.prices.diesel + yst91 * cfg.prices.n91 + yst95 * cfg.prices.n95;
  const pctChg = ystMoney > 0 ? ((todayMoney - ystMoney) / ystMoney * 100) : 0;
  const pctLine = ystMoney > 0
    ? `\n📈 مقارنة بأمس: ${pctChg >= 0 ? '+' : ''}${pctChg.toFixed(1)}% (${fmt(ystMoney,2)} ر.س)`
    : '';

  const stock = cfg.currentStock;
  const avg   = getAvgConsumption(7);
  const now   = new Date();
  const dateStr = `${now.getDate()}/${now.getMonth()+1}/${now.getFullYear()}`;

  const shiftSummary = last24.map(s => {
    const sName = cfg.shifts.find(x => x.abbr === s.shiftType)?.name || s.shiftType;
    return `  • ${sName}: ديزل ${fmt(s.diesel)}ل | بنزين 91: ${fmt(s.n91)}ل | بنزين 95: ${fmt(s.n95)}ل | ${fmt(s.totalMoney,2)} ر.س`;
  }).join('\n');

  const daysD   = avg.diesel > 0 ? (stock.diesel / avg.diesel).toFixed(1) : '∞';
  const days91  = avg.n91    > 0 ? (stock.n91    / avg.n91   ).toFixed(1) : '∞';
  const days95  = avg.n95    > 0 ? (stock.n95    / avg.n95   ).toFixed(1) : '∞';

  const text = `📊 ملخص استهلاك اليوم — ${dateStr}
🏢 ${cfg.stationName}
━━━━━━━━━━━━━━━━━━━━
⛽ الاستهلاك:
  • ⬛ ديزل: ${fmt(todayD)} لتر (${fmt(todayD*cfg.prices.diesel,2)} ر.س)
  • 🟢 بنزين 91: ${fmt(today91)} لتر (${fmt(today91*cfg.prices.n91,2)} ر.س)
  • 🔴 بنزين 95: ${fmt(today95)} لتر (${fmt(today95*cfg.prices.n95,2)} ر.س)
━━━━━━━━━━━━━━━━━━━━
💰 الإجمالي: ${fmt(todayMoney,2)} ر.س${pctLine}
━━━━━━━━━━━━━━━━━━━━
📋 تفاصيل الورديات:
${shiftSummary || '  لا توجد ورديات'}
━━━━━━━━━━━━━━━━━━━━
🛢️ المخزون المتبقي:
  • ⬛ ديزل: ${fmt(stock.diesel)} لتر (يكفي ${daysD} يوم)
  • 🟢 بنزين 91: ${fmt(stock.n91)} لتر (يكفي ${days91} يوم)
  • 🔴 بنزين 95: ${fmt(stock.n95)} لتر (يكفي ${days95} يوم)`;

  navigator.clipboard.writeText(text).then(() => {
    const btn = document.querySelector('[onclick="copySummary()"]');
    if (btn) { btn.textContent = '✅ تم النسخ!'; setTimeout(() => btn.innerHTML = '📋 نسخ ملخص اليوم للواتساب', 2000); }
    _showToast('✅ تم نسخ الملخص للواتساب', 'success', 2000);
  }).catch(() => _showCopyFallbackModal(text));
}

// ===========================
// [v12] مشاركة آخر وردية عبر واتساب (زر الصفحة الرئيسية)
// ===========================
function shareLastShiftWhatsApp() {
  const lastShift = [...DB.shifts].sort((a, b) => (b.id || 0) - (a.id || 0))[0];
  if (!lastShift) { _showToast('⚠️ لا توجد ورديات مسجّلة بعد', 'warning'); return; }
  shareShiftImage(null, lastShift.id, null);
}

// ===========================
// FEATURE 14: EXPORT CSV
// ===========================
// ✅ [FIX v9] دالة csvEscape - تدعم الفواصل والاقتباسات والأسطر الجديدة
function csvEscape(val) {
  if (val === null || val === undefined) return '';
  const str = String(val);
  // إذا احتوى على فاصلة أو اقتباس أو سطر جديد — نلفّه بعلامات اقتباس
  if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function exportReportCSV() {
  const type = document.getElementById('rep_type').value;
  const today = new Date().toISOString().split('T')[0];
  let fromDate, toDate;
  if (type === 'today') { fromDate = toDate = today; }
  else if (type === 'week') {
    // ✅ [FIX v9] 7 أيام فعلية
    const d = new Date(); d.setDate(d.getDate() - 6);
    fromDate = d.toISOString().split('T')[0]; toDate = today;
  } else if (type === 'month') {
    fromDate = getMonthStartDate(); toDate = today;
  } else {
    fromDate = document.getElementById('rep_from').value;
    toDate = document.getElementById('rep_to').value;
  }
  if (!fromDate || !toDate) { alert('⚠️ يرجى تحديد الفترة أولاً'); return; }

  const cfg = DB.config;
  const filtered = DB.shifts.filter(s => s.date >= fromDate && s.date <= toDate && s.type !== 'audit');
  if (filtered.length === 0) { alert('⚠️ لا توجد بيانات لهذه الفترة'); return; }

  const BOM = '\uFEFF';
  const headers = ['التاريخ','الوردية','ديزل (لتر)','91 (لتر)','95 (لتر)','الإجمالي (ر.س)','شبكة (ر.س)','فواتير (ر.س)','توريد (ر.س)','نقدية (ر.س)'];
  const rows = filtered.map(s => {
    const shiftName = cfg.shifts.find(x => x.abbr === s.shiftType)?.name || s.shiftType;
    // ✅ [FIX v9] استخدام csvEscape لكل حقل
    return [
      csvEscape(s.date), csvEscape(shiftName),
      csvEscape(s.diesel||0), csvEscape(s.n91||0), csvEscape(s.n95||0),
      csvEscape((s.totalMoney||0).toFixed(2)),
      csvEscape((s.network||0).toFixed(2)),
      csvEscape((s.invoices||0).toFixed(2)),
      csvEscape((s.supplied||0).toFixed(2)),
      csvEscape((s.cash||0).toFixed(2))
    ].join(',');
  });

  // Totals row
  const tD = filtered.reduce((a,s) => a+(s.diesel||0),0);
  const t91 = filtered.reduce((a,s) => a+(s.n91||0),0);
  const t95 = filtered.reduce((a,s) => a+(s.n95||0),0);
  const tM = filtered.reduce((a,s) => a+(s.totalMoney||0),0);
  const tN = filtered.reduce((a,s) => a+(s.network||0),0);
  const tI = filtered.reduce((a,s) => a+(s.invoices||0),0);
  const tS = filtered.reduce((a,s) => a+(s.supplied||0),0);
  const tC = filtered.reduce((a,s) => a+(s.cash||0),0);
  rows.push(`المجموع,,${tD},${t91},${t95},${tM.toFixed(2)},${tN.toFixed(2)},${tI.toFixed(2)},${tS.toFixed(2)},${tC.toFixed(2)}`);

  const csv = BOM + [headers.join(','), ...rows].join('\n');
  const blob = new Blob([csv], {type:'text/csv;charset=utf-8;'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `تقرير_${cfg.stationName}_${fromDate}_${toDate}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ===========================
// FEATURE 15: OWNER DASHBOARD
// ===========================
// ✅ [NEW v9] تحليل أداء الموظفين
function renderEmployeePerformance() {
  if (!DB.shifts || DB.shifts.length === 0) return '<div class="alert alert-info">لا توجد بيانات ورديات بعد</div>';
  const cfg = DB.config;
  const empStats = {};
  DB.shifts.filter(s => s.type !== 'audit').forEach(s => {
    const key = s.employeeName || s.employee || 'غير محدد';
    if (!empStats[key]) empStats[key] = { shifts: 0, totalMoney: 0, diesel: 0, n91: 0, n95: 0, supplied: 0, network: 0 };
    empStats[key].shifts++;
    empStats[key].totalMoney += s.totalMoney || 0;
    empStats[key].diesel     += s.diesel     || 0;
    empStats[key].n91        += s.n91        || 0;
    empStats[key].n95        += s.n95        || 0;
    empStats[key].supplied   += s.supplied   || 0;
    empStats[key].network    += s.network    || 0;
  });
  const shiftsPerDay = parseInt(cfg.shiftsPerDay || cfg.shifts?.length || 2);
  const sorted = Object.entries(empStats).sort((a, b) => b[1].totalMoney - a[1].totalMoney);
  let html = '<div class="card"><div class="card-header"><span class="card-title">👥 أداء الموظفين</span></div><div class="card-body" style="padding:0">';
  sorted.forEach(([name, st], i) => {
    const avgMoney = st.shifts > 0 ? st.totalMoney / st.shifts : 0;
    const workDays = Math.ceil(st.shifts / shiftsPerDay);
    html += `<div style="padding:10px 14px;border-bottom:1px solid var(--gray-200)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
        <span style="font-weight:800;font-size:13px">${i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i+1}`} ${name}</span>
        <span style="font-weight:800;color:var(--gold-dark);font-size:13px">${fmt(st.totalMoney,2)} ر.س</span>
      </div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:4px;font-size:11px;color:var(--gray-500)">
        <div>📋 الورديات: <strong style="color:var(--text-primary)">${st.shifts}</strong></div>
        <div>📅 الأيام: <strong style="color:var(--text-primary)">${workDays}</strong></div>
        <div>📊 المتوسط: <strong style="color:var(--text-primary)">${fmt(avgMoney,2)}</strong></div>
        <div>⬛ ديزل: <strong style="color:#D4AC0D">${fmt(st.diesel)}</strong></div>
        <div>🟢 91: <strong style="color:#27AE60">${fmt(st.n91)}</strong></div>
        <div>🔴 95: <strong style="color:var(--red)">${fmt(st.n95)}</strong></div>
      </div>
    </div>`;
  });
  html += '</div></div>';
  return html;
}

function renderDashboard() {
  if (!_canDo('dashboard')) return; // [FIX v10] مدير ومالك يريان Dashboard
  const cfg = DB.config;

  // Current month
  const mRange = getMonthRange();
  const today_d = new Date().toISOString().split('T')[0];
  const _mDay = new Date().getDate();
  const _mStart = cfg.monthStart || 1;
  const _mFrom = (_mDay >= _mStart)
    ? new Date(new Date().getFullYear(), new Date().getMonth(), _mStart)
    : new Date(new Date().getFullYear(), new Date().getMonth() - 1, _mStart);
  // ✅ [v17] إيراد الشهر الحالي = مجموع totalMoney الفعلي (بسعر كل وردية وقتها)
  // بدل (لترات × السعر الحالي)، الذي كان يُخطئ إن تغيّر السعر أثناء الشهر
  const mMoney = AccountingEngine.getReportTotals(_mFrom.toISOString().split('T')[0], today_d).totals.money;

  // Previous month
  const now = new Date();
  const ms = cfg.monthStart || 1;
  const day = now.getDate();
  let prevFrom, prevTo;
  if (day >= ms) {
    prevFrom = new Date(now.getFullYear(), now.getMonth()-1, ms).toISOString().split('T')[0];
    prevTo = new Date(now.getFullYear(), now.getMonth(), ms-1 < 1 ? 1 : ms-1).toISOString().split('T')[0];
  } else {
    prevFrom = new Date(now.getFullYear(), now.getMonth()-2, ms).toISOString().split('T')[0];
    prevTo = new Date(now.getFullYear(), now.getMonth()-1, ms-1 < 1 ? 1 : ms-1).toISOString().split('T')[0];
  }
  // ✅ [v17] نفس الإصلاح — إيراد الشهر الماضي الفعلي بسعره وقتها، لا بسعر اليوم
  const prevMoney = AccountingEngine.getReportTotals(prevFrom, prevTo).totals.money;

  const changePct = prevMoney > 0 ? (((mMoney - prevMoney) / prevMoney) * 100).toFixed(1) : null;
  const changeColor = changePct >= 0 ? '#27AE60' : 'var(--red)';
  const changeIcon = changePct >= 0 ? '📈' : '📉';

  // Employee stats
  const empStats = {};
  DB.shifts.filter(s => s.type !== 'audit').forEach(s => {
    const byEmail = s.enteredBy || 'غير محدد';
    if (!empStats[byEmail]) empStats[byEmail] = 0;
    empStats[byEmail]++;
  });
  const empRows = Object.entries(empStats).map(([e, cnt]) => {
    const u = _findUserByEmail(e);
    return `<div class="flex-between" style="padding:7px 0;border-bottom:1px solid var(--gray-100)">
      <span style="font-size:13px;font-weight:700">${u ? u.name : e}</span>
      <span class="badge" style="background:var(--red);color:white">${cnt} وردية</span>
    </div>`;
  }).join('') || '<div class="text-muted text-sm">لا توجد بيانات</div>';

  // Last 5 supplies
  const lastSupplies = [...DB.supply].reverse().slice(0,5);
  const supplyRows = lastSupplies.length > 0 ? lastSupplies.map(s => `
    <div class="flex-between" style="padding:7px 0;border-bottom:1px solid var(--gray-100);font-size:12.5px">
      <div><span class="badge badge-${s.type==='diesel'?'diesel':s.type==='91'?'91':'95'}" style="margin-left:6px">${s.type==='diesel'?'ديزل':s.type}</span>${formatDateShort(s.date)}</div>
      <strong>${fmt(s.qty)} لتر</strong>
    </div>`).join('') : '<div class="text-muted text-sm">لا توجد توريدات</div>';

  // System alerts
  const stock = cfg.currentStock;
  const minStock = cfg.minStock || 5000;
  const avg = getAvgConsumption(10);
  const alertLabels = {diesel:'ديزل', n91:'بنزين 91', n95:'بنزين 95'};
  let sysAlerts = '';
  ['diesel','n91','n95'].forEach(type => {
    const val = stock[type] || 0;
    const days = avg[type] > 0 ? (val / avg[type]).toFixed(1) : '∞';
    if (val <= 0) sysAlerts += `<div class="alert alert-danger" style="margin-bottom:6px">🚨 نفد مخزون ${alertLabels[type]}</div>`;
    else if (val < minStock) sysAlerts += `<div class="alert alert-danger" style="margin-bottom:6px">⚠️ مخزون ${alertLabels[type]} أقل من الحد (يكفي ${days} يوم)</div>`;
    else if (parseFloat(days) <= 3) sysAlerts += `<div class="alert alert-warning" style="margin-bottom:6px">⏳ ${alertLabels[type]} يكفي ${days} يوم فقط</div>`;
  });
  if (!sysAlerts) sysAlerts = '<div class="alert alert-success" style="margin-bottom:6px">✅ لا توجد تنبيهات حرجة</div>';

  // رسم الرسوم البيانية للوحة التحكم
  setTimeout(() => {
    const c1 = document.getElementById('dashConsumptionChart');
    const c2 = document.getElementById('dashRevenueChart');
    if (c1) { const tmpCanvas = document.getElementById('consumptionChart'); if (tmpCanvas) c1.getContext('2d').drawImage(tmpCanvas, 0, 0); else { document.getElementById('consumptionChart') || (document.body.insertAdjacentHTML('beforeend','<canvas id="consumptionChart" style="display:none" width="400" height="180"></canvas>')); renderConsumptionChart(); } }
  }, 100);

  // مقارنة شهرية
  const months3 = getMonthlyComparison();
  const compHTML = months3.map((m, i) => `
    <div class="comparison-cell ${i === 2 ? 'current' : ''}">
      <div style="font-size:12px;font-weight:700;color:var(--gray-700);margin-bottom:4px">${m.label}</div>
      <div style="font-size:15px;font-weight:800;color:var(--red)">${fmt(m.revenue, 0)} ر.س</div>
      <div style="font-size:11px;color:var(--gray-500)">${m.shifts} وردية</div>
    </div>`).join('');

  // ✅ [FIX v9] حساب KPI احترافية من البيانات الفعلية
  const allShiftsSorted = [...DB.shifts].sort((a, b) => (a.id || 0) - (b.id || 0));
  const shiftsPerDay_d = parseInt(cfg.shiftsPerDay || cfg.shifts?.length || 2);

  // أعلى/أقل يوم مبيعات
  const byDateRevenue = {};
  allShiftsSorted.forEach(s => {
    if (!byDateRevenue[s.date]) byDateRevenue[s.date] = 0;
    byDateRevenue[s.date] += s.totalMoney || 0;
  });
  const dateRevEntries = Object.entries(byDateRevenue);
  const maxRevDay = dateRevEntries.length > 0 ? dateRevEntries.reduce((a, b) => b[1] > a[1] ? b : a) : null;
  const minRevDay = dateRevEntries.length > 0 ? dateRevEntries.reduce((a, b) => b[1] < a[1] ? b : a) : null;
  const avgDayRevenue = dateRevEntries.length > 0 ? dateRevEntries.reduce((a, b) => a + b[1], 0) / dateRevEntries.length : 0;

  // نسبة كل منتج
  const totalLiters = (mRange.diesel + mRange.n91 + mRange.n95) || 1;
  const dieselPct = Math.round((mRange.diesel / totalLiters) * 100);
  const n91Pct    = Math.round((mRange.n91    / totalLiters) * 100);
  const n95Pct    = Math.round((mRange.n95    / totalLiters) * 100);
  const topProduct = dieselPct >= n91Pct && dieselPct >= n95Pct ? 'ديزل ⬛' :
                     n91Pct   >= dieselPct && n91Pct >= n95Pct  ? '91 🟢' : '95 🔴';

  // معدل نمو المبيعات (مقارنة بالشهر السابق)
  const growthPct = prevMoney > 0 ? (((mMoney - prevMoney) / prevMoney) * 100).toFixed(1) : null;
  const growthColor = growthPct >= 0 ? '#27AE60' : 'var(--red)';
  const growthIcon  = growthPct >= 0 ? '📈' : '📉';

  document.getElementById('dashboardContent').innerHTML = `
    <!-- KPI Cards -->
    <!-- [FIX v10] بطاقات اليوم والأسبوع والشهر -->
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:12px">
      <div class="stat-box" style="padding:10px;border-top:3px solid #C0392B">
        <div class="stat-label" style="font-size:10px;font-weight:800;color:#922B21">📅 اليوم</div>
        <div class="stat-value" style="font-size:16px;color:#922B21">${fmt(
          (() => { const td = new Date().toISOString().split('T')[0]; return DB.shifts.filter(s=>s.date===td&&s.type!=='audit').reduce((a,s)=>a+(s.totalMoney||0),0); })()
        , 0)} ر.س</div>
        <div style="font-size:10px;color:var(--gray-500);margin-top:2px">${
          DB.shifts.filter(s=>s.date===new Date().toISOString().split('T')[0]&&s.type!=='audit').length
        } ورديات</div>
      </div>
      <div class="stat-box" style="padding:10px;border-top:3px solid #1565C0">
        <div class="stat-label" style="font-size:10px;font-weight:800;color:#0D47A1">📆 الأسبوع</div>
        <div class="stat-value" style="font-size:16px;color:#0D47A1">${fmt(
          (() => { const d7 = new Date(); d7.setDate(d7.getDate()-7); const d7s = d7.toISOString().split('T')[0]; return DB.shifts.filter(s=>s.date>=d7s&&s.type!=='audit').reduce((a,s)=>a+(s.totalMoney||0),0); })()
        , 0)} ر.س</div>
        <div style="font-size:10px;color:var(--gray-500);margin-top:2px">آخر 7 أيام</div>
      </div>
      <div class="stat-box" style="padding:10px;border-top:3px solid #27AE60">
        <div class="stat-label" style="font-size:10px;font-weight:800;color:#145A32">🗓️ الشهر</div>
        <div class="stat-value" style="font-size:16px;color:#145A32">${fmt(mMoney, 0)} ر.س</div>
        <div style="font-size:10px;color:var(--gray-500);margin-top:2px">${mRange.diesel+mRange.n91+mRange.n95|0} لتر إجمالي</div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-bottom:12px">
      <div class="stat-box" style="padding:10px;border-top:3px solid var(--red)">
        <div class="stat-label">🏆 أعلى يوم مبيعات</div>
        <div class="stat-value" style="font-size:14px">${maxRevDay ? fmt(maxRevDay[1],0) + ' ر.س' : '—'}</div>
        <div class="stat-sub">${maxRevDay ? formatDateShort(maxRevDay[0]) : ''}</div>
      </div>
      <div class="stat-box" style="padding:10px;border-top:3px solid var(--gold)">
        <div class="stat-label">📉 أقل يوم مبيعات</div>
        <div class="stat-value" style="font-size:14px">${minRevDay ? fmt(minRevDay[1],0) + ' ر.س' : '—'}</div>
        <div class="stat-sub">${minRevDay ? formatDateShort(minRevDay[0]) : ''}</div>
      </div>
      <div class="stat-box" style="padding:10px;border-top:3px solid #27AE60">
        <div class="stat-label">📊 متوسط اليوم</div>
        <div class="stat-value" style="font-size:14px">${fmt(avgDayRevenue,0)} ر.س</div>
        <div class="stat-sub">${dateRevEntries.length} يوم عمل فعلي</div>
      </div>
      <div class="stat-box" style="padding:10px;border-top:3px solid #1565C0">
        <div class="stat-label">⭐ أكثر منتج مبيعاً</div>
        <div class="stat-value" style="font-size:14px">${topProduct}</div>
        <div class="stat-sub">${Math.max(dieselPct,n91Pct,n95Pct)}% من الاستهلاك</div>
      </div>
    </div>

    <!-- نسب المنتجات -->
    <div class="card" style="margin-bottom:12px">
      <div class="card-header"><span class="card-title">📊 نسبة كل منتج (الشهر الحالي)</span></div>
      <div class="card-body">
        <div style="margin-bottom:6px">
          <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:2px"><span>⬛ ديزل</span><span>${dieselPct}%</span></div>
          <div class="progress-bar-wrap"><div class="progress-bar" style="width:${dieselPct}%;background:#D4AC0D"></div></div>
        </div>
        <div style="margin-bottom:6px">
          <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:2px"><span>🟢 بنزين 91</span><span>${n91Pct}%</span></div>
          <div class="progress-bar-wrap"><div class="progress-bar" style="width:${n91Pct}%;background:#27AE60"></div></div>
        </div>
        <div>
          <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:2px"><span>🔴 بنزين 95</span><span>${n95Pct}%</span></div>
          <div class="progress-bar-wrap"><div class="progress-bar" style="width:${n95Pct}%;background:var(--red)"></div></div>
        </div>
      </div>
    </div>

    <div class="card" style="margin-bottom:12px">
      <div class="card-header"><span class="card-title">📅 مقارنة 3 أشهر</span></div>
      <div class="card-body">
        <div class="comparison-row">${compHTML}</div>
      </div>
    </div>

    <!-- Month Summary -->
    <div class="card" style="margin-bottom:12px">
      <div class="card-header"><span class="card-title">📅 ملخص الشهر الحالي</span></div>
      <div class="card-body">
        <div class="stats-grid mb-8">
          <div class="stat-box diesel"><div class="stat-label">ديزل</div><div class="stat-value">${fmt(mRange.diesel)}</div><div class="stat-sub">لتر</div></div>
          <div class="stat-box n91"><div class="stat-label">91</div><div class="stat-value">${fmt(mRange.n91)}</div><div class="stat-sub">لتر</div></div>
          <div class="stat-box n95"><div class="stat-label">95</div><div class="stat-value">${fmt(mRange.n95)}</div><div class="stat-sub">لتر</div></div>
        </div>
        <div class="totals-section">
          <div class="totals-grid">
            <div class="total-item"><div class="total-label">إجمالي الشهر</div><div class="total-value">${fmt(mMoney,2)} ر.س</div></div>
            ${growthPct !== null ? `<div class="total-item"><div class="total-label">مقارنة بالشهر السابق</div><div class="total-value" style="color:${growthColor}">${growthIcon} ${Math.abs(growthPct)}%</div></div>` : '<div class="total-item"><div class="total-label">الشهر السابق</div><div class="total-value">—</div></div>'}
          </div>
        </div>
        ${growthPct !== null ? `<div style="margin-top:8px;font-size:12px;color:var(--gray-500);text-align:center">الشهر السابق: ${fmt(prevMoney,2)} ر.س</div>` : ''}
      </div>
    </div>

    <!-- Employee Performance -->
    ${renderEmployeePerformance()}

    <!-- Last Supplies -->
    <div class="card" style="margin-bottom:12px">
      <div class="card-header"><span class="card-title">🚛 آخر التوريدات</span></div>
      <div class="card-body">${supplyRows}</div>
    </div>

    <!-- System Alerts -->
    <div class="card" style="margin-bottom:12px">
      <div class="card-header"><span class="card-title">🔔 تنبيهات النظام</span></div>
      <div class="card-body">${sysAlerts}</div>
    </div>

    <!-- [FIX v10] معلومات النظام -->
    <div class="card" style="margin-bottom:12px">
      <div class="card-header"><span class="card-title">ℹ️ معلومات النظام</span></div>
      <div class="card-body" style="font-size:12.5px">
        <div class="flex-between" style="padding:5px 0;border-bottom:1px solid var(--gray-200)">
          <span style="color:var(--gray-500)">عدد الموظفين</span>
          <strong>${Object.values(DB.users||{}).filter(u=>u.role!=='owner').length}</strong>
        </div>
        <div class="flex-between" style="padding:5px 0;border-bottom:1px solid var(--gray-200)">
          <span style="color:var(--gray-500)">عدد الورديات الكلي</span>
          <strong>${DB.shifts.length}</strong>
        </div>
        <div class="flex-between" style="padding:5px 0;border-bottom:1px solid var(--gray-200)">
          <span style="color:var(--gray-500)">الجهاز الحالي</span>
          <strong style="font-size:10.5px">${_DEVICE_ID.slice(-8)}</strong>
        </div>
        <div class="flex-between" style="padding:5px 0;border-bottom:1px solid var(--gray-200)">
          <span style="color:var(--gray-500)">آخر مزامنة</span>
          <strong id="dashLastSync">${_isOnline ? '🟢 متصل' : '🔴 غير متصل'}</strong>
        </div>
        <div class="flex-between" style="padding:5px 0">
          <span style="color:var(--gray-500)">إصدار التطبيق</span>
          <strong>v${APP_VERSION}</strong>
        </div>
      </div>
    </div>
  `;
}

// [v12] دالة عرض قسم الجرد في لوحة التحكم
function _renderDashboardAuditSection() {
  const el = document.getElementById('dashAuditContent');
  if (!el) return;
  const result = _calcSinceLastAudit();
  const cfg = DB.config;

  if (result.shiftsAfterAudit.length === 0 && !result.lastAudit) {
    el.innerHTML = '<div class="alert alert-info" style="font-size:12px">لم يتم تسجيل أي جرد أو ورديات بعد</div>';
    return;
  }

  const auditDateStr = result.lastAudit
    ? `${result.lastAudit.date} ${result.lastAudit.time || ''}`
    : 'بداية التشغيل';
  const diffColor = result.lastAudit?.auditDiff === 0 ? '#27AE60' : result.lastAudit?.auditDiff > 0 ? '#27AE60' : '#E74C3C';
  const diffLabel = !result.lastAudit ? '—'
    : result.lastAudit.auditDiff === 0 ? 'مطابق'
    : result.lastAudit.auditDiff > 0 ? `فائض +${fmt(result.lastAudit.auditDiff,2)} ر.س`
    : `عجز ${fmt(result.lastAudit.auditDiff,2)} ر.س`;

  el.innerHTML = `
    <div style="font-size:11px;color:#2F4F4F;font-weight:700;margin-bottom:8px">
      📌 منذ جرد: <strong>${auditDateStr}</strong> | ${result.shiftsAfterAudit.length} وردية
    </div>

    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:10px">
      <div style="text-align:center;background:rgba(212,172,13,0.08);border:1px solid #F9E87A;border-radius:8px;padding:8px">
        <div style="font-size:9px;font-weight:800;color:#7D6608">⬛ ديزل</div>
        <div style="font-size:17px;font-weight:900;color:#5D4E00">${fmt(result.diesel)}</div>
        <div style="font-size:10px;color:#9A7D0A">${fmt(result.dieselRev,0)} ر.س</div>
      </div>
      <div style="text-align:center;background:rgba(39,174,96,0.08);border:1px solid #52BE80;border-radius:8px;padding:8px">
        <div style="font-size:9px;font-weight:800;color:#1E8449">🟢 بنزين 91</div>
        <div style="font-size:17px;font-weight:900;color:#1B5E20">${fmt(result.n91)}</div>
        <div style="font-size:10px;color:#27AE60">${fmt(result.n91Rev,0)} ر.س</div>
      </div>
      <div style="text-align:center;background:rgba(192,57,43,0.08);border:1px solid #E74C3C;border-radius:8px;padding:8px">
        <div style="font-size:9px;font-weight:800;color:#922B21">🔴 بنزين 95</div>
        <div style="font-size:17px;font-weight:900;color:#7B0000">${fmt(result.n95)}</div>
        <div style="font-size:10px;color:#C0392B">${fmt(result.n95Rev,0)} ر.س</div>
      </div>
    </div>

    <div style="background:linear-gradient(135deg,#1B2631,#2F4F4F);color:white;border-radius:8px;padding:10px;margin-bottom:10px;text-align:center">
      <div style="font-size:10px;opacity:0.8">💼 إجمالي الذمة المالية</div>
      <div style="font-size:22px;font-weight:900;color:#A9D5D5">${fmt(result.totalRevenue,2)} ر.س</div>
    </div>

    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-bottom:8px">
      <div style="background:#F5F5F5;border-radius:6px;padding:8px;text-align:center;border:1px solid #E0E0E0">
        <div style="font-size:9px;color:#555;font-weight:700">🌐 شبكة</div>
        <div style="font-size:14px;font-weight:800;color:#1565C0">${fmt(result.totalNetwork,0)} ر.س</div>
      </div>
      <div style="background:#F5F5F5;border-radius:6px;padding:8px;text-align:center;border:1px solid #E0E0E0">
        <div style="font-size:9px;color:#555;font-weight:700">📄 فواتير</div>
        <div style="font-size:14px;font-weight:800;color:#555">${fmt(result.totalInvoices,0)} ر.س</div>
      </div>
    </div>

    <div style="background:rgba(212,172,13,0.1);border:1.5px solid #F9E87A;border-radius:8px;padding:10px;text-align:center">
      <div style="font-size:10px;font-weight:700;color:#7D6608">💵 النقدية المتوقعة</div>
      <div style="font-size:20px;font-weight:900;color:#5D4E00">${fmt(result.expectedCash,2)} ر.س</div>
    </div>

    ${result.lastAudit ? `<div style="margin-top:8px;font-size:11px;font-weight:700;color:${diffColor};text-align:center;padding:6px;background:${result.lastAudit.auditDiff>=0?'rgba(39,174,96,0.08)':'rgba(192,57,43,0.08)'};border-radius:6px">آخر جرد: ${diffLabel}</div>` : ''}
  `;
}
function toggleDarkMode() {
  document.body.classList.toggle('dark-mode');
  const isDark = document.body.classList.contains('dark-mode');
  localStorage.setItem('darkMode', isDark ? '1' : '0');
  const btn = document.getElementById('darkToggleBtn');
  if (btn) btn.textContent = isDark ? '☀️' : '🌙';
  // [FIX v11] إعادة رسم بطاقات counter بعد تغيير الوضع
  if (typeof updateHomePage === 'function' && currentUser) {
    try { updateHomePage(); } catch(e) {}
  }
}
function initDarkMode() {
  const saved = localStorage.getItem('darkMode');
  if (saved === '1') {
    document.body.classList.add('dark-mode');
    const btn = document.getElementById('darkToggleBtn');
    if (btn) btn.textContent = '☀️';
  }
}

// ===========================
// FEATURE 20: ACTIVITY LOG
// ===========================
// [FIX v10] Audit Log احترافي مع deviceId والتغيير قبل وبعد
function logActivity(action, details, beforeAfter) {
  if (!DB.activityLog) DB.activityLog = [];
  const actionIcons = {
    shift_add:    '📝', shift_edit:    '✏️', shift_delete: '🗑️',
    supply_add:   '🚛', stock_adjust:  '⚖️', stock_supply: '⛽',
    login:        '🔐', logout:        '🚪', backup:       '💾',
    restore:      '🔄', user_add:      '👤', user_remove:  '🗑️',
    settings:     '⚙️', archive:       '📦', factory_reset:'🔄',
    counter_reset:'🔢', meter_delete:  '🗑️', report_export:'📊'
  };
  const entry = {
    id:         Date.now(),
    timestamp:  new Date().toISOString(),
    user:       currentUser?.name  || 'غير محدد',
    userEmail:  currentUser?.email || '',
    role:       currentUser?.role  || 'employee',
    action,
    icon:       actionIcons[action] || '📌',
    details,
    deviceId:   _DEVICE_ID,
    deviceType: navigator.userAgent.includes('Mobile') ? '📱 هاتف' : '🖥️ كمبيوتر'
  };
  // إضافة بيانات "قبل وبعد" إن وُجدت
  if (beforeAfter) {
    entry.before = beforeAfter.before;
    entry.after  = beforeAfter.after;
  }
  DB.activityLog.unshift(entry);
  if (DB.activityLog.length > 2000) DB.activityLog.length = 2000;
  saveDB();
}
function renderActivityLog() {
  const role = currentUser?.role;
  if (role !== 'owner' && role !== 'supervisor') return;
  const logs = DB.activityLog || [];
  if (logs.length === 0) {
    document.getElementById('activityLogContainer').innerHTML = '<div class="alert alert-info" style="margin:12px">لا توجد أنشطة مسجلة بعد</div>';
    return;
  }
  document.getElementById('activityLogContainer').innerHTML = logs.map(log => {
    const dt = new Date(log.timestamp);
    const dateStr = `${dt.getDate()}/${dt.getMonth()+1}/${dt.getFullYear()} ${dt.getHours().toString().padStart(2,'0')}:${dt.getMinutes().toString().padStart(2,'0')}`;
    const roleLabel = log.role==='owner' ? '👑' : log.role==='supervisor' ? '🔍' : '👤';
    const deviceStr = log.deviceId ? `<span style="font-size:10px;color:var(--gray-500)"> • ${log.deviceType||'جهاز'} (${log.deviceId.slice(-6)})</span>` : '';
    const beforeAfterHtml = (log.before !== undefined || log.after !== undefined) ? `
      <div style="font-size:10.5px;background:var(--gray-100);border-radius:6px;padding:4px 8px;margin-top:4px">
        ${log.before !== undefined ? `<span style="color:#C0392B">قبل: ${JSON.stringify(log.before)}</span>` : ''}
        ${log.after  !== undefined ? `<span style="color:#27AE60;margin-right:8px">بعد: ${JSON.stringify(log.after)}</span>` : ''}
      </div>` : '';
    return `<div class="activity-item">
      <div class="activity-icon">${log.icon||'📌'}</div>
      <div class="activity-detail">
        <span class="activity-user">${roleLabel} ${log.user}</span>
        <div class="activity-desc">${log.details}</div>
        ${beforeAfterHtml}
        <div class="activity-time">🕐 ${dateStr}${deviceStr}</div>
      </div>
    </div>`;
  }).join('');
}
