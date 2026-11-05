/* touch-zoom.js — زوم دو‌انگشتی نرم و سریع در همهٔ بخش‌ها (لیست، جزئیات، تنظیمات، فیلترها، تیک‌سود و ...)
   بدون دکمه. حداقل = اندازهٔ پیش‌فرض (۱×)، حداکثر ۳×. اندازه در localStorage (کلید tsext_m_zoom) ذخیره می‌شود.

   روش (چرا قبلی روان نبود و این روان است):
   • قبلاً CSS zoom روی خودِ کانتینر می‌خورد؛ در شیت تنظیمات و پنل جزئیات (position:fixed با max-height / inset)
     این کار ابعاد و فاصلهٔ کانتینر را هم ضرب می‌کرد → شیت از صفحه بیرون می‌زد، اسکرول خراب می‌شد و بعد از رها کردن می‌پرید.
   • حالا CSS zoom فقط روی «فرزندان» کانتینر اعمال می‌شود؛ خودِ کانتینر (اندازه، موقعیت، اسکرول) دست‌نخورده می‌ماند.
   • حین حرکت انگشت‌ها فقط transform (GPU، بدون هیچ چیدمان مجدد) روی کانتینر اعمال می‌شود و بیرون از کادر اصلی برش (clip) می‌خورد
     تا دقیقاً همان چیزی دیده شود که بعد از رها کردن می‌ماند.
   • با برداشتن انگشت، زوم نهایی یک‌بار اعمال می‌شود و اسکرول طوری تنظیم می‌شود که نقطهٔ زیر انگشت‌ها همان‌جا بماند (بدون پرش).
   • هر ناحیهٔ اسکرول‌شونده‌ای که زیر انگشت‌ها باشد زوم می‌شود (نه فقط چهار بخش شناخته‌شده)؛ همه با یک اندازهٔ واحد. */
