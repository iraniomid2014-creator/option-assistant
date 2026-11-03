(function () {
  "use strict";
  var o = false;
  function i(e) {
    try {
      var t = document.createElement("div");
      t.setAttribute("dir", "rtl");
      t.style.cssText =
        "margin:40px auto;max-width:520px;padding:24px;border:1px solid #7f1d1d;border-radius:12px;background:#1c0f0f;color:#fecaca;font:14px/2 Tahoma,sans-serif;text-align:center";
      t.textContent = e;
      document.body.appendChild(t);
    } catch {}
  }
  function showVersion() {
    try {
      var v = "";
      if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.getManifest) {
        v = chrome.runtime.getManifest().version || "";
      }
      if (!v) return;
      document.title = "دستیار هوشمند آپشن — v" + v;
      var badge = document.getElementById("tsext-version-badge");
      if (!badge) {
        badge = document.createElement("div");
        badge.id = "tsext-version-badge";
        badge.setAttribute("dir", "ltr");
        badge.style.cssText =
          "position:fixed;bottom:8px;left:10px;z-index:99999;font:11px/1.4 Vazirmatn,Tahoma,sans-serif;opacity:.55;pointer-events:none;user-select:none;color:inherit";
        badge.textContent = "v" + v;
        (document.body || document.documentElement).appendChild(badge);
      } else {
        badge.textContent = "v" + v;
      }
    } catch {}
  }
  function n() {
    if (!o) {
      o = true;
      try {
        var e = document.createElement("script");
        e.src = "content.js";
        e.async = false;
        e.onerror = function () {
          i(
            "موتور پنل (content.js) لود نشد — پوشهٔ افزونه ناقص است؛ دوباره نصب کنید."
          );
        };
        e.onload = function () {
          showVersion();
          setTimeout(showVersion, 500);
        };
        document.head.appendChild(e);
        setTimeout(function () {
          try {
            if (!window.__tsetmcOptionsLoaded && !window.__tsetmcInternals)
              i(
                "موتور پنل اجرا نشد — اکستنشن را یک‌بار Reload کنید (chrome://extensions) و صفحه را ببندید و دوباره باز کنید."
              );
          } catch {}
        }, 10000);
      } catch {}
    }
  }
  if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function")
    window.requestAnimationFrame(function () {
      window.requestIdleCallback(n, { timeout: 500 });
    });
  else if (
    document.readyState === "complete" ||
    document.readyState === "interactive"
  )
    setTimeout(n, 0);
  else window.addEventListener("DOMContentLoaded", function () {
    setTimeout(n, 0);
  });
})();
