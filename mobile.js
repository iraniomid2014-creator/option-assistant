/* mobile.js — لایهٔ موبایل فشرده
   - دکمه تنظیمات + برگشت گوشی
   - قفل اسکرول
   - فعال‌سازی خودکار حالت «فشرده» روی موبایل */
(function () {
  'use strict';
  var mq = window.matchMedia ? window.matchMedia('(max-width: 820px)') : { matches: false };
  function host() { return document.getElementById('tsext-host'); }
  function isMobile() { return mq.matches; }

  function setBodyScrollLock(lock) {
    try { document.documentElement.classList.toggle('m-panel-open', !!lock); } catch (e) {}
  }

  function forceCompactDensity() {
    if (!isMobile()) return;
    try {
      var sel = document.getElementById('tsext-density');
      if (sel && sel.value !== 'compact' && sel.value !== 'فشرده') {
        // try common values
        var opts = sel.options;
        for (var i = 0; i < opts.length; i++) {
          var v = (opts[i].value || '') + ' ' + (opts[i].text || '');
          if (/compact|فشرده/i.test(v)) {
            sel.value = opts[i].value;
            sel.dispatchEvent(new Event('change', { bubbles: true }));
            break;
          }
        }
      }
      document.documentElement.classList.add('tsext-density-compact');
      document.documentElement.setAttribute('data-density', 'compact');
      var h = host();
      if (h) {
        h.classList.add('tsext-density-compact');
        h.setAttribute('data-density', 'compact');
      }
    } catch (e) {}
  }

  function addSettingsBtn() {
    var h = host(), right = document.getElementById('pr-top-right');
    if (!h || !right || document.getElementById('m-settings-btn')) return !!document.getElementById('m-settings-btn');
    var b = document.createElement('button');
    b.id = 'm-settings-btn';
    b.type = 'button';
    b.title = 'تنظیمات محاسبه';
    b.textContent = '⚙';
    b.setAttribute('aria-label', 'تنظیمات محاسبه');
    b.addEventListener('click', function () {
      var open = h.classList.toggle('m-settings-open');
      if (isMobile()) setBodyScrollLock(open || h.classList.contains('tsext-with-ob'));
    });
    right.insertBefore(b, right.firstChild);

    var tabs = document.getElementById('tsext-tabs');
    if (tabs) {
      tabs.addEventListener('click', function () {
        h.classList.remove('m-settings-open');
        if (isMobile()) setBodyScrollLock(h.classList.contains('tsext-with-ob'));
      });
    }
    return true;
  }

  var obState = false;
  var settingsState = false;

  function watchPanels() {
    var h = host();
    if (!h) return;

    new MutationObserver(function () {
      if (!isMobile()) return;
      var withOb = h.classList.contains('tsext-with-ob');
      var withSettings = h.classList.contains('m-settings-open');

      if (withOb && !obState) {
        obState = true;
        try { history.pushState({ tsextOb: 1 }, ''); } catch (e) {}
      } else if (!withOb && obState) {
        obState = false;
        try { if (history.state && history.state.tsextOb) history.back(); } catch (e) {}
      }

      if (withSettings && !settingsState) {
        settingsState = true;
        try { history.pushState({ tsextSettings: 1 }, ''); } catch (e) {}
      } else if (!withSettings && settingsState) {
        settingsState = false;
        try { if (history.state && history.state.tsextSettings) history.back(); } catch (e) {}
      }

      setBodyScrollLock(withOb || withSettings);
    }).observe(h, { attributes: true, attributeFilter: ['class'] });

    window.addEventListener('popstate', function () {
      if (!isMobile()) return;
      var h2 = host();
      if (!h2) return;
      if (settingsState && h2.classList.contains('m-settings-open')) {
        settingsState = false;
        h2.classList.remove('m-settings-open');
        setBodyScrollLock(h2.classList.contains('tsext-with-ob'));
        return;
      }
      if (obState && h2.classList.contains('tsext-with-ob')) {
        obState = false;
        var c = document.getElementById('tsext-obpanel-close');
        if (c) c.click();
        setBodyScrollLock(false);
      }
    });

    window.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && isMobile()) {
        var h3 = host();
        if (h3 && h3.classList.contains('m-settings-open')) {
          h3.classList.remove('m-settings-open');
          setBodyScrollLock(h3.classList.contains('tsext-with-ob'));
        }
      }
    });
  }

  if (mq.addEventListener) {
    mq.addEventListener('change', function () {
      if (!mq.matches) {
        var h = host();
        if (h) h.classList.remove('m-settings-open');
        setBodyScrollLock(false);
        obState = false;
        settingsState = false;
      } else {
        forceCompactDensity();
      }
    });
  }

  var tries = 0, t = setInterval(function () {
    tries++;
    forceCompactDensity();
    if (addSettingsBtn() && host()) {
      clearInterval(t);
      watchPanels();
      forceCompactDensity();
      // retry a few times in case density select appears late
      setTimeout(forceCompactDensity, 500);
      setTimeout(forceCompactDensity, 1500);
    } else if (tries > 120) {
      clearInterval(t);
    }
  }, 120);
})();
