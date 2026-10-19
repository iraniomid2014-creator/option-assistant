/* ==========================================================================
   web-adapter.js — لایهٔ تطبیق «نسخهٔ وب» دستیار هوشمند آپشن
   --------------------------------------------------------------------------
   content.js (موتور اصلی) عیناً و بدون هیچ تغییری همان فایل اکستنشن است.
   این فایل فقط قبل از آن بارگذاری می‌شود و سه کار انجام می‌دهد:

   ۱) به‌روزرسانی خودکار
      • هنگام باز شدن صفحه، version.json (بدون کش) خوانده می‌شود؛ اگر نسخهٔ سرور
        با نسخهٔ این صفحه فرق داشت، صفحه یک‌بار خودکار تازه می‌شود.
      • وقتی صفحه باز است (هر ۶۰ ثانیه و هر بار که کاربر به تب برمی‌گردد) دوباره
        بررسی می‌شود؛ اگر نسخهٔ جدید آمده بود یک نوار کوچک «نسخهٔ جدید آماده است»
        نشان می‌دهد و کاربر هر وقت خواست (بدون از دست رفتن کار جاری) دکمه را می‌زند.

   ۲) سازگاری شبکه با مرورگر عادی
      • اکستنشن با host_permissions از CORS معاف بود؛ صفحهٔ وب نیست. هدرهای
        Cache-Control و Pragma (که درخواست را «غیرساده» می‌کنند و preflight می‌خواهند)
        فقط برای درخواست‌های tsetmc حذف می‌شوند؛ جلوگیری از کش با cache:'no-store'
        و پارامتر _t/_r که موتور خودش می‌فرستد همچنان برقرار است.
      • اگر درخواست‌ها هیچ‌وقت موفق نشوند، علتش (CORS یا قطع ارتباط) تشخیص داده
        و با یک پیام روشن نشان داده می‌شود؛ با اولین موفقیت، پیام خودکار محو می‌شود.

   ۳) shim بسیار کوچک chrome.runtime.getManifest() تا نسخه در پنل تشخیصی نمایش داده شود.
   ========================================================================== */
