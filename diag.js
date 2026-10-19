(function () {
  var out = document.getElementById('out'), js = document.getElementById('js');
  js.className = 'ok'; js.textContent = '✓ جاوااسکریپت اجرا می‌شود';
  function line(ok, text) { var p = document.createElement('div'); p.className = ok ? 'ok' : 'bad'; p.textContent = (ok ? '✓ ' : '✗ ') + text; out.appendChild(p); }
  function t(name, fn) { var ok = false; try { ok = !!fn(); } catch (e) {} line(ok, name); }
  var ua = document.createElement('pre'); ua.textContent = navigator.userAgent; out.appendChild(ua);
  t('CSS @layer', function () { return window.CSSLayerBlockRule || CSS.supports('@layer x{}'); });
  t('CSS :has()', function () { return CSS.supports('selector(:has(*))'); });
  t('CSS color-mix', function () { return CSS.supports('color', 'color-mix(in srgb, red 50%, blue)'); });
  t('fetch', function () { return window.fetch; });
  t('AbortController', function () { return window.AbortController; });
  t('localStorage', function () { localStorage.setItem('t', '1'); return localStorage.getItem('t') === '1'; });
  t('MutationObserver', function () { return window.MutationObserver; });
  function load(url, label) {
    fetch(url + '?t=' + Date.now(), { cache: 'no-store' }).then(function (r) { return r.text().then(function (x) { line(r.ok, label + ' — کد ' + r.status + ' — ' + x.length + ' بایت'); }); })
      .catch(function (e) { line(false, label + ' — ' + e); });
  }
  load('index.html', 'index.html'); load('content.js', 'content.js'); load('web-adapter.js', 'web-adapter.js'); load('pro.css', 'pro.css'); load('mobile.css', 'mobile.css'); load('version.json', 'version.json');
  fetch('https://cdn.tsetmc.com/api/ClosingPrice/GetClosingPriceInfo/46348559193224090?t=' + Date.now())
    .then(function (r) { return r.json().then(function () { line(true, 'اتصال مستقیم به tsetmc — کد ' + r.status); }); })
    .catch(function (e) { line(false, 'اتصال مستقیم به tsetmc — ' + e); });
  // آیا خود اپ اجرا می‌شود؟ در iframe پنهان
  var f = document.createElement('iframe'); f.style.cssText = 'width:1px;height:1px;border:0;position:absolute;left:-9px';
  f.onload = function () { setTimeout(function () { var d; try { d = f.contentDocument; line(!!d.getElementById('tsext-host'), 'اپ اصلی در iframe بالا آمد'); line(!!(f.contentWindow.__tsextWebAdapter), 'لایهٔ تطبیق اجرا شد'); } catch (e) { line(false, 'iframe: ' + e); } }, 4000); };
  f.src = 'index.html'; document.body.appendChild(f);
  window.addEventListener('error', function (e) { line(false, 'خطا: ' + e.message); });
})();
