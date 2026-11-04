/* mobile.js — موبایل: مثل نمونه improved + فشرده/کامل واقعی + نوار پایین */
(function () {
  'use strict';
  var mq = window.matchMedia ? window.matchMedia('(max-width: 820px)') : { matches: false };
  function host() { return document.getElementById('tsext-host'); }
  function isMobile() { return mq.matches; }
  function listEl() { return document.getElementById('tsext-list'); }
  function compactSelect() { return document.getElementById('tsext-compact-mode'); }

  function setBodyScrollLock(lock) {
    try { document.documentElement.classList.toggle('m-panel-open', !!lock); } catch (e) {}
  }

  function densifyBars(isCompact) {
    var body = document.getElementById('tsext-list-body');
    if (body) {
      var bars = body.querySelectorAll('.tsext-bar');
      for (var i = 0; i < bars.length; i++) {
        var bar = bars[i];
        var main = bar.querySelector('.tsext-bar-main') || bar;
        if (isCompact) {
          bar.style.setProperty('margin', '0 0 0 0', 'important');
          bar.style.setProperty('margin-bottom', '0', 'important');
          bar.style.setProperty('border-radius', '4px', 'important');
          main.style.setProperty('padding', '1px 4px', 'important');
          main.style.setProperty('row-gap', '0', 'important');
          main.style.setProperty('column-gap', '3px', 'important');
        } else {
          bar.style.removeProperty('margin');
          bar.style.removeProperty('margin-bottom');
          bar.style.removeProperty('border-radius');
          main.style.removeProperty('padding');
          main.style.removeProperty('row-gap');
          main.style.removeProperty('column-gap');
        }
      }
    }
    // فشرده روی همهٔ بخش‌ها
    var h = host();
    if (h) h.classList.toggle('m-dense', !!isCompact);
    try { document.documentElement.classList.toggle('m-dense', !!isCompact); } catch (e) {}
    try { document.body.classList.toggle('m-dense', !!isCompact); } catch (e) {}

    var topbar = document.getElementById('pr-topbar');
    if (topbar) {
      if (isCompact) {
        topbar.style.setProperty('height', '44px', 'important');
        topbar.style.setProperty('min-height', '44px', 'important');
        topbar.style.setProperty('max-height', '44px', 'important');
        topbar.style.setProperty('padding', '0 6px', 'important');
        topbar.style.setProperty('margin', '0', 'important');
      } else {
        topbar.style.setProperty('height', '54px', 'important');
        topbar.style.setProperty('min-height', '54px', 'important');
        topbar.style.setProperty('max-height', '54px', 'important');
        topbar.style.setProperty('padding', '0 8px', 'important');
        topbar.style.setProperty('margin', '0', 'important');
      }
    }
    document.querySelectorAll('#m-settings-btn, #m-filters-btn, #pr-digits-btn, #tsext-theme-cycle').forEach(function (btn) {
      if (isCompact) {
        btn.style.setProperty('min-height', '38px', 'important');
        btn.style.setProperty('height', '38px', 'important');
        btn.style.removeProperty('min-width');   /* عرض را CSS (clamp بر پایهٔ vw) تعیین می‌کند */
        btn.style.setProperty('font-size', '13px', 'important');
      } else {
        btn.style.setProperty('min-height', '44px', 'important');
        btn.style.setProperty('height', '44px', 'important');
        btn.style.setProperty('min-width', btn.id === 'tsext-theme-cycle' ? '64px' : btn.id === 'pr-digits-btn' ? '52px' : '44px', 'important');
        btn.style.setProperty('font-size', '14px', 'important');
      }
    });
    var status = document.getElementById('tsext-status') || document.getElementById('pr-status-text');
    if (status) {
      if (isCompact) {
        status.style.setProperty('font-size', '9px', 'important');
        status.style.setProperty('line-height', '14px', 'important');
        status.style.setProperty('padding', '0 4px', 'important');
      } else {
        status.style.removeProperty('font-size');
        status.style.removeProperty('line-height');
        status.style.removeProperty('padding');
      }
    }
    var listHdr = document.getElementById('tsext-list-hdr');
    if (listHdr) {
      if (isCompact) {
        listHdr.style.setProperty('padding', '0 4px', 'important');
        listHdr.style.setProperty('min-height', '13px', 'important');
        listHdr.style.setProperty('font-size', '9px', 'important');
      } else {
        listHdr.style.removeProperty('padding');
        listHdr.style.removeProperty('min-height');
        listHdr.style.removeProperty('font-size');
      }
    }
    try { document.documentElement.style.setProperty('--pr-top-h', (isCompact ? 44 : 54) + 'px'); } catch (e) {}
    // بازخوانی کروم دیدبان با اندازهٔ جدید
    try { forceWatchlistChrome(); } catch (e) {}
  }

  function applyCompactUI(isCompact) {
    var list = listEl();
    if (list) list.classList.toggle('tsext-compact', !!isCompact);
    var h = host();
    if (h) h.classList.toggle('m-dense', !!isCompact);
    try { document.documentElement.classList.toggle('m-dense', !!isCompact); } catch (e) {}
    try { document.body.classList.toggle('m-dense', !!isCompact); } catch (e) {}
    densifyBars(isCompact);
    try { forceWatchlistChrome(); } catch (e) {}
    try { forceMobileChrome(); } catch (e) {}
    var sel = compactSelect();
    if (sel) {
      var v = isCompact ? 'compact' : 'full';
      if (sel.value !== v) {
        sel.value = v;
        try { sel.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}
      }
    }
    try { localStorage.setItem('tsext_m_compact', isCompact ? '1' : '0'); } catch (e) {}
  }

  function isCompactNow() {
    /* موبایل: همیشه فشرده (گزینهٔ فشرده/کامل در موبایل حذف شده است) */
    if (isMobile()) return true;
    var list = listEl();
    if (list && list.classList.contains('tsext-compact')) return true;
    var sel = compactSelect();
    if (sel && sel.value) return sel.value === 'compact';
    try { return localStorage.getItem('tsext_m_compact') === '1'; } catch (e) {}
    return false;
  }

  function toggleCompact() {
    applyCompactUI(!isCompactNow());
  }

  function hideCompactChoice() {
    var sel = compactSelect();
    if (!sel) return;
    var lab = sel.closest ? sel.closest('label') : null;
    (lab || sel).style.setProperty('display', isMobile() ? 'none' : '', 'important');
    if (!isMobile()) (lab || sel).style.removeProperty('display');
  }

  function ensureCompactBtn() {
    hideCompactChoice();
    /* کلید سریع حذف شد — فقط همگام‌سازی select فیلترها */
    applyCompactUI(isCompactNow());
  }


  
  function watchListCompact() {
    var list = listEl();
    if (!list || list._mCompactObs) return;
    list._mCompactObs = true;
    var timer = null;
    function reapply() {
      if (!isMobile()) return;
      var sel = compactSelect();
      var want = sel ? sel.value === 'compact' : isCompactNow();
      list.classList.toggle('tsext-compact', want);
      var h = host();
      if (h) h.classList.toggle('m-dense', want);
      densifyBars(want);
    }
    new MutationObserver(function () {
      clearTimeout(timer);
      timer = setTimeout(reapply, 50);
    }).observe(list, { attributes: true, attributeFilter: ['class'], childList: true, subtree: true });
    var body = document.getElementById('tsext-list-body');
    if (body && !body._mCompactObs) {
      body._mCompactObs = true;
      new MutationObserver(function () {
        clearTimeout(timer);
        timer = setTimeout(reapply, 50);
      }).observe(body, { childList: true, subtree: true });
    }
  }

  function bindCompactSelect() {
    var sel = compactSelect();
    if (!sel || sel._mBound) return;
    sel._mBound = true;
    sel.addEventListener('change', function () {
      applyCompactUI(sel.value === 'compact');
    });
  }

  
  function closeSettings() {
    var h = host();
    if (!h) return;
    h.classList.remove('m-settings-open');
    setBodyScrollLock(h.classList.contains('tsext-with-ob'));
    var bd = document.getElementById('m-settings-backdrop');
    if (bd) bd.classList.remove('m-show');
    var bar = document.getElementById('m-settings-bar');
    if (bar) bar.classList.remove('m-show');
    forceMobileChrome();
  }

  
  function densifySettingsPanel(open) {
    document.querySelectorAll('#tsext-head .tsext-strategy-panel').forEach(function (panel) {
      if (!open || !panel.classList.contains('active')) return;
      panel.style.setProperty('padding', '8px 8px 16px', 'important');
      panel.querySelectorAll('input, select, .tsext-input').forEach(function (el) {
        el.style.setProperty('min-height', '30px', 'important');
        el.style.setProperty('font-size', '13px', 'important');
      });
      panel.querySelectorAll('label, .tsext-mini').forEach(function (el) {
        el.style.setProperty('font-size', '11px', 'important');
      });
    });
  }

  function ensureSettingsChrome() {
    if (!isMobile()) return;
    var h = host();
    if (!h) return;
    var open = h.classList.contains('m-settings-open');

    var bd = document.getElementById('m-settings-backdrop');
    if (!bd) {
      bd = document.createElement('div');
      bd.id = 'm-settings-backdrop';
      bd.addEventListener('click', function () { closeSettings(); });
      document.body.appendChild(bd);
    }

    var bar = document.getElementById('m-settings-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'm-settings-bar';
      bar.innerHTML =
        '<span class="m-settings-bar-title">تنظیمات محاسبه</span>' +
        '<button type="button" id="m-settings-close" aria-label="بازگشت به صفحه اصلی">بازگشت به صفحه اصلی</button>';
      document.body.appendChild(bar);
      document.getElementById('m-settings-close').addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        closeSettings();
      });
    }

    if (open) {
      bd.classList.add('m-show');
      bar.classList.add('m-show');
      densifySettingsPanel(true);
    } else {
      bd.classList.remove('m-show');
      bar.classList.remove('m-show');
    }
  }


  
  function forceWatchlistChrome() {
    if (!isMobile()) return;
    var input = document.getElementById('pr-wl-input');
    var btn = document.getElementById('pr-wl-add-btn');
    var bar = document.getElementById('pr-wlbar');
    var title = document.getElementById('pr-wl-title');
    var add = document.querySelector('#pr-watchlist .pr-wl-add');
    var wl = document.getElementById('pr-watchlist');
    var compact = !!(document.querySelector('#tsext-list.tsext-compact') || document.getElementById('tsext-host')?.classList.contains('m-dense'));
    /* عادی: ۳۰px — فشرده: ۲۶px (متناسب، نه باریک) */
    var h = compact ? 38 : 30;
    var fs = compact ? '13px' : '13px';
    var btnFs = compact ? '12.5px' : '12px';
    var btnMinW = compact ? '48px' : '54px';
    var padX = compact ? '8px' : '10px';
    var btnPadX = compact ? '10px' : '12px';
    var barH = compact ? 16 : 22;
    var titleFs = compact ? '11px' : '12px';
    if (wl) {
      wl.style.setProperty('padding', compact ? '0 3px' : '3px 6px', 'important');
      wl.style.setProperty('gap', compact ? '1px' : '4px', 'important');
      wl.style.setProperty('margin', '0', 'important');
      wl.style.setProperty('min-height', '0', 'important');
    }
    if (add) {
      add.style.setProperty('padding', compact ? '1px 3px' : '4px 6px', 'important');
      add.style.setProperty('gap', compact ? '4px' : '6px', 'important');
      add.style.setProperty('min-height', '0', 'important');
      add.style.setProperty('height', 'auto', 'important');
      add.style.setProperty('border-width', '1px', 'important');
    }
    if (input) {
      input.style.setProperty('height', h + 'px', 'important');
      input.style.setProperty('min-height', h + 'px', 'important');
      input.style.setProperty('max-height', h + 'px', 'important');
      input.style.setProperty('font-size', fs, 'important');
      input.style.setProperty('line-height', h + 'px', 'important');
      input.style.setProperty('padding', '0 ' + padX, 'important');
      input.style.setProperty('border-radius', compact ? '6px' : '8px', 'important');
    }
    if (btn) {
      btn.style.setProperty('height', h + 'px', 'important');
      btn.style.setProperty('min-height', h + 'px', 'important');
      btn.style.setProperty('max-height', h + 'px', 'important');
      btn.style.setProperty('min-width', btnMinW, 'important');
      btn.style.setProperty('font-size', btnFs, 'important');
      btn.style.setProperty('padding', '0 ' + btnPadX, 'important');
      btn.style.setProperty('line-height', '1', 'important');
      btn.style.setProperty('border-radius', compact ? '6px' : '8px', 'important');
    }
    if (bar) {
      bar.style.setProperty('height', barH + 'px', 'important');
      bar.style.setProperty('min-height', barH + 'px', 'important');
      bar.style.setProperty('max-height', barH + 'px', 'important');
      bar.style.setProperty('padding', '0 6px', 'important');
    }
    if (title) {
      title.style.setProperty('font-size', titleFs, 'important');
      title.style.setProperty('line-height', barH + 'px', 'important');
      title.style.setProperty('gap', '4px', 'important');
    }
    /* عدد کنار عنوان — هم‌اندازه متن */
    document.querySelectorAll('#pr-wl-title span, #pr-wlbar .pr-wl-count, #pr-wlbar [class*="count"], #pr-wl-count').forEach(function (el) {
      el.style.setProperty('font-size', titleFs, 'important');
      el.style.setProperty('line-height', barH + 'px', 'important');
    });
    if (title) {
      title.querySelectorAll('*').forEach(function (el) {
        el.style.setProperty('font-size', titleFs, 'important');
        el.style.setProperty('line-height', barH + 'px', 'important');
      });
    }
    document.querySelectorAll('#pr-wlbar .tsext-btn, #pr-wlbar button').forEach(function (b) {
      var bh = compact ? 18 : 24;
      b.style.setProperty('width', bh + 'px', 'important');
      b.style.setProperty('height', bh + 'px', 'important');
      b.style.setProperty('min-width', bh + 'px', 'important');
      b.style.setProperty('min-height', bh + 'px', 'important');
      b.style.setProperty('font-size', titleFs, 'important');
      b.style.setProperty('padding', '0', 'important');
    });
    /* چیپ‌های نماد: یک ردیف + اسکرول افقی */
    var chips = document.getElementById('pr-wl-chips');
    if (chips) {
      chips.style.setProperty('display', 'flex', 'important');
      chips.style.setProperty('flex-wrap', 'nowrap', 'important');
      chips.style.setProperty('overflow-x', 'auto', 'important');
      chips.style.setProperty('overflow-y', 'hidden', 'important');
      chips.style.setProperty('-webkit-overflow-scrolling', 'touch', 'important');
      chips.style.setProperty('max-width', '100%', 'important');
      chips.style.setProperty('min-width', '0', 'important');
      chips.style.setProperty('width', '100%', 'important');
      chips.style.setProperty('max-height', 'none', 'important');
      chips.style.setProperty('gap', '6px', 'important');
    }
    document.querySelectorAll('#pr-wl-chips .pr-wl-chip, .pr-wl-chip').forEach(function (c) {
      c.style.setProperty('flex-shrink', '0', 'important');
      c.style.setProperty('white-space', 'nowrap', 'important');
      c.style.setProperty('max-width', 'none', 'important');
    });
  }


  /* ===== شیت تنظیمات: سربرگ واضح + دکمهٔ ✕ + پس‌زمینهٔ تیره + کشیدن به پایین برای بستن ===== */
  function closeSettingsSheet() {
    var h = host();
    if (!h) return;
    h.classList.remove('m-settings-open');
    setBodyScrollLock(h.classList.contains('tsext-with-ob'));
    forceMobileChrome();
  }
  function ensureSheetBackdrop() {
    var ex = document.getElementById('m-sheet-backdrop');
    if (ex && host() && ex.parentNode !== host()) { host().appendChild(ex); return; }
    if (ex) return;
    var bd = document.createElement('div');
    bd.id = 'm-sheet-backdrop';
    bd.addEventListener('click', closeSettingsSheet);
    bd.addEventListener('touchmove', function (e) { if (e.cancelable) e.preventDefault(); }, { passive: false });
    (host() || document.body).appendChild(bd);
  }
  function ensureSheetHead(panel) {
    if (panel.querySelector(':scope > .m-sheet-head')) return;
    var head = document.createElement('div');
    head.className = 'm-sheet-head';
    head.innerHTML =
      '<span class="m-sheet-grip" aria-hidden="true"></span>' +
      '<span class="m-sheet-title"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>' +
      '<span>تنظیمات محاسبه</span><span class="m-sheet-title-sub"></span></span>' +
      '<button type="button" class="m-sheet-x" aria-label="بستن تنظیمات"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg><span>بستن</span></button>';
    panel.insertBefore(head, panel.firstChild);
    head.querySelector('.m-sheet-x').addEventListener('click', function (e) { e.preventDefault(); e.stopPropagation(); closeSettingsSheet(); });
    /* کشیدن سربرگ به پایین = بستن */
    var y0 = 0, dy = 0, drag = false, raf = 0;
    function paint() { raf = 0; panel.style.transform = dy > 0 ? 'translateY(' + dy + 'px)' : ''; }
    head.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1 || (e.target.closest && e.target.closest('.m-sheet-x'))) return;
      drag = true; y0 = e.touches[0].clientY; dy = 0; panel.style.transition = 'none';
    }, { passive: true });
    head.addEventListener('touchmove', function (e) {
      if (!drag) return;
      dy = Math.max(0, e.touches[0].clientY - y0);
      if (e.cancelable) e.preventDefault();
      if (!raf) raf = requestAnimationFrame(paint);
    }, { passive: false });
    function end() {
      if (!drag) return;
      drag = false;
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      panel.style.transition = 'transform .18s ease';
      if (dy > 70) { panel.style.transform = 'translateY(100%)'; setTimeout(function () { panel.style.transition = ''; panel.style.transform = ''; closeSettingsSheet(); }, 150); }
      else { panel.style.transform = ''; setTimeout(function () { panel.style.transition = ''; }, 200); }
      dy = 0;
    }
    head.addEventListener('touchend', end, { passive: true });
    head.addEventListener('touchcancel', end, { passive: true });
  }

  /* آیکن‌های SVG نوار تب (به‌جای کاراکترهای یونیکد که روی بعضی گوشی‌ها خالی دیده می‌شدند) */
  var TAB_ICONS = {
    pospanj: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z"/></svg>',
    combo:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h14"/><path d="M14 4l4 4-4 4"/><path d="M20 16H6"/><path d="M10 12l-4 4 4 4"/></svg>',
    jamp:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 17l6-6 4 4 6-8"/><path d="M15 7h5v5"/></svg>',
    tick:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2"/><path d="M9.5 2.5h5"/></svg>'
  };
  function ensureTabIcons(tabs) {
    Array.prototype.forEach.call(tabs.children, function (tab) {
      if (!tab.classList || !tab.classList.contains('tsext-tab')) return;
      if (tab.querySelector('.m-ico')) return;
      var key = tab.getAttribute('data-s') || '';
      var label = (tab.textContent || '').trim();
      var ico = document.createElement('span');
      ico.className = 'm-ico';
      ico.setAttribute('aria-hidden', 'true');
      ico.innerHTML = TAB_ICONS[key] || TAB_ICONS.pospanj;
      var lbl = document.createElement('span');
      lbl.className = 'm-lbl';
      lbl.textContent = label;
      tab.textContent = '';
      tab.appendChild(ico);
      tab.appendChild(lbl);
    });
    if (!tabs._mIcoObs && window.MutationObserver) {
      tabs._mIcoObs = true;
      var t = null;
      new MutationObserver(function () {
        clearTimeout(t);
        t = setTimeout(function () {
          if (!isMobile()) return;
          ensureTabIcons(tabs);
          Array.prototype.forEach.call(tabs.children, function (tab) {
            tab.setAttribute('aria-selected', tab.classList.contains('active') ? 'true' : 'false');
          });
        }, 30);
      }).observe(tabs, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    }
  }

  function forceMobileChrome() {
    if (!isMobile()) return;
    var tabs = document.getElementById('tsext-tabs');
    var denseNow = isCompactNow();
    var navH = denseNow ? 44 : 58;
    try { document.documentElement.style.setProperty('--m-nav-h', navH + 'px'); } catch (e) {}
    if (tabs) {
      /* ظاهر نوار تب را CSS (بلوک v1.2 در mobile.css) تعیین می‌کند؛ اینجا فقط ساختار: آیکن SVG + برچسب */
      ensureTabIcons(tabs);
      /* استایل‌های inline قدیمی را پاک کن تا CSS نهایی اعمال شود */
      ['position','left','right','bottom','top','z-index','display','flex-direction','width','height','min-height','max-height',
       'padding','margin','gap','box-sizing','border-radius'].forEach(function (k) { tabs.style.removeProperty(k); });
      tabs.style.setProperty('z-index', '2147483000', 'important');
      Array.prototype.forEach.call(tabs.children, function (tab) {
        ['flex','min-width','width','min-height','height','margin','padding','display','flex-direction','align-items',
         'justify-content','gap','font-size','line-height','box-shadow'].forEach(function (k) { tab.style.removeProperty(k); });
        if (!tab.hasAttribute('role')) tab.setAttribute('role', 'tab');
        tab.setAttribute('aria-selected', tab.classList.contains('active') ? 'true' : 'false');
      });
    }
    var h = host();
    if (h) {
      var compact = h.classList.contains('m-dense') || !!(document.querySelector('#tsext-list.tsext-compact'));
      /* فقط ارتفاع تب‌ها — بدون نوار مرده بالای وضعیت */
      h.style.setProperty('padding-bottom', 'calc(' + navH + 'px + env(safe-area-inset-bottom, 0px))', 'important');
    }
    var statusEl = document.getElementById('tsext-status');
    if (statusEl) {
      var compact2 = !!(document.getElementById('tsext-host') && document.getElementById('tsext-host').classList.contains('m-dense'))
        || !!(document.querySelector('#tsext-list.tsext-compact'));
      statusEl.style.setProperty('position', 'fixed', 'important');
      statusEl.style.setProperty('left', '0', 'important');
      statusEl.style.setProperty('right', '0', 'important');
      statusEl.style.setProperty('bottom', 'calc(' + navH + 'px + env(safe-area-inset-bottom, 0px))', 'important');
      statusEl.style.setProperty('top', 'auto', 'important');
      statusEl.style.setProperty('z-index', '2147482990', 'important');
      statusEl.style.setProperty('height', compact2 ? '16px' : '18px', 'important');
      statusEl.style.setProperty('min-height', compact2 ? '16px' : '18px', 'important');
      statusEl.style.setProperty('max-height', compact2 ? '16px' : '18px', 'important');
      statusEl.style.setProperty('display', 'flex', 'important');
      statusEl.style.setProperty('align-items', 'center', 'important');
      statusEl.style.setProperty('visibility', 'visible', 'important');
      statusEl.style.setProperty('opacity', '1', 'important');
      statusEl.style.setProperty('overflow', 'hidden', 'important');
      statusEl.style.setProperty('white-space', 'nowrap', 'important');
      statusEl.style.setProperty('font-size', compact2 ? '9.5px' : '10.5px', 'important');
      statusEl.style.setProperty('padding', '0 10px', 'important');
      statusEl.style.setProperty('margin', '0', 'important');
      statusEl.style.setProperty('border', 'none', 'important');
      statusEl.style.setProperty('border-top', 'none', 'important');
      statusEl.style.setProperty('border-radius', '0', 'important');
      statusEl.style.setProperty('box-shadow', 'none', 'important');
      statusEl.style.setProperty('background', 'transparent', 'important');
      statusEl.style.setProperty('background-image', 'none', 'important');
      statusEl.style.setProperty('backdrop-filter', 'none', 'important');
      statusEl.style.setProperty('box-sizing', 'border-box', 'important');
      statusEl.style.setProperty('pointer-events', 'none', 'important');
    }
    var listBody = document.getElementById('tsext-list-body');
    if (listBody) {
      var compact3 = !!(document.querySelector('#tsext-list.tsext-compact'));
      listBody.style.setProperty('padding-bottom', '4px', 'important');
    }
    var head = document.getElementById('tsext-head');
    if (head) {
      head.style.setProperty('height', '0', 'important');
      head.style.setProperty('min-height', '0', 'important');
      head.style.setProperty('max-height', '0', 'important');
      head.style.setProperty('overflow', 'visible', 'important');
    }
    var open = h && h.classList.contains('m-settings-open');
    /* شیت تنظیمات: ظاهر را CSS (بلوک v1.5) می‌دهد؛ اینجا فقط نمایش/پنهان + سربرگ + پس‌زمینهٔ تیره */
    document.querySelectorAll('#tsext-head .tsext-strategy-panel').forEach(function (panel) {
      ['position','left','right','top','bottom','inset','max-height','height','z-index','overflow-y','background','border-radius','padding'].forEach(function (k) { panel.style.removeProperty(k); });
      if (open && panel.classList.contains('active')) panel.style.setProperty('display', 'block', 'important');
      else panel.style.setProperty('display', 'none', 'important');
      ensureSheetHead(panel);
    });
    ensureSheetBackdrop();
    try {
      document.documentElement.classList.toggle('m-sheet-open', !!open);
      var sb = document.getElementById('m-settings-btn');
      if (sb) sb.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) {
        var at = document.querySelector('#tsext-tabs .tsext-tab.active .m-lbl, #tsext-tabs .tsext-tab.active');
        var ttl = document.querySelector('#tsext-head .tsext-strategy-panel.active .m-sheet-title-sub');
        if (ttl && at) ttl.textContent = (at.textContent || '').trim();
      }
    } catch (e) {}
    if (!document.getElementById('tsext-mobile-final')) {
      var link = document.querySelector('link[href*="mobile.css"]');
      if (link && link.href) {
        fetch(link.href).then(function (r) { return r.text(); }).then(function (css) {
          if (document.getElementById('tsext-mobile-final')) return;
          var st = document.createElement('style');
          st.id = 'tsext-mobile-final';
          st.textContent = css;
          document.documentElement.appendChild(st);
        }).catch(function () {});
      }
    }
  }

  function addTopButtons() {
    var h = host(), right = document.getElementById('pr-top-right');
    if (!h || !right) return false;

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
        forceMobileChrome();
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
        forceMobileChrome();
      });
      right.insertBefore(b, right.firstChild);
    }

    ensureCompactBtn();
    bindCompactSelect();
    watchListCompact();

    var tabs = document.getElementById('tsext-tabs');
    if (tabs && !tabs._mBound) {
      tabs._mBound = true;
      tabs.addEventListener('click', function () {
        h.classList.remove('m-settings-open');
        h.classList.remove('m-filters-open');
        if (isMobile()) setBodyScrollLock(h.classList.contains('tsext-with-ob'));
        forceMobileChrome();
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
      forceMobileChrome();
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
        forceMobileChrome();
        return;
      }
      if (obState && h2.classList.contains('tsext-with-ob')) {
        obState = false;
        var c = document.getElementById('tsext-obpanel-close');
        if (c) c.click();
        setBodyScrollLock(false);
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
      } else {
        forceMobileChrome();
        applyCompactUI(isCompactNow());
      }
    });
  }

  /* ===== زوم با دو انگشت (pinch) در همهٔ بخش‌ها: لیست، جزئیات، تنظیمات و فیلترها — بدون دکمه =====
     حداقل = اندازهٔ پیش‌فرض (۱×)، حداکثر ۲٫۲×. حین حرکت انگشت‌ها فقط transform (GPU، بدون چیدمان مجدد)
     اعمال می‌شود تا نرم و سریع باشد؛ با برداشتن انگشت، زوم نهایی یک‌بار اعمال می‌شود. اندازه ذخیره می‌شود. */
  var Z_MIN = 1, Z_MAX = 2.2, zoomNow = 1;
  var ZOOM_SEL = '#tsext-list-body, #tsext-obpanel-body, #tsext-display-settings, #tsext-head .tsext-strategy-panel';
  function clampZ(z) { return Math.max(Z_MIN, Math.min(Z_MAX, z)); }
  function setZoomVar(z) {
    zoomNow = z;
    var root = document.documentElement;
    root.style.setProperty('--m-zoom', String(Math.round(z * 1000) / 1000));
    root.classList.toggle('m-zoomed', z > 1.001);
  }
  function commitZoom(el, z0, z1, ax, ay) {
    var sl = el.scrollLeft, st = el.scrollTop;
    var r0 = el.getBoundingClientRect();
    var rtl = getComputedStyle(el).direction === 'rtl';
    el.style.transform = ''; el.style.willChange = ''; el.style.transformOrigin = '';
    setZoomVar(z1);
    var k = z1 / z0;
    if (Math.abs(k - 1) > 1e-4) {
      var cy = ay - r0.top;
      el.scrollTop = (st + cy) * k - cy;
      if (rtl) { var cxr = r0.right - ax; el.scrollLeft = -(((-sl) + cxr) * k - cxr); }
      else { var cx = ax - r0.left; el.scrollLeft = (sl + cx) * k - cx; }
    }
    try { localStorage.setItem('tsext_m_zoom', String(z1)); } catch (e) {}
  }
  function bindPinchZoom() {
    if (document._mPinch) return;
    document._mPinch = true;
    try { var saved = parseFloat(localStorage.getItem('tsext_m_zoom')); if (saved && isMobile()) setZoomVar(clampZ(saved)); } catch (e) {}
    var el = null, d0 = 0, z0 = 1, zLive = 1, ox = 0, oy = 0, raf = 0, active = false;
    function dist(t) { var dx = t[0].clientX - t[1].clientX, dy = t[0].clientY - t[1].clientY; return Math.sqrt(dx * dx + dy * dy); }
    function paint() {
      raf = 0;
      if (!el) return;
      el.style.transform = 'scale(' + (zLive / z0).toFixed(4) + ')';
    }
    document.addEventListener('touchstart', function (e) {
      if (!isMobile() || e.touches.length !== 2) return;
      var t = e.target && e.target.closest ? e.target.closest(ZOOM_SEL) : null;
      if (!t) { el = null; active = false; return; }
      el = t; active = true; z0 = zoomNow; zLive = zoomNow; d0 = dist(e.touches);
      ox = (e.touches[0].clientX + e.touches[1].clientX) / 2;
      oy = (e.touches[0].clientY + e.touches[1].clientY) / 2;
      var r = el.getBoundingClientRect();
      el.style.transformOrigin = (ox - r.left) + 'px ' + (oy - r.top) + 'px';
      el.style.willChange = 'transform';
    }, { passive: true, capture: true });
    document.addEventListener('touchmove', function (e) {
      if (!active || !el || e.touches.length !== 2) return;
      if (e.cancelable) e.preventDefault();
      if (d0 < 10) return;
      zLive = clampZ(z0 * (dist(e.touches) / d0));
      if (!raf) raf = requestAnimationFrame(paint);
    }, { passive: false, capture: true });
    function end(e) {
      if (!active) return;
      if (e.touches && e.touches.length >= 2) return;
      active = false;
      if (raf) { cancelAnimationFrame(raf); raf = 0; }
      var t = el; el = null;
      if (t) commitZoom(t, z0, zLive, ox, oy);
    }
    document.addEventListener('touchend', end, { passive: true, capture: true });
    document.addEventListener('touchcancel', end, { passive: true, capture: true });
    ['gesturestart', 'gesturechange', 'gestureend'].forEach(function (n) {
      document.addEventListener(n, function (e) { if (isMobile()) e.preventDefault(); });
    });
  }
  function syncZoomWithViewport() {
    if (!isMobile()) { document.documentElement.style.setProperty('--m-zoom', '1'); document.documentElement.classList.remove('m-zoomed'); }
    else { try { var sv = parseFloat(localStorage.getItem('tsext_m_zoom')); if (sv) setZoomVar(clampZ(sv)); } catch (e) {} }
  }
  if (mq.addEventListener) mq.addEventListener('change', syncZoomWithViewport);
  bindPinchZoom();

  var tries = 0;
  var t = setInterval(function () {
    tries++;
    forceMobileChrome();
    forceWatchlistChrome();
    if (addTopButtons() && host()) {
      applyCompactUI(isCompactNow());
      if (tries > 20) {
        clearInterval(t);
        watchPanels();
        forceMobileChrome();
      }
    } else if (tries > 120) {
      clearInterval(t);
    }
  }, 120);

  var tForce = setInterval(function () { forceMobileChrome(); }, 200);
  setTimeout(function () {
    clearInterval(tForce);
    setInterval(function () { forceMobileChrome(); }, 1500);
  }, 8000);
})();