(function () {
  'use strict';
  if (window.__tsextWebAdapter) return;

  var root = document.documentElement;
  var BUILD = root.getAttribute('data-tsext-build') || '';
  var VERSION = root.getAttribute('data-tsext-version') || '';
  var TSE_HOST = /(^|\.)tsetmc\.com$/i;
  var CHECK_MS = 60000;
  var FAIL_STREAK_TO_DIAGNOSE = 3;

  var api = window.__tsextWebAdapter = {
    build: BUILD,
    version: VERSION,
    net: { ok: 0, fail: 0, streak: 0, http: 0, state: 'unknown' },
    update: { available: false, remoteBuild: '', remoteVersion: '', checks: 0, dismissedFor: '' },
  };

  /* ---------------------------------------------------------------- ۳) shim */
  try {
    var c = window.chrome;
    if (!c || typeof c !== 'object') { c = {}; window.chrome = c; }
    if (!c.runtime) c.runtime = {};
    if (typeof c.runtime.getManifest !== 'function') {
      c.runtime.getManifest = function () {
        return { manifest_version: 3, name: 'دستیار هوشمند آپشن', version: VERSION || '0.0.0' };
      };
    }
  } catch (e) {}

  /* --------------------------------------------------------------- UI نوارها */
  // ⚠ استایل‌ها عمداً «inline از طریق CSSOM» هستند، نه تگ <style> با متن:
  //   موتور اصلی همهٔ ارقام متن‌های صفحه را فارسی می‌کند و داخل متن یک <style> هم
  //   «14px» را «۱۴px» می‌کرد و کل استایل از کار می‌افتاد (در تست واقعی دیده شد).
  //   پنل اصلی با z-index حداکثر تمام صفحه را می‌پوشاند؛ پس نوارها در «لایهٔ بالا» (top layer)
  //   مرورگر (popover) نشان داده می‌شوند که هیچ z-index ای از آن بالاتر نمی‌رود؛
  //   در مرورگرهای قدیمی‌تر که popover ندارند، همان z-index حداکثر جایگزین است.
  var host = null;
  var banners = {};
  var FONT = 'Vazirmatn,Tahoma,Arial,sans-serif';
  var ST_HOST = {
    'position': 'fixed', 'inset': 'auto auto 14px 50%', 'transform': 'translateX(-50%)', 'z-index': '2147483647',
    'margin': '0', 'padding': '0', 'border': '0', 'background': 'transparent', 'overflow': 'visible',
    'width': 'max-content', 'max-width': 'min(94vw,640px)', 'flex-direction': 'column', 'gap': '8px',
    'align-items': 'center', 'pointer-events': 'none', 'font-family': FONT, 'direction': 'rtl'
  };
  var ST_BANNER = {
    'pointer-events': 'auto', 'display': 'flex', 'align-items': 'center', 'gap': '10px', 'flex-wrap': 'wrap',
    'justify-content': 'center', 'padding': '9px 14px', 'border-radius': '10px', 'font-size': '12.5px',
    'line-height': '1.8', 'font-weight': '700', 'color': '#f3f6fb', 'background': '#111a27',
    'border': '1px solid #2b3a52', 'box-shadow': '0 8px 28px rgba(0,0,0,.45)', 'font-family': FONT
  };
  var ST_BTN = {
    'font': 'inherit', 'font-weight': '900', 'cursor': 'pointer', 'color': '#fff', 'background': '#16a34a',
    'border': '0', 'border-radius': '8px', 'padding': '4px 12px'
  };
  var ST_GHOST = { 'background': 'transparent', 'color': '#9fb0c7', 'border': '1px solid #2b3a52' };
  var KIND_BORDER = { warn: '#f59e0b', info: '#22c55e' };
  function css(el, o) { for (var k in o) el.style.setProperty(k, o[k]); }

  function ensureHost() {
    if (host && host.isConnected) return host;
    if (!document.body) return null;
    host = document.getElementById('tsext-web-notices');
    if (!host) {
      host = document.createElement('div');
      host.id = 'tsext-web-notices';
      host.setAttribute('dir', 'rtl');
      host.setAttribute('role', 'status');
      if (typeof host.showPopover === 'function') host.setAttribute('popover', 'manual');
      css(host, ST_HOST);
      if (!host.hasAttribute('popover')) host.style.setProperty('display', 'flex');
      document.body.appendChild(host);
    }
    return host;
  }
  function popOpen() {
    if (host && host.hasAttribute('popover')) {
      try {
        if (!host.matches(':popover-open')) host.showPopover();
        host.style.setProperty('display', 'flex');
      } catch (e) {}
    }
  }
  function popClose() {
    if (host && host.hasAttribute('popover') && !host.children.length) {
      try { host.style.removeProperty('display'); if (host.matches(':popover-open')) host.hidePopover(); } catch (e) {}
    }
  }
  function showBanner(key, kind, text, buttons) {
    var h = ensureHost();
    if (!h) { document.addEventListener('DOMContentLoaded', function () { showBanner(key, kind, text, buttons); }, { once: true }); return; }
    var el = banners[key];
    if (!el) { el = document.createElement('div'); banners[key] = el; h.appendChild(el); }
    el.className = 'tsw ' + kind;
    css(el, ST_BANNER);
    el.style.setProperty('border-color', KIND_BORDER[kind] || '#2b3a52');
    el.textContent = '';
    var span = document.createElement('span');
    span.textContent = text;
    el.appendChild(span);
    (buttons || []).forEach(function (b) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = b.label;
      css(btn, ST_BTN);
      if (b.ghost) { btn.className = 'ghost'; css(btn, ST_GHOST); }
      btn.addEventListener('click', b.onClick);
      el.appendChild(btn);
    });
    popOpen();
  }
  function hideBanner(key) {
    var el = banners[key];
    if (el && el.parentNode) el.parentNode.removeChild(el);
    delete banners[key];
    popClose();
  }

  /* ----------------------------------------------------------------- ۲) شبکه */
  var origFetch = typeof window.fetch === 'function' ? window.fetch.bind(window) : null;
  var diagBusy = false;

  function isTse(input) {
    try {
      var u = typeof input === 'string' ? input : (input && input.url) || String(input);
      return TSE_HOST.test(new URL(u, location.href).hostname);
    } catch (e) { return false; }
  }
  function urlOf(input) {
    try { return typeof input === 'string' ? input : (input && input.url) || String(input); } catch (e) { return ''; }
  }
  // هدرهایی که درخواست را از «ساده» به «preflight‌دار» تبدیل می‌کنند
  var STRIP = { 'cache-control': 1, 'pragma': 1 };
  function cleanInit(init) {
    if (!init || !init.headers) return init;
    var out = {}, k;
    for (k in init) { if (Object.prototype.hasOwnProperty.call(init, k)) out[k] = init[k]; }
    var h = init.headers, nh = {};
    try {
      if (typeof Headers !== 'undefined' && h instanceof Headers) {
        h.forEach(function (v, n) { if (!STRIP[n.toLowerCase()]) nh[n] = v; });
      } else if (Array.isArray(h)) {
        h.forEach(function (p) { if (p && !STRIP[String(p[0]).toLowerCase()]) nh[p[0]] = p[1]; });
      } else {
        for (k in h) { if (Object.prototype.hasOwnProperty.call(h, k) && !STRIP[k.toLowerCase()]) nh[k] = h[k]; }
      }
    } catch (e) { return init; }
    out.headers = nh;
    return out;
  }

  function setNetState(s) {
    if (api.net.state === s) return;
    api.net.state = s;
    if (s === 'ok') { hideBanner('net'); return; }
    if (s === 'cors-blocked') {
      showBanner('net', 'warn',
        'مرورگر اجازهٔ دریافت مستقیم داده از tsetmc را به این صفحه نمی‌دهد (محدودیت CORS). با نصب یک‌بارهٔ «پل tsetmc» رفع می‌شود: فایل zip را استخراج کنید، در chrome://extensions حالت Developer را روشن و Load unpacked را بزنید، سپس صفحه را تازه کنید.',
        [{ label: 'دانلود پل tsetmc', onClick: function () { location.href = 'bridge/tsetmc-bridge.zip'; } }]);
    } else if (s === 'unreachable') {
      showBanner('net', 'warn',
        'ارتباط با tsetmc برقرار نمی‌شود — اینترنت یا دسترسی به tsetmc.com را بررسی کنید. با برقراری ارتباط خودکار ادامه می‌دهد.',
        []);
    }
  }
  function diagnose(url) {
    if (diagBusy || !origFetch) return;
    diagBusy = true;
    // no-cors: اگر سرور در دسترس باشد (حتی بدون هدر CORS) resolve می‌شود؛ اگر نشد یعنی اصلاً ارتباط نیست
    origFetch(url, { mode: 'no-cors', cache: 'no-store' }).then(
      function () { if (api.net.ok === 0) setNetState('cors-blocked'); },
      function () { if (api.net.ok === 0) setNetState('unreachable'); }
    ).then(function () { diagBusy = false; });
  }
  function noteOk(resp) {
    api.net.streak = 0;
    if (resp && resp.ok) { api.net.ok++; setNetState('ok'); } else { api.net.http++; }
  }
  function noteFail(url, err) {
    if (err && err.name === 'AbortError') return; // تایم‌اوتِ خودِ موتور؛ نه علامتِ CORS است نه قطعی
    api.net.fail++;
    api.net.streak++;
    if (api.net.ok === 0 && api.net.streak >= FAIL_STREAK_TO_DIAGNOSE) diagnose(url);
  }

  if (origFetch) {
    window.fetch = function (input, init) {
      if (!isTse(input)) return origFetch(input, init);
      var url = urlOf(input);
      var p;
      try { p = origFetch(input, cleanInit(init)); } catch (e) { noteFail(url, e); throw e; }
      return p.then(function (resp) { noteOk(resp); return resp; }, function (err) { noteFail(url, err); throw err; });
    };
  }

  /* ------------------------------------------------ گزارش خطای بوت (برای گوشی‌ها) */
  // اگر پنل تا ۸ ثانیه بالا نیامد، به‌جای صفحهٔ خالی علت و قابلیت‌های مرورگر روی صفحه نوشته می‌شود
  var bootErrors = [];
  window.addEventListener('error', function (e) { bootErrors.push(String(e && e.message || e).slice(0, 160)); });
  window.addEventListener('unhandledrejection', function (e) { bootErrors.push('promise: ' + String(e && e.reason).slice(0, 160)); });
  function feat() {
    var f = [];
    function t(name, fn) { var ok = false; try { ok = !!fn(); } catch (x) {} f.push(name + (ok ? '✓' : '✗')); }
    t('layer', function () { return window.CSS && CSS.supports && CSS.supports('@layer x{}') || (window.CSSLayerBlockRule); });
    t('has', function () { return CSS.supports('selector(:has(*))'); });
    t('color-mix', function () { return CSS.supports('color', 'color-mix(in srgb, red 50%, blue)'); });
    t('fetch', function () { return window.fetch; });
    return f.join(' ');
  }
  setTimeout(function () {
    if (document.getElementById('tsext-host')) return;
    var msg = 'پنل بالا نیامد. ' + (bootErrors.length ? 'خطا: ' + bootErrors.slice(0, 3).join(' | ') + ' — ' : '') + 'مرورگر: ' + feat() + ' — ' + (navigator.userAgent || '').slice(0, 110);
    showBanner('boot', 'warn', msg, []);
  }, 8000);

  /* ----------------------------------------------------- ۱) به‌روزرسانی خودکار */
  var RELOAD_KEY = 'tsext-web-reloaded-for';
  function ssGet(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } }
  function ssSet(k, v) { try { sessionStorage.setItem(k, v); } catch (e) {} }

  function reloadFresh() {
    var done = false;
    function go() { if (done) return; done = true; location.reload(); }
    try {
      // کش HTTP خودِ صفحه را هم تازه کن تا reload نسخهٔ قدیمی index.html را برنگرداند
      origFetch(location.href, { cache: 'reload' }).then(go, go);
      setTimeout(go, 2500);
    } catch (e) { go(); }
  }
  function fmtVer(j) { return j && j.version ? ' (' + j.version + ')' : ''; }

  function checkUpdate(isBoot) {
    if (!BUILD || !origFetch) return;
    origFetch('version.json?t=' + Date.now(), { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        api.update.checks++;
        if (!j || !j.build) return;
        api.update.remoteBuild = j.build;
        api.update.remoteVersion = j.version || '';
        if (j.build === BUILD) { api.update.available = false; hideBanner('update'); return; }
        api.update.available = true;
        // اولین باز شدن: هنوز کاری در صفحه نیست → بی‌صدا نسخهٔ جدید را بگیر (حداکثر یک‌بار برای هر نسخه)
        if (isBoot && ssGet(RELOAD_KEY) !== j.build) { ssSet(RELOAD_KEY, j.build); reloadFresh(); return; }
        if (api.update.dismissedFor === j.build) return;
        showBanner('update', 'info', 'نسخهٔ جدید دستیار' + fmtVer(j) + ' آماده است.', [
          { label: 'به‌روزرسانی', onClick: function () { reloadFresh(); } },
          { label: 'بعداً', ghost: true, onClick: function () { api.update.dismissedFor = j.build; hideBanner('update'); } },
        ]);
      })
      .catch(function (e) { try { console.warn('[web-adapter] update check failed:', e); } catch (_) {} });
  }

  checkUpdate(true);
  setInterval(function () { if (!document.hidden) checkUpdate(false); }, CHECK_MS);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) checkUpdate(false); });
  window.addEventListener('online', function () { checkUpdate(false); });
})();
