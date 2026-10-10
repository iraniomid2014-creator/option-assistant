/* mobile.js — موبایل: تنظیمات + فیلتر جمع‌شونده + چگالی فشرده + برگشت گوشی */
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
      var h = host();
      if (h) {
        h.classList.add('tsext-density-compact');
        h.setAttribute('data-density', 'compact');
      }
      var sel = document.getElementById('tsext-density');
      if (sel) {
        var opts = sel.options;
        for (var i = 0; i < opts.length; i++) {
          if ((opts[i].value || '') === 'compact' || /فشرده/i.test(opts[i].text || '')) {
            if (sel.value !== opts[i].value) {
              sel.value = opts[i].value;
              sel.dispatchEvent(new Event('change', { bubbles: true }));
            }
            break;
          }
        }
      }
    } catch (e) {}
  }

  function addTopButtons() {
    var h = host(), right = document.getElementById('pr-top-right');
    if (!h || !right) return false;
    var ok = true;

    if (!document.getElementById('m-filters-btn')) {
      var fb = document.createElement('button');
      fb.id = 'm-filters-btn';
      fb.type = 'button';
      fb.title = 'فیلتر و کلاس';
      fb.textContent = '☰';
      fb.setAttribute('aria-label', 'فیلتر و کلاس');
      fb.addEventListener('click', function () {
        var open = h.classList.toggle('m-filters-open');
        if (open) h.classList.remove('m-settings-open');
      });
      right.insertBefore(fb, right.firstChild);
    }

    if (!document.getElementById('m-settings-btn')) {
      var b = document.createElement('button');
      b.id = 'm-settings-btn';
      b.type = 'button';
      b.title = 'تنظیمات محاسبه';
      b.textContent = '⚙';
      b.setAttribute('aria-label', 'تنظیمات محاسبه');
      b.addEventListener('click', function () {
        var open = h.classList.toggle('m-settings-open');
        if (open) h.classList.remove('m-filters-open');
        if (isMobile()) setBodyScrollLock(open || h.classList.contains('tsext-with-ob'));
      });
      right.insertBefore(b, right.firstChild);
    }

    var tabs = document.getElementById('tsext-tabs');
    if (tabs && !tabs._mBound) {
      tabs._mBound = true;
      tabs.addEventListener('click', function () {
        h.classList.remove('m-settings-open');
        h.classList.remove('m-filters-open');
        if (isMobile()) setBodyScrollLock(h.classList.contains('tsext-with-ob'));
      });
    }
    return !!(document.getElementById('m-settings-btn') && document.getElementById('m-filters-btn'));
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
        if (!h3) return;
        if (h3.classList.contains('m-settings-open')) {
          h3.classList.remove('m-settings-open');
          setBodyScrollLock(h3.classList.contains('tsext-with-ob'));
        }
        if (h3.classList.contains('m-filters-open')) {
          h3.classList.remove('m-filters-open');
        }
      }
    });
  }

  if (mq.addEventListener) {
    mq.addEventListener('change', function () {
      if (!mq.matches) {
        var h = host();
        if (h) {
          h.classList.remove('m-settings-open');
          h.classList.remove('m-filters-open');
        }
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
    if (addTopButtons() && host()) {
      clearInterval(t);
      watchPanels();
      forceCompactDensity();
      setTimeout(forceCompactDensity, 400);
      setTimeout(forceCompactDensity, 1200);
    } else if (tries > 120) {
      clearInterval(t);
    }
  }, 120);
})();