(function () {
  'use strict';
  if (window.__tsTouchZoom) return;
  var KEY = 'tsext_m_zoom', Z_MIN = 1, Z_MAX = 3;
  var MAX_W = 820; // بالاتر از این عرض (چیدمان دسکتاپ، ستون‌های هم‌تراز با سرستون) زوم لمسی خاموش است
  var touchCapable = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
  if (!touchCapable) return;
  window.__tsTouchZoom = true;

  var root = document.documentElement;
  var KNOWN = ['#tsext-list-body', '#tsext-obpanel-body', '#tsext-display-settings', '#tsext-head .tsext-strategy-panel'];
  var KNOWN_SEL = KNOWN.join(',');
  var zoomNow = 1;

  function enabled() { return (window.innerWidth || root.clientWidth) <= MAX_W; }
  function clampZ(z) { return Math.max(Z_MIN, Math.min(Z_MAX, z)); }
  function setZoom(z, persist) {
    zoomNow = z;
    root.style.setProperty('--m-zoom', String(Math.round(z * 1000) / 1000));
    root.classList.toggle('m-zoomed', z > 1.001);
    if (z <= 1.001) root.style.removeProperty('--tz-sheet-h'); // قفل ارتفاع شیت فقط وقتی زوم است
    if (persist) { try { localStorage.setItem(KEY, String(z)); } catch (e) {} }
  }

  /* ---- سرستون لیست: با اسکرول افقی لیست هم‌حرکت می‌شود ----
     --tz-w = عرض کل محتوای لیست، --tz-hx = جابه‌جایی افقی (= -scrollLeft). استایل مصرف‌کننده در mobile.css است. */
  var hdrRaf = 0, listBound = null;
  function hdrSync() {
    hdrRaf = 0;
    var list = document.getElementById('tsext-list-body'), hdr = document.getElementById('tsext-list-hdr');
    if (!list || !hdr) return;
    var sw = list.scrollWidth, cw = list.clientWidth;
    if (zoomNow > 1.001 && sw > cw + 1) {
      hdr.style.setProperty('--tz-w', sw + 'px');
      hdr.style.setProperty('--tz-hx', (-list.scrollLeft) + 'px');
      if (!hdr.hasAttribute('data-tz-h')) hdr.setAttribute('data-tz-h', '');
    } else if (hdr.hasAttribute('data-tz-h')) {
      hdr.removeAttribute('data-tz-h'); hdr.style.removeProperty('--tz-w'); hdr.style.removeProperty('--tz-hx');
    }
  }
  function hdrSchedule() { if (!hdrRaf) hdrRaf = requestAnimationFrame(hdrSync); }
  function bindList() {
    var list = document.getElementById('tsext-list-body');
    if (list && list !== listBound) { listBound = list; list.addEventListener('scroll', hdrSchedule, { passive: true }); hdrSchedule(); }
  }

  /* ---- استایل ---- */
  try {
    var st = document.createElement('style');
    st.id = 'tsext-touch-zoom-css';
    st.textContent =
      'html [data-tz]{touch-action:pan-x pan-y !important;overflow-anchor:none !important}' +
      'html [data-tz] > *:not(.m-sheet-head){zoom:var(--m-zoom,1)}';
    (document.head || root).appendChild(st);
  } catch (e) {}

  function mark(el) { if (el && el.nodeType === 1 && !el.hasAttribute('data-tz')) el.setAttribute('data-tz', ''); }
  function markKnown() { try { var l = document.querySelectorAll(KNOWN_SEL); for (var i = 0; i < l.length; i++) mark(l[i]); bindList(); } catch (e) {} }

  /* ---- بازیابی اندازهٔ ذخیره‌شده ---- */
  try { var sv = parseFloat(localStorage.getItem(KEY)); if (sv && isFinite(sv)) setZoom(clampZ(sv), false); } catch (e) {}
  var n = 0, iv = setInterval(function () { markKnown(); if (++n > 60) clearInterval(iv); }, 500);
  markKnown();

  /* ---- پیدا کردن ناحیهٔ اسکرول زیر انگشت‌ها ---- */
  function findScroller(el) {
    if (!el || !el.closest) return null;
    var k = el.closest(KNOWN_SEL);
    if (k) return k;
    for (var e = el; e && e !== document.body && e !== root; e = e.parentElement) {
      if (e.hasAttribute && e.hasAttribute('data-tz')) return e;
      var cs = getComputedStyle(e);
      var oy = cs.overflowY, ox = cs.overflowX;
      if (((oy === 'auto' || oy === 'scroll') && e.scrollHeight > e.clientHeight + 2) || ((ox === 'auto' || ox === 'scroll') && e.scrollWidth > e.clientWidth + 2)) return e;
    }
    return null;
  }

  /* ---- ژست ---- */
  var S = null, active = false, raf = 0;
  var d0 = 0, z0 = 1, zLive = 1, ox = 0, oy = 0, mx = 0, my = 0;
  var beginH = 0, isSheet = false, anchor = null, afx = 0, afy = 0, oldClip = '', R = null, oxl = 0, oyl = 0, oldWC = '', oldTO = '', oldTl = '', oldSc = '';
  function dist(t) { var dx = t[0].clientX - t[1].clientX, dy = t[0].clientY - t[1].clientY; return Math.sqrt(dx * dx + dy * dy); }

  function paint() {
    raf = 0;
    if (!S || !active) return;
    var k = zLive / z0, tx = mx - ox, ty = my - oy;
    // از ویژگی‌های جدا (translate / scale) استفاده می‌شود، نه transform: انیمیشن‌های ورود پنل (tsextPanelIn با fill both)
    // و قوانین transform:none روی transform غلبه می‌کنند ولی روی translate/scale اثری ندارند.
    S.style.translate = tx.toFixed(1) + 'px ' + ty.toFixed(1) + 'px';
    S.style.scale = k.toFixed(4);
    // برش در مختصات خودِ کانتینر طوری که روی صفحه همان کادر اصلی بماند (چیزی روی نوار بالا/پایین نمی‌افتد)
    var L = oxl + (R.left - ox - tx) / k, Rr = oxl + (R.right - ox - tx) / k;
    var T = oyl + (R.top - oy - ty) / k, B = oyl + (R.bottom - oy - ty) / k;
    S.style.clipPath = 'inset(' + T.toFixed(1) + 'px ' + (R.width - Rr).toFixed(1) + 'px ' + (R.height - B).toFixed(1) + 'px ' + L.toFixed(1) + 'px)';
  }

  function begin(e) {
    var t = e.touches;
    ox = mx = (t[0].clientX + t[1].clientX) / 2;
    oy = my = (t[0].clientY + t[1].clientY) / 2;
    var under = document.elementFromPoint(ox, oy) || e.target;
    var sc = findScroller(under) || findScroller(e.target);
    if (!sc) { S = null; active = false; return; }
    mark(sc);
    S = sc; active = true;
    z0 = zoomNow; zLive = zoomNow; d0 = dist(t);
    var rS = S.getBoundingClientRect();
    // نقطهٔ لنگر: عنصر زیر انگشت‌ها، تا بعد از زوم همان نقطه زیر انگشت بماند
    anchor = null;
    if (under && under !== S && S.contains(under)) {
      var ra = under.getBoundingClientRect();
      if (ra.width > 0 && ra.height > 0) { anchor = under; afx = (ox - ra.left) / ra.width; afy = (oy - ra.top) / ra.height; }
    }
    beginH = rS.height;
    try { isSheet = S.matches('.tsext-strategy-panel') && getComputedStyle(S).position === 'fixed'; } catch (e) { isSheet = false; }
    R = rS; oxl = ox - rS.left; oyl = oy - rS.top; oldClip = S.style.clipPath;
    oldWC = S.style.willChange; oldTO = S.style.transformOrigin; oldTl = S.style.translate; oldSc = S.style.scale;
    S.style.transformOrigin = (ox - rS.left) + 'px ' + (oy - rS.top) + 'px';
    S.style.willChange = 'transform';
  }

  function finish() {
    if (!active) return;
    active = false;
    if (raf) { cancelAnimationFrame(raf); raf = 0; }
    var s = S; S = null;
    if (!s) return;
    var k = zLive / z0;
    var st0 = s.scrollTop, sl0 = s.scrollLeft;
    // پاک کردن transform و اعمال زوم نهایی در یک فریم (بدون چشمک)
    s.style.translate = oldTl; s.style.scale = oldSc; s.style.willChange = oldWC; s.style.transformOrigin = oldTO;
    s.style.clipPath = oldClip;
    if (Math.abs(k - 1) < 1e-3) {
      // فقط جابه‌جایی دو‌انگشتی
      s.scrollLeft = sl0 + (ox - mx); s.scrollTop = st0 + (oy - my);
      hdrSync();
      return;
    }
    // شیت تنظیمات (position:fixed با ارتفاع خودکار): ارتفاعش در لحظهٔ شروع زوم قفل می‌شود تا بعد از رها کردن انگشت قد نکشد؛
    // محتوای زوم‌شده داخل همان شیت اسکرول می‌شود. با برگشت به ۱× قفل برداشته می‌شود (--tz-sheet-h در mobile.css مصرف می‌شود).
    if (isSheet && zLive > 1.001 && !root.style.getPropertyValue('--tz-sheet-h')) root.style.setProperty('--tz-sheet-h', beginH + 'px');
    setZoom(zLive, true);
    var px, py, ok = false;
    if (anchor && anchor.isConnected && s.contains(anchor)) {
      var r2 = anchor.getBoundingClientRect();
      if (r2.width > 0 && r2.height > 0) { px = r2.left + afx * r2.width; py = r2.top + afy * r2.height; ok = true; }
    }
    if (ok) {
      s.scrollLeft = sl0 + (px - mx);
      s.scrollTop = st0 + (py - my);
    } else {
      // لنگر از بین رفته (رندر مجدد): تخمین با نسبت
      var rs = s.getBoundingClientRect();
      s.scrollTop = (st0 + (oy - rs.top)) * k - (my - rs.top);
      var rtl = getComputedStyle(s).direction === 'rtl';
      if (rtl) { var cxr = rs.right - ox, mxr = rs.right - mx; s.scrollLeft = -(((-sl0) + cxr) * k - mxr); }
      else s.scrollLeft = (sl0 + (ox - rs.left)) * k - (mx - rs.left);
    }
    anchor = null;
    hdrSync();
  }

  document.addEventListener('touchstart', function (e) {
    if (!enabled()) return;
    // با اولین انگشت، ناحیهٔ اسکرول علامت می‌خورد تا touch-action (pan-x pan-y) قبل از انگشت دوم اعمال شود
    // و مرورگر زوم خودش را شروع نکند (روی ناحیه‌هایی که از قبل شناخته‌شده نیستند هم).
    if (e.touches.length === 1) { try { mark(findScroller(e.target)); } catch (er) {} }
    if (e.touches.length === 2 && !active) begin(e);
    else if (e.touches.length > 2 && active) finish();
  }, { passive: true, capture: true });

  document.addEventListener('touchmove', function (e) {
    if (!active || !S) return;
    if (e.touches.length < 2) return;
    if (e.cancelable) e.preventDefault();
    if (d0 < 10) return;
    zLive = clampZ(z0 * (dist(e.touches) / d0));
    mx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
    my = (e.touches[0].clientY + e.touches[1].clientY) / 2;
    if (!raf) raf = requestAnimationFrame(paint);
  }, { passive: false, capture: true });

  function end(e) {
    if (!active) return;
    if (e.touches && e.touches.length >= 2) return;
    finish();
  }
  document.addEventListener('touchend', end, { passive: true, capture: true });
  document.addEventListener('touchcancel', end, { passive: true, capture: true });

  // iOS Safari: زوم خود مرورگر روی ناحیه‌های زوم‌پذیر
  ['gesturestart', 'gesturechange', 'gestureend'].forEach(function (nm) {
    document.addEventListener(nm, function (e) { if (enabled() && (active || (e.target && e.target.closest && e.target.closest('[data-tz]')))) e.preventDefault(); });
  });

  window.addEventListener('resize', function () { hdrSchedule(); if (!enabled()) { root.style.setProperty('--m-zoom', '1'); root.classList.remove('m-zoomed'); } else { try { var v = parseFloat(localStorage.getItem(KEY)); if (v) setZoom(clampZ(v), false); } catch (e) {} } });
})();
