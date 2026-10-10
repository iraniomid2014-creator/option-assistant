// ===========================================================================
//  دستیار هوشمند آپشن TSETMC — بر اساس آموزش‌های بهاری
//  نسخه: 1.0.0
//
//  هدف: رصد لحظه‌ای بازار اختیار معامله روی tsetmc.
//  تنظیمات UI و نمادهای اخیر در localStorage می‌مانند؛ بقیهٔ ورودی‌ها و کش نشست با بستن پنل پاک می‌شوند.
//
//  استراتژی‌ها:
//    • مثبت‌پنج (Covered Call) — calcPosPanj / analyzeCoveredCallRow
//    • معاملات ترکیبی — calcCombo (خرید نزدیک‌سررسید + فروش سررسید بلندتر)
//    • جامپ — yield / downshift / upshift / challenge
//
//  ساختار ماژولار (بنرهای MODULE در بدنه):
//    [1] constants + state   [2] session storage   [3] helpers
//    [4] formulas            [5] theme + layout    [6] soft-update
//    [7] net / fetch         [8] render            [9] detail/orderbook
//    [10] ui bootstrap + cleanup
//
//  کلاس‌بندی: X نزدیک سهم · B ITM میانی · A ITM دور · −B OTM نزدیک · −A OTM دور
//  کارمزد فقط با ورود دستی کاربر (پیش‌فرض صفر).
//  ⚠ این فایل «خروجی build» است — دستی ویرایش نکنید. منبع حقیقت: پوشهٔ src/ ؛ بعد از هر ویرایش: cd tools && npm run assemble
// ===========================================================================
(() => {
  if (window.__tsetmcOptionsLoaded) return;
  window.__tsetmcOptionsLoaded = true;

  // ----- from src/01-constants-state.js -----
  // ========== MODULE [1] constants + state ==================================
  const KB = {
    DEFAULT_COMMISSION_PCT: 0, // تا وقتی کاربر دستی وارد نکند کارمزدی اعمال نمی‌شود
    MIN_NO_EXERCISE_PROFIT: 3,
    // این سه‌تا قبلاً پیش‌فرض آموزشی غیرصفر داشتند (۸/۱۸/۱۵) که در نبود ورودی کاربر بی‌صدا
    // اعمال می‌شد و حتی در جعبهٔ ورودی هم به‌صورت کم‌رنگ (placeholder) نشان داده می‌شد. طبق
    // درخواست صریح کاربر: هیچ عدد پیش‌فرضی — نه در محاسبه، نه در جعبه — نباید بی‌اطلاع او
    // اعمال شود؛ اگر خالی بماند، همیشه صفر است، و خودش باید عدد واقعی موردنظرش را تایپ کند.
    NEAR_EXPIRY_DAYS: 7,         // پنجره نزدیک‌سررسید برای برچسب‌گذاری هم‌زنجیره
    ARB_MAX_DAYS: 2,              // آربیتراژ سهم↔قرارداد: طبق متن رسمی سند («قراردادها در یکی از دو روز آخر سررسید هستند») حداکثر ۲ روز مانده — قبلاً این عدد اشتباهاً ۱۰ بود
    MIN_TICK_EQUIL_RIAL: 0,      // نقطه تعادل اسپرد تقویمی (سند: نمونه‌هایی بین ۱۲ تا ۲۲ ریال) — حتماً با رصد چندروزهٔ خودِ کاربر واردشود، وگرنه صفر (یعنی تب اسپرد تقویمی عملاً چیزی نشان نمی‌دهد تا این عدد را وارد کند)
    FIXED_INCOME_RATE_PCT: 0,    // درآمد ثابت: نرخ ماهانهٔ صندوق (سند: نمونهٔ ~۲٪) — ورودی کاربر؛ خالی = صفر و تب فرصتی نشان نمی‌دهد
    STOCK_SELL_COMM_PCT: 1,      // کارمزد تقریبی فروش سهم در آربیتراژ/درآمد ثابت (نمونهٔ سند ~۱٪) — فقط به‌عنوان راهنما، بی‌تایپِ کاربر اعمال نمی‌شود
    JAMP_COMMISSION_PCT: 0,      // فرصت‌های جامپ (هر چهار زیرحالت): سهم جابه‌جا نمی‌شود → کارمزد صفر، بدون فیلد ورودی (v1.25.1)
  };
  const ALL_CLASSES = ['A', 'B', 'X', '−B', '−A']; // طیف ریسک: کم ← نزدیک سهم (X وسط) ← زیاد
  const CHAIN_REFRESH_MS = 20000; // زنجیره — قیمت‌ها با تیک حیاتی/دیدنی می‌آیند // زنجیره کامل — سبک‌تر؛ قیمت‌ها با تیک حیاتی/دیدنی می‌آیند
  const CRIT_REFRESH_MS  = 120;  // تیک حیاتی پایه  // تیک حیاتی پایه (زنده‌تر)
  const CRIT_TURBO_MS    = 80;   // تیک حیاتی توربو  // تیک حیاتی در حالت توربو (پنل فعال / جزئیات باز)
  const CRIT_ADAPT_MS    = 240;  // Adaptive وقتی بازار ساکت است  // تیک حیاتی وقتی بازار ساکت است (Adaptive — هنوز نسبتاً تند)
  const VIS_REFRESH_MS   = 300;  // تیک ردیف‌های دیدنی  // تیک ردیف‌های دیدنی پایه
  const VIS_ADAPT_MS     = 550;  // تیک دیدنی در حالت ساکت
  const OB_REFRESH_MS    = 180;  // صف سفارشات جزئیات  // صف سفارشات جزئیات
  const CRIT_MAX_CODES   = 10;   // کد موازی در تیک حیاتی    // حداکثر کد موازی در تیک حیاتی
  const VIS_MAX_CODES    = 20;   // کد موازی در تیک دیدنی   // حداکثر کد موازی در تیک ردیف‌های دیدنی
  const ADAPT_STREAK     = 18;   // دیرتر Adaptive تا حس زنده حفظ شود   // دیرتر به Adaptive برو تا حس زنده بودن حفظ شود
  const SCHED_PULSE_MS   = 50;   // پالس زمان‌بند واحد — واکنش تندتر
  const NET_MICRO_TTL_MS = 45;   // کش هم‌زمان کوتاه‌تر → قیمت تازه‌تر   // کش هم‌زمان خیلی کوتاه تا قیمت کهنه نماند
  const MKT_CLOSED_FACTOR = 10;  // بازار بسته → فاصلهٔ همهٔ تیک‌ها ×۱۰ (داده عوض نمی‌شود)
  const MKT_PREOPEN_FACTOR = 1.5;// پیش‌گشایش → کمی آهسته‌تر (قبلاً ۲٫۵ بود)
  const NET_SOFT_SLOW_FROM = 3;  // از این تعداد شکست پیاپی، تیک‌ها کمی آهسته‌تر می‌شوند
  const NET_SOFT_SLOW_MAX = 2.0; // سقف ضریب آهسته‌سازی شبکه (ملایم)
  const MKT_CHAIN_MAX_MS = 5 * 60 * 1000; // سقف فاصلهٔ زنجیره وقتی بازار بسته است
  const FORCE_LIVE_MS    = 5 * 60 * 1000; // «زنده کن»: ۵ دقیقه رفرش کامل حتی وقتی ساعت می‌گوید بازار بسته است
  // تعطیلات رسمی بورس تهران (v1.24) — کلید: تاریخ میلادی به وقت تهران (YYYY-MM-DD)، مقدار: نام مناسبت.
  // منبع: تقویم رسمی ۱۴۰۵ (شورای مرکز تقویم مؤسسهٔ ژئوفیزیک) + ۲۲ بهمن و ۲۹ اسفند ۱۴۰۴.
  // مناسبت‌های «قمری» با رؤیت هلال ممکن است یک روز جابه‌جا شوند؛ به همین دلیل اگر در روزی که تعطیل
  // فرض شده معامله‌ای با تاریخ امروز (dEven) دیده شود، پنل خودکار به حالت زنده برمی‌گردد (tradedToday).
  // تعطیلات رسمی اضافه (عمدتاً قمری) — فقط تاریخ، بدون نام مناسبت.
  // تعطیلات شمسی ثابت + پنجشنبه/جمعه در منطق بازار محاسبه می‌شوند.
  const MARKET_HOLIDAY_DATES = new Set([
    '2026-02-11',
    '2026-03-20',
    '2026-03-21',
    '2026-03-22',
    '2026-03-23',
    '2026-03-24',
    '2026-04-01',
    '2026-04-02',
    '2026-04-14',
    '2026-05-27',
    '2026-06-04',
    '2026-06-05',
    '2026-06-24',
    '2026-06-25',
    '2026-08-04',
    '2026-08-12',
    '2026-08-13',
    '2026-08-21',
    '2026-08-30',
    '2026-11-13',
    '2026-12-23',
    '2027-01-06',
    '2027-01-24',
    '2027-02-11',
    '2027-02-28',
    '2027-03-10',
    '2027-03-11',
    '2027-03-20',
  ]);
  // سازگاری با کد قدیمی: شیء خالی نام‌ها (دیگر استفاده نمایشی ندارد)
  const MARKET_HOLIDAYS = Object.create(null);
  MARKET_HOLIDAY_DATES.forEach((d) => { MARKET_HOLIDAYS[d] = 'تعطیل رسمی'; });
  try { if (typeof window !== 'undefined') { window.__tsextHolidayNames = MARKET_HOLIDAYS; window.__tsextHolidays = Array.from(MARKET_HOLIDAY_DATES); } } catch (e) {}
  const TRADED_TODAY_TTL_MS = 15 * 60 * 1000; // «امروز معامله دیده شد» تا ۱۵ دقیقه معتبر است (بعدش دوباره از تقویم پیروی می‌کنیم)
  const ERR_LOG_MAX = 50; // دفترچهٔ خطاهای محلی: فقط ۵۰ مورد آخر، فقط در حافظه
  const AUTO_REFRESH_MS  = CHAIN_REFRESH_MS; // سازگاری با نام قبلی
  const SETTINGS_KEY = 'tsext-settings';
  const STRATS = ['pospanj', 'combo', 'jamp']; // هر تب صفحهٔ ورودی/فیلتر مخصوص خودش را دارد
  // رنگ تأکیدی هر تب (تم کلی یکی است؛ فقط accent عوض می‌شود)
  // (accent یکپارچه: دیگر رنگ هر استراتژی جدا نیست — همه از تم اصلی می‌گیرند، ظاهر منسجم‌تر)
  // قبلاً اینجا رنگ accent را به‌ازای هر تب عوض می‌کرد؛ طبق بازطراحی حذف شد.

  // --------------------------------------------------------------- هاله وضعیت اپ (بدون تاثیر بر فرمول‌ها)
  const state = {
    priceMode: 'last', // v1.29: 'last' = آخرین قیمت (پیش‌فرض) · 'exec' = قیمت قابل‌اجرا از دفتر سفارش
    bookCache: Object.create(null),
    strategy: 'pospanj',
    jampMode: 'yield', // yield | downshift | upshift | challenge — چهار زیرحالت جامپ (بازدهی/کاهش اعمال/افزایش اعمال/چالشی)
    monthFilter: null, // null = همه ماه‌ها · 1..12 = فقط همان ماه سررسید
    classFilter: new Set(ALL_CLASSES),
    autoRefresh: true, // همیشه فعال — به‌روزرسانی آنی بدون نیاز به کلیک کاربر
    chainRefreshMs: CHAIN_REFRESH_MS, // بازهٔ قابل‌تنظیم رفرش زنجیره (حداقل ۸۰۰ms)
    autoTimer: null,
    fetchSeq: 0,
    cache: null,      // {term, rows, basePrice, livePrice}
    chainCache: Object.create(null), // term -> { term, rows, livePrice, livePriceIsLive, at }
    chainCacheTtlMs: 40000, // کش کوتاه‌مدت سوییچ نماد (~۴۰ث)
    candidates: null, // لیست نامزدهای نماد وقتی جست‌وجو مبهم است
    openKeys: new Set(), // کلید نوارهای باز — تا رفرش خودکار جزئیات را نبندد
    lastListSig: '',     // امضای لیست برای جلوگیری از پرش رفرش
    forceReorder: false, // فقط با کلیک کاربر (مرتب‌سازی/فیلتر) ترتیب عوض شود
    obInsCode: null,     // قرارداد فعلی پنل صف
    symbolCache: null,   // {term, found} — نتیجهٔ قطعی جست‌وجوی نماد؛ رفرش‌های خودکار بدون GetInstrumentSearch
    uaCatalog: null,     // [{insCode, name, names[]}] — نمادهای پایه‌ای که اختیار معامله دارند
    uaCatalogAt: 0,      // زمان ساخت کاتالوگ
    uaCatalogTtlMs: 2 * 60 * 60 * 1000, // اعتبار کاتالوگ: ۲ ساعت — فقط با force یا شکست جستجو تازه می‌شود
    lastApiShapeKeys: Object.create(null), // kind -> آخرین کلیدهای پاسخ ناقص (فقط لاگ داخلی)
    uaSuggestTimer: null, // debounce پیشنهاد خودکار نماد
    uaSuggestActive: -1,  // ایندکس آیتم فعال در لیست پیشنهاد
    fetchInFlight: false, // رفرش خودکار قبلی هنوز در جریان است — درخواست بعدی رد می‌شود تا درخواست‌ها انباشته نشوند
    obKey: null,          // کلید جزئیات باز فعلی
    compareSpec: null,    // مشخصات قرارداد دوم برای مقایسهٔ کنارهم در پنل جزئیات
    obLoadedAt: 0,        // زمان آخرین بارگذاری موفق سفارشات — برای جلوگیری از درخواست تکراری
    obCtx: null,          // {insBuy, insSell, insCode, uaIns, isComboPair, singleOpt} — برای رفرش زندهٔ صف سفارشات
    obTimer: null,        // تایمر رفرش زندهٔ صف سفارشات/سهم پایه در پنل جزئیات
    obFetchInFlight: false, // جلوگیری از انباشت درخواست‌های رفرش صف سفارشات
    obManualSize: null,    // {width,height} — اگر کاربر پنل جزئیات را دستی تغییر اندازه داد
    obSizedThisSession: false, // فقط تغییر اندازهٔ همین نشست (نه localStorage قدیمی)
    obUserMoved: false,   // کاربر پنل جزئیات را جابه‌جا کرده
    obManualPos: null,    // {left,top} موقعیت دستی پنل جزئیات
    uiInteracting: false, // کاربر در حال کشیدن/تغییر اندازه است — رندرهای زنده موقتاً متوقف می‌شوند تا روان بماند
    obThresh: {},        // insCode -> {max,min} — سقف/کف مجاز امروز (برای کم‌رنگ کردن قیمت‌های خارج از دامنه نوسان در جدول سفارشات)
    uaInfo: null,        // {uaInsCode, yPrice} — قیمت دیروز سهم پایه (یک‌بار برای هر نماد)
    uaTicks: [],         // تیک‌های قیمت مبنا در این نشست — برای اسپارک‌لاین
    prevBaseShown: null, // آخرین قیمت مبنا نمایش‌داده‌شده — برای فلاش تغییر
    lastDataAt: 0,       // زمان آخرین دادهٔ موفق (برای نمایش سن)
    lastChainAt: 0,      // آخرین واکشی زنجیره کامل
    critFetchInFlight: false,
    visFetchInFlight: false,
    critTimer: null,
    visTimer: null,
    ageTimer: null,
    chainTimer: null,
    visibleKeys: new Set(),
    visObs: null,
    prevProfitByKey: {},
    // توربو + تطبیقی (رفرش هوشمند)
    noChangeStreak: 0,       // تعداد تیک‌های پیاپی بدون تغییر قیمت (برای Adaptive)
    turboActive: true,       // آیا الان در حالت توربو هستیم
    lastInteractAt: 0,       // آخرین تعامل کاربر (برای تشخیص فوکوس/فعال بودن)
    // وضعیت شبکه (MODULE net)
    netFailCount: 0,
    lastNetError: null,
    // v1.22.0 — سرعت رفرش (ضریب فاصلهٔ تیک‌ها؛ بدون UI کاربر)
    refreshMode: 'turbo', // پیش‌فرض: بیشترین سرعت زنده
    favoritesMap: Object.create(null), // { [نمادپایه]: Set(rowKey) } — موردعلاقه جدا برای هر نماد
    favOnly: false,        // فیلتر نمایش: فقط موردعلاقه‌های نماد فعلی
    listTerm: null,        // نمادی که الان در DOM لیست نمایش داده شده — برای جلوگیری از ماندن لیست نماد قبلی

    showAllList: false, // نمایش همه ردیف‌ها (پیش‌فرض: صفحه اول)
    netBackoffUntil: 0,
    // درگ عرض ستون در حال انجام است (برای جلوگیری از اعمال مجدد مقادیر قدیمی وسط درگ)
    colResizing: false,
    cacheGen: 0,           // نسل cache — با هر پاک‌سازی زیاد می‌شود تا تیک‌های در پرواز نتیجهٔ کهنه ننشانند
    listDensity: 'normal', // 'normal' | 'compact' — چگالی دستی ردیف‌ها
  };

  // ----- from src/02-session-storage.js -----
  // ========== MODULE [2] session storage =====================================
  // سیاست: هیچ داده‌ای به‌صورت دائمی ذخیره نمی‌شود.
  // lsCache فقط حافظهٔ موقت همین نشست است. با بستن پنل / ترک صفحه پاک می‌شود.
  // تنظیمات UI (نماد، فیلتر، مرتب‌سازی، کارمزد، بازه رفرش و ...) در همین نشست نگه داشته می‌شوند
  // تا با بازسازی پنل (ensureSidebar) از بین نروند.
  const lsCache = {};
  function lsGet(key) {
    return Object.prototype.hasOwnProperty.call(lsCache, key) ? lsCache[key] : null;
  }
  function lsSet(key, value) {
    lsCache[key] = value;
  }
  function lsClearAll() {
    // داده‌های بازار/جلسه پاک می‌شوند، اما تنظیمات ظاهری و چیدمان کاربر حفظ می‌شوند.
    const keep = {};
    ['tsext-theme','tsext-column-widths','tsext-zoom','tsext-ob-zoom','tsext-mirror','tsext-layout','tsext-ob-layout','tsext-open'].forEach((k) => {
      if (Object.prototype.hasOwnProperty.call(lsCache, k)) keep[k] = lsCache[k];
    });
    Object.keys(lsCache).forEach((k) => { delete lsCache[k]; });
    Object.keys(keep).forEach((k) => { lsCache[k] = keep[k]; });
  }
  const SESSION_SETTINGS_KEY = 'ui-settings';
  const JAMP_MANUAL_FIELDS = ['tsext-jamp-recv-premium-d', 'tsext-jamp-recv-premium-u', 'tsext-jamp-recv-premium'];
  function loadSettings() {
    return lsGet(SESSION_SETTINGS_KEY) || null;
  }
  function collectStrategySettings() {
    if (!panelHost) return null;
    const out = {
      strategy: state.strategy,
      autoRefresh: !!state.autoRefresh,
      refreshMode: state.refreshMode || 'normal',
      favOnly: !!state.favOnly,
      chainRefreshMs: state.chainRefreshMs || CHAIN_REFRESH_MS,
      monthFilter: state.monthFilter == null ? null : Number(state.monthFilter),
      classFilter: Array.from(state.classFilter || []),
      theme: (lsGet('tsext-theme') || 'light'),
      mirrored: !!state.mirrored,
      fontScale: state.fontScale || 1,
      byStrategy: {},
    };
    ['pospanj', 'combo', 'jamp'].forEach((s) => {
      const und = $id(panelHost, 'tsext-underlying-' + s);
      const man = $id(panelHost, 'tsext-manual-' + s);
      const comm = $id(panelHost, 'tsext-comm-' + s);
      const sort = $id(panelHost, 'tsext-sort');
      out.byStrategy[s] = {
        underlying: und ? (und.value || '') : '',
        manual: man ? (man.value || '') : '',
        commission: comm ? (comm.value || '') : '',
        sort: sort ? (sort.value || 'profit') : 'profit',
      };
    });
    [].forEach((id) => {
      const el = $id(panelHost, 'tsext-' + id);
      if (el) out[id] = el.value || '';
    });
    // فیلدهای دستی جامپ (v1.25: از جمله پرمیوم دریافتی قرارداد جاری در چالشی)
    out.jampFields = {};
    JAMP_MANUAL_FIELDS.forEach((id) => {
      const el = $id(panelHost, id);
      if (el) out.jampFields[id] = el.value || '';
    });
    out.jampMode = state.jampMode || 'yield';
    out.priceMode = state.priceMode === 'exec' ? 'exec' : 'last';
    out.listDensity = state.listDensity === 'compact' ? 'compact' : 'normal';
    return out;
  }
  function saveSettings(/* extra */) {
    try {
      const data = collectStrategySettings();
      if (data) lsSet(SESSION_SETTINGS_KEY, data);
    } catch (e) {}
  }
  let __saveSettingsTimer = null;
  function debouncedSaveSettings() {
    clearTimeout(__saveSettingsTimer);
    __saveSettingsTimer = setTimeout(() => { try { saveSettings(); } catch (e) {} }, 200);
  }
  function restoreSettingsToDom() {
    const sv = loadSettings();
    if (!sv || !panelHost) return;
    try {
      if (sv.strategy && sv.strategy !== 'tick') state.strategy = sv.strategy;
      else if (sv.strategy === 'tick') state.strategy = 'pospanj';
      if (sv.priceMode === 'exec') state.priceMode = 'exec';
      if (sv.listDensity === 'compact') state.listDensity = 'compact';
      else state.listDensity = 'normal';
      const densSel = $id(panelHost, 'tsext-density'); if (densSel) densSel.value = state.listDensity;
      try { if (typeof applyListDensity === 'function') applyListDensity(); } catch (eD) {}
      const pmSel = $id(panelHost, 'tsext-price-mode'); if (pmSel) pmSel.value = state.priceMode;
      if (typeof sv.autoRefresh === 'boolean') state.autoRefresh = sv.autoRefresh;
      if (sv.refreshMode === 'conservative' || sv.refreshMode === 'normal' || sv.refreshMode === 'turbo') state.refreshMode = sv.refreshMode;
      if (typeof sv.favOnly === 'boolean') state.favOnly = sv.favOnly;
      if (sv.chainRefreshMs && sv.chainRefreshMs >= 800) state.chainRefreshMs = sv.chainRefreshMs;
      if (sv.monthFilter == null || sv.monthFilter === '' || sv.monthFilter === 0) state.monthFilter = null;
      else {
        const m = Number(sv.monthFilter);
        state.monthFilter = (m >= 1 && m <= 12) ? m : null;
      }
      if (Array.isArray(sv.classFilter) && sv.classFilter.length) {
        state.classFilter = new Set(sv.classFilter.filter((c) => ALL_CLASSES.indexOf(c) >= 0));
        if (!state.classFilter.size) ALL_CLASSES.forEach((k) => state.classFilter.add(k));
      }
      if (sv.byStrategy) {
        let sortSet = false;
        Object.keys(sv.byStrategy).forEach((s) => {
          const d = sv.byStrategy[s];
          if (!d) return;
          const setVal = (id, v) => { const el = $id(panelHost, id); if (el && v != null) el.value = v; };
          setVal('tsext-underlying-' + s, d.underlying);
          setVal('tsext-manual-' + s, d.manual);
          setVal('tsext-comm-' + s, d.commission);
          if (!sortSet && d.sort) {
            const prefer = (s === (sv.strategy || state.strategy));
            if (prefer || !sortSet) {
              setVal('tsext-sort', d.sort === 'days' ? 'date' : d.sort);
              if (prefer) sortSet = true;
              else sortSet = true; // اولین مقدار موجود
            }
          }
        });
      }
      // اگر استراتژی ذخیره‌شدهٔ قدیمی حذف‌شده بود به مثبت‌پنج برگرد
      if (sv.strategy === 'tick') { sv.strategy = 'pospanj'; state.strategy = 'pospanj'; }
      if (sv.jampFields && typeof sv.jampFields === 'object') {
        JAMP_MANUAL_FIELDS.forEach((id) => {
          if (sv.jampFields[id] != null) { const el = $id(panelHost, id); if (el) el.value = sv.jampFields[id]; }
        });
      }
      if (sv.jampMode === 'yield' || sv.jampMode === 'downshift' || sv.jampMode === 'upshift' || sv.jampMode === 'challenge') {
        state.jampMode = sv.jampMode;
        try { updateJampModeUI(); } catch (e) { /* پنل هنوز کامل نیست */ }
      }
      try { syncMonthSelects(); } catch (e) {}
    } catch (e) {}
  }

  // ----- from src/03-helpers.js -----
  // ========== MODULE [3] helpers ============================================
  const $id = (host, id) => host.querySelector('#' + id);
  const asNum = (v, d) => { const n = Number(v); return isNaN(n) ? d : n; };
  // اولین عدد مثبت معتبر را از میان چند نام محتمل فیلد در یک آبجکت برمی‌گرداند —
  // برای خواندن سقف/کف مجاز روز که نام دقیق فیلدش در پاسخ‌های مختلف tsetmc یکسان نیست
  function pickPosNum(obj, keys) {
    if (!obj) return 0;
    for (let i = 0; i < keys.length; i++) {
      const v = Number(obj[keys[i]]);
      if (v > 0) return v;
    }
    return 0;
  }
  // پارس یکپارچهٔ عدد ورودی کاربر: ارقام فارسی/عربی + جداکنندهٔ هزارگان (٬ ، ,) + فاصله را حذف می‌کند.
  // تمام ورودی‌های دستی (قیمت، کارمزد، حداقل سود، روز مانده) باید از همین یک تابع رد شوند
  // تا رفتار پارس در همه‌جا یکسان و قابل اعتماد باشد.
  function parseUserNumber(v) {
    if (v === null || v === undefined) return NaN;
    const cleaned = faDigits(String(v)).replace(/[,،٬\s]/g, '').trim();
    if (cleaned === '') return NaN;
    return Number(cleaned);
  }

  // پاک‌سازی امن cache + باطل‌کردن تیک‌های در پرواز (نسل)
  function clearCache(/* reason */) {
    state.cache = null;
    state.cacheGen = (state.cacheGen || 0) + 1;
    // پرچم‌های در پرواز را رها نکن — finally خودشان پاک می‌کنند؛ فقط نسل عوض می‌شود
  }
  function currentCacheGen() { return state.cacheGen || 0; }


  // ----- from src/04-formulas.js -----
  // ========== MODULE [4] formulas ===========================================
  // همهٔ توابع این بخش خالص‌اند (بدون دستکاری DOM). فقط عدد برمی‌گردانند.
  // ----------------------------------------------------- محاسبهٔ مثبت‌پنج
  // ---------- v1.29: قیمت قابل‌اجرا (دفتر سفارش) ----------
  // در حالت «آخرین قیمت» هیچ ردیفی __exec ندارد و همهٔ خروجی‌ها دقیقاً مثل قبل است.
  // در حالت «قابل‌اجرا» رندر، به هر ردیف یک __exec می‌چسباند:
  //   { optBid, optBidQ, optAsk, optAskQ, uaBid, uaBidQ, uaAsk, uaAskQ }  (بهترین سطح صف؛ قیمت ریال، حجم = تعداد)
  // فروش اختیار → بهترین خرید (optBid) · خرید اختیار → بهترین فروش (optAsk)
  // خرید سهم → بهترین فروش (uaAsk) · فروش سهم → بهترین خرید (uaBid)
  function execOf(row) { return (row && row.__exec) ? row.__exec : null; }
  const NO_EXEC_ERR = 'قیمت قابل‌اجرا ندارد (صف خالی است)';
  function tradableContracts(qtyContractsList) {
    // هر عنصر: تعداد قرارداد قابل‌معاملهٔ یک پا؛ کمترین، حجم قابل‌معاملهٔ کل موقعیت است
    const xs = qtyContractsList.filter((v) => v != null && isFinite(v));
    if (!xs.length) return null;
    return Math.max(0, Math.floor(Math.min.apply(null, xs)));
  }
  function calcPosPanj(p) {
    const c = (p.contracts !== undefined && p.contracts !== null && !isNaN(p.contracts)) ? Number(p.contracts) : 1;
    const sizeRaw = Number(p.contractSize);
    const size = (sizeRaw > 0 && isFinite(sizeRaw)) ? Math.floor(sizeRaw) : 0;
    if (!(size > 0)) return { error: 'اندازه قرارداد نامعتبر است (contractSize).' };
    const strike = asNum(p.strike, 0);
    const shareBuy = asNum(p.shareBuy, 0);
    const premium = asNum(p.premium, 0);
    const days = asNum(p.days, 0);
    const comm = (typeof p.commissionPct === 'number' && !isNaN(p.commissionPct)) ? Number(p.commissionPct) : KB.DEFAULT_COMMISSION_PCT;
    if (!(strike > 0) || !(shareBuy > 0) || !(premium >= 0) || !(c > 0)) return { error: 'دادۀ اعمال ناقص است.' };
    if (!(size > 0)) return { error: 'اندازه قرارداد باید بزرگ‌تر از صفر باشد.' };
    const shares = c * size;
    const commShare = shareBuy * (1 + comm / 100); // بهای تمام‌شدهٔ هر سهم با احتساب کارمزد
    const totalPremium = premium * shares;
    // سرمایهٔ درگیر هر سهم = بهای تمام‌شده منهای پرمیوم دریافتی (مطابق فایل اکسل: H4 = C4 - B2)
    const investedPerShare = commShare - premium;
    const invested = investedPerShare * shares;
    const profitPerShare = (strike + premium) - commShare;
    const profitTotal = profitPerShare * shares;
    const received = (strike + premium) * shares; // دریافتی کل (مطابق B4 اکسل، برای کل موقعیت)
    const paid = commShare * shares; // پرداختی کل (مطابق C4 اکسل، برای کل موقعیت)
    const commRial = (shareBuy * shares * comm) / 100;
    // درصد با علامت واقعی — زیان دیگر به صفر تبدیل نمی‌شود
    let profitPct = 0;
    let profitMonth = 0;
    if (investedPerShare > 0) {
      profitPct = (profitPerShare / investedPerShare) * 100;
      if (days > 0) profitMonth = (profitPct / days) * 30;
    } else if (investedPerShare < 0) {
      profitPct = (profitPerShare / Math.abs(investedPerShare)) * 100;
      if (days > 0) profitMonth = (profitPct / days) * 30;
    } else {
      profitPct = profitPerShare > 0 ? 100 : (profitPerShare < 0 ? -100 : 0);
      profitMonth = profitPct;
    }
    // بازده بدون اعمال = پرمیوم به همان سرمایهٔ درگیر (مطابق فایل اکسل: I2 = B2 / H4)
    let noExProfitPct = 0;
    if (investedPerShare > 0) noExProfitPct = (premium / investedPerShare) * 100;
    else if (investedPerShare < 0) noExProfitPct = (premium / Math.abs(investedPerShare)) * 100;
    const noExProfitMonth = days > 0 ? (noExProfitPct / days) * 30 : 0;
    return {
      shares, needCapital: shareBuy * shares,
      commRial, commShare, totalPremium, received, paid,
      invested,
      profitPerShare, profitTotal,
      profitPct, profitMonth, noExProfitPct, noExProfitMonth,
      breakeven: invested / shares, breakEvenPrice: strike + premium,
      contractSize: size,
    };
  }

  // ------------------------------------------------------- تحلیل از ردیف زنجیره

  // آستانه‌های تیک: تا وقتی خودِ کاربر عدد واقعی‌اش را وارد نکند، صفر است (نه یک پیش‌فرض
  // آموزشی غیرصفر) — طبق درخواست صریح کاربر، هیچ آستانه‌ای نباید بی‌اطلاع او فرصت‌ها را
  // فیلتر کند؛ هدر هر تب هم همیشه همین وضعیت (صفر/واردشده) را شفاف نشان می‌دهد.
  // نقطه تعادل اسپرد تقویمی — طبق سند (جلسه ۲۰) با رصد چندروزه/چندهفته‌ای همان جفت قرارداد
  // کشف می‌شود، نه با فرمول ثابت. تا کاربر عدد واقعی نمادش را وارد نکند صفر است؛ در نتیجه
  // (چون این عدد مستقیم در فرمول «سود کل = تیک + نقطه‌تعادل» استفاده می‌شود) با صفر، تب اسپرد
  // تقویمی عملاً فرصتی نشان نمی‌دهد — همین هم در هدر همان تب صریحاً هشدار داده می‌شود.
  // وجه تضمین بلوکه‌شده (ریال، به‌ازای هر قرارداد) — کاملاً اختیاری و بدون پیش‌فرض آموزشی، چون
  // این عدد را فقط پنل کارگزاری/بورس می‌داند و حدس زدنش گمراه‌کننده است. اگر کاربر وارد نکند،
  // این تابع null برمی‌گرداند و هزینهٔ فرصت اصلاً محاسبه/کسر نمی‌شود (نه اینکه صفر فرض شود).
  // نرخ ماهانهٔ صندوق درآمد ثابت (٪) — طبق سند (بخش ع/م-۶) نرخ نمونهٔ سند ~۲٪ ماهانه است، ولی
  // نرخ واقعی به صندوق انتخابی کاربر بستگی دارد؛ پس ورودی کاربر است و بدون تایپِ او صفر است
  // (تب درآمد ثابت عملاً فرصتی نشان نمی‌دهد، همان‌طور که تب اسپرد بدون نقطه تعادل).

  function analyzeCoveredCallRow(row, basePrice, commission, baseIsManual) {
    if (!row) return { error: 'ردیف زنجیره موجود نیست.', incomplete: true };
    const strike = asNum(row.strikePrice, 0);
    const sizeRaw = asNum(row.contractSize, 0);
    const size = sizeRaw > 0 ? sizeRaw : 1000;
    const days = asNum(row.remainedDay, 0);
    const incompleteMeta = (!(asNum(row.strikePrice, 0) > 0) || !(sizeRaw > 0));
    const x = execOf(row);
    let shareBuy, premium, priceLive, tradable = null, tradeLimit = '';
    let partialExec = false;
    if (x) {
      // قابل‌اجرا: سهم را با بهترین فروش می‌خریم (مگر قیمت دستی داده شده)، اختیار را با بهترین خرید می‌فروشیم
      const manualBase = !!baseIsManual && Number(basePrice) > 0;
      shareBuy = manualBase ? Number(basePrice) : asNum(x.uaAsk, 0);
      premium = asNum(x.optBid, 0);
      priceLive = true;
      // اگر فقط یکی از پاها صف دارد، ردیف را حذف نکن — کم‌رنگ و برچسب «ناقص»
      if (!(shareBuy > 0) || !(premium > 0)) {
        partialExec = true;
        // fallback به آخرین/پایانی تا حداقل عددی نشان داده شود
        if (!(shareBuy > 0)) shareBuy = (Number(basePrice) > 0) ? Number(basePrice) : (asNum(row.pDrCotVal_UA, 0) || asNum(row.pClosing_UA, 0));
        if (!(premium > 0)) {
          const rawLive = asNum(row.pDrCotVal_C, 0);
          premium = rawLive || asNum(row.pClosing_C, 0);
        }
        if (!(shareBuy > 0) || !(premium > 0)) {
          return { error: NO_EXEC_ERR, noExec: true, incomplete: true, ticker: row.lVal18AFC_C || row.lVal30_C, strike, size, days, insCode: row.insCode_C };
        }
      } else {
        const optQ = asNum(x.optBidQ, 0);
        const uaQ = manualBase ? null : asNum(x.uaAskQ, 0) / (size > 0 ? size : 1);
        tradable = tradableContracts([optQ, uaQ]);
        tradeLimit = (uaQ != null && uaQ < optQ) ? 'صف فروش سهم' : 'صف خرید اختیار';
      }
    } else {
      shareBuy = (Number(basePrice) > 0) ? Number(basePrice) : (asNum(row.pDrCotVal_UA, 0) || asNum(row.pClosing_UA, 0));
      const rawLive = asNum(row.pDrCotVal_C, 0);
      premium = rawLive || asNum(row.pClosing_C, 0);
      priceLive = rawLive > 0; // اگر معاملهٔ امروزی نبوده، این مقدار قیمت پایانی (نه زنده) است
    }
    if (!(strike > 0) || !(shareBuy > 0)) {
      return { error: 'داده ناقص', incomplete: true, ticker: row.lVal18AFC_C || row.lVal30_C, strike, size, days, insCode: row.insCode_C };
    }
    const res = calcPosPanj({ strike, shareBuy, premium, contracts: 1, contractSize: size, days, commissionPct: commission });
    if (res.error) return Object.assign(res, { incomplete: true });
    return Object.assign(res, {
      execMode: !!x && !partialExec, tradable, tradeLimit,
      premium, priceLive, strike, size, days,
      shareBuy,
      baseIsManual: !!baseIsManual,
      incomplete: incompleteMeta || partialExec,
      partialExec,
      insCode: row.insCode_C,
      uaInsCode: row.uaInsCode,
      ticker: row.lVal18AFC_C || row.lVal30_C,
      volume: asNum(row.qTotTran5J_C, 0),
      openInterest: asNum(row.oP_C, 0),
      expiry: expiryOf(row, days),
    });
  }

  // ------------------------------------------- کلاس‌بندی ۵ کلاسه
  // بر اساس قیمت زنده/مبنای داده‌شده و گام مبنا = میانهٔ فاصلهٔ اعمال‌های مجاور:
  //   X  = تا ۲ گام از قیمت (هر دو طرف)
  //   B  = ITM میانی (۲ تا ۴ گام زیر قیمت)   · A  = ITM دور (>۴ گام زیر)
  //   −B = OTM میانی (۲ تا ۴ گام بالای قیمت) · −A = OTM دور (>۴ گام بالا)
  function classifyStrikes(rows, price) {
    const map = {};
    const strikes = rows
      .map((r) => Number(r.strikePrice))
      .filter((s) => s > 0)
      .filter((s, i, arr) => arr.indexOf(s) === i)
      .sort((a, b) => a - b);
    if (!strikes.length || !(price > 0)) return map;

    const gaps = [];
    for (let i = 1; i < strikes.length; i++) gaps.push(strikes[i] - strikes[i - 1]);
    gaps.sort((a, b) => a - b);
    const medianGap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0;
    const step = medianGap > 0 ? medianGap : Math.max(price * 0.02, 1);

    // X: تا ۲ پله فاصله از قیمت (هر دو طرف)
    // B / −B: از ۲ تا ۴ پله
    // A / −A: فراتر از ۴ پله
    const X_STEPS = 2;
    const NEAR_STEPS = 4;

    strikes.forEach((s) => {
      const diff = s - price; // منفی = زیر قیمت سهم
      const steps = Math.abs(diff) / step;
      let cls;
      if (steps <= X_STEPS) {
        cls = 'X';
      } else if (diff < 0) {
        cls = steps <= NEAR_STEPS ? 'B' : 'A';
      } else {
        cls = steps <= NEAR_STEPS ? '−B' : '−A';
      }
      map[s] = cls;
    });

    // تضمین حداقل یک X: نزدیک‌ترین اعمال به قیمت
    if (!Object.values(map).includes('X') && strikes.length) {
      let nearest = strikes[0], bestD = Infinity;
      for (const s of strikes) {
        const d = Math.abs(s - price);
        if (d < bestD) { bestD = d; nearest = s; }
      }
      map[nearest] = 'X';
    }
    return map;
  }

  function riskLabel(cls) {
    // مطابق طیف ریسک: A سبز (کم) ← −A قرمز (زیاد)
    if (cls === 'A') return { text: 'خیلی کم‌ریسک', short: 'خیلی کم‌ریسک', level: 'vlow' };
    if (cls === 'B') return { text: 'کم‌ریسک', short: 'کم‌ریسک', level: 'low' };
    if (cls === 'X') return { text: 'ریسک متعادل', short: 'ریسک متعادل', level: 'mid' };
    if (cls === '−B') return { text: 'پرریسک', short: 'پرریسک', level: 'high' };
    if (cls === '−A') return { text: 'خیلی پرریسک', short: 'خیلی پرریسک', level: 'vhigh' };
    return { text: 'نامشخص', short: '—', level: 'mid' };
  }
  // کلاس CSS رنگ ریسک — پرریسک = رنگ کلاس −B (mB) · خیلی‌پرریسک = رنگ −A (mA)
  function riskValClass(riskOrLevel) {
    const level = (riskOrLevel && typeof riskOrLevel === 'object') ? riskOrLevel.level : riskOrLevel;
    if (level === 'vlow') return 'tsext-risk-vlow';
    if (level === 'low') return 'tsext-risk-low';
    if (level === 'mid') return 'tsext-risk-mid';
    if (level === 'high') return 'tsext-risk-high'; // پرریسک → هم‌رنگ −B
    if (level === 'vhigh') return 'tsext-risk-vhigh';
    return '';
  }

  // هشدار نقدشوندگی: حجم امروز و موقعیت باز خیلی پایین = عمق کم
  // آستانه‌ها محافظه‌کارانه هستند تا فقط موارد واقعاً کم‌عمق را نشان دهند.
  function liquidityWarn(volume, openInterest) {
    const vol = Number(volume) || 0;
    const oi = Number(openInterest) || 0;
    if (vol <= 0 && oi <= 0) {
      return { level: 'high', text: 'نقدشوندگی بسیار پایین', short: 'کم‌عمق', title: 'حجم امروز و موقعیت باز صفر یا ناموجود — احتمال دشواری در ورود/خروج' };
    }
    if (vol < 5 && oi < 50) {
      return { level: 'mid', text: 'نقدشوندگی پایین', short: 'کم‌عمق', title: 'حجم و موقعیت باز محدود — مراقب اسپرد و لغزش باشید' };
    }
    return null;
  }

  // هشدار ریسک اعمال: نزدیک سررسید (≤ ۳ روز) احتمال اعمال و تغییرات شدیدتر بیشتر است
  function exerciseWarn(days) {
    const d = Number(days);
    if (!(d >= 0) || !isFinite(d)) return null;
    if (d <= 1) {
      return { level: 'high', text: 'ریسک اعمال بالا', short: 'اعمال نزدیک', title: 'کمتر از ۲ روز تا سررسید — احتمال اعمال و نوسان شدید' };
    }
    if (d <= 3) {
      return { level: 'mid', text: 'نزدیک سررسید', short: 'اعمال نزدیک', title: '۳ روز یا کمتر تا سررسید — ریسک اعمال را در نظر بگیرید' };
    }
    return null;
  }

  // ساخت چیپ‌های هشدار برای نمایش در جزئیات / لیست
  function warnChipsHtml(volume, openInterest, days, riskCls) {
    // فقط نقدشوندگی + نزدیکی سررسید — کلاس ریسک جداگانه در ستون/سطح ریسک آمده (پرریسک/خیلی‌پرریسک)
    // تا برچسب تکراری «پرریسک / ریسک بالا» ساخته نشود
    const parts = [];
    const tips = [];
    const liq = liquidityWarn(volume, openInterest);
    // «بدون معامله» (حجم و موقعیت‌باز صفر) نشان داده نمی‌شود — فقط شلوغی UI بود.
    if (liq && liq.level !== 'high') {
      parts.push('کم‌عمق');
      tips.push(liq.title);
    }
    const ex = exerciseWarn(days);
    if (ex) {
      parts.push(ex.level === 'high' ? 'فردا/امروز سررسید' : 'نزدیک سررسید');
      tips.push(ex.title);
    }
    if (!parts.length) return '';
    const level = (ex && ex.level === 'high') ? 'high' : 'mid';
    const cls = level === 'high' ? 'tsext-warn-unified tsext-warn-high' : 'tsext-warn-unified tsext-warn-mid';
    return ' <span class="' + cls + '" title="' + esc(tips.join(' · ')) + '">⚠ ' + esc(parts.join(' · ')) + '</span>';
  }

  function assignClasses(rows, shareBuy) {
    const price = Number(shareBuy) || 0;
    if (!rows || !rows.length) return rows;
    if (!(price > 0)) { rows.forEach((r) => { if (r) r.class = 'X'; }); return rows; }
    const map = classifyStrikes(rows, price);
    rows.forEach((r) => { if (r) r.class = map[Number(r.strikePrice)] || 'X'; });
    return rows;
  }

  // اندازه قرارداد: اگر از API نیامد/نامعتبر بود، بی‌صدا ۱۰۰۰ فرض نکن — flag بگذار تا UI هشدار دهد.
  function resolveContractSize(row, fallbackRow) {
    const raw = row && (row.contractSize ?? row.contract_size ?? row.cs);
    const n = Number(raw);
    if (n > 0 && isFinite(n)) return { size: Math.floor(n), guessed: false };
    const fb = fallbackRow && (fallbackRow.contractSize ?? fallbackRow.contract_size ?? fallbackRow.cs);
    const fn = Number(fb);
    if (fn > 0 && isFinite(fn)) return { size: Math.floor(fn), guessed: false };
    return { size: 1000, guessed: true }; // fallback اضطراری + پرچم حدس
  }
  // پارس امن تاریخ سررسید از فیلدهای tsetmc
  // پشتیبانی: YYYYMMDD عددی/رشته، ISO، YYYY/MM/DD میلادی، و تاریخ شمسی (سال ۱۳۰۰–۱۵۰۰)
  function jalaliToGregorian(jy, jm, jd) {
    jy = Number(jy); jm = Number(jm); jd = Number(jd);
    if (!(jy > 0 && jm >= 1 && jm <= 12 && jd >= 1 && jd <= 31)) return null;
    const jy2 = jy + 1595;
    let days = -355668 + (365 * jy2) + Math.floor(jy2 / 33) * 8 + Math.floor(((jy2 % 33) + 3) / 4) + jd
      + ((jm < 7) ? (jm - 1) * 31 : ((jm - 7) * 30 + 186));
    let gy = 400 * Math.floor(days / 146097);
    days %= 146097;
    if (days > 36524) {
      gy += 100 * Math.floor(--days / 36524);
      days %= 36524;
      if (days >= 365) days++;
    }
    gy += 4 * Math.floor(days / 1461);
    days %= 1461;
    if (days > 365) {
      gy += Math.floor((days - 1) / 365);
      days = (days - 1) % 365;
    }
    let gd = days + 1;
    const sal_a = [0, 31, ((gy % 4 === 0 && gy % 100 !== 0) || (gy % 400 === 0)) ? 29 : 28,
      31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let gm = 0;
    for (gm = 1; gm <= 12 && gd > sal_a[gm]; gm++) gd -= sal_a[gm];
    return new Date(gy, gm - 1, gd);
  }
  function parseExpiryValue(v) {
    if (v === undefined || v === null || v === '') return null;
    // عدد YYYYMMDD (مثل 20260315 یا 14041220)
    if (typeof v === 'number' && isFinite(v)) {
      const n = Math.floor(v);
      if (n >= 13000101 && n <= 15001229) {
        const y = Math.floor(n / 10000), m = Math.floor((n % 10000) / 100), d = n % 100;
        return jalaliToGregorian(y, m, d);
      }
      if (n >= 19900101 && n <= 21001231) {
        const y = Math.floor(n / 10000), m = Math.floor((n % 10000) / 100), d = n % 100;
        if (m >= 1 && m <= 12 && d >= 1 && d <= 31) return new Date(y, m - 1, d);
      }
      // timestamp میلی‌ثانیه‌ای معقول (بعد از ۲۰۰۱)
      if (n > 1e12 && n < 2e13) {
        const t = new Date(n);
        if (!isNaN(t.getTime())) return t;
      }
      return null; // عدد خام مثل 20240315 را دیگر به‌عنوان ms تفسیر نکن
    }
    const s = String(v).trim();
    if (!s) return null;
    // فقط ارقام ۸تایی
    if (/^\d{8}$/.test(s)) {
      const n = parseInt(s, 10);
      return parseExpiryValue(n);
    }
    // جداکننده / یا -
    const m = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
    if (m) {
      const y = parseInt(m[1], 10), mo = parseInt(m[2], 10), d = parseInt(m[3], 10);
      if (y >= 1300 && y <= 1500) return jalaliToGregorian(y, mo, d);
      if (y >= 1990 && y <= 2100) return new Date(y, mo - 1, d);
    }
    // ISO و بقیه
    const t = new Date(s);
    if (!isNaN(t.getTime())) {
      const y = t.getFullYear();
      // سال‌های شمسی اشتباه‌parseشده (۱۴xx) را رد کن
      if (y >= 1300 && y <= 1500) return null;
      if (y < 1990 || y > 2100) return null;
      return t;
    }
    return null;
  }
  function startOfLocalDay(d) {
    const x = d ? new Date(d) : new Date();
    x.setHours(0, 0, 0, 0);
    return x;
  }
  /** قرارداد هنوز معتبر است؟ (روزمانده > 0 یا سررسید از امروز به بعد) */
  function isContractActive(rowOrObj) {
    if (!rowOrObj) return false;
    const days = Number(rowOrObj.days != null ? rowOrObj.days : rowOrObj.remainedDay);
    if (isFinite(days) && days < 0) return false;
    if (isFinite(days) && days === 0) {
      // سررسید امروز — تا پایان روز نگه دار
      return true;
    }
    const exp = rowOrObj.expiry instanceof Date && !isNaN(rowOrObj.expiry.getTime())
      ? rowOrObj.expiry
      : null;
    if (exp) {
      if (exp.getTime() < startOfLocalDay().getTime()) return false;
    }
    // اگر فقط days مثبت است
    if (isFinite(days) && days > 0) return true;
    // بدون تاریخ و روز — محتاطانه نگه دار (نباید همه را حذف کنیم)
    if (!isFinite(days) && !exp) return true;
    return isFinite(days) ? days >= 0 : true;
  }
  // تاریخ اعمال (سررسید) + پرچم حدس: اگر API تاریخ نداد، از today+days تخمین می‌زنیم ولی guessed=true
  function expiryWithFlag(row, days) {
    const keys = ['dExpd', 'endDate', 'aEma', 'settlementDate', 'dEnd', 'expiryDate', 'dateExpire', 'EndDate'];
    if (row) {
      for (const k of keys) {
        const parsed = parseExpiryValue(row[k]);
        if (parsed) return { date: parsed, guessed: false };
      }
    }
    const d = Number(days);
    const base = startOfLocalDay();
    if (isFinite(d)) base.setDate(base.getDate() + d);
    return { date: base, guessed: true };
  }
  // ------------------------------------------- تاریخ اعمال (سررسید)
  function expiryOf(row, days) {
    return expiryWithFlag(row, days).date;
  }

  // ------------------------------------------- جامپ بازدهی: مقایسهٔ قرارداد جاری کاربر با بقیهٔ زنجیره
  // فرمول = دقیقاً همان مثبت‌پنج (calcPosPanj) با مبانی جدید پس از آفست:
  //   قیمت سهم پایهٔ جدید = اعمال قرارداد فعلی (قدیم) + پرمیوم پرداختی برای آفست
  //   روز درگیری جدید = روز قرارداد جدید − روز باقی‌ماندهٔ قرارداد فعلی
  //   کارمزد = صفر (سهم پایه جابه‌جا نمی‌شود)
  //   دریافتی = اعمال جدید + پرمیوم جدید
  //   سود به ریال = دریافتی − سهم پایهٔ جدید
  //   سرمایه درگیر = سهم پایهٔ جدید − پرمیوم جدید
  //   سود٪ / سود ماهانه / بدون‌اعمال = همان فرمول‌های مثبت‌پنج روی سرمایهٔ درگیر
  // «اختلاف پرمیوم» (= پرمیوم جدید − آفست) فقط برای فیلتر حداقل‌اختلاف نگه داشته می‌شود؛
  // وقتی اعمال جدید = اعمال قدیم، سود به ریال با اختلاف پرمیوم یکی است، ولی درصد روی سرمایهٔ درگیر حساب می‌شود.
  function buildJampCandidate(row, manual, commission) {
    const targetDays = asNum(row.remainedDay, 0);
    const days = targetDays - manual.days; // روز قرارداد جدید − روز باقی‌ماندهٔ قرارداد فعلی
    if (!(days > 0)) return null; // فقط قراردادهایی که روز ماندهٔ بیشتری از قرارداد فعلی دارند
    const size = asNum(row.contractSize, 1000);
    const strike = asNum(row.strikePrice, 0); // اعمال جدید (مقصد)
    if (!(strike > 0)) return null;
    const xr = execOf(row);
    const rawLive = xr ? asNum(xr.optBid, 0) : asNum(row.pDrCotVal_C, 0);
    const premium = xr ? rawLive : (rawLive || asNum(row.pClosing_C, 0)); // پرمیوم دریافتی از فروش قرارداد جدید (قابل‌اجرا: بهترین خرید)
    if (!(premium > 0)) return null;
    const shareBuy = manual.oldStrike + manual.offsetPremium; // قیمت سهم پایهٔ جدید (م-۱)
    const premiumDiff = premium - manual.offsetPremium; // اختلاف پرمیوم (برای فیلتر حداقل)
    // محاسبهٔ کامل مثل مثبت‌پنج با کارمزد صفر
    const res = calcPosPanj({
      strike, shareBuy, premium,
      contracts: 1, contractSize: size, days,
      commissionPct: 0,
    });
    if (res.error) return null;
    return {
      strike, size, days, premium, shareBuy, priceLive: !!rawLive,
      execMode: !!xr,
      tradable: xr ? tradableContracts([asNum(xr.optBidQ, 0), manual.oldAskQ != null ? manual.oldAskQ : null]) : null,
      tradeLimit: xr ? 'صف خرید اختیار / صف بازخرید' : '',
      targetDays, myDays: manual.days,
      oldStrike: manual.oldStrike, offsetPremium: manual.offsetPremium,
      oldInsCode: manual.oldInsCode || null, // کد قرارداد فعلی (برای نمایش صف آفست در جزئیات)
      premiumDiff,
      // بازده‌ها از calcPosPanj (مثل مثبت‌پنج)
      profitPerShare: res.profitPerShare,
      profitTotal: res.profitTotal,
      profitPct: res.profitPct,
      profitMonth: res.profitMonth,
      noExProfitPct: res.noExProfitPct,
      noExProfitMonth: res.noExProfitMonth,
      invested: res.invested,
      investedPerShare: res.invested / res.shares,
      received: res.received,
      paid: res.paid,
      ticker: row.lVal18AFC_C || row.lVal30_C,
      insCode: row.insCode_C,
      uaInsCode: row.uaInsCode,
      class: row.class || 'X',
      expiry: expiryOf(row, targetDays),
      volume: asNum(row.qTotTran5J_C, 0),
      openInterest: asNum(row.oP_C, 0),
    };
  }

  // ------------------------------------------- جامپ کاهش اعمال (v1.26 — طبق درخواست کاربر)
  // منطق دقیقاً مثل چالشی: قرارداد جاری (oldRow) انتخاب می‌شود + پرمیوم دریافتی دستی.
  //   قیمت سهم پایه = اعمال جاری + (بازخرید زندهٔ جاری − پرمیوم دریافتی)
  // سپس فقط قراردادهایی با اعمال کمتر از اعمال جاری بررسی می‌شوند، هرکدام با پرمیوم زندهٔ خودش، اعمال خودش و روزماندهٔ خودش
  // با همان محاسبهٔ اکسل مثبت‌پنج (کارمزد صفر) روی این قیمت پایه ارزیابی می‌شوند.
  // روز: اگر هم‌سررسید باشد همان روز جاری، اگر دورتر باشد روز قرارداد دور، اگر جاری دورتر باشد روز قرارداد نزدیک‌تر (یعنی همیشه روز کاندید)
  // هدف: حتی با سود صفر، سرمایه درگیر کم می‌شود و پول آزاد می‌شود.
  function buildJampDownshiftCandidate(oldRow, row, recvPremium) {
    if (!oldRow || !row) return null;
    if (String(row.insCode_C) === String(oldRow.insCode_C)) return null;
    const candidateStrike = asNum(row.strikePrice, 0);
    const oldStrike = asNum(oldRow.strikePrice, 0);
    if (!(candidateStrike > 0) || !(oldStrike > 0)) return null;
    if (!(candidateStrike < oldStrike)) return null; // فقط اعمال کمتر از جاری
    const b = challengeBasePrice(oldRow, recvPremium);
    if (!(b.basePrice > 0)) return null;
    const r = analyzeCoveredCallRow(row, b.basePrice, 0, true);
    if (!r || r.error) return null;
    return Object.assign(r, {
      tradable: (r.execMode && b.oldAskQ != null) ? tradableContracts([r.tradable, b.oldAskQ]) : r.tradable,
      jampSubMode: 'downshift',
      oldStrike: b.oldStrike, buyback: b.buyback, buybackLive: b.buybackLive,
      recvPremium: b.recvPremium, netPaid: b.netPaid, closePnL: b.closePnL, basePrice: b.basePrice,
      strikeDrop: b.oldStrike - r.strike,
      sameExpiry: asNum(row.remainedDay, 0) === asNum(oldRow.remainedDay, 0),
      ok: r.profitPerShare >= 0,
      class: row.class || 'X',
      insCodeBuy: oldRow.insCode_C,
      insCodeSell: row.insCode_C,
    });
  }

  // ------------------------------------------- جامپ افزایش اعمال و سود (v1.27 — طبق درخواست کاربر)
  // منطق دقیقاً مثل کاهش اعمال و سرمایه درگیر، فقط فیلتر برعکس: اعمال بالاتر از جاری
  //   قیمت سهم پایه = اعمال جاری + (بازخرید زندهٔ جاری − پرمیوم دریافتی)  — مثل چالشی
  //   هر کاندید: پرمیوم زندهٔ خودش، اعمال خودش، روزماندهٔ خودش — مثل مثبت‌پنج بدون کارمزد
  function buildJampUpshiftCandidate(oldRow, row, recvPremium) {
    if (!oldRow || !row) return null;
    if (String(row.insCode_C) === String(oldRow.insCode_C)) return null;
    const candidateStrike = asNum(row.strikePrice, 0);
    const oldStrike = asNum(oldRow.strikePrice, 0);
    if (!(candidateStrike > 0) || !(oldStrike > 0)) return null;
    if (!(candidateStrike > oldStrike)) return null; // فقط اعمال بالاتر از جاری
    const b = challengeBasePrice(oldRow, recvPremium);
    if (!(b.basePrice > 0)) return null;
    const r = analyzeCoveredCallRow(row, b.basePrice, 0, true);
    if (!r || r.error) return null;
    return Object.assign(r, {
      tradable: (r.execMode && b.oldAskQ != null) ? tradableContracts([r.tradable, b.oldAskQ]) : r.tradable,
      jampSubMode: 'upshift',
      oldStrike: b.oldStrike, buyback: b.buyback, buybackLive: b.buybackLive,
      recvPremium: b.recvPremium, netPaid: b.netPaid, closePnL: b.closePnL, basePrice: b.basePrice,
      strikeDiff: r.strike - b.oldStrike,
      strikeDrop: b.oldStrike - r.strike,
      sameExpiry: asNum(row.remainedDay, 0) === asNum(oldRow.remainedDay, 0),
      ok: r.profitPerShare >= 0,
      class: row.class || 'X',
      insCodeBuy: oldRow.insCode_C,
      insCodeSell: row.insCode_C,
    });
  }

  // ------------------------------------------- جامپ چالشی (منطق v1.25 — طبق تعریف کاربر)
  // شما یک قرارداد «جاری» فروخته‌اید (اعمال K0) و بابت آن پرمیوم P0 گرفته‌اید. برای خروج از چالش باید آن را
  // با پرمیوم زندهٔ بازار (بازخرید/آفست) بخرید. چون سهمی خریده نمی‌شود، کارمزدی هم در کار نیست.
  //   خالص پرداختی = بازخرید زندهٔ قرارداد جاری − پرمیوم دریافتی (دستی)
  //   قیمت سهم پایه (برای اکسل) = اعمال جاری − خالص پرداختی
  // سپس هر قرارداد زنجیره با پرمیوم زندهٔ خودش، اعمال خودش و روزماندهٔ خودش با همان محاسبهٔ اکسل مثبت‌پنج
  // (calcPosPanj، کارمزد صفر) روی این قیمت سهم پایه ارزیابی می‌شود.
  function challengeBasePrice(oldRow, recvPremium) {
    const oldStrike = asNum(oldRow && oldRow.strikePrice, 0);
    const xo = execOf(oldRow);
    const buyRaw = xo ? asNum(xo.optAsk, 0) : asNum(oldRow && oldRow.pDrCotVal_C, 0);
    const buyback = xo ? buyRaw : (buyRaw || asNum(oldRow && oldRow.pClosing_C, 0)); // بازخرید قابل‌اجرا = بهترین فروش
    const recv = asNum(recvPremium, 0);
    // خالص بستن موقعیت کوتاه: بازخرید − دریافتی (منفی اگر دریافتی بیشتر باشد)
    const netPaid = buyback - recv;
    // سهم پایه = اعمال + خالص بستن → زیان بستن (بازخرید>دریافتی) پایه را بالا می‌برد و سود جامپ را کم می‌کند
    const basePrice = (xo && !(buyRaw > 0)) ? 0 : (oldStrike + netPaid);
    const closePnL = recv - buyback; // سود/زیان بستن قرارداد جاری (منفی = زیان)
    const out = { oldStrike, buyback, buybackLive: buyRaw > 0, recvPremium: recv, netPaid, basePrice, closePnL };
    if (xo) out.oldAskQ = asNum(xo.optAskQ, 0);
    return out;
  }
  function buildJampChallengeCandidate(oldRow, row, recvPremium) {
    if (!oldRow || !row) return null;
    if (String(row.insCode_C) === String(oldRow.insCode_C)) return null; // خودِ قرارداد جاری کاندید نیست
    // مثل کاهش اعمال: فقط اعمال کمتر از قرارداد انتخابی کشویی
    const candidateStrike = asNum(row.strikePrice, 0);
    const oldStrike = asNum(oldRow.strikePrice, 0);
    if (!(candidateStrike > 0) || !(oldStrike > 0)) return null;
    if (!(candidateStrike < oldStrike)) return null;
    const b = challengeBasePrice(oldRow, recvPremium);
    if (!(b.basePrice > 0)) return null;
    let r = analyzeCoveredCallRow(row, b.basePrice, 0, true);
    // اگر صف خالی بود، با آخرین/پایانی دوباره حساب کن
    if ((!r || r.error || r.noExec) && execOf(row)) {
      const rowFallback = Object.assign({}, row, { __exec: null });
      r = analyzeCoveredCallRow(rowFallback, b.basePrice, 0, true);
    }
    if (!r || r.error) return null;
    return Object.assign(r, {
      tradable: (r.execMode && b.oldAskQ != null) ? tradableContracts([r.tradable, b.oldAskQ]) : r.tradable,
      jampSubMode: 'challenge',
      oldStrike: b.oldStrike, buyback: b.buyback, buybackLive: b.buybackLive,
      recvPremium: b.recvPremium, netPaid: b.netPaid, closePnL: b.closePnL, basePrice: b.basePrice,
      strikeDrop: b.oldStrike - r.strike,
      sameExpiry: asNum(row.remainedDay, 0) === asNum(oldRow.remainedDay, 0),
      ok: r.profitPerShare >= 0,
      class: row.class || 'X',
      insCodeBuy: oldRow.insCode_C,
      insCodeSell: row.insCode_C,
    });
  }


  // ------------------------------------------- معاملات ترکیبی (Combo)
  // منطق مطابق اکسل (OPTIONS):
  //   پرمیوم (B2)       = پرمیوم قرارداد فروش
  //   سهم پایه (C2)    = اعمال خرید + پرمیوم زنده خرید (+ کارمزد٪ → C4 = C2×(1+کارمزد/100))
  //   قیمت اعمال (D2)  = قیمت اعمال قرارداد فروش
  //   روز تا سررسید (E2)= روزماندهٔ قرارداد فروش
  //   دریافتی B4=B2+D2 · پرداختی C4=C2+(C2×کارمزد%) · سرمایه E6=C4-B2 · سود E4=B4-C4
  // فقط قراردادهای فروش با روزماندهٔ بیشتر از قرارداد خرید مقایسه/نمایش می‌شوند.
  function calcCombo(rowBuy, rowSell, commission) {
    // معاملات ترکیبی = همان اکسل مثبت‌پنج با جایگزینی:
    //   C2 (سهم پایه) ← اعمال‌خرید + پرمیوم‌خرید
    //   B2 (پرمیوم)   ← پرمیوم فروش
    //   D2 (اعمال)    ← اعمال فروش
    //   E2 (روز)      ← روزمانده فروش
    // سلول‌های اکسل:
    //   C4 = C2×(۱+کارمزد٪)     پرداختی واحد
    //   B4 = B2+D2              دریافتی واحد
    //   E4 = B4−C4              سود به ریال واحد
    //   E6 = C4−B2              سرمایه درگیر واحد
    //   A8 = E4/E6              سود٪
    //   B8 = (A8/E2)×۳۰         سود ماهانه
    //   D6 = B2/E6              بدون اعمال
    if (!rowBuy || !rowSell) return { error: 'به دو قرارداد (خرید + فروش) نیاز است.' };
    const strikeBuy = asNum(rowBuy.strikePrice, 0);
    const strikeSell = asNum(rowSell.strikePrice, 0);
    if (!(strikeBuy > 0) || !(strikeSell > 0)) {
      return { error: 'اعمال قراردادها نامعتبر است.' };
    }
    // ترجیح اندازه قرارداد فروش؛ اگر هر دو موجود و متفاوت، کوچک‌تر را بگیر
    const sizeSell = asNum(rowSell.contractSize, 0);
    const sizeBuy = asNum(rowBuy.contractSize, 0);
    let size = sizeSell > 0 ? sizeSell : (sizeBuy > 0 ? sizeBuy : 1000);
    if (sizeSell > 0 && sizeBuy > 0 && sizeSell !== sizeBuy) {
      size = Math.min(sizeSell, sizeBuy);
    }
    const days = asNum(rowSell.remainedDay, 0);
    const buyDays = asNum(rowBuy.remainedDay, 0);
    if (!(days > buyDays)) {
      return { error: 'روزماندهٔ فروش باید بیشتر از روزماندهٔ خرید باشد.' };
    }
    const buyLiveRaw = asNum(rowBuy.pDrCotVal_C, 0);
    const sellLiveRaw = asNum(rowSell.pDrCotVal_C, 0);
    let premBuy = buyLiveRaw || asNum(rowBuy.pClosing_C, 0);
    let premSell = sellLiveRaw || asNum(rowSell.pClosing_C, 0);
    const xb = execOf(rowBuy), xs = execOf(rowSell);
    const execC = !!(xb && xs);
    let tradableC = null;
    if (execC) {
      // خرید اختیار → بهترین فروش (ask) · فروش اختیار → بهترین خرید (bid)
      premBuy = asNum(xb.optAsk, 0);
      premSell = asNum(xs.optBid, 0);
      if (!(premBuy > 0) || !(premSell > 0)) return { error: NO_EXEC_ERR, noExec: true };
      tradableC = tradableContracts([asNum(xb.optAskQ, 0), asNum(xs.optBidQ, 0)]);
    }
    if (!(premBuy >= 0)) return { error: 'پرمیوم قرارداد خرید در دسترس نیست.' };
    if (!(premSell >= 0)) return { error: 'پرمیوم قرارداد فروش نامعتبر است.' };

    // C2 اکسل در حالت ترکیبی
    const shareBase = strikeBuy + premBuy; // C2
    const comm = (typeof commission === 'number' && !isNaN(commission) && commission >= 0)
      ? Number(commission)
      : KB.DEFAULT_COMMISSION_PCT;

    // همان calcPosPanj / اکسل — صریح برای شفافیت
    const res = calcPosPanj({
      strike: strikeSell,       // D2
      shareBuy: shareBase,      // C2
      premium: premSell,        // B2
      contracts: 1,
      contractSize: size,
      days,                     // E2
      commissionPct: comm,
    });
    if (res.error) return res;

    // مقادیر واحد هم‌تراز سلول‌های اکسل (برای نمایش و راستی‌آزمایی)
    const excelC2 = shareBase;
    const excelB2 = premSell;
    const excelD2 = strikeSell;
    const excelC4 = res.commShare;           // پرداختی واحد
    const excelB4 = strikeSell + premSell; // دریافتی واحد
    const excelE4 = res.profitPerShare;      // سود به ریال
    const excelE6 = res.invested / (res.shares || size); // سرمایه درگیر واحد
    const excelA8 = res.profitPct;           // سود٪
    const excelB8 = res.profitMonth;         // سود ماهانه
    const excelD6 = res.noExProfitPct;       // بدون اعمال٪

    return Object.assign(res, {
      strikeBuy, strikeSell, days, buyDays, size,
      premBuy, premSell,
      execMode: execC, tradable: tradableC, tradeLimit: execC ? 'صف قرارداد خرید/فروش' : '',
      buyPriceLive: execC || buyLiveRaw > 0, sellPriceLive: execC || sellLiveRaw > 0,
      shareBuy: shareBase,
      shareBase,
      commissionPctUsed: comm,
      // نگاشت اکسل
      excel: { C2: excelC2, B2: excelB2, D2: excelD2, C4: excelC4, B4: excelB4, E4: excelE4, E6: excelE6, A8: excelA8, B8: excelB8, D6: excelD6 },
      tickerBuy: rowBuy.lVal18AFC_C || rowBuy.lVal30_C,
      tickerSell: rowSell.lVal18AFC_C || rowSell.lVal30_C,
      insCodeBuy: rowBuy.insCode_C,
      insCodeSell: rowSell.insCode_C,
      uaInsCode: rowSell.uaInsCode || rowBuy.uaInsCode,
      class: rowSell.class || 'X',
      expiry: expiryOf(rowSell, days),
      volumeBuy: asNum(rowBuy.qTotTran5J_C, 0),
      volumeSell: asNum(rowSell.qTotTran5J_C, 0),
      nearBuy: buyDays > 0 && buyDays < 10,
    });
  }

  // ----- from src/05-theme-layout.js -----
  // ========== MODULE [5] theme + layout =====================================
  const THEMES = {
    dark: {
      // نزدیک تم تیرهٔ ترمینال‌های ایرانی (ایزی‌تریدر-مانند)
      bg: '#0f1419', panel: '#1a222d', panel2: '#151c26',
      fg: '#c5cdd8', bright: '#eef2f6', muted: '#8b96a5', border: '#2a3444', inputBg: '#121820',
      accent: '#2b7de9', green: '#26a69a', red: '#ef5350', orange: '#ffa726',
      sw: { A: '#26a69a', B: '#4db6ac', X: '#42a5f5', mB: '#ffa726', mA: '#ef5350' },
    },
    light: {
      // نزدیک ایزی‌تریدر مفید: بوم روشن، کارت سفید، آبی سازمانی، سبز/قرمز سفارش
      bg: '#f4f6f8', panel: '#ffffff', panel2: '#eef1f5',
      fg: '#37474f', bright: '#1a2332', muted: '#546e7a', border: '#dde3ea', inputBg: '#ffffff',
      accent: '#1565c0', green: '#2e7d32', red: '#c62828', orange: '#ef6c00',
      sw: { A: '#2e7d32', B: '#558b2f', X: '#0277bd', mB: '#ef6c00', mA: '#c62828' },
    },
    contrast: {
      bg: '#000000', panel: '#0a0a0a', panel2: '#141414',
      fg: '#f5f5f5', bright: '#ffffff', muted: '#d4d4d4', border: '#737373', inputBg: '#171717',
      accent: '#42a5f5', green: '#66bb6a', red: '#ef5350', orange: '#ffa726',
      sw: { A: '#66bb6a', B: '#81c784', X: '#42a5f5', mB: '#ffa726', mA: '#ef5350' },
    },
  };
  function theme() {
    const k = lsGet('tsext-theme') || 'light';
    return THEMES[k] || THEMES.light;
  }
  function th() { return theme(); }
  function swKey(cls) { return cls === '−B' ? 'mB' : cls === '−A' ? 'mA' : cls; }
  function classColor(cls) { const t = th(); return t.sw[swKey(cls)] || t.accent; }

  // ---------- مرحلهٔ بازار (به وقت تهران) ----------
  // شنبه–چهارشنبه: ۸:۴۵–۹:۰۰ پیش‌گشایش · ۹:۰۰–۱۲:۳۰ باز · ۱۲:۳۰–۱۲:۴۰ جمع‌بندی · بقیه بسته
  // پنجشنبه/جمعه تعطیل هفتگی · تعطیل شمسی ثابت خودکار · تاریخ‌های اضافی در MARKET_HOLIDAY_DATES (بدون نام مناسبت)

  const WD_FA = { Sat: 'شنبه', Sun: 'یکشنبه', Mon: 'دوشنبه', Tue: 'سه‌شنبه', Wed: 'چهارشنبه', Thu: 'پنجشنبه', Fri: 'جمعه' };

  /** میلادی → شمسی (الگوریتم استاندارد) */
  function gregorianToJalali(gy, gm, gd) {
    const g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
    let gy2 = (gm > 2) ? (gy + 1) : gy;
    let days = 355666 + (365 * gy) + Math.floor((gy2 + 3) / 4) - Math.floor((gy2 + 99) / 100) + Math.floor((gy2 + 399) / 400) + gd + g_d_m[gm - 1];
    let jy = -1595 + (33 * Math.floor(days / 12053));
    days %= 12053;
    jy += 4 * Math.floor(days / 1461);
    days %= 1461;
    if (days > 365) {
      jy += Math.floor((days - 1) / 365);
      days = (days - 1) % 365;
    }
    const jm = (days < 186) ? 1 + Math.floor(days / 31) : 7 + Math.floor((days - 186) / 30);
    const jd = 1 + ((days < 186) ? (days % 31) : ((days - 186) % 30));
    return { jy, jm, jd };
  }

  /** تعطیلات شمسی ثابت (بدون نام مناسبت) */
  function isFixedSolarHoliday(jy, jm, jd) {
    if (jm === 1 && jd >= 1 && jd <= 4) return true;   // ۱–۴ فروردین
    if (jm === 1 && (jd === 12 || jd === 13)) return true; // ۱۲ و ۱۳ فروردین
    if (jm === 3 && (jd === 14 || jd === 15)) return true; // ۱۴ و ۱۵ خرداد
    if (jm === 11 && jd === 22) return true;              // ۲۲ بهمن
    if (jm === 12 && jd === 29) return true;              // ۲۹ اسفند
    return false;
  }

  function tehranClock() {
    try {
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Tehran', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
      }).formatToParts(new Date());
      const map = {};
      parts.forEach((p) => { map[p.type] = p.value; });
      const hour = parseInt(String(map.hour || '0'), 10) % 24;
      const minute = parseInt(String(map.minute || '0'), 10);
      const y = parseInt(map.year, 10);
      const m = parseInt(map.month, 10);
      const d = parseInt(map.day, 10);
      const ymd = (map.year && map.month && map.day) ? (map.year + '-' + map.month + '-' + map.day) : '';
      let jal = { jy: 0, jm: 0, jd: 0 };
      try { if (y && m && d) jal = gregorianToJalali(y, m, d); } catch (e) {}
      return {
        wd: map.weekday || '',
        wdFa: WD_FA[map.weekday] || map.weekday || '',
        mins: hour * 60 + minute,
        ymd,
        jy: jal.jy, jm: jal.jm, jd: jal.jd,
        shamsi: jal.jy ? (jal.jy + '/' + String(jal.jm).padStart(2, '0') + '/' + String(jal.jd).padStart(2, '0')) : '',
      };
    } catch (e) {
      const d = new Date();
      const pad = (n) => (n < 10 ? '0' : '') + n;
      const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
      let jal = { jy: 0, jm: 0, jd: 0 };
      try { jal = gregorianToJalali(d.getFullYear(), d.getMonth() + 1, d.getDate()); } catch (e2) {}
      return {
        wd, wdFa: WD_FA[wd] || wd,
        mins: d.getHours() * 60 + d.getMinutes(),
        ymd: d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()),
        jy: jal.jy, jm: jal.jm, jd: jal.jd,
        shamsi: jal.jy ? (jal.jy + '/' + String(jal.jm).padStart(2, '0') + '/' + String(jal.jd).padStart(2, '0')) : '',
      };
    }
  }

  /** امروز تعطیل رسمی است؟ (بدون برگرداندن نام مناسبت) */
  function holidayToday() {
    const c = tehranClock();
    if (!c.ymd) return '';
    if (typeof MARKET_HOLIDAY_DATES !== 'undefined' && MARKET_HOLIDAY_DATES.has(c.ymd)) return 'تعطیل رسمی';
    if (c.jy && isFixedSolarHoliday(c.jy, c.jm, c.jd)) return 'تعطیل رسمی';
    // سازگاری: کلیدهای قدیمی MARKET_HOLIDAYS
    if (MARKET_HOLIDAYS && MARKET_HOLIDAYS[c.ymd]) return 'تعطیل رسمی';
    return '';
  }

  function tradedToday() {
    return !!(state.lastTodayTradeAt && Date.now() - state.lastTodayTradeAt < TRADED_TODAY_TTL_MS);
  }
  function tehranDEven() {
    const c = tehranClock();
    return c.ymd ? Number(c.ymd.replace(/-/g, '')) : 0;
  }
  function isHolidayClosed() {
    if (isForcedLive()) return false;
    if (marketPhaseByClock() === 'closed') return false;
    return !!holidayToday() && !tradedToday();
  }
  function marketPhaseByClock() {
    const c = tehranClock();
    const isWd = (c.wd === 'Sat' || c.wd === 'Sun' || c.wd === 'Mon' || c.wd === 'Tue' || c.wd === 'Wed');
    if (!isWd) return 'closed';
    if (c.mins >= 8 * 60 + 45 && c.mins < 9 * 60) return 'preopen';
    if (c.mins >= 9 * 60 && c.mins < 12 * 60 + 30) return 'open';
    if (c.mins >= 12 * 60 + 30 && c.mins < 12 * 60 + 40) return 'closing';
    return 'closed';
  }
  function isForcedLive() { return !!(state.forceLiveUntil && Date.now() < state.forceLiveUntil); }
  function marketPhase() {
    if (isForcedLive()) return 'open';
    const p = marketPhaseByClock();
    if (p !== 'closed' && holidayToday() && !tradedToday()) return 'closed';
    return p;
  }
  function marketPhaseInfo() {
    const p = marketPhase();
    const hol = holidayToday();
    const holClosed = isHolidayClosed();
    const c = tehranClock();
    return {
      phase: holClosed ? 'holiday' : (p === 'closing' ? 'closed' : p),
      enginePhase: p,
      label: marketStatusFa(),
      tip: marketStatusTip(),
      holiday: hol ? 'تعطیل رسمی' : '',
      tradedToday: tradedToday(),
      forced: isForcedLive(),
      weekday: c.wdFa || '',
      shamsi: c.shamsi || '',
    };
  }
  function marketFactor() {
    const p = marketPhase();
    if (p === 'closed') return MKT_CLOSED_FACTOR;
    if (p === 'preopen') return MKT_PREOPEN_FACTOR;
    return 1;
  }
  function forceLiveNow() {
    state.forceLiveUntil = Date.now() + FORCE_LIVE_MS;
    try { setStatus('رفرش کامل برای ۵ دقیقه روشن شد (حتی با بازار بسته)'); } catch (e) {}
    try { updateAgeLabel(); } catch (e) {}
    try { if (typeof criticalPriceTick === 'function') criticalPriceTick(); } catch (e) {}
  }
  function marketStatusFa() {
    const p = marketPhase();
    if (p === 'open') return isForcedLive() ? 'زندهٔ دستی' : 'بازار باز';
    if (p === 'preopen') return 'پیش‌گشایش';
    if (p === 'closing') return 'پایان جلسه';
    if (isHolidayClosed()) return 'تعطیل رسمی';
    return 'بازار بسته';
  }
  function marketStatusTip() {
    const c = tehranClock();
    const p = marketPhase();
    const parts = [];
    if (c.wdFa) parts.push(c.wdFa);
    if (c.shamsi) parts.push(c.shamsi);
    parts.push(marketStatusFa());
    let tip = parts.join(' · ');
    if (isHolidayClosed()) tip += '\nامروز تعطیل رسمی است (بازار بسته)';
    else if (holidayToday() && tradedToday()) tip += '\nدر تقویم تعطیل بود ولی معاملهٔ امروز دیده شد — حالت زنده';
    if (isForcedLive()) tip += '\nرفرش کامل دستی تا چند دقیقه فعال است';
    if (p === 'open') tip += '\nساعات معاملات: ۹:۰۰ تا ۱۲:۳۰ تهران';
    else if (p === 'preopen') tip += '\nپیش‌گشایش · شروع از ۹:۰۰';
    else if (!isHolidayClosed()) tip += '\nخارج از ساعت معاملات یا روز غیرکاری';
    return tip;
  }
  function marketStatusHtml() {
    const s = marketStatusFa();
    const p = marketPhase();
    const tip = marketStatusTip();
    const c = tehranClock();
    const extra = (c.wdFa || c.shamsi)
      ? (' <small>· ' + [c.wdFa, c.shamsi].filter(Boolean).join(' · ') + '</small>')
      : '';
    return '<span class="tsext-mkt tsext-mkt-' + (p === 'open' || p === 'preopen' ? 'open' : 'closed')
      + '" id="tsext-market" title="' + esc(tip) + '">' + s + extra + (p === 'closed' ? ' <small>· رفرش آهسته</small>' : '') + '</span>';
  }

  function applyUiPrefs() {
    if (!panelHost) return;
    const thKey = lsGet('tsext-theme') || 'light';
    panelHost.classList.toggle('tsext-theme-contrast', thKey === 'contrast');
    panelHost.setAttribute('data-tsext-theme', thKey);
    applyColumnWidths();
  }
  function ensureVisibleObserver() {
    if (state.visObs || !panelHost) return;
    const root = listEl();
    if (!root || typeof IntersectionObserver === 'undefined') return;
    state.visObs = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        const k = en.target.getAttribute('data-key');
        if (!k) return;
        if (en.isIntersecting) state.visibleKeys.add(k);
        else state.visibleKeys.delete(k);
      });
    }, { root: root, threshold: 0.12, rootMargin: '40px 0px' });
  }
  function observeBars() {
    ensureVisibleObserver();
    if (!state.visObs || !panelHost) return;
    panelHost.querySelectorAll('#tsext-list .tsext-bar').forEach((b) => {
      try { state.visObs.observe(b); } catch (e) {}
    });
  }
  function saveObLayoutPersist() {
    try {
      lsSet('tsext-ob-layout', JSON.stringify({
        size: state.obManualSize, pos: state.obManualPos, moved: !!state.obUserMoved,
      }));
    } catch (e) {}
  }
  function loadObLayoutPersist() {
    // اندازهٔ ذخیره‌شدهٔ قدیمی جزئیات دیگر بارگذاری نمی‌شود —
    // ابعاد همیشه از نسبت صفحهٔ اصلی (همهٔ تب‌ها) محاسبه می‌شود.
    // فقط موقعیت دستی همین نشست معتبر است (از save هنگام درگ).
    try {
      // عمداً size از localStorage خوانده نمی‌شود
      state.obManualSize = null;
      state.obSizedThisSession = false;
      state.obUserMoved = false;
      state.obManualPos = null;
    } catch (e) {}
  }

  let panelHost = null;
  // ردیف‌های قرارداد (قابل‌اسکرول) — نه بلوک هدر
  function listEl() { return panelHost.querySelector('#tsext-list-body'); }
  // بلوک هدر لیست (نماد/قیمت/راهنمای کلاس/سرستون‌ها) — بیرون از ناحیهٔ اسکرول، همیشه ثابت
  function listHdrEl() { return panelHost.querySelector('#tsext-list-hdr'); }
  // همگام‌سازی اسکرول افقی هدر و بدنهٔ لیست تا سرستون‌ها روی ستون‌ها بمانند (v1.21.4)
  function syncListScroll() {
    const h = listHdrEl();
    const b = listEl();
    if (!h || !b) return;
    if (h.__tsextScrollSync && b.__tsextScrollSync) return;
    let lock = false;
    const tie = (from, to) => {
      from.addEventListener('scroll', () => {
        if (lock) return;
        lock = true;
        to.scrollLeft = from.scrollLeft;
        requestAnimationFrame(() => { lock = false; });
      }, { passive: true });
    };
    if (!h.__tsextScrollSync) { tie(h, b); h.__tsextScrollSync = true; }
    if (!b.__tsextScrollSync) { tie(b, h); b.__tsextScrollSync = true; }
  }
  // عرض واقعی اسکرول‌بار عمودی بدنه را به هدر می‌دهد تا سرستون‌ها دقیقاً روی ستون‌ها بیفتند (v1.21.5)
  function syncListGutter() {
    if (!panelHost) return;
    const b = listEl();
    if (!b) return;
    const sbw = Math.max(0, Math.round(b.offsetWidth - b.clientWidth));
    const cur = panelHost.style.getPropertyValue('--tsext-sbw');
    if (cur !== sbw + 'px') panelHost.style.setProperty('--tsext-sbw', sbw + 'px');
  }
  function setListHeader(html) {
    const h = listHdrEl();
    if (h) { h.innerHTML = html || ''; setupColumnResizers(); syncListScroll(); syncListGutter(); }
  }
  const COLUMN_DEFAULTS = { class: 38, name: 260, strike: 64, days: 44, date: 92, risk: 105, profit: 92, actions: 88 };
  const COLUMN_LIMITS = { class: [32, 64], name: [140, 420], strike: [50, 140], days: [36, 90], date: [78, 140], risk: [85, 200], profit: [72, 180], actions: [72, 200] };
  function getColumnWidths() {
    try {
      const raw = lsGet('tsext-column-widths-v6');
      if (!raw) return { ...COLUMN_DEFAULTS };
      const obj = typeof raw === 'string' ? JSON.parse(raw) : raw;
      return { ...COLUMN_DEFAULTS, ...Object.fromEntries(Object.keys(COLUMN_DEFAULTS).map(k => [k, Math.max(COLUMN_LIMITS[k][0], Math.min(COLUMN_LIMITS[k][1], Number(obj[k]) || COLUMN_DEFAULTS[k]))])) };
    } catch (e) { return { ...COLUMN_DEFAULTS }; }
  }
  function applyColumnWidths() {
    if (!panelHost) return;
    const w = getColumnWidths();
    Object.keys(w).forEach(k => panelHost.style.setProperty('--tsext-col-' + k, w[k] + 'px'));
  }
  function saveColumnWidths(w) { try { lsSet('tsext-column-widths-v6', JSON.stringify(w)); } catch (e) {} }
  function setupColumnResizers() {
    if (!panelHost) return;
    if (!state.colResizing) applyColumnWidths(); // حین درگ، مقادیر زنده همین لحظه اعمال شده‌اند
    const hdr = panelHost.querySelector('.tsext-cols');
    if (!hdr || hdr.__tsextResizeReady) return;
    hdr.__tsextResizeReady = true;
    const rtl = getComputedStyle(panelHost).direction === 'rtl';
    const handles = hdr.querySelectorAll('[data-resize]');
    handles.forEach((cell) => {
      const grip = cell.querySelector('.tsext-col-grip');
      if (!grip) return;
      // prevent double-binding if DOM is re-created with same node reference
      if (grip.__tsextBound) return;
      grip.__tsextBound = true;
      grip.setAttribute('tabindex', '0');
      grip.setAttribute('role', 'separator');
      grip.setAttribute('aria-orientation', 'vertical');
      grip.title = 'کشیدن برای تنظیم عرض ستون';

      const startDrag = (clientX) => {
        const key = cell.getAttribute('data-resize');
        if (!COLUMN_LIMITS[key]) return;
        const widths = getColumnWidths();
        const startX = clientX;
        const startW = widths[key];
        const sign = rtl ? -1 : 1;
        let lastX = clientX;
        let rafId = 0;
        state.colResizing = true;
        state.uiInteracting = true;
        grip.classList.add('is-dragging');
        document.body.classList.add('tsext-col-resizing');
        try { panelHost && panelHost.classList.add('tsext-ui-interacting'); } catch (e) {}

        // فقط CSS var در هر قاب — بدون localStorage تا درگ روان بماند
        const apply = () => {
          const delta = (lastX - startX) * sign;
          const next = Math.max(
            COLUMN_LIMITS[key][0],
            Math.min(COLUMN_LIMITS[key][1], Math.round(startW + delta))
          );
          if (widths[key] !== next) {
            widths[key] = next;
            panelHost.style.setProperty('--tsext-col-' + key, next + 'px');
          }
        };

        const move = (e) => {
          lastX = e.clientX;
          if (!rafId) {
            rafId = requestAnimationFrame(() => {
              rafId = 0;
              apply();
            });
          }
        };
        const up = () => {
          if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
          apply();
          saveColumnWidths(widths);
          state.colResizing = false;
          state.uiInteracting = false;
          grip.classList.remove('is-dragging');
          document.body.classList.remove('tsext-col-resizing');
          try { panelHost && panelHost.classList.remove('tsext-ui-interacting'); } catch (e) {}
          window.removeEventListener('mousemove', move);
          window.removeEventListener('mouseup', up);
          window.removeEventListener('blur', up);
        };
        window.addEventListener('mousemove', move, { passive: true });
        window.addEventListener('mouseup', up, { once: true });
        window.addEventListener('blur', up, { once: true });
      };

      grip.addEventListener('mousedown', (ev) => {
        if (ev.button !== 0) return;
        ev.preventDefault();
        ev.stopPropagation();
        startDrag(ev.clientX);
      });

      // touch support for smoother mobile/tablet resizing
      grip.addEventListener('touchstart', (ev) => {
        if (!ev.touches || !ev.touches[0]) return;
        ev.preventDefault();
        ev.stopPropagation();
        const key = cell.getAttribute('data-resize');
        if (!COLUMN_LIMITS[key]) return;
        const widths = getColumnWidths();
        const startX = ev.touches[0].clientX;
        const startW = widths[key];
        const sign = rtl ? -1 : 1;
        let lastX = startX;
        state.colResizing = true;
        grip.classList.add('is-dragging');
        document.body.classList.add('tsext-col-resizing');

        let rafId = 0;
        const apply = () => {
          const delta = (lastX - startX) * sign;
          const next = Math.max(
            COLUMN_LIMITS[key][0],
            Math.min(COLUMN_LIMITS[key][1], Math.round(startW + delta))
          );
          if (widths[key] !== next) {
            widths[key] = next;
            panelHost.style.setProperty('--tsext-col-' + key, next + 'px');
          }
        };
        const move = (e) => {
          if (!e.touches || !e.touches[0]) return;
          lastX = e.touches[0].clientX;
          if (!rafId) {
            rafId = requestAnimationFrame(() => { rafId = 0; apply(); });
          }
        };
        const up = () => {
          state.colResizing = false;
          apply();
          saveColumnWidths(widths);
          grip.classList.remove('is-dragging');
          document.body.classList.remove('tsext-col-resizing');
          window.removeEventListener('touchmove', move);
          window.removeEventListener('touchend', up);
          window.removeEventListener('touchcancel', up);
        };
        window.addEventListener('touchmove', move, { passive: false });
        window.addEventListener('touchend', up, { once: true });
        window.addEventListener('touchcancel', up, { once: true });
      }, { passive: false });
    });
  }

  // شمارش خطاهای خاموش (فقط این نشست): استثناها و پرمیس‌های دست‌نبرده که در try/catch‌های
  // پراکندهٔ کد می‌پرند اینجا جمع می‌شوند و به‌صورت نشان هشدار در فوتر نمایش داده می‌شوند —
  // در ابزار بازار، شکستِ پنهان بدتر از هشدار آزاردهنده است.
  const tsextErr = { n: 0, last: '', log: [] };
  // opts.quiet: فقط در دفترچه ثبت شود، بدون افزایش شمارندهٔ نشان هشدار (مثلاً قطعی‌های گذرای شبکه)
  function noteError(err, ctx, opts) {
    try {
      const quiet = !!(opts && opts.quiet);
      const msg = String((err && (err.message || err.description)) || err || 'خطای نامشخص').slice(0, 160);
      if (!quiet) { tsextErr.n++; tsextErr.last = (ctx ? '[' + ctx + '] ' : '') + msg; }
      let stack = '';
      try { stack = String((err && err.stack) || '').split(String.fromCharCode(10)).slice(1, 3).map((s) => s.trim()).join(' ← ').slice(0, 220); } catch (e) {}
      tsextErr.log.push({ at: Date.now(), ctx: ctx || '', msg, stack, quiet });
      if (tsextErr.log.length > ERR_LOG_MAX) tsextErr.log.splice(0, tsextErr.log.length - ERR_LOG_MAX);
    } catch (e) {}
    if (!(opts && opts.quiet)) { try { renderErrorBadge(); } catch (e) {} }
  }
  // متن دفترچهٔ خطا (جدیدترین آخر) — برای گزارش کپی‌شده و پنل تشخیصی
  function errLogText(limit) {
    const rows = tsextErr.log.slice(-(limit || ERR_LOG_MAX));
    if (!rows.length) return 'بدون خطا';
    return rows.map((r) => {
      let t = '';
      try { t = new Date(r.at).toLocaleTimeString('fa-IR', { hour12: false }); } catch (e) { t = String(r.at); }
      return t + ' [' + (r.ctx || '—') + ']' + (r.quiet ? ' (بی‌صدا)' : '') + ' ' + r.msg + (r.stack ? ' — ' + r.stack : '');
    }).join(String.fromCharCode(10));
  }
  // ---------- نگهبان سلامت داده (v1.24) ----------
  // اگر tsetmc نام فیلدهای پاسخ را عوض کند، به‌جای این‌که همه‌جا بی‌صدا «–» ببینید، یک بنر روشن بالای لیست
  // می‌گوید کدام پاسخ/فیلد مشکل دارد. هر نوع پاسخ فقط بعد از ۳ پاسخ خرابِ پشت‌سرهم «مشکل‌دار» می‌شود
  // (یک پاسخ ناقصِ گذرا هشدار نمی‌دهد) و با اولین پاسخ سالم، خودکار پاک می‌شود.
  const DATA_SHAPE = {
    closing:    { label: 'ClosingPriceInfo',  fields: ['pDrCotVal', 'pClosing', 'priceYesterday', 'priceMin', 'priceMax', 'priceFirst', 'zTotTran'] },
    bestlimits: { label: 'BestLimits',        fields: ['pMeDem', 'qTitMeDem', 'zOrdMeDem', 'pMeOf', 'qTitMeOf', 'zOrdMeOf'] },
    instrument: { label: 'InstrumentInfo',    fields: ['insCode'], anyOf: ['staticThreshold', 'psGelStaMax', 'PSGelStaMax'] },
    chain:      { label: 'OptionMarketWatch', fields: ['insCode_C', 'strikePrice', 'contractSize', 'remainedDay', 'pDrCotVal_C', 'pClosing_C', 'uaInsCode', 'pDrCotVal_UA', 'pClosing_UA'], anyOf: ['lVal18AFC_C', 'lVal30_C'] },
    search:     { label: 'InstrumentSearch',  fields: ['insCode'], anyOf: ['lVal18AFC', 'lVal30'] },
  };
  const DATA_BAD_STREAK = 3;
  const dataHealth = { bad: Object.create(null), streak: Object.create(null), checked: 0, since: 0 };
  function checkDataShape(kind, obj) {
    const spec = DATA_SHAPE[kind];
    if (!spec || !obj || typeof obj !== 'object') return true;
    dataHealth.checked++;
    const missing = spec.fields.filter((f) => !(f in obj));
    if (spec.anyOf && !spec.anyOf.some((f) => f in obj)) missing.push(spec.anyOf.join('|'));
    if (!missing.length) {
      dataHealth.streak[kind] = 0;
      if (dataHealth.bad[kind]) { delete dataHealth.bad[kind]; try { renderHealthBanner(); } catch (e) {} }
      return true;
    }
    dataHealth.streak[kind] = (dataHealth.streak[kind] || 0) + 1;
    // همیشه کلیدهای دیده‌شده را در لاگ داخلی نگه دار (بدون UI)
    try {
      const seenKeys = Object.keys(obj).slice(0, 30);
      state.lastApiShapeKeys = state.lastApiShapeKeys || Object.create(null);
      state.lastApiShapeKeys[kind] = { missing: missing.slice(), keys: seenKeys, at: Date.now() };
      if (dataHealth.streak[kind] === 1) {
        noteError(spec.label + ': missing=[' + missing.join(',') + '] keys=[' + seenKeys.join(',') + ']', 'data-shape', { quiet: true });
      }
    } catch (eLog) {}
    if (dataHealth.streak[kind] >= DATA_BAD_STREAK && !dataHealth.bad[kind]) {
      dataHealth.bad[kind] = missing;
      if (!dataHealth.since) dataHealth.since = Date.now();
      noteError(spec.label + ': فیلد(های) ' + missing.join(', ') + ' در پاسخ tsetmc نیست', 'data-shape', { quiet: true });
      // بنر سلامت فقط برای توسعه‌دهندهٔ تشخیصی؛ کاربر عادی اگر diag باز نباشد مزاحم نمی‌شود
      try { if (state.diagOpen) renderHealthBanner(); } catch (e) {}
    }
    return false;
  }
  function healthSummary() {
    const kinds = Object.keys(dataHealth.bad);
    if (!kinds.length) return '';
    return kinds.map((k) => DATA_SHAPE[k].label + ' (' + dataHealth.bad[k].join('، ') + ')').join(' · ');
  }
  function renderHealthBanner() {
    if (!panelHost) return;
    let el = panelHost.querySelector('#tsext-health-banner');
    const s = healthSummary();
    if (!s || state.healthDismissed) { if (el) el.remove(); return; }
    if (!el) {
      el = document.createElement('div');
      el.id = 'tsext-health-banner';
      el.className = 'tsext-health-banner';
      el.setAttribute('dir', 'rtl');
      el.setAttribute('role', 'alert');
      const list = panelHost.querySelector('#tsext-list');
      if (list) list.insertBefore(el, list.firstChild); else panelHost.appendChild(el);
      el.addEventListener('click', (e) => {
        const b = e.target && e.target.closest ? e.target.closest('[data-health]') : null;
        if (!b) return;
        state.healthDismissed = true; // فقط همین نشست
        renderHealthBanner();
      });
    }
    el.innerHTML = '<span class="tsext-health-txt">⚠ ساختار دادهٔ tsetmc تغییر کرده است — ' + esc(s)
      + ' · بعضی اعداد ممکن است خالی یا اشتباه نمایش داده شوند؛ احتمالاً به‌روزرسانی افزونه لازم است.</span>'
      + '<button type="button" class="tsext-btn tsext-health-x" data-health="dismiss" title="پنهان کردن تا پایان این نشست">×</button>';
  }
  function renderErrorBadge() {
    const el = panelHost && panelHost.querySelector('#tsext-errbadge');
    if (!el) return;
    if (!tsextErr.n) { el.textContent = ''; el.title = ''; return; }
    el.textContent = '⚠ ' + faDigits(tsextErr.n);
    el.title = 'خطاهای پنهان در این نشست: ' + tsextErr.n + String.fromCharCode(10) + 'آخرین: ' + tsextErr.last + String.fromCharCode(10) + '(کلیک = کپی گزارش مشکل در کلیپ‌بورد)';
  }
  try {
    // خطاهای دست‌نبردهٔ صفحه (از جمله از هندلرهای رویداد). خطاهای اسکریپت‌های خودِ tsetmc هم
    // ممکن است بیایند؛ متن خطا در title نشان، تشخیص آن‌ها را ممکن می‌کند.
    window.addEventListener('error', (ev) => { if (ev.error) noteError(ev.error, 'page'); });
    window.addEventListener('unhandledrejection', (ev) => { noteError(ev.reason, 'promise'); });
  } catch (e) {}


  // ---------- نمادهای اخیر (پایدار — localStorage) ----------
  function getRecentSymbols() {
    try {
      const a = JSON.parse(localStorage.getItem('tsext-recent') || '[]');
      return Array.isArray(a) ? a.filter((x) => x && String(x).trim()).slice(0, 8) : [];
    } catch (e) { return []; }
  }
  function pushRecentSymbol(term) {
    const t = String(term || '').trim();
    if (!t) return;
    try {
      const next = [t].concat(getRecentSymbols().filter((x) => x !== t)).slice(0, 8);
      localStorage.setItem('tsext-recent', JSON.stringify(next));
    } catch (e) {}
  }
  function recentChipsHtml() {
    const list = getRecentSymbols();
    if (!list.length) return '';
    return '<div class="tsext-recent-wrap">'
      + '<div class="tsext-recent-lbl">نمادهای اخیر</div>'
      + list.map((t) => '<button type="button" class="tsext-recent-chip" data-term="' + esc(t) + '">' + esc(t) + '</button>').join('')
      + '</div>';
  }
    // پشتیبان حذف شد (v1.0) — توابع خالی برای جلوگیری از ReferenceError احتمالی
  const BACKUP_PREFIXES = [];
  function backupCollect() { return null; }
  function backupDownload() {}
  function backupValidate() { return 'پشتیبان حذف شده است'; }
  function backupApply() { return false; }
  function toggleBackupMenu() {}
  function backupRestoreSessionAfterReload() {}


  // ---------- موردعلاقه‌ها per-نماد + per-تب/حالت (پایدار — localStorage) ----------
  // محدوده: نماد پایه × استراتژی × زیرحالت (مثلاً جامپ/yield یا تیک/chain)
  // ستاره در یک تب روی تب‌ها و حالت‌های دیگر اثر ندارد.
  const FAV_STORAGE_KEY = 'tsext-favorites-by-scope';
  const FAV_STORAGE_KEY_TERM = 'tsext-favorites-by-term'; // مهاجرت از نسخهٔ per-term
  const FAV_STORAGE_KEY_LEGACY = 'tsext-favorites';
  function currentFavTerm() {
    try {
      if (state.cache && state.cache.term) return String(state.cache.term).trim();
    } catch (e) {}
    try {
      if (panelHost) {
        const inp = $id(panelHost, 'tsext-underlying-' + (state.strategy || 'pospanj'));
        if (inp && String(inp.value || '').trim()) return String(inp.value).trim();
      }
    } catch (e2) {}
    try { if (state.listTerm) return String(state.listTerm).trim(); } catch (e3) {}
    return '';
  }
  function currentFavSubMode() {
    const s = state.strategy || 'pospanj';
    if (s === 'jamp') return String(state.jampMode || 'yield');
    return ''; // pospanj / combo
  }
  function currentFavScope() {
    const term = currentFavTerm();
    if (!term) return '';
    const strat = state.strategy || 'pospanj';
    const sub = currentFavSubMode();
    return term + '::' + strat + (sub ? ('::' + sub) : '');
  }
  function favScopeLabel() {
    const stratNames = { pospanj: 'مثبت‌پنج', combo: 'ترکیبی', jamp: 'جامپ' };
    const jampNames = { yield: 'بازدهی', downshift: 'کاهش اعمال و سرمایه درگیر', upshift: 'افزایش اعمال و سود', challenge: 'چالشی' };
    const s = state.strategy || 'pospanj';
    let lab = stratNames[s] || s;
    if (s === 'jamp') lab += ' / ' + (jampNames[state.jampMode] || state.jampMode || '');
    const term = currentFavTerm();
    return (term ? (term + ' · ') : '') + lab;
  }
  function favSetForScope(scope) {
    const sc = String(scope || '').trim();
    if (!sc) return null;
    if (!state.favoritesMap) state.favoritesMap = Object.create(null);
    if (!state.favoritesMap[sc]) state.favoritesMap[sc] = new Set();
    return state.favoritesMap[sc];
  }
  function loadFavorites() {
    if (!state.favoritesMap) state.favoritesMap = Object.create(null);
    try {
      const raw = localStorage.getItem(FAV_STORAGE_KEY);
      if (raw) {
        const obj = JSON.parse(raw);
        if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
          Object.keys(obj).forEach((scope) => {
            const arr = obj[scope];
            if (Array.isArray(arr)) {
              state.favoritesMap[scope] = new Set(arr.filter((x) => x && String(x).trim()).map(String));
            }
          });
          return;
        }
      }
      // مهاجرت از per-term: کلیدهای قدیمی «نماد» → «نماد::pospanj»
      const termRaw = localStorage.getItem(FAV_STORAGE_KEY_TERM);
      if (termRaw) {
        const obj = JSON.parse(termRaw);
        if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
          Object.keys(obj).forEach((term) => {
            if (term === '__legacy__') return;
            const arr = obj[term];
            if (Array.isArray(arr) && arr.length) {
              const scope = term + '::pospanj';
              state.favoritesMap[scope] = new Set(arr.filter((x) => x && String(x).trim()).map(String));
            }
          });
          try { saveFavorites(); } catch (e) {}
          return;
        }
      }
      const leg = localStorage.getItem(FAV_STORAGE_KEY_LEGACY);
      if (leg) {
        const a = JSON.parse(leg);
        if (Array.isArray(a) && a.length) {
          state.favoritesMap.__legacy__ = new Set(a.filter((x) => x && String(x).trim()).map(String));
        }
      }
    } catch (e) {
      state.favoritesMap = Object.create(null);
    }
  }
  function saveFavorites() {
    try {
      const out = {};
      const map = state.favoritesMap || {};
      Object.keys(map).forEach((scope) => {
        if (scope === '__legacy__') return;
        const set = map[scope];
        if (set && set.size) out[scope] = Array.from(set);
      });
      localStorage.setItem(FAV_STORAGE_KEY, JSON.stringify(out));
    } catch (e) {}
  }
  function favCountForCurrent() {
    const sc = currentFavScope();
    if (!sc) return 0;
    const set = state.favoritesMap && state.favoritesMap[sc];
    return set ? set.size : 0;
  }
  function isFavorite(key) {
    if (!key) return false;
    const k = String(key);
    const sc = currentFavScope();
    if (sc && state.favoritesMap && state.favoritesMap[sc] && state.favoritesMap[sc].has(k)) return true;
    // legacy سراسری فقط اگر هنوز scope نساخته‌ایم
    if (!sc && state.favoritesMap && state.favoritesMap.__legacy__ && state.favoritesMap.__legacy__.has(k)) return true;
    return false;
  }
  function toggleFavorite(key) {
    const k = String(key || '');
    const sc = currentFavScope();
    if (!k || !sc) {
      try { setStatus('ابتدا نماد پایه و تب استراتژی را مشخص کنید'); } catch (e) {}
      return false;
    }
    const set = favSetForScope(sc);
    if (set.has(k)) set.delete(k);
    else set.add(k);
    try {
      if (state.favoritesMap.__legacy__) {
        state.favoritesMap.__legacy__.delete(k);
        if (!state.favoritesMap.__legacy__.size) delete state.favoritesMap.__legacy__;
      }
    } catch (e) {}
    saveFavorites();
    return set.has(k);
  }
  function passesFavFilter(itemOrKey) {
    if (!state.favOnly) return true;
    if (typeof itemOrKey === 'string') return isFavorite(itemOrKey);
    const k = (itemOrKey && itemOrKey.key) || (itemOrKey && itemOrKey.spec && itemOrKey.spec.key) || rowKey(itemOrKey && (itemOrKey.spec || itemOrKey));
    return isFavorite(k);
  }
  function filterFavItems(items) {
    if (!state.favOnly || !items || !items.length) return items || [];
    return items.filter((it) => passesFavFilter(it));
  }
  function updateFavFilterBtn() {
    try {
      const sel = panelHost && panelHost.querySelector('#tsext-fav-filter');
      if (!sel) return;
      const n = favCountForCurrent();
      const lab = favScopeLabel();
      const optAll = sel.querySelector('option[value="all"]');
      const optFav = sel.querySelector('option[value="fav"]');
      if (optAll) optAll.textContent = 'همه قراردادها';
      if (optFav) {
        optFav.textContent = n > 0 ? ('فقط موردعلاقه ★ (' + n + ')') : 'فقط موردعلاقه ★';
      }
      const want = state.favOnly ? 'fav' : 'all';
      // اجبار به‌روزرسانی نمایش کشویی (بعضی مرورگرها متن option انتخاب‌شده را کش می‌کنند)
      sel.value = want === 'fav' ? 'all' : 'fav';
      sel.value = want;
      sel.title = state.favOnly
        ? ('فقط موردعلاقه‌های این بخش: ' + lab + (n ? (' · ' + n + ' مورد') : ' · خالی'))
        : (n ? ('همه · ' + n + ' موردعلاقه در: ' + lab) : ('همه قراردادها · محدوده: ' + lab));
      // نشانگر کنار کشویی (همیشه همگام با عدد واقعی)
      let badge = panelHost.querySelector('#tsext-fav-count-badge');
      if (!badge) {
        const wrap = sel.closest('label') || sel.parentElement;
        if (wrap) {
          badge = document.createElement('span');
          badge.id = 'tsext-fav-count-badge';
          badge.style.cssText = 'font-size:11px;font-weight:800;color:#d97706;margin-inline-start:2px;white-space:nowrap;';
          wrap.appendChild(badge);
        }
      }
      if (badge) {
        badge.textContent = n > 0 ? ('★' + n) : '';
        badge.title = n > 0 ? (n + ' موردعلاقه در این بخش') : '';
      }
    } catch (e) {}
  }
  // همگام‌سازی ظاهر ستاره‌های可见 با scope فعلی (همه تب‌ها)
  function syncFavStarsInDom() {
    try {
      const el = listEl();
      if (!el) return;
      el.querySelectorAll('.tsext-bar').forEach((b) => {
        const k = b.getAttribute('data-key') || '';
        const favBtn = b.querySelector('.tsext-bar-fav');
        if (!favBtn || !k) return;
        const on = isFavorite(k);
        favBtn.classList.toggle('on', on);
        favBtn.textContent = on ? '★' : '☆';
        favBtn.title = on ? 'حذف از موردعلاقه' : 'افزودن به موردعلاقه';
        favBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
    } catch (e) {}
  }
  function applyFavFilterFromSelect() {
    try {
      const sel = panelHost && panelHost.querySelector('#tsext-fav-filter');
      state.favOnly = !!(sel && sel.value === 'fav');
    } catch (e) { state.favOnly = false; }
    updateFavFilterBtn();
    try { saveSettings(); } catch (e) {}
    state.forceReorder = true;
    if (state.cache) {
      try { renderActive(); } catch (e) {}
    }
    const n = favCountForCurrent();
    setStatus(state.favOnly
      ? ('نمایش: فقط موردعلاقه این بخش' + (n ? (' · ' + n + ' مورد') : ' · هنوز ستاره‌ای در این تب نزده‌اید'))
      : 'نمایش: همه قراردادهای این بخش');
  }

  function emptyGuideHtml() {
    return '<div class="tsext-empty tsext-empty-guide">'
      + '<div class="tsext-empty-title">نماد پایه را وارد کنید</div>'
      + '<div class="tsext-empty-sub">نام سهم پایه را بنویسید و Enter بزنید · یا از نمادهای اخیر / دیدبان انتخاب کنید</div>'
      + recentChipsHtml()
      + '</div>';
  }
  function skeletonListHtml(term) {
    const t = term ? (' · ' + esc(term)) : '';
    let rows = '';
    for (let i = 0; i < 8; i++) {
      rows += '<div class="tsext-skel-row" style="animation-delay:' + (i * 40) + 'ms"><span class="sk sk-a"></span><span class="sk sk-b"></span><span class="sk sk-c"></span><span class="sk sk-d"></span></div>';
    }
    return '<div class="tsext-skel" aria-hidden="true"><div class="tsext-skel-label">در حال بارگذاری' + t + '</div>' + rows + '</div>';
  }
  // هنگام تعویض نماد: ردیف‌های قبلی را کم‌رنگ نگه دار و اسکلتون را روی آن‌ها بنشان (بدون پرش سفید)
  function showLoadingOverlay(listEl, term) {
    if (!listEl) return;
    const hasBars = !!listEl.querySelector('.tsext-bar');
    if (hasBars) {
      listEl.classList.add('tsext-list-loading');
      let overlay = listEl.querySelector('.tsext-skel-overlay');
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'tsext-skel-overlay';
        overlay.setAttribute('aria-hidden', 'true');
        listEl.appendChild(overlay);
      }
      const t = term ? (' · ' + esc(term)) : '';
      overlay.innerHTML = '<div class="tsext-skel-label">بارگذاری' + t + '…</div>';
    } else {
      listEl.innerHTML = skeletonListHtml(term);
    }
  }
  function clearLoadingOverlay(listEl) {
    if (!listEl) return;
    try {
      listEl.classList.remove('tsext-list-loading');
      const o = listEl.querySelector('.tsext-skel-overlay');
      if (o) o.remove();
    } catch (e) {}
  }
  function getChainCache(term) {
    const k = String(term || '').trim();
    if (!k) return null;
    const hit = state.chainCache[k];
    if (!hit || !hit.rows || !hit.rows.length) return null;
    if ((Date.now() - (hit.at || 0)) > (state.chainCacheTtlMs || 40000)) return null;
    return hit;
  }
  function putChainCache(payload) {
    if (!payload || !payload.term || !payload.rows) return;
    state.chainCache[String(payload.term)] = {
      term: payload.term,
      rows: payload.rows,
      livePrice: payload.livePrice,
      livePriceIsLive: payload.livePriceIsLive,
      at: Date.now(),
    };
    // سقف حافظه: حداکثر ۱۲ نماد
    const keys = Object.keys(state.chainCache);
    if (keys.length > 12) {
      keys.sort((a, b) => (state.chainCache[a].at || 0) - (state.chainCache[b].at || 0));
      keys.slice(0, keys.length - 12).forEach((k) => { delete state.chainCache[k]; });
    }
  }

  const LIST_PAGE = 40;
  function limitListItems(items) {
    if (!items || !items.length) return { shown: [], more: 0 };
    if (state.showAllList || items.length <= LIST_PAGE) return { shown: items, more: 0 };
    return { shown: items.slice(0, LIST_PAGE), more: items.length - LIST_PAGE };
  }
  function showMoreBtn(more) {
    if (!(more > 0)) return null;
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tsext-show-more';
    b.textContent = 'نمایش ' + faDigits(more) + ' مورد دیگر…';
    b.addEventListener('click', () => {
      state.showAllList = true;
      if (state.cache) renderActive();
    });
    return b;
  }
  function appendLimitedBars(el, softItems) {
    state.forceReorder = false;
    // ثبت نماد فعلی روی لیست — تا سوییچ نماد بعدی لیست قبلی را نگه ندارد
    try { state.listTerm = (state.cache && state.cache.term) ? String(state.cache.term) : null; } catch (e) { state.listTerm = null; }
    if (el) {
      try {
        if (state.listTerm) el.setAttribute('data-list-term', state.listTerm);
        else el.removeAttribute('data-list-term');
      } catch (e2) {}
    }
    const beforeFav = softItems ? softItems.length : 0;
    softItems = filterFavItems(softItems);
    if (state.favOnly && (!softItems || !softItems.length)) {
      const why = (beforeFav > 0)
        ? 'هیچ‌کدام از قراردادهای این لیست ستاره‌دار نیستند.'
        : 'برای این نماد/تب هنوز موردعلاقه‌ای ثبت نشده.';
      el.innerHTML = ''
        + '<div class="tsext-empty tsext-empty-fav">'
        + '<div class="tsext-empty-title">موردعلاقه‌ای برای نمایش نیست</div>'
        + '<div class="tsext-empty-sub">' + why + '</div>'
        + '<button type="button" class="tsext-btn tsext-fav-showall" id="tsext-fav-showall-btn">نمایش همه قراردادها</button>'
        + '</div>';
      try {
        const btn = el.querySelector('#tsext-fav-showall-btn');
        if (btn) btn.addEventListener('click', () => {
          state.favOnly = false;
          try {
            const sel = panelHost && panelHost.querySelector('#tsext-fav-filter');
            if (sel) sel.value = 'all';
          } catch (e) {}
          try { updateFavFilterBtn(); } catch (e) {}
          try { saveSettings(); } catch (e) {}
          state.forceReorder = true;
          if (state.cache) renderActive();
          setStatus('نمایش: همه قراردادهای این بخش');
        });
      } catch (e) {}
      try { updateFavFilterBtn(); } catch (e) {}
      return;
    }
    const { shown, more } = limitListItems(softItems);
    const scroll = el.scrollTop;
    const frag = document.createDocumentFragment();
    shown.forEach((it) => frag.appendChild(barRow(it.spec || it)));
    const btn = showMoreBtn(more);
    if (btn) frag.appendChild(btn);
    // یک‌جا جایگزین کن تا فریم سفید میانی نیاید
    el.replaceChildren(frag);
    el.scrollTop = scroll;
    requestAnimationFrame(() => { try { el.scrollTop = scroll; } catch (e) {} });
    try { updateFavFilterBtn(); } catch (e) {}
  }

  function setStatus(t) {
    const el = panelHost && panelHost.querySelector('#tsext-status');
    if (!el) return;
    el.textContent = t || '';
  }

  // جلوگیری از پرش: اسکرول را نگه دار و اگر لیست از نظر داده عوض نشده، DOM را از نو نساز
  function beginListRender() {
    const el = listEl();
    return { el, scroll: el ? el.scrollTop : 0 };
  }
  function endListRender(ctx) {
    if (!ctx || !ctx.el) return;
    const s = ctx.scroll;
    const restore = () => { try { ctx.el.scrollTop = s; } catch (e) {} };
    restore();
    requestAnimationFrame(() => {
      restore();
      requestAnimationFrame(restore);
    });
    // بعد از تغییر layout (مثلاً باز شدن جزئیات) چند فریم دیگر هم نگه دار
    setTimeout(restore, 50);
    setTimeout(restore, 150);
    // بعد از رندر دوباره، نوار قراردادِ جزئیاتِ باز را برجسته نگه دار
    if (state.obKey && panelHost) {
      panelHost.querySelectorAll('.tsext-bar.active-ob').forEach((el) => el.classList.remove('active-ob'));
      const bars = panelHost.querySelectorAll('.tsext-bar[data-key]');
      bars.forEach((b) => {
        const k = b.getAttribute('data-key') || '';
        const spec = b.__tsextSpec || {};
        const ob = String(state.obKey);
        // فقط تطبیق دقیق کلید — در ترکیبی همه ردیف‌ها insCodeBuy مشترک دارند
        // و indexOf باعث فعال شدن هم‌زمان همه کارت‌ها می‌شد
        const match = (ob === k)
          || (spec.insCode && (ob === String(spec.insCode) || ob === ('i:' + spec.insCode)))
          || (spec.key && ob === String(spec.key));
        if (match) {
          b.classList.add('active-ob');
          // عمداً scrollIntoView نیست — اسکرول لیست باید همان‌جایی بماند که کاربر بود
        }
      });
    }
    observeBars();
  }

  // جایگزینی محتوای لیست بدون فریم سفید خالی — اسکرول هم حفظ می‌شود
  function replaceListContent(el, htmlOrNodes, strategy) {
    if (!el) return;
    const scroll = el.scrollTop;
    if (typeof htmlOrNodes === 'string') {
      el.innerHTML = htmlOrNodes;
    } else if (htmlOrNodes && htmlOrNodes.nodeType) {
      el.replaceChildren(htmlOrNodes);
    } else {
      el.innerHTML = '';
    }
    if (strategy) el.setAttribute('data-strategy', strategy);
    el.scrollTop = scroll;
    requestAnimationFrame(() => { try { el.scrollTop = scroll; } catch (e) {} });
  }

  function softListSignature(items) {
    return items.map((it) => [
      it.key || '',
      it.cls || '',
      (Math.round((it.profitPct || 0) * 100) / 100),
      it.strike || '',
      it.daysText || '',
      it.dateText || '',
    ].join(':')).join('|');
  }
  // به‌روزرسانی نرم هدر/ستون‌ها — این بلوک اکنون در ظرف ثابت #tsext-list-hdr است (جدا از ردیف‌های
  // قابل‌اسکرول)، بدون هیچ فیلد قابل‌فوکوسی؛ پس جایگزینی کامل innerHTML آن کاملاً بی‌خطر و ساده‌تر است

  // رندر لیست: رفرش خودکار هرگز DOM را خالی نکند (ضد سفید شدن)
  function applyListUpdate(softItems, strategy, hdrHtml, sort, statusTxt) {
    // اگر نماد لیست با نماد فعلی cache یکی نیست، هرگز لیست قبلی را نگه ندار
    const curTerm = state.cache && state.cache.term ? String(state.cache.term) : '';
    const listMismatch = !!(curTerm && state.listTerm && state.listTerm !== curTerm);
    if (listMismatch) state.forceReorder = true;

    if (!listMismatch && trySoftUpdateList(softItems, strategy)) {
      softUpdateChrome(hdrHtml, sort, statusTxt);
      return true;
    }
    const el = listEl();
    // فقط وقتی همان نماد است و کاربر فیلتر نزده، لیست فعلی را نگه دار (ضد پرش رفرش خودکار)
    if (!listMismatch && el && el.querySelector('.tsext-bar') && !state.forceReorder) {
      softUpdateChrome(hdrHtml, sort, statusTxt);
      return true;
    }
    return false; // نیاز به بازسازی کامل (تعویض نماد / فیلتر / اولین بار)
  }

  function softUpdateChrome(hdrHtml, sort, statusTxt) {
    if (hdrHtml != null) setListHeader(hdrHtml);
    if (statusTxt != null) setStatus(statusTxt);
    setUpdatedNow();
  }

  // ----- from src/06a-list-render-softupdate.js -----
  // ========== MODULE [6] soft-update ========================================
  // به‌روزرسانی نرم لیست: اگر مجموعهٔ کلید ردیف‌ها نسبت به DOM فعلی یکسان باشد (حتی با ترتیب
  // متفاوت — مثلاً مرتب‌سازی بر اساس سود که با هر رفرش جابه‌جا می‌شود)، گره‌های DOM را درجا
  // مرتب می‌کند و فقط متن/کلاس سلول‌ها را عوض می‌کند تا اسکرول نپرد و لیست پرش/فلیکر نکند.
  // اگر مجموعهٔ کلیدها واقعاً عوض شده باشد (ردیف اضافه/کم شده)، false برمی‌گردد و رندر کامل انجام می‌شود.
  function trySoftUpdateList(items, strategy) {
    if (state.uiInteracting || state.colResizing) return false;
    // تعویض نماد: soft-update ممنوع — لیست نماد قبلی نباید با اعداد جدید patch شود
    const curTerm = state.cache && state.cache.term ? String(state.cache.term) : '';
    if (curTerm && state.listTerm && state.listTerm !== curTerm) return false;
    items = filterFavItems(items);
    const el = listEl();
    if (!el) return false;
    const domTerm = el.getAttribute('data-list-term') || '';
    if (curTerm && domTerm && domTerm !== curTerm) return false;
    // اگر تب عوض شده، soft-update ممنوع — هدر/لیست تب قبلی قاطی نشود
    if (strategy && el.getAttribute('data-strategy') && el.getAttribute('data-strategy') !== strategy) return false;
    const bars = el.querySelectorAll('.tsext-bar');
    if (!bars.length) return false;
    // اگر تعداد یا مجموعهٔ کلیدها فرق دارد، soft-update نکن — ردیف کهنه نماند (تعویض قرارداد/نماد)
    if (bars.length !== items.length) {
      if (!state.forceReorder) {
        // فقط وقتی همهٔ کلیدهای جدید در DOM هستند و صرفاً تعداد DOM بیشتر است (حذف نشده)،
        // باز هم full render امن‌تر است تا ردیف قدیمی روی صفحه نماند.
      }
      return false;
    }
    if (bars.length !== items.length) return false;
    // نقشهٔ کلید → گرهٔ DOM؛ اگر مجموعهٔ کلیدها (بدون ترتیب) یکسان نباشد، soft-update ممکن نیست
    const domByKey = new Map();
    for (let i = 0; i < bars.length; i++) domByKey.set(bars[i].getAttribute('data-key') || '', bars[i]);
    if (domByKey.size !== items.length) return false;
    for (let i = 0; i < items.length; i++) {
      if (!domByKey.has(items[i].key || '')) return false;
    }
    // رفرش خودکار ترتیب را عوض نکند — فقط وقتی کاربر مرتب‌سازی/فیلتر زده (forceReorder)
    if (state.forceReorder) {
      let needReorder = false;
      const barsNow = el.querySelectorAll('.tsext-bar');
      for (let i = 0; i < items.length; i++) {
        if ((barsNow[i] && barsNow[i].getAttribute('data-key')) !== (items[i].key || '')) {
          needReorder = true; break;
        }
      }
      if (needReorder) {
        const _scrollKeep = el.scrollTop;
        for (let i = 0; i < items.length; i++) {
          const node = domByKey.get(items[i].key || '');
          if (node) el.appendChild(node);
        }
        el.scrollTop = _scrollKeep;
        requestAnimationFrame(() => { try { el.scrollTop = _scrollKeep; } catch (e) {} });
      }
      state.forceReorder = false;
    }
    // مشخصات جزئیات را هم‌اکنون به‌روز کن (نه داخل rAF) تا پنل جزئیاتِ باز با کارمزد/قیمت دستی هم‌خوان بماند
    for (let i = 0; i < items.length; i++) {
      const b0 = domByKey.get(items[i].key || '');
      if (b0 && items[i].spec) b0.__tsextSpec = items[i].spec;
    }
    // فقط اعداد/متن را با rAF بچ کن تا چند تیک پشت‌سرهم باعث jank نشود
    const applyCellUpdates = () => {
      for (let i = 0; i < items.length; i++) {
        const b = domByKey.get(items[i].key || '');
        const it = items[i];
        if (!b) continue;
        if (it.spec) b.__tsextSpec = it.spec;
        try {
          const inc = !!(it.incomplete || it.noExec || (it.spec && (it.spec.incomplete || it.spec.noExec || it.spec.partialExec)));
          b.classList.toggle('tsext-incomplete', inc);
        } catch (eInc) {}
        const profit = b.querySelector('.tsext-bar-profit');
        if (profit) {
          const newTxt = (it.profitDisplay != null ? it.profitDisplay : (upc(it.profitPct) + (it.profitUnit || '٪')));
          const oldN = parseFloat(String(profit.textContent).replace(/[^\d.\-+]/g, ''));
          const newN = parseFloat(String(newTxt).replace(/[^\d.\-+]/g, ''));
          if (profit.textContent !== newTxt) {
            profit.textContent = newTxt;
            profit.className = 'tsext-bar-cell tsext-bar-profit ' + percol(it.profitPct);
            if (!isNaN(oldN) && !isNaN(newN) && newN !== oldN) {
              const fc = newN > oldN ? 'tsext-flash-up' : 'tsext-flash-down';
              void profit.offsetWidth;
              profit.classList.add(fc);
              b.classList.add(fc);
              setTimeout(() => { try { profit.classList.remove(fc); b.classList.remove(fc); } catch (e) {} }, 480);
              let delta = profit.querySelector('.tsext-bar-delta');
              if (!delta) { delta = document.createElement('span'); delta.className = 'tsext-bar-delta'; profit.appendChild(delta); }
              delta.className = 'tsext-bar-delta ' + (newN > oldN ? 'up' : 'down');
              delta.textContent = (newN > oldN ? '▲' : '▼');
              setTimeout(() => { try { delta.textContent = ''; } catch (e) {} }, 1800);
            }
          } else {
            profit.className = 'tsext-bar-cell tsext-bar-profit ' + percol(it.profitPct);
          }
          state.prevProfitByKey[it.key] = it.profitPct;
        }
        const strike = b.querySelector('.tsext-bar-strike');
        if (strike && it.strike != null && strike.textContent !== String(it.strike)) strike.textContent = it.strike;
        const days = b.querySelector('.tsext-bar-days');
        if (days && it.daysText != null && days.textContent !== String(it.daysText)) days.textContent = it.daysText;
        const date = b.querySelector('.tsext-bar-date');
        if (date && it.dateText != null && date.textContent !== String(it.dateText)) date.textContent = it.dateText;
        const risk = b.querySelector('.tsext-bar-risk');
        if (risk) {
          const ccls = it.cls || b.getAttribute('data-c') || 'X';
          const rl = riskLabel(ccls);
          const rcol = classColor(ccls);
          if (risk.textContent !== rl.short) risk.textContent = rl.short;
          risk.title = rl.text;
          risk.className = 'tsext-bar-risk tsext-risk-' + rl.level;
          risk.style.setProperty('color', rcol, 'important');
          risk.style.setProperty('border-color', rcol, 'important');
          risk.style.setProperty('background', 'color-mix(in srgb,' + rcol + ' 22%,transparent)', 'important');
          // شکل کادر ریسک را مستقل از CSSهای میزبان، کپسولی و یکسان نگه می‌داریم.
          risk.style.setProperty('border-radius', '999px', 'important');
          risk.style.setProperty('padding', '3px 7px', 'important');
        }
        if (it.cls) {
          b.setAttribute('data-c', it.cls);
          const strip = b.querySelector('.tsext-bar-strip');
          if (strip) strip.style.background = classColor(it.cls);
          const clsEl = b.querySelector('.tsext-bar-class');
          if (clsEl) {
            if (clsEl.textContent !== it.cls) clsEl.textContent = it.cls;
            clsEl.style.color = classColor(it.cls);
            clsEl.style.borderColor = classColor(it.cls);
          }
        }
        b.classList.remove('tsext-plvl-hi', 'tsext-plvl-mid', 'tsext-plvl-lo', 'tsext-plvl-neg');
        const pl = profitLevelClass(it.profitPct);
        if (pl) b.classList.add(pl);
        if (it.spec) b.__tsextSpec = it.spec;
        // همگام ستاره با scope فعلی (تب/حالت)
        try {
          const favBtn = b.querySelector('.tsext-bar-fav');
          if (favBtn) {
            const on = isFavorite(it.key || b.getAttribute('data-key') || '');
            favBtn.classList.toggle('on', on);
            favBtn.textContent = on ? '★' : '☆';
            favBtn.title = on ? 'حذف از موردعلاقه' : 'افزودن به موردعلاقه';
            favBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
          }
        } catch (eFav) {}
      }
      try { updateFavFilterBtn(); } catch (e) {}
      // جزئیات باز: بعد از به‌روز شدن __tsextSpec، محاسبات پنل را هم تازه کن
      try { if (typeof refreshOpenDetailCalc === 'function') refreshOpenDetailCalc(); } catch (eR) {}
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(applyCellUpdates);
    else applyCellUpdates();
    // یک‌بار هم هم‌اکنون (بدون انتظار rAF) تا با تغییر دستی کارمزد/قیمت لحظه‌ای باشد
    try { if (typeof refreshOpenDetailCalc === 'function') refreshOpenDetailCalc(); } catch (eR2) {}
    return true;
  }
  function priceInfoEl() { return panelHost.querySelector('#tsext-priceinfo'); }

  const SORTS = {
    profit: { key: 'profit', label: 'بیشترین سود' },
    name:   { key: 'name',   label: 'نماد' },
    date:   { key: 'date',   label: 'تاریخ اعمال' },
    strike: { key: 'strike', label: 'قیمت اعمال' },
    class:  { key: 'class',  label: 'کلاس‌بندی' },
  };
  const CLASS_ORDER = { A: 0, B: 1, X: 2, '−B': 3, '−A': 4 };

  // استایل‌ها → src/06c-styles.js (CSS, CSS_V129, ensureStyleBlock)

  // ensureStyleBlock → src/06c-styles.js

  function applyStrategyAccent() {
    if (!panelHost) return;
    const s = state.strategy || 'pospanj';
    // accent یکپارچه — رنگ از تم اصلی (applyTheme) می‌آید و دیگر به‌ازای هر تب تغییر نمی‌کند
    STRATS.forEach((k) => panelHost.classList.toggle('tsext-s-' + k, k === s));
  }
  function applyTheme() {
    if (!panelHost) return;
    const t = th();
    const set = (k, v) => { try { panelHost.style.setProperty('--tsext-' + k, v); } catch (e) {} };
    set('bg', t.bg); set('panel', t.panel); set('panel2', t.panel2);
    set('fg', t.fg); set('bright', t.bright); set('muted', t.muted); set('border', t.border); set('input', t.inputBg);
    set('accent', t.accent); set('green', t.green); set('red', t.red); set('orange', t.orange);
    set('sw-A', t.sw.A); set('sw-B', t.sw.B); set('sw-X', t.sw.X); set('sw-mB', t.sw.mB); set('sw-mA', t.sw.mA);
    applyStrategyAccent(); // accent تب فعال روی تم پایه می‌نشیند
    panelHost.querySelectorAll('.tsext-bar').forEach((el) => {
      const c = el.getAttribute('data-c');
      if (c) {
        const strip = el.querySelector('.tsext-bar-strip');
        if (strip) strip.style.background = classColor(c);
      }
    });
    panelHost.querySelectorAll('.tsext-chip').forEach((el) => {
      const c = el.getAttribute('data-c');
      if (c) { const col = classColor(c); el.style.color = col; el.style.borderColor = col; }
    });
    // همگام‌سازی رنگ/پس‌زمینه ستون ریسک با کلاس همان ردیف
    panelHost.querySelectorAll('.tsext-bar-risk').forEach((el) => {
      const bar = el.closest('.tsext-bar');
      const c = (bar && bar.getAttribute('data-c')) || 'X';
      const col = classColor(c);
      el.style.setProperty('color', col, 'important');
      el.style.setProperty('border-color', col, 'important');
      el.style.setProperty('background', 'color-mix(in srgb,' + col + ' 22%,transparent)', 'important');
    });
  }

  function getZoom() {
    const v = Number(lsGet('tsext-zoom'));
    return (v && v >= 0.6 && v <= 3) ? v : 1;
  }
  function setZoom(z) {
    const clamped = Math.round(Math.max(0.6, Math.min(3, z)) * 100) / 100;
    lsSet('tsext-zoom', String(clamped));
    applyZoomToList();
    return clamped;
  }
  function applyZoomToList() {
    // زوم فقط روی لیست کارت‌ها اعمال می‌شود، نه روی هدر/دکمه‌ها — تا دکمه‌های زوم و ورودی‌ها ثابت بمانند
    if (panelHost) {
      const list = panelHost.querySelector('#tsext-list');
      if (list) list.style.zoom = String(getZoom());
    }
  }
  // زوم مستقل برای پنل جزئیات (سفارشات/محاسبات) — دقیقاً مثل زوم صفحهٔ اصلی، اما جدا ذخیره می‌شود
  // تا بزرگ‌نمایی این دو پنل به هم گره نخورد
  function getObZoom() {
    const v = Number(lsGet('tsext-ob-zoom'));
    return (v && v >= 0.6 && v <= 3) ? v : 1;
  }
  function setObZoom(z) {
    const clamped = Math.round(Math.max(0.6, Math.min(3, z)) * 100) / 100;
    lsSet('tsext-ob-zoom', String(clamped));
    applyZoomToOb();
    return clamped;
  }
  function applyZoomToOb() {
    if (panelHost) {
      const body = panelHost.querySelector('#tsext-obpanel-body');
      if (body) body.style.zoom = String(getObZoom());
    }
  }

  // چیدمان پیش‌فرض هنگام باز شدن:
  // • ارتفاع: تقریباً کامل از بالا تا پایین (با فاصلهٔ کوچک برای دستهٔ resize)
  // • عرض: به‌اندازهٔ کافی برای دیدن همهٔ سرستون‌ها و نوشته‌ها
  // • چپ یا راست: بسته به حالت آینه (mirror)
  // کاربر بعداً می‌تواند از هر طرف اندازه را عوض کند و همان ذخیره می‌شود.
  const TASKBAR_GAP = 12;
  function isMirror() {
    try { return lsGet('tsext-mirror') === '1'; } catch (e) { return false; }
  }
  // اگر چیدمانِ ذخیره‌شده بیرون از صفحه بیفتد، داخل می‌آورد و ارتفاع را به سقف پنجره محدود می‌کند

  // ----- from src/06c-styles.js -----
  // ========== MODULE [6c] styles =============================================
  // ظاهر: معماری @layer (tokens/base/components/theme/patches/pro) — selectorهای تکراری ادغام شده‌اند.
  // تزریق: ensureStyleBlock() → <style id="tsext-style">
  // اولویت لایه: tsext-tokens → base → components → theme → patches → pro

  const CSS = `
  /* Layered architecture — tokens → base → components → theme → patches → pro */
  /* Order is declared in ensureStyleBlock */

  @layer tsext-tokens {

:root{
    --tsext-r-xxs:2px; --tsext-r-xs:4px; --tsext-r-sm:6px; --tsext-r-md:8px;
    --tsext-r-lg:10px; --tsext-r-xl:12px; --tsext-r-pill:999px;
    --tsext-fs-xxs:9.5px; --tsext-fs-xs:10.5px; --tsext-fs-sm:11px; --tsext-fs-md:12px;
    --tsext-fs-base:13px; --tsext-fs-lg:14px; --tsext-fs-xl:15px; --tsext-fs-2xl:17px;
    --tsext-fs-3xl:20px; --tsext-fs-hero:28px;
  }

#tsext-host{
  --tsext-r-xxs: 2px;
  --tsext-r-xs: 4px;
  --tsext-r-xl: 12px;
  --tsext-r-pill: 999px;
  --tsext-fs-base: 13px;
  --tsext-fs-md: 12px;
  --tsext-fs-sm: 11px;
  --tsext-fs-xs: 10.5px;
  --tsext-fs-xxs: 9.5px;
  --tsext-fs-lg: 14px;
  --tsext-fs-xl: 15px;
  --tsext-fs-2xl: 17px;
  --tsext-fs-3xl: 20px;
  --tsext-fs-hero: 28px;
  --tsext-col-class: 38px;
  --tsext-col-name: 260px;
  --tsext-col-strike: 64px;
  --tsext-col-days: 44px;
  --tsext-col-date: 92px;
  --tsext-col-risk: 110px;
  --tsext-col-profit: 96px;
  --tsext-col-actions: 92px;
  --tsext-grid-gap: 6px;
  --tsext-grid-cols: 4px
      var(--tsext-col-class)
      minmax(200px, var(--tsext-col-name))
      minmax(50px, var(--tsext-col-strike))
      minmax(36px, var(--tsext-col-days))
      minmax(78px, var(--tsext-col-date))
      minmax(85px, var(--tsext-col-risk))
      minmax(72px, var(--tsext-col-profit))
      var(--tsext-col-actions);
  --tsext-grid-cols-narrow: 4px 28px minmax(0,1.3fr) minmax(40px,0.7fr)
      minmax(32px,0.45fr) minmax(48px,0.75fr) 78px 50px;
  position: fixed;
  display: flex;
  flex-direction: column;
  overflow: visible;
  border-radius: var(--tsext-r-lg);
  font-size: var(--tsext-fs-base);
  line-height: 1.5;
  font-family: 'Vazirmatn','Segoe UI',Tahoma,Arial,sans-serif;
  color: var(--tsext-fg);
  box-shadow: var(--tsext-shadow);
  resize: none;
  min-width: 420px;
  min-height: 360px;
  z-index: 2147483647;
  transition: none;
  letter-spacing: .01em;
  --tsext-soft-shadow: 0 10px 30px rgba(15,23,42,.10),0 2px 8px rgba(15,23,42,.06);
  --tsext-float-shadow: 0 18px 48px rgba(15,23,42,.18),0 5px 16px rgba(15,23,42,.08);
  --tsext-bg: #f5f7fb;
  --tsext-panel: #ffffff;
  --tsext-panel2: #f7f8ff;
  --tsext-fg: #334155;
  --tsext-bright: #0f172a;
  --tsext-muted: #5b6b80;
  --tsext-border: #dbe3ef;
  --tsext-input: #ffffff;
  --tsext-accent: #4f46e5;
  --tsext-green: #047857;
  --tsext-red: #ef4444;
  --tsext-orange: #b45309;
  --tsext-sw-a: #047857;
  --tsext-sw-b: #4d7c0f;
  --tsext-sw-x: #0e7490;
  --tsext-sw-mb: #b45309;
  --tsext-sw-ma: #f43f5e;
  --tsext-r-sm: 10px;
  --tsext-r-md: 15px;
  --tsext-r-lg: 20px;
  --tsext-shadow: 0 24px 70px rgba(15,23,42,.16),0 8px 28px rgba(79,70,229,.08),0 0 0 1px rgba(148,163,184,.18);
  background: radial-gradient(110% 32% at 0% 0%, rgba(99,102,241,.12), transparent 52%),
      radial-gradient(85% 28% at 100% 0%, rgba(6,182,212,.10), transparent 50%),
      var(--tsext-bg);
  border: 1px solid var(--tsext-border);
  --tsext-surface: color-mix(in srgb,var(--tsext-panel) 94%,var(--tsext-bg));
  --tsext-surface2: color-mix(in srgb,var(--tsext-panel2) 88%,var(--tsext-bg));
  --tsext-line: color-mix(in srgb,var(--tsext-border) 78%,transparent);
  --tsext-soft: color-mix(in srgb,var(--tsext-accent) 8%,var(--tsext-panel));
  --tsext-shadow-soft: 0 5px 18px color-mix(in srgb,#000 10%,transparent);
  font-weight: 600;
  --tsext-ease: cubic-bezier(.22,.68,0,1.1);
  --tsext-ease-out: cubic-bezier(.16,1,.3,1);
  font-family: 'Vazirmatn','Segoe UI',Tahoma,Arial,sans-serif !important;
}
  
  }

  @layer tsext-base {
  /* پوستهٔ حداقلی میزبان — چیدمان اصلی در components و pro است */
  #tsext-host {
    box-sizing: border-box;
    font-family: 'Vazirmatn', Tahoma, Arial, sans-serif;
  }
  #tsext-host *, #tsext-host *::before, #tsext-host *::after {
    box-sizing: border-box;
  }
  }

  @layer tsext-components {
.tsext-disclaimer{
    flex-shrink:0; padding:4px 12px; font-size:var(--tsext-fs-xxs); font-weight:700;
    color:var(--tsext-muted); text-align:center; opacity:.85;
    border-top:1px dashed color-mix(in srgb,var(--tsext-border) 80%,transparent);
    background:color-mix(in srgb,var(--tsext-panel2) 70%,transparent);
    letter-spacing:.01em; line-height:1.5;
  }

.tsext-price-mode-badge{
    display:inline-block; margin-inline-start:6px; padding:2px 8px; border-radius:999px;
    font-size:var(--tsext-fs-xxs); font-weight:800; vertical-align:middle;
    background:color-mix(in srgb,var(--tsext-accent) 12%,transparent);
    color:var(--tsext-accent); border:1px solid color-mix(in srgb,var(--tsext-accent) 28%,transparent);
  }

.tsext-price-mode-badge.is-exec{
    background:color-mix(in srgb,var(--tsext-orange) 14%,transparent);
    color:var(--tsext-orange); border-color:color-mix(in srgb,var(--tsext-orange) 35%,transparent);
  }

.tsext-stale-banner{
    padding:7px 12px; font-size:var(--tsext-fs-xs) !important; font-weight:800 !important;
    color:#92400e !important; background:color-mix(in srgb,#fef3c7 92%,transparent) !important;
    border-bottom:1px solid color-mix(in srgb,#f59e0b 45%,transparent) !important;
    flex-shrink:0; text-align:center;
  }

#tsext-host select.tsext-select.tsext-select-open,
  #tsext-host select.tsext-select[size]:not([size="1"]){
    position: relative;
    z-index: 200;
    height: auto;
    max-height: 320px;
    overflow-y: scroll;
    overflow-x: hidden;
    overscroll-behavior: contain !important;
    background: var(--tsext-panel) !important;
    color: var(--tsext-fg) !important;
    border: 1px solid var(--tsext-accent) !important;
    box-shadow: 0 12px 32px rgba(0,0,0,.28) !important;
    direction: rtl !important;
    scrollbar-width: thin !important;
  }

#tsext-host select.tsext-select.tsext-select-open::-webkit-scrollbar,
  #tsext-host select.tsext-select[size]:not([size="1"])::-webkit-scrollbar{
    width: 8px;
  }

#tsext-host select.tsext-select.tsext-select-open::-webkit-scrollbar-thumb,
  #tsext-host select.tsext-select[size]:not([size="1"])::-webkit-scrollbar-thumb{
    background: color-mix(in srgb, var(--tsext-muted) 70%, transparent) !important;
    border-radius: 6px;
  }

#tsext-host select.tsext-select.tsext-select-open option,
  #tsext-host select.tsext-select[size]:not([size="1"]) option{
    padding: 7px 10px;
    white-space: normal;
    line-height: 1.45 !important;
  }

.tsext-select-panel{
    background: var(--tsext-panel, #fff) !important;
    color: var(--tsext-fg, #334155) !important;
    border: 1px solid var(--tsext-accent, #4f46e5) !important;
    border-radius: 10px;
    box-shadow: 0 14px 36px rgba(0,0,0,.28) !important;
    padding: 4px 0;
    font-family: Vazirmatn, Tahoma, Arial, sans-serif !important;
    font-size: 12px !important;
    font-weight: 700 !important;
    direction: rtl !important;
    text-align: right;
    overscroll-behavior: contain !important;
    scrollbar-width: thin !important;
  }

.tsext-select-panel::-webkit-scrollbar{ width: 8px; }

.tsext-select-panel::-webkit-scrollbar-thumb{
    background: color-mix(in srgb, var(--tsext-muted, #64748b) 65%, transparent) !important;
    border-radius: 6px;
  }

.tsext-select-item{
    padding: 8px 12px;
    cursor: pointer !important;
    line-height: 1.45 !important;
    white-space: normal;
    word-break: break-word !important;
  }

.tsext-select-item:hover{
    background: color-mix(in srgb, var(--tsext-accent, #4f46e5) 14%, transparent) !important;
    color: var(--tsext-bright, #0f172a) !important;
  }

.tsext-select-item.is-selected{
    background: color-mix(in srgb, var(--tsext-accent, #4f46e5) 18%, transparent) !important;
    color: var(--tsext-accent, #4f46e5) !important;
    font-weight: 900 !important;
  }

.tsext-select-item.is-placeholder,
  .tsext-select-item.is-disabled{
    color: var(--tsext-muted, #64748b) !important;
    cursor: default !important;
    font-weight: 600 !important;
  }

.tsext-select-item.is-placeholder:hover,
  .tsext-select-item.is-disabled:hover{
    background: transparent !important;
  }

#tsext-host select.tsext-select.tsext-select-open{
    border-color: var(--tsext-accent) !important;
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--tsext-accent) 22%, transparent) !important;
  }

#tsext-host.tsext-select-expanded #tsext-head,
  #tsext-host.tsext-select-expanded .tsext-strategy-panel,
  #tsext-host.tsext-select-expanded .tsext-strategy-panel .tsext-row {
    overflow: visible;
  }

#tsext-tabs.tsext-tabs,
  #tsext-host #tsext-tabs{
    display: flex;
    flex-direction: column;
    flex-wrap: nowrap;
    gap: 0;
    width: 100%;
    grid-template-columns: none;
    padding: 16px 12px 20px;
  }

#tsext-tabs .tsext-tab{
    width: 100%;
    flex: 0 0 auto;
    text-align: right;
    justify-content: flex-start;
    white-space: normal;
    min-height: 64px;
    padding: 18px 18px;
    margin: 0 0 18px 0;
    border-radius: 14px;
    font-size: 14px !important;
    font-weight: 900 !important;
  }

#tsext-tabs .tsext-tab:last-child{ margin-bottom: 6px; }

.tsext-resize-handle{ position:absolute; z-index:2147483647; pointer-events:auto}

.tsext-resize-e{ top:0; right:-3px; width:10px; height:100%; cursor:ew-resize; }

.tsext-resize-w{ top:0; left:-3px; width:10px; height:100%; cursor:ew-resize}

.tsext-resize-s{ left:0; bottom:-3px; height:10px; width:100%; cursor:ns-resize}

.tsext-resize-n{ left:0; top:-3px; height:10px; width:100%; cursor:ns-resize}

.tsext-resize-se{ right:-3px; bottom:-3px; width:18px; height:18px; cursor:nwse-resize}

.tsext-resize-sw{ left:-3px; bottom:-3px; width:18px; height:18px; cursor:nesw-resize}

.tsext-resize-ne{ right:-3px; top:-3px; width:18px; height:18px; cursor:nesw-resize}

.tsext-resize-nw{ left:-3px; top:-3px; width:18px; height:18px; cursor:nwse-resize}

.tsext-resize-e:hover,.tsext-resize-w:hover,.tsext-resize-s:hover,.tsext-resize-n:hover{ background:color-mix(in srgb,var(--tsext-accent) 30%,transparent)}

.tsext-resize-se::after,.tsext-resize-sw::after,.tsext-resize-ne::after,.tsext-resize-nw::after{
    content:''; position:absolute; width:8px; height:8px; opacity:.55; pointer-events:none;
    background-image:repeating-linear-gradient(135deg, var(--tsext-muted) 0 1.4px, transparent 1.4px 3.6px)}

.tsext-resize-se::after{ right:4px; bottom:4px}

.tsext-resize-sw::after{ left:4px; bottom:4px; background-image:repeating-linear-gradient(45deg, var(--tsext-muted) 0 1.4px, transparent 1.4px 3.6px)}

.tsext-resize-ne::after{ right:4px; top:4px; background-image:repeating-linear-gradient(45deg, var(--tsext-muted) 0 1.4px, transparent 1.4px 3.6px)}

.tsext-resize-nw::after{ left:4px; top:4px}

.tsext-resize-se:hover::after,.tsext-resize-sw:hover::after,.tsext-resize-ne:hover::after,.tsext-resize-nw:hover::after{ opacity:.9}

#tsext-host.tsext-ui-interacting *,
  #tsext-host.tsext-ui-interacting *::before,
  #tsext-host.tsext-ui-interacting *::after{
    animation-play-state:paused !important;
    transition: none !important;
  }

#tsext-host.tsext-ui-interacting{
    will-change: left, top, width, height;
    contain: layout style;
  }

#tsext-host.tsext-ui-interacting #tsext-obpanel{ will-change:left,top,width,height}

#tsext-host.tsext-ui-interacting .tsext-bar:hover{ transform: none; }

#tsext-host.tsext-ui-interacting #tsext-list-body{ pointer-events: none; }

body.tsext-col-resizing #tsext-host,
  body.tsext-col-resizing #tsext-host *{
    transition: none !important;
  }

#tsext-host * , #tsext-host *::before, #tsext-host *::after { box-sizing:border-box}

#tsext-host ::-webkit-scrollbar{ width:9px; height:9px}

#tsext-host ::-webkit-scrollbar-thumb{ background:var(--tsext-border); border-radius:var(--tsext-r-sm); border:2px solid transparent; background-clip:padding-box}

#tsext-host ::-webkit-scrollbar-thumb:hover{ background:color-mix(in srgb,var(--tsext-muted) 55%,var(--tsext-border)); background-clip:padding-box}

#tsext-host ::-webkit-scrollbar-track{ background:transparent}

#tsext-host :focus-visible{ outline:none; box-shadow:0 0 0 2px var(--tsext-bg), 0 0 0 4px color-mix(in srgb,var(--tsext-accent) 70%,transparent) !important; border-radius:var(--tsext-r-sm); }

.tsext-btn.tsext-close{ color:var(--tsext-red); margin-inline-start:3px}

.tsext-input::placeholder{ color:var(--tsext-muted); font-weight:600; opacity:.8}

select.tsext-input{ cursor:pointer}

select.tsext-input option{ background:var(--tsext-panel); color:var(--tsext-fg)}

.tsext-num{ width:56px; text-align:center}

.tsext-select{ flex:1}

.tsext-field.tsext-field-hidden{ display:none }

.tsext-mini.tsext-mini-wrap{ white-space:normal; overflow:visible; text-overflow:clip }

#tsext-list-hdr:empty{ border-bottom:none; padding-bottom:0}

.tsext-stale-banner{ padding:6px 12px; font-size:var(--tsext-fs-xs); font-weight:800; color:#92400e; background:color-mix(in srgb,#fef3c7 90%,transparent); border-bottom:1px solid color-mix(in srgb,#f59e0b 40%,transparent); flex-shrink:0; text-align:center; }

.tsext-health-banner{ display:flex; align-items:center; gap:8px; padding:6px 10px; font-size:var(--tsext-fs-xs); font-weight:800; line-height:1.6; color:#7f1d1d; background:color-mix(in srgb,#fee2e2 92%,transparent); border-bottom:1px solid color-mix(in srgb,#ef4444 45%,transparent); flex-shrink:0; }

.tsext-health-banner .tsext-health-txt{ flex:1 1 auto; }

.tsext-health-banner .tsext-health-x{ flex:0 0 auto; min-width:24px; padding:0 6px; }

#tsext-backup-menu{ position:fixed; z-index:2147483647; min-width:230px; max-width:300px; padding:6px; border-radius:10px; background:var(--tsext-panel); color:var(--tsext-fg); border:1px solid var(--tsext-border); box-shadow:0 10px 30px rgba(0,0,0,.25); font-family:inherit; }

#tsext-backup-menu .tsext-backup-item{ display:block; width:100%; text-align:right; padding:8px 10px; border:0; border-radius:8px; background:transparent; color:var(--tsext-bright); font:inherit; font-size:var(--tsext-fs-sm); font-weight:800; cursor:pointer; }

#tsext-backup-menu .tsext-backup-item:hover{ background:color-mix(in srgb,var(--tsext-accent) 14%,transparent); }

#tsext-backup-menu .tsext-backup-note{ padding:6px 10px 4px; font-size:var(--tsext-fs-xs); color:var(--tsext-muted); line-height:1.7; border-top:1px dashed var(--tsext-border); margin-top:4px; }

#tsext-backup-menu .tsext-backup-file{ position:absolute; width:1px; height:1px; opacity:0; pointer-events:none; }

.tsext-diag-errs{ margin-top:6px; border-top:1px dashed var(--tsext-border); padding-top:4px; max-height:160px; overflow:auto; }

.tsext-diag-errs-h{ font-weight:900; color:var(--tsext-muted); margin-bottom:2px; }

.tsext-diag-err{ display:grid; grid-template-columns:auto auto 1fr; gap:6px; align-items:baseline; padding:1px 0; font-size:var(--tsext-fs-xs); line-height:1.6; }

.tsext-diag-err.is-quiet{ opacity:.7; }

.tsext-diag-err-t{ direction:ltr; font-variant-numeric:tabular-nums; color:var(--tsext-muted); }

.tsext-diag-err-c{ color:var(--tsext-orange); font-weight:800; direction:ltr; }

.tsext-diag-err-m{ color:var(--tsext-fg); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }

.tsext-list-summary{ margin:4px 8px 6px; padding:5px 10px; border-radius:8px; font-size:var(--tsext-fs-xs); font-weight:800; text-align:center; color:var(--tsext-bright); background:color-mix(in srgb,var(--tsext-accent) 10%,var(--tsext-panel2)); border:1px solid color-mix(in srgb,var(--tsext-accent) 28%,var(--tsext-border)); }

.tsext-rangebar{ padding:6px 12px 3px; direction:ltr; user-select:none; position:relative; background:var(--tsext-panel); border-bottom:1px solid color-mix(in srgb,var(--tsext-border) 70%,transparent); container-type:inline-size; }

@container (max-width: 236px){ .tsext-rangebar-caption .rb-cap-time{ display:none; } }

.tsext-rangebar-labels{
    position:relative; height:15px; margin-bottom:9px;
    font-size:var(--tsext-fs-xxs); font-weight:700; line-height:15px;
    color:var(--tsext-muted); font-variant-numeric:tabular-nums; white-space:nowrap;
  }

.tsext-rangebar-labels .rb-lo{ position:absolute; left:0; top:0; }

.tsext-rangebar-labels .rb-hi{ position:absolute; right:0; top:0; }

.tsext-rangebar-labels .rb-ref{ position:absolute; top:0; transform:translateX(-50%); color:var(--tsext-muted); }

.tsext-rangebar.is-synthetic .rb-lo, .tsext-rangebar.is-synthetic .rb-hi{ opacity:.6; font-style:italic; }

.tsext-rangebar.is-option .rb-lo::after{ content:" (−۱۰۰٪)"; font-weight:600; opacity:.7; }

.tsext-rangebar.is-option .rb-hi::before{ content:"(+۱۰۰٪) "; font-weight:600; opacity:.7; }

.tsext-rangebar .rb-last.rb-over, .tsext-rangebar .rb-close.rb-over{ opacity:.55; }

.tsext-rangebar-track .rb-base{
    position:absolute; left:0; right:0; top:11.5px; height:1px; border-radius:999px; z-index:0;
    background:color-mix(in srgb,var(--tsext-border) 80%,var(--tsext-muted));
  }

.tsext-rangebar-track .rb-wick{
    position:absolute; left:0; top:11.5px; height:1px; border-radius:999px; z-index:1; width:0;
    background:var(--tsext-green); transition:none;
  }

.tsext-rangebar-track .rb-tick{
    position:absolute; top:6px; width:1px; height:12px; margin-left:-0.5px; z-index:2;
    background:color-mix(in srgb,var(--tsext-muted) 70%,var(--tsext-border)); border-radius:1px; transition:none;
  }

.tsext-rangebar-track .rb-band{
    position:absolute; top:8px; height:8px; border-radius:999px; z-index:3; min-width:3px;
    background:var(--tsext-green); transition:none;
    box-shadow:0 1px 2px color-mix(in srgb,var(--tsext-fg) 10%,transparent);
  }

.tsext-rangebar.is-down .rb-wick, .tsext-rangebar.is-down .rb-band{ background:var(--tsext-red); }

.tsext-rangebar.no-trade .rb-band{ background:color-mix(in srgb,var(--tsext-muted) 45%,var(--tsext-border)); box-shadow:none; height:4px; top:10px; }

.tsext-rangebar-track .rb-last{
    position:absolute; top:0; width:0; height:0; margin-left:-5px; z-index:5;
    border-left:5px solid transparent; border-right:5px solid transparent;
    border-top:7px solid var(--tsext-bright); transition:none;
    filter:drop-shadow(0 1px 1px color-mix(in srgb,var(--tsext-fg) 25%,transparent));
  }

.tsext-rangebar-track .rb-close{
    position:absolute; top:17px; width:0; height:0; margin-left:-4px; z-index:4;
    border-left:4px solid transparent; border-right:4px solid transparent;
    border-bottom:6px solid color-mix(in srgb,var(--tsext-muted) 80%,var(--tsext-fg)); transition:none;
  }

.tsext-rangebar .rb-hidden{ display:none; }

#tsext-diag{
    position:fixed; left:12px; bottom:12px; z-index:2147483647; width:340px; max-width:calc(100vw - 24px); max-height:70vh; overflow:auto;
    background:var(--tsext-panel); color:var(--tsext-fg); border:1px solid var(--tsext-border); border-radius:var(--tsext-r-md);
    box-shadow:var(--tsext-shadow); padding:8px 10px 10px; font-size:var(--tsext-fs-xxs); font-weight:600; font-variant-numeric:tabular-nums;
  }

#tsext-diag .tsext-diag-head{ display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:6px; font-weight:800; color:var(--tsext-bright); }

#tsext-diag .tsext-diag-btns{ display:inline-flex; gap:4px; }

#tsext-diag .tsext-diag-btns .tsext-btn{ padding:0 7px; line-height:1.7; font-size:var(--tsext-fs-xxs); }

#tsext-diag .tsext-diag-row{ display:flex; justify-content:space-between; gap:10px; padding:3px 0; border-top:1px solid color-mix(in srgb,var(--tsext-border) 55%,transparent); }

#tsext-diag .tsext-diag-row span{ color:var(--tsext-muted); white-space:nowrap; }

#tsext-diag .tsext-diag-row b{ color:var(--tsext-bright); font-weight:700; text-align:left; word-break:break-word; }

.tsext-ob-skel{ padding:0 0 6px; }

.tsext-ob-skel .tsext-skel-cell, .tsext-ob-skel .tsext-skel-line{
    display:inline-block; height:9px; border-radius:999px;
    background:linear-gradient(90deg, color-mix(in srgb,var(--tsext-border) 55%,transparent) 25%, color-mix(in srgb,var(--tsext-border) 20%,transparent) 50%, color-mix(in srgb,var(--tsext-border) 55%,transparent) 75%);
    background-size:200% 100%; animation:tsextSkel 1.3s ease-in-out infinite;
  }

.tsext-ob-skel .tsext-skel-bar{ display:flex; align-items:center; gap:10px; padding:10px 12px 8px; }

.tsext-ob-skel .tsext-skel-line{ flex:1; height:2px; }

.tsext-ob-skel .tsext-skel-head{ display:flex; gap:6px; padding:4px 8px 8px; }

.tsext-ob-skel .tsext-skel-head .tsext-skel-cell{ flex:1; height:22px; border-radius:var(--tsext-r-sm); }

.tsext-ob-skel .tsext-skel-row{ display:flex; gap:8px; padding:6px 10px; border-top:1px solid color-mix(in srgb,var(--tsext-border) 45%,transparent); }

.tsext-ob-skel .tsext-skel-row .tsext-skel-cell{ flex:1; }

.tsext-ob-skel .w1{ max-width:28px; }

.tsext-ob-skel .w2{ max-width:54px; }

.tsext-ob-skel .w3{ max-width:46px; }

.tsext-ob-skel .w4{ width:36px; }

.tsext-ob-skel .w5{ }

@keyframes tsextSkel{ 0%{ background-position:200% 0 } 100%{ background-position:-200% 0 } }

@media (prefers-reduced-motion:reduce){ .tsext-ob-skel .tsext-skel-cell, .tsext-ob-skel .tsext-skel-line{ animation:none } }

.tsext-rangebar-track{
  position: relative;
  height: 24px;
  overflow: visible;
  cursor: crosshair;
}

.tsext-rangebar-track .rb-hover-line{
    display:none; position:absolute; top:1px; bottom:1px; width:1px; margin-left:-0.5px; z-index:6; pointer-events:none;
    background:color-mix(in srgb,var(--tsext-fg) 45%,transparent);
  }

.tsext-rangebar-track .rb-hover{
    display:none; position:absolute; top:-25px; z-index:7; pointer-events:none; white-space:nowrap;
    padding:2px 7px; border-radius:6px; font-size:var(--tsext-fs-xxs); font-weight:800; line-height:1.45;
    font-variant-numeric:tabular-nums; color:var(--tsext-bright); background:var(--tsext-panel);
    border:1px solid var(--tsext-border); box-shadow:0 2px 6px color-mix(in srgb,var(--tsext-fg) 15%,transparent);
  }

.tsext-rangebar-track.is-hover .rb-hover-line, .tsext-rangebar-track.is-hover .rb-hover{ display:block; }

.tsext-rangebar-track .rb-hover .rb-hover-p{ color:var(--tsext-bright); }

.tsext-rangebar-track .rb-hover .rb-hover-pct{ margin-left:5px; color:var(--tsext-muted); }

.tsext-rangebar-track .rb-hover.is-pos .rb-hover-pct{ color:var(--tsext-green); }

.tsext-rangebar-track .rb-hover.is-neg .rb-hover-pct{ color:var(--tsext-red); }

.tsext-rangebar-caption{
    display:flex; flex-wrap:wrap; justify-content:space-between; gap:2px 8px; margin-top:1px;
    font-size:var(--tsext-fs-xxs); font-weight:700; color:var(--tsext-muted); font-variant-numeric:tabular-nums; white-space:nowrap;
  }

.tsext-rangebar-caption .rb-cap-status-row{ flex:1 0 100%; text-align:center; line-height:1.2; }

.tsext-rangebar-caption .rb-cap-last{ color:var(--tsext-bright); font-weight:800; }

.tsext-ob-status-tag{
    display:inline-block; margin-inline-start:6px; padding:0 7px; border-radius:999px; font-size:var(--tsext-fs-xxs); font-weight:800; line-height:1.7; vertical-align:middle;
    color:var(--tsext-orange); background:color-mix(in srgb,var(--tsext-orange) 14%,transparent); border:1px solid color-mix(in srgb,var(--tsext-orange) 45%,transparent);
  }

.tsext-rangebar-caption .rb-cap-time{ color:var(--tsext-muted); font-weight:600; margin-inline-start:5px; opacity:.85; font-variant-numeric:tabular-nums; }

.tsext-rangebar-caption .rb-cap-status{
    display:inline-block; padding:0 8px; border-radius:999px; line-height:1.6; font-weight:800;
    color:var(--tsext-orange); background:color-mix(in srgb,var(--tsext-orange) 14%,transparent); border:1px solid color-mix(in srgb,var(--tsext-orange) 45%,transparent);
  }

.tsext-rangebar.chg-up .rb-cap-chg{ color:var(--tsext-green); }

.tsext-rangebar.chg-down .rb-cap-chg{ color:var(--tsext-red); }

#tsext-host[data-tsext-rangebar-caption="0"] .tsext-rangebar-caption{ display:none; }

#tsext-host.tsext-with-ob{ overflow:visible}

#tsext-host.tsext-with-ob #tsext-obpanel{ display:flex}

#tsext-host.tsext-ob-left #tsext-obpanel{ /* سمت با JS تنظیم می‌شود */ }

.tsext-obpanel-head:active{ cursor:grabbing}

.tsext-obpanel-head > span, #tsext-obpanel-title{ font-size:var(--tsext-fs-base); font-weight:800; color:var(--tsext-bright); overflow:hidden; min-width:0; flex:1; line-height:1.45}

#tsext-obpanel-body.tsext-ob-split{
    display:grid;
    grid-template-columns:minmax(220px, 1.05fr) minmax(220px, 1fr);
    grid-template-rows:1fr;
    gap:0;
  }

#tsext-obpanel-body.tsext-ob-split.tsext-ob-solo{
    grid-template-columns:1fr;
  }

#tsext-ob-calc{
    min-height:0; overflow-y:auto; overflow-x:hidden; padding:10px 12px 12px;
    border-left:1px solid var(--tsext-border);
    overscroll-behavior:contain;
  }

#tsext-ob-books{
    min-height:0; overflow-y:auto; overflow-x:hidden; padding:8px 10px 10px;
    display:flex; flex-direction:column; gap:8px;
    overscroll-behavior:contain;
    background:color-mix(in srgb, var(--tsext-panel2) 55%, var(--tsext-panel));
  }

#tsext-obpanel-body.tsext-ob-solo #tsext-ob-calc{ border-left:none }

#tsext-obpanel-body.tsext-ob-solo #tsext-ob-books{ display:none }

#tsext-ob-calc .tsext-grid{ grid-template-columns:1fr; gap:3px 0 }

#tsext-ob-calc .tsext-cell{ padding:5px 0; gap:2px; flex-direction:column; align-items:stretch }

#tsext-ob-calc .tsext-cell .lbl{ font-size:var(--tsext-fs-xs); font-weight:600; white-space:normal; overflow:visible; text-overflow:unset }

#tsext-ob-calc .tsext-cell .val{ font-size:var(--tsext-fs-xs); font-weight:600; font-variant-numeric:tabular-nums; white-space:normal; word-break:break-word; line-height:1.45 }

#tsext-ob-calc .tsext-hero{
    margin:0 0 8px; gap:0;
    grid-template-columns:1fr;
  }

#tsext-ob-calc .tsext-hero-card,
  #tsext-ob-calc .tsext-hero-card.main{
    padding:14px 12px 15px; border-radius:var(--tsext-r-md); min-width:0;
  }

#tsext-ob-calc .tsext-hero-card .h-lbl{
    font-size:var(--tsext-fs-md) !important; margin-bottom:6px;
    color:#64748b !important; font-weight:800 !important;
  }

#tsext-ob-calc .tsext-hero-card .h-val{
    font-size:var(--tsext-fs-lg) !important; font-weight:700 !important;
    color:#0f172a !important; line-height:1.15 !important;
    letter-spacing:-.02em !important;
  }

#tsext-ob-calc .tsext-hero-card.pos .h-val,
  #tsext-ob-calc .tsext-hero-card.main.pos .h-val{
    color:#047857 !important;
  }

#tsext-ob-calc .tsext-hero-card.neg .h-val,
  #tsext-ob-calc .tsext-hero-card.main.neg .h-val{
    color:#b91c1c !important;
  }

#tsext-ob-calc .tsext-sec{ margin-top:6px; padding-top:5px; font-size:var(--tsext-fs-xxs); letter-spacing:.04em }

#tsext-ob-calc .tsext-verdict{ font-size:var(--tsext-fs-xs); padding:5px 8px; margin:4px 0 }

#tsext-ob-calc .tsext-price-basis{ font-size:var(--tsext-fs-xxs); margin:4px 0 2px; opacity:.85 }

#tsext-ob-books .tsext-ob-slot{
    flex:0 0 auto; min-height:0;
    border:1px solid var(--tsext-border); border-radius:var(--tsext-r-md);
    background:var(--tsext-panel); overflow:hidden;
  }

#tsext-ob-books .tsext-ob-table th,
  #tsext-ob-books .tsext-ob-table td{ font-size:var(--tsext-fs-xs) !important; font-weight:600 !important; font-family:inherit !important; font-variant-numeric:tabular-nums !important; padding:3px 4px }

#tsext-ob-books .tsext-ob-table .px-ask,
  #tsext-ob-books .tsext-ob-table .px-bid{ font-size:var(--tsext-fs-xs) !important; font-weight:600 !important; font-family:inherit !important }

#tsext-ob-books .tsext-ob-empty,
  #tsext-ob-books .tsext-ob-loading{ font-size:var(--tsext-fs-sm); padding:10px 8px; color:var(--tsext-muted); text-align:center }

#tsext-ob-books.tsext-ob-books-1 .tsext-ob-slot{ flex:1 1 auto }

@media (max-width: 900px){
    #tsext-obpanel-body.tsext-ob-split{
      grid-template-columns:1fr;
      grid-template-rows:minmax(180px, 0.42fr) minmax(200px, 0.58fr);
    }
    #tsext-ob-calc{ border-left:none; border-bottom:1px solid var(--tsext-border) }
  }

.tsext-bar-obbtn:hover{ color:var(--tsext-accent); border-color:var(--tsext-accent); background:color-mix(in srgb,var(--tsext-accent) 10%,transparent)}

.tsext-bar.active-ob > .tsext-bar-main{ padding-top:26px; }

.tsext-obpanel-head .tsext-btn{
  flex-shrink: 0;
  cursor: pointer;
}

#tsext-obpanel-title{ font-size:var(--tsext-fs-base) !important; font-weight:800 !important; color:var(--tsext-bright) !important}

.tsext-ob-active-tag{
    display:inline-block; margin-inline-start:6px; font-size:var(--tsext-fs-xxs); font-weight:900;
    color:#fff; background:var(--tsext-accent); border-radius:var(--tsext-r-xs); padding:1px 8px; vertical-align:middle}

.tsext-hdr b{ color:var(--tsext-bright); font-weight:800}

.tsext-bar-delta{ font-size:var(--tsext-fs-xxs); font-weight:900; margin-inline-start:3px; vertical-align:middle}

.tsext-bar-delta.up{ color:var(--tsext-green)}

.tsext-bar-delta.down{ color:var(--tsext-red)}

.tsext-market-open{ color:var(--tsext-green); font-weight:900}

.tsext-market-open::before{ content:''; display:inline-block; width:7px; height:7px; border-radius:50%; background:var(--tsext-green); margin-inline-end:6px; vertical-align:middle; box-shadow:0 0 0 0 color-mix(in srgb,var(--tsext-green) 60%,transparent); animation:tsextLiveDot 1.6s ease-out infinite}

.tsext-market-closed{ color:var(--tsext-orange); font-weight:900}

.tsext-market-closed small{ font-weight:700; opacity:.8; font-size:.9em }

.tsext-market-click{ cursor:pointer; border-bottom:1px dashed color-mix(in srgb,var(--tsext-orange) 60%,transparent) }

.tsext-market-pre{ color:var(--tsext-accent); font-weight:900}

.tsext-market-pre::before{ content:''; display:inline-block; width:7px; height:7px; border-radius:50%; background:var(--tsext-accent); margin-inline-end:6px; vertical-align:middle; animation:tsextLiveDot 2.2s ease-out infinite}

.tsext-market-closed::before{ content:''; display:inline-block; width:7px; height:7px; border-radius:50%; background:var(--tsext-orange); margin-inline-end:6px; vertical-align:middle; opacity:.85}

@keyframes tsextLogoGlow{ 0%,100%{ box-shadow:0 2px 6px color-mix(in srgb,var(--tsext-accent) 40%,transparent); background-position:0% 50%; } 50%{ box-shadow:0 2px 14px color-mix(in srgb,var(--tsext-accent) 72%,transparent); background-position:100% 50%; } }

@keyframes tsextHeadShine{ 0%{ background-position:200% 0; } 100%{ background-position:-200% 0; } }

@media (prefers-reduced-motion:reduce){ .tsext-logo,.tsext-market-open::before,#tsext-head::before{ animation:none !important} }

.tsext-warn{ color:var(--tsext-orange); font-weight:700; }

.tsext-warn-unified{ display:inline-block; margin-inline-start:4px; padding:1px 7px; border-radius:999px; font-size:var(--tsext-fs-xxs); font-weight:800; white-space:nowrap; vertical-align:middle; }

.tsext-warn-unified.tsext-warn-mid{ color:var(--tsext-orange); background:color-mix(in srgb,var(--tsext-orange) 14%,transparent); border:1px solid color-mix(in srgb,var(--tsext-orange) 30%,transparent); }

.tsext-warn-unified.tsext-warn-high{ color:var(--tsext-red); background:color-mix(in srgb,var(--tsext-red) 14%,transparent); border:1px solid color-mix(in srgb,var(--tsext-red) 32%,transparent); }

.tsext-empty-fav{ display:flex; flex-direction:column; align-items:center; gap:8px; padding:32px 16px }

.tsext-empty-fav .tsext-empty-title{ font-size:var(--tsext-fs-lg); font-weight:800; color:var(--tsext-bright) }

.tsext-empty-fav .tsext-empty-sub{ font-size:var(--tsext-fs-sm); color:var(--tsext-muted); max-width:320px; line-height:1.7 }

.tsext-fav-showall{
    margin-top:6px; padding:7px 16px; font-weight:800 !important;
    background:color-mix(in srgb,#f59e0b 18%, var(--tsext-panel)) !important;
    border:1px solid color-mix(in srgb,#f59e0b 45%, var(--tsext-border)) !important;
    color:#b45309 !important; border-radius:8px; cursor:pointer; font-family:inherit;
  }

.tsext-fav-showall:hover{ background:color-mix(in srgb,#f59e0b 28%, var(--tsext-panel)) !important }

.tsext-bar.tsext-plvl-hi .tsext-bar-strip-profit{ background:var(--tsext-green)}

.tsext-bar.tsext-plvl-mid .tsext-bar-strip-profit{ background:var(--tsext-orange)}

.tsext-bar.tsext-plvl-lo .tsext-bar-strip-profit{ background:color-mix(in srgb,var(--tsext-muted) 55%,transparent)}

.tsext-bar.tsext-plvl-neg .tsext-bar-strip-profit{ background:var(--tsext-red)}

.tsext-bar-cell{ font-size:var(--tsext-fs-md); font-weight:600; color:var(--tsext-fg); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; font-variant-numeric:tabular-nums}

#tsext-host .tsext-bar-main .tsext-bar-strike,
  #tsext-host .tsext-bar-cell.tsext-bar-strike{
    overflow:visible;
    text-overflow:clip !important;
    white-space:nowrap;
    font-variant-numeric:tabular-nums !important;
    letter-spacing:-0.01em !important;
  }

.tsext-bar-date{ color:var(--tsext-fg); text-align:center; font-size:var(--tsext-fs-sm); font-weight:700}

.tsext-bar-cell.tsext-bar-profit{ overflow:visible; text-overflow:clip !important; white-space:nowrap }

.tsext-bar-profit.pos{ color:var(--tsext-green); background:color-mix(in srgb,var(--tsext-green) 10%,transparent) }

.tsext-bar-profit.neg{ color:var(--tsext-red); background:color-mix(in srgb,var(--tsext-red) 10%,transparent) }

.tsext-bar-caret{ color:var(--tsext-muted); font-size:var(--tsext-fs-md); transition:transform .2s ease; opacity:.7}

.tsext-bar.open .tsext-bar-caret{ transform:rotate(180deg); color:var(--tsext-accent); opacity:1}

.tsext-bar-name-text{ min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap }

.tsext-bar-fav{
    background:color-mix(in srgb,#f59e0b 8%, transparent);
    border:1px solid color-mix(in srgb,#f59e0b 35%, var(--tsext-border));
    color:#d97706 !important;
    width:22px; height:22px; min-width:22px; line-height:1;
    cursor:pointer; font-size:15px; font-weight:700;
    transition:color .15s, background .15s, border-color .15s, transform .12s, box-shadow .15s;
    font-family:inherit; flex-shrink:0; padding:0;
    display:inline-flex; align-items:center; justify-content:center;
    border-radius:6px; opacity:1;
  }

.tsext-bar-fav:hover{
    color:#f59e0b !important;
    background:color-mix(in srgb,#f59e0b 18%, transparent);
    border-color:#f59e0b;
    transform:scale(1.1);
  }

.tsext-bar-fav.on{
    color:#fff !important;
    background:#f59e0b !important;
    border-color:#d97706 !important;
    box-shadow:0 1px 4px color-mix(in srgb,#f59e0b 45%, transparent);
  }

.tsext-bar-open{ background:transparent; border:1px solid var(--tsext-border); color:var(--tsext-muted); border-radius:var(--tsext-r-sm); width:22px; height:22px; line-height:1; cursor:pointer; font-size:var(--tsext-fs-sm); transition:color .15s,border-color .15s,background .15s; font-family:inherit; flex-shrink:0}

.tsext-bar-open:hover{ color:var(--tsext-accent); border-color:var(--tsext-accent); background:color-mix(in srgb,var(--tsext-accent) 12%,transparent)}

.tsext-bar-cmp{
    background:transparent; border:1px solid var(--tsext-border); color:var(--tsext-muted);
    border-radius:var(--tsext-r-sm); height:22px; padding:0 6px; cursor:pointer; font-size:var(--tsext-fs-xs);
    font-weight:700; font-family:inherit; flex-shrink:0; display:inline-flex; align-items:center; gap:3px;
    transition:color .15s,border-color .15s,background .15s;
  }

.tsext-bar-cmp:hover{ color:var(--tsext-accent); border-color:var(--tsext-accent); background:color-mix(in srgb,var(--tsext-accent) 12%,transparent)}

.tsext-bar-cmp .tsext-obbtn-lbl{ font-size:var(--tsext-fs-xs) }

.tsext-compare-wrap{ display:grid; grid-template-columns:1fr 1fr; gap:10px; align-items:start }

.tsext-compare-col{ min-width:0; border:1px solid var(--tsext-border); border-radius:var(--tsext-r-md); padding:8px 8px 4px; background:color-mix(in srgb,var(--tsext-panel2) 80%,transparent) }

.tsext-compare-h{ font-size:var(--tsext-fs-sm); font-weight:800; color:var(--tsext-bright); margin-bottom:6px; padding-bottom:4px; border-bottom:1px solid var(--tsext-border) }

.tsext-linkbtn{ background:none; border:none; color:var(--tsext-accent); cursor:pointer; font:inherit; font-weight:700; padding:0; text-decoration:underline }

.tsext-linkbtn:hover{ filter:brightness(1.15) }

@media (max-width:720px){
    .tsext-compare-wrap{ grid-template-columns:1fr }
    #tsext-host .tsext-bar-cmp .tsext-obbtn-lbl{ display:none }
    #tsext-obpanel{ max-width:96vw }
    #tsext-ob-calc .tsext-cell .lbl{ font-size:var(--tsext-fs-xs) }
    #tsext-ob-calc .tsext-cell .val{ font-size:var(--tsext-fs-sm) }
  }

.tsext-bar.open .tsext-bar-detail{ max-height:900px; padding:10px 12px 12px; border-top:1px solid var(--tsext-border)}

.tsext-bar-risk{ font-size:var(--tsext-fs-xs); font-weight:700; color:var(--tsext-muted); white-space:nowrap; text-align:center; overflow:visible; text-overflow:clip; max-width:none}

.tsext-liq-warn,.tsext-exer-warn{display:inline-flex;align-items:center;gap:3px;font-size:var(--tsext-fs-xxs);font-weight:700;padding:1px 5px;border-radius:var(--tsext-r-xs);line-height:1.25;margin-inline-start:3px;vertical-align:middle;white-space:nowrap}

.tsext-liq-warn{background:color-mix(in srgb,#f59e0b 18%,transparent);color:#b45309;border:1px solid color-mix(in srgb,#f59e0b 35%,transparent)}

.tsext-exer-warn{background:color-mix(in srgb,#ef4444 14%,transparent);color:#b91c1c;border:1px solid color-mix(in srgb,#ef4444 30%,transparent)}

.tsext-bar-cell,.tsext-bar-profit,.tsext-bar-strike,.tsext-bar-days,.tsext-cell .val,.tsext-hero-card .h-val,.tsext-ob-table td{font-variant-numeric:tabular-nums}

.tsext-arrow{ color:var(--tsext-accent); font-weight:800; margin:0 2px}

.tsext-chip{ font-size:var(--tsext-fs-xxs); font-weight:600; border:1px solid color-mix(in srgb,var(--tsext-border) 80%,var(--tsext-muted)); color:var(--tsext-muted); border-radius:var(--tsext-r-xs); padding:2px 8px; white-space:nowrap; background:transparent}

.tsext-hero{ grid-column:1 / -1; display:grid; grid-template-columns:1fr; gap:0; margin:2px 0 8px}

.tsext-hero-card{ background:color-mix(in srgb,var(--tsext-panel) 82%,var(--tsext-bg)); border:1px solid var(--tsext-border); border-radius:var(--tsext-r-md); padding:14px 12px 15px; text-align:center; min-width:0}

.tsext-hero-card .h-lbl{ display:block; font-size:var(--tsext-fs-md); font-weight:800; color:var(--tsext-muted); margin-bottom:6px; letter-spacing:.02em}

.tsext-hero-card .h-val{ display:block; font-size:var(--tsext-fs-lg); font-weight:700; color:var(--tsext-bright); font-variant-numeric:tabular-nums; letter-spacing:0; line-height:1.3}

.tsext-hero-card.pos .h-val{ color:var(--tsext-green)}

.tsext-hero-card.neg .h-val{ color:var(--tsext-red)}

.tsext-hero-card.main{ border-color:color-mix(in srgb,var(--tsext-accent) 50%,var(--tsext-border)); background:linear-gradient(180deg, color-mix(in srgb,var(--tsext-accent) 12%,var(--tsext-panel)), color-mix(in srgb,var(--tsext-panel) 92%,var(--tsext-bg))); box-shadow:0 4px 14px color-mix(in srgb,var(--tsext-accent) 12%,transparent)}

.tsext-hero-card.main.pos{ border-color:color-mix(in srgb,var(--tsext-green) 45%,var(--tsext-border)); background:linear-gradient(180deg, color-mix(in srgb,var(--tsext-green) 14%,var(--tsext-panel)), color-mix(in srgb,var(--tsext-panel) 92%,var(--tsext-bg))); box-shadow:0 4px 14px color-mix(in srgb,var(--tsext-green) 12%,transparent)}

.tsext-hero-card.main.neg{ border-color:color-mix(in srgb,var(--tsext-red) 45%,var(--tsext-border)); background:linear-gradient(180deg, color-mix(in srgb,var(--tsext-red) 12%,var(--tsext-panel)), color-mix(in srgb,var(--tsext-panel) 92%,var(--tsext-bg))); box-shadow:0 4px 14px color-mix(in srgb,var(--tsext-red) 10%,transparent)}

.tsext-sec{ grid-column:1 / -1; font-size:var(--tsext-fs-xxs); font-weight:800; color:var(--tsext-muted); letter-spacing:.03em; margin-top:8px; padding-top:7px; border-top:1px solid color-mix(in srgb,var(--tsext-border) 70%,transparent)}

.tsext-verdict{ grid-column:1 / -1; font-size:var(--tsext-fs-sm); font-weight:800; line-height:1.8; border-radius:var(--tsext-r-sm); padding:7px 10px; margin:2px 0 6px}

.tsext-verdict.pos{ color:var(--tsext-green); background:color-mix(in srgb,var(--tsext-green) 10%,transparent); border:1px solid color-mix(in srgb,var(--tsext-green) 35%,transparent)}

.tsext-verdict.neg{ color:var(--tsext-red); background:color-mix(in srgb,var(--tsext-red) 10%,transparent); border:1px solid color-mix(in srgb,var(--tsext-red) 35%,transparent)}

.tsext-cell .val.pos{ color:var(--tsext-green)}

.tsext-cell .val.neg{ color:var(--tsext-red)}

.tsext-cell .val.warn{ color:var(--tsext-orange)}

.tsext-note{ margin-top:5px; padding-top:5px; border-top:1px dashed color-mix(in srgb,var(--tsext-border) 80%,transparent); font-size:var(--tsext-fs-md); color:var(--tsext-fg); font-weight:600; line-height:1.8}

.tsext-tag-live{ font-size:var(--tsext-fs-xxs); font-weight:800; color:var(--tsext-green); border:1px solid color-mix(in srgb,var(--tsext-green) 55%,transparent); border-radius:var(--tsext-r-xs); padding:0 5px}

.tsext-tag-close{ font-size:var(--tsext-fs-xxs); font-weight:800; color:var(--tsext-orange); border:1px solid color-mix(in srgb,var(--tsext-orange) 55%,transparent); border-radius:var(--tsext-r-xs); padding:0 5px; white-space:normal}


#tsext-host.tsext-mirror #tsext-obpanel-body .tsext-cell .val{ text-align:right}

#tsext-host.tsext-mirror #tsext-obpanel-body .tsext-ob,
  #tsext-host.tsext-mirror #tsext-obpanel-body .tsext-ob-table,
  #tsext-host.tsext-mirror #tsext-obpanel-body .tsext-ob-foot{
    direction:ltr !important; unicode-bidi:isolate;
  }

.tsext-autorow{ display:flex; align-items:center; gap:6px}

.tsext-check{ display:flex; align-items:center; gap:4px; font-size:var(--tsext-fs-xs); font-weight:700; color:var(--tsext-muted); cursor:pointer; white-space:nowrap}

.tsext-check input{ accent-color:var(--tsext-accent); cursor:pointer}

#tsext-updated{ font-size:var(--tsext-fs-xxs); color:var(--tsext-muted); font-weight:600; margin-inline-start:auto; white-space:nowrap; display:inline-flex; align-items:center; gap:5px}

#tsext-updated.tsext-live-hot{ color:var(--tsext-green) !important; font-weight:800}

#tsext-updated.tsext-live-warm{ color:var(--tsext-green); opacity:.9}

#tsext-updated.tsext-live-cold{ color:var(--tsext-orange) !important}

#tsext-updated.tsext-live-close{ color:var(--tsext-muted) !important; font-weight:700 }

#tsext-updated.tsext-live-close .tsext-pulse-dot{ background:var(--tsext-muted); animation:none; box-shadow:none }

#tsext-updated.tsext-live-cold .tsext-pulse-dot{ background:var(--tsext-orange); animation:none }

.tsext-pulse-dot{
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--tsext-green);
  box-shadow: 0 0 0 0 color-mix(in srgb,var(--tsext-green) 55%,transparent);
  animation: tsext-pulse 1.1s ease-out infinite;
  flex-shrink: 0;
  display: inline-block;
}

.tsext-pulse-dot.tsext-pulse-slow{
  animation-duration: 2.2s;
  opacity: .75;
}

@keyframes tsext-pulse{
    0%{ box-shadow:0 0 0 0 color-mix(in srgb,var(--tsext-green) 55%,transparent); transform:scale(1)}
    70%{ box-shadow:0 0 0 6px transparent; transform:scale(1.05)}
    100%{ box-shadow:0 0 0 0 transparent; transform:scale(1)}
  }

#tsext-errbadge{ cursor:pointer; font-size:var(--tsext-fs-xs); font-weight:800; color:var(--tsext-red); background:color-mix(in srgb,var(--tsext-red) 12%,transparent); border:1px solid color-mix(in srgb,var(--tsext-red) 40%,transparent); border-radius:var(--tsext-r-xs); padding:0 6px; white-space:nowrap; line-height:1.7}

#tsext-errbadge:empty{ display:none}

#tsext-market-row{
    display:flex; align-items:center; gap:8px; flex-wrap:nowrap;
  }

#tsext-market-row #tsext-market-wrap{
    flex-shrink:0; margin-inline-end:4px;
    margin-inline-start:0;
  }

.tsext-ob-info{
    display:flex; flex-wrap:wrap; gap:6px 10px; align-items:center;
    padding:6px 10px; margin:0 0 6px;
    font-size:var(--tsext-fs-xs); font-weight:800;
    color:var(--tsext-bright);
    background:color-mix(in srgb,var(--tsext-accent) 8%, var(--tsext-panel2));
    border:1px solid color-mix(in srgb,var(--tsext-accent) 18%, var(--tsext-border));
    border-radius:var(--tsext-r-sm);
  }

.tsext-ob-info span{ white-space:nowrap }

[id^="tsext-go-"][disabled]{ opacity:.6; cursor:default; transform:none}

.tsext-legend .tsext-chip{ cursor:pointer; user-select:none}

.tsext-legend .tsext-chip.off{ opacity:.35; text-decoration:line-through}

.tsext-jamp-sub{ display:none}

.tsext-jamp-sub.active{ display:block}

.tsext-jamp-modes{ width:100%}

.tsext-jamp-modes .tsext-tab{ flex:1; text-align:center}

.tsext-ob, #tsext-obpanel-body .tsext-ob{
    margin-top:6px; border:1px solid var(--tsext-border); border-radius:var(--tsext-r-md); overflow-x:auto; overflow-y:hidden; font-size:var(--tsext-fs-sm);
    background:var(--tsext-panel2); box-shadow:0 1px 3px rgba(0,0,0,.2);
    direction:ltr !important; unicode-bidi:isolate;
  }

.tsext-ob-table, #tsext-obpanel-body .tsext-ob-table{ direction:ltr !important; width:100%; border-collapse:collapse}

.tsext-ob-foot, #tsext-obpanel-body .tsext-ob-foot{ direction:ltr !important}

.tsext-ob-fresh{ animation:tsextObIn .28s ease}

@keyframes tsextObIn{ from{ opacity:0; transform:translateY(-3px);} to{ opacity:1; transform:translateY(0);} }

.tsext-ob-title{ padding:6px 10px; background:var(--tsext-panel); font-weight:600; color:var(--tsext-muted); font-size:var(--tsext-fs-xs); border-bottom:1px solid var(--tsext-border); display:flex; align-items:center; gap:6px}

.tsext-live-dot{ width:6px; height:6px; border-radius:50%; background:var(--tsext-green); box-shadow:none; animation:none; display:inline-block; opacity:.9}

@keyframes tsextLiveDot{ 0%{ box-shadow:0 0 0 0 color-mix(in srgb,var(--tsext-green) 55%,transparent);} 70%{ box-shadow:0 0 0 6px transparent;} 100%{ box-shadow:0 0 0 0 transparent;} }

.tsext-ob-table{ width:100%; border-collapse:collapse; table-layout:auto}

.tsext-ob-table th{ padding:4px 4px; text-align:center; font-size:var(--tsext-fs-xxs); font-weight:600; color:var(--tsext-muted); background:var(--tsext-panel2); border-bottom:1px solid var(--tsext-border)}

.tsext-ob-table .tsext-ob-grouprow th{ font-size:var(--tsext-fs-xs); font-weight:700; padding:4px 4px 3px; letter-spacing:.01em}

.tsext-ob-table .tsext-ob-grouprow th.ask-c{ background:color-mix(in srgb,var(--tsext-red) 8%,var(--tsext-panel2))}

.tsext-ob-table .tsext-ob-grouprow th.bid-c{ background:color-mix(in srgb,var(--tsext-green) 8%,var(--tsext-panel2))}

.tsext-ob-table td{ padding:3px 4px; text-align:center; font-weight:500; font-size:var(--tsext-fs-xs); font-family:inherit; font-variant-numeric:tabular-nums; border-bottom:1px solid color-mix(in srgb,var(--tsext-border) 40%,transparent); vertical-align:middle; height:24px; white-space:nowrap}

.tsext-ob-table tr:last-child td{ border-bottom:none}

.tsext-ob-table .ask-c{ color:var(--tsext-red)}

.tsext-ob-table .bid-c{ color:var(--tsext-green)}

.tsext-ob-table tbody tr.tsext-ob-row{ animation:none; transition:background-color .1s}

@keyframes tsextRowIn{ from{ opacity:0; transform:translateY(-2px);} to{ opacity:1; transform:translateY(0);} }

.tsext-ob-table tbody tr.tsext-ob-row:nth-child(even){ background:color-mix(in srgb,var(--tsext-panel2) 35%,transparent)}

.tsext-ob-table tbody tr.tsext-ob-row:hover{ background:color-mix(in srgb,var(--tsext-accent) 6%,transparent)}

.tsext-ob-table tbody tr.tsext-ob-best td{ font-weight:700}

.tsext-ob-table .vol-cell{ position:relative; overflow:hidden}

.tsext-ob-table .vol-bar{ position:absolute; top:2px; bottom:2px; border-radius:var(--tsext-r-xxs); opacity:.26; pointer-events:none; transition:width .3s ease}

.tsext-ob-table .vol-bar.ask{ right:0; background:linear-gradient(90deg,transparent,var(--tsext-red))}

.tsext-ob-table .vol-bar.bid{ left:0; background:linear-gradient(90deg,var(--tsext-green),transparent)}

.tsext-ob-table .vol-txt{ position:relative; z-index:1}

.tsext-ob-table .px-ask{ background:transparent; border-radius:0; padding:0 2px; color:var(--tsext-red); font-weight:700; display:inline-block; white-space:nowrap; box-shadow:none}

.tsext-ob-table .px-bid{ background:transparent; border-radius:0; padding:0 2px; color:var(--tsext-green); font-weight:700; display:inline-block; white-space:nowrap; box-shadow:none}

.tsext-ob-table td.tsext-ob-oor{ opacity:.38; }

.tsext-ob-table .px-ask.tsext-ob-oor,
  .tsext-ob-table .px-bid.tsext-ob-oor{ background:color-mix(in srgb,var(--tsext-muted) 16%,transparent); color:var(--tsext-muted); box-shadow:none}

.tsext-ob-foot{ display:flex; justify-content:space-between; align-items:center; padding:5px 10px; font-size:var(--tsext-fs-xs); font-weight:600; border-top:1px solid var(--tsext-border); background:var(--tsext-panel2)}

.tsext-ob-foot .ask-tot{ color:var(--tsext-red)}

.tsext-ob-foot .bid-tot{ color:var(--tsext-green)}

.tsext-ob-foot .lbl{ color:var(--tsext-muted); font-weight:500; margin-inline:4px}

.tsext-ob-loading,.tsext-ob-empty{ padding:10px 8px; color:var(--tsext-muted); font-weight:600; text-align:center; font-size:var(--tsext-fs-sm)}

.tsext-ob-loading{ position:relative}

.tsext-ob-loading::after{ content:''; display:inline-block; width:8px; height:8px; margin-inline-start:6px; border-radius:50%; background:var(--tsext-accent); animation:tsextLiveDot 1.2s ease-out infinite; vertical-align:middle}

.tsext-tick-mode.active{ border-color:var(--tsext-accent) !important; background:var(--tsext-accent) !important; box-shadow:0 2px 8px color-mix(in srgb,var(--tsext-accent) 35%,transparent) !important}

.tsext-settings-toggle .tsext-caret{ font-size:var(--tsext-fs-xxs); transition:transform .18s ease}

.tsext-settings-toggle.open .tsext-caret{ transform:rotate(180deg)}

.tsext-settings-body.open{ display:block; }

.tsext-jamp-manual-grid{ margin-top:8px }

#tsext-jamp-modes .tsext-tab{ flex:1 1 calc(50% - 4px) }

.tsext-row > .tsext-input,
  .tsext-row > .tsext-select{ min-width:0; max-width:100% }

.tsext-jamp-sub, .tsext-tick-sub{ max-width:100% }

.tsext-settings-grid-compact{ gap:6px 8px }

.tsext-field-secondary input{ opacity:.92 }

.tsext-field-secondary label{ font-weight:600 }

#tsext-display-settings{
    flex-shrink:0;
    padding:5px 8px 6px;
    border-bottom:1px solid color-mix(in srgb,var(--tsext-border) 65%,transparent);
    background:var(--tsext-surface2, var(--tsext-bg));
    z-index:2;
    min-width:0;
    max-width:100%;
    box-sizing:border-box;
  }

#tsext-display-settings .tsext-ds-row{
    display:flex;
    flex-wrap:wrap;
    gap:5px 6px;
    align-items:center;
    min-height:0;
    min-width:0;
    max-width:100%;
  }

#tsext-display-settings .tsext-ds-row-class{
    margin-top:4px;
    padding-top:4px;
    border-top:1px solid color-mix(in srgb,var(--tsext-border) 50%,transparent);
    flex-wrap:nowrap;
    overflow:hidden;
  }

#tsext-display-settings .tsext-ds-inline{
    display:inline-flex;
    align-items:center;
    gap:3px;
    flex:0 1 auto;
    min-width:0;
    margin:0;
    font-weight:600;
  }

#tsext-display-settings .tsext-ds-inline .tsext-mini{
    white-space:nowrap;
    margin:0;
    font-size:var(--tsext-fs-xxs);
    color:var(--tsext-muted);
    flex-shrink:0;
  }

#tsext-display-settings .tsext-ds-select{
    width:auto;
    min-width:64px;
    max-width:110px;
    height:26px;
    padding:2px 5px;
    font-size:var(--tsext-fs-xs) !important;
  }

#tsext-display-settings .tsext-class-filter-host{
    flex:1 1 auto;
    min-width:0;
    max-width:100%;
    overflow:hidden;
  }

#tsext-display-settings .tsext-class-filter-host .tsext-legend{
    padding:0;
    margin:0;
    background:transparent !important;
    border:none !important;
    gap:3px;
    flex-wrap:nowrap;
    overflow-x:auto;
    overflow-y:hidden;
    scrollbar-width:thin;
    align-items:center;
    max-width:100%;
  }

#tsext-display-settings .tsext-class-filter-host .tsext-legend > span:first-child{
    font-size:var(--tsext-fs-xxs) !important;
    margin-inline-end:2px;
    flex-shrink:0;
  }

#tsext-display-settings .tsext-legend .tsext-chip{
    padding:2px 6px;
    font-size:11px !important;
    font-weight:600 !important;
    min-width:26px;
    text-align:center;
    flex-shrink:0;
  }

#tsext-host.tsext-narrow #tsext-display-settings .tsext-ds-inline .tsext-mini,
  #tsext-host.tsext-with-ob #tsext-display-settings .tsext-ds-inline .tsext-mini{
    display:none;
  }

#tsext-host.tsext-narrow #tsext-display-settings .tsext-ds-select,
  #tsext-host.tsext-with-ob #tsext-display-settings .tsext-ds-select{
    min-width:56px;
    max-width:96px;
    height:24px;
    font-size:var(--tsext-fs-xxs) !important;
  }

#tsext-host.tsext-narrow #tsext-display-settings,
  #tsext-host.tsext-with-ob #tsext-display-settings{
    padding:4px 6px 5px;
  }

#tsext-host.tsext-narrow .tsext-tools,
  #tsext-host.tsext-with-ob .tsext-tools{
    padding-inline:8px;
  }

#tsext-host.tsext-narrow .tsext-strategy-panel,
  #tsext-host.tsext-with-ob .tsext-strategy-panel{
    max-width:100%;
    overflow:hidden;
  }

#tsext-host.tsext-narrow .tsext-tabs,
  #tsext-host.tsext-with-ob .tsext-tabs{
    flex-wrap:wrap;
    gap:3px;
  }

#tsext-host.tsext-narrow .tsext-tab,
  #tsext-host.tsext-with-ob .tsext-tab{
    font-size:var(--tsext-fs-xs);
    padding:4px 8px;
  }

#tsext-host.tsext-narrow #tsext-list-hdr,
  #tsext-host.tsext-with-ob #tsext-list-hdr{
    overflow-x:auto;
    max-width:100%;
  }

#tsext-host.tsext-narrow .tsext-bar-main,
  #tsext-host.tsext-with-ob .tsext-bar-main{
    min-width:0;
  }

.tsext-field .tsext-input{ width:100%}

.tsext-field .tsext-num{ width:100%; text-align:right}

.tsext-field-wide{
  grid-column: 1 / -1;
}

.tsext-settings-hint{ padding:6px 0 0; font-size:var(--tsext-fs-sm); line-height:1.7}

.tsext-tick-sub{ display:none}

.tsext-tick-sub.active{ display:block}

.tsext-priceinfo b.pos{ color:var(--tsext-green)}

.tsext-priceinfo b.neg{ color:var(--tsext-red)}

.tsext-spark{ vertical-align:middle}

.tsext-flash-up{ animation:tsextFlashUp .55s ease-out; border-radius:var(--tsext-r-sm)}

.tsext-flash-down{ animation:tsextFlashDown .55s ease-out; border-radius:var(--tsext-r-sm)}

.tsext-cols-strip{ width:5px; min-width:5px}

.tsext-cols .tsext-col,
  .tsext-cols .tsext-col.on,
  .tsext-cols .tsext-bar-name,
  .tsext-cols .tsext-bar-strike,
  .tsext-cols .tsext-bar-days,
  .tsext-cols .tsext-bar-date,
  .tsext-cols .tsext-bar-risk,
  .tsext-cols .tsext-bar-profit{
    font-size:var(--tsext-fs-sm) !important; font-weight:800 !important;
    color:var(--tsext-accent) !important;
    letter-spacing:.01em;
    cursor:pointer; user-select:none; white-space:nowrap;
    text-align:center; overflow:hidden; text-overflow:ellipsis; min-width:0;
    opacity:1}

.tsext-cols .tsext-col.on{ color:var(--tsext-accent) !important; font-weight:800 !important; box-shadow:none !important; background:color-mix(in srgb,var(--tsext-accent) 10%,transparent) !important }

.tsext-cols .tsext-col:hover{ color:var(--tsext-accent) !important}

.tsext-cols .tsext-bar-name{ cursor:pointer; text-align:start; justify-self:stretch; padding-inline-start:22px; padding-inline-end:0; }

.tsext-cols-class{ text-align:center}

.tsext-sum{ display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:9px; margin:0 0 11px}

.tsext-sum-card{ background:color-mix(in srgb,var(--tsext-panel2) 90%,var(--tsext-accent)); border:1px solid var(--tsext-border); border-radius:var(--tsext-r-md); padding:9px 11px; text-align:center; min-width:0}

.tsext-sum-card .s-lbl{ display:block; font-size:var(--tsext-fs-xxs); font-weight:700; color:var(--tsext-muted); margin-bottom:3px}

.tsext-sum-card .s-val{ display:block; font-size:var(--tsext-fs-xl); font-weight:900; color:var(--tsext-bright); font-variant-numeric:tabular-nums; letter-spacing:-.02em; overflow:hidden; text-overflow:ellipsis; white-space:nowrap}

.tsext-sum-card .s-val.pos{ color:var(--tsext-green)}

.tsext-sum-card .s-val.neg{ color:var(--tsext-red)}

.tsext-sum-card.tsext-sum-main{ border-color:color-mix(in srgb,var(--tsext-green) 35%,var(--tsext-border)); background:color-mix(in srgb,var(--tsext-panel2) 80%,var(--tsext-green))}

@keyframes tsextFlashUp{ 0%{ background:color-mix(in srgb,var(--tsext-green) 26%,transparent); } 100%{ background:transparent; } }

@keyframes tsextFlashDown{ 0%{ background:color-mix(in srgb,var(--tsext-red) 26%,transparent); } 100%{ background:transparent; } }

.tsext-ob-cell-flash{ animation:tsextObCellFlash .5s ease-out; border-radius:var(--tsext-r-sm); }

@keyframes tsextObCellFlash{ 0%{ background:color-mix(in srgb,var(--tsext-accent) 18%,transparent); } 100%{ background:transparent; } }

#tsext-host.tsext-narrow .tsext-bar-risk,
  #tsext-host.tsext-narrow .tsext-cols .tsext-bar-risk{ display:none; }

#tsext-host.tsext-narrow .tsext-tab{ font-size:var(--tsext-fs-xs); padding:5px 2px}

#tsext-host::after{
    content:''; position:absolute; inset:0; pointer-events:none; border-radius:inherit;
    box-shadow:inset 0 1px 0 rgba(255,255,255,.65); z-index:0}

#tsext-maincol{
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  min-width: 0;
  overflow: hidden;
  position: relative;
  z-index: 1;
}

.tsext-btn:active{ transform:translateY(0)}

.tsext-btn.tsext-close:hover{
  background: var(--tsext-red);
  color: #fff;
  box-shadow: 0 5px 14px color-mix(in srgb,var(--tsext-red) 22%,transparent);
}

.tsext-tab::after{
    content:''; position:absolute; inset:auto 16% 0; height:2px; border-radius:var(--tsext-r-pill);
    background:var(--tsext-accent); transform:scaleX(0); transition:transform .18s ease}

.tsext-tab.active,
  .tsext-tab.on,
  .tsext-tab[aria-selected="true"]{
    color:var(--tsext-accent) !important;
    background:color-mix(in srgb,var(--tsext-accent) 10%,var(--tsext-panel)) !important;
    box-shadow:0 4px 12px color-mix(in srgb,var(--tsext-accent) 12%,transparent)}

.tsext-tab.active::after,.tsext-tab.on::after,.tsext-tab[aria-selected="true"]::after{ transform:scaleX(1)}

[id^="tsext-go-"]:active{
  transform: translateY(1px);
}

.tsext-settings-toggle.open{
  color: var(--tsext-accent);
  border-color: var(--tsext-accent);
  background: color-mix(in srgb,var(--tsext-accent) 8%,transparent);
  box-shadow: 0 4px 12px color-mix(in srgb,var(--tsext-accent) 10%,transparent);
}

.tsext-mini{
  color: var(--tsext-muted);
  font-weight: 600;
  white-space: nowrap;
  opacity: 1;
  line-height: 1.3;
  margin: 0;
  font-size: var(--tsext-fs-sm);
}

.tsext-price-basis{
  font-weight: 700;
  color: var(--tsext-muted);
  padding: 1px 8px 7px;
  line-height: 1.5;
  font-size: var(--tsext-fs-xs);
  opacity: 1;
}

.tsext-cols .tsext-col{ font-size:var(--tsext-fs-xs) !important}

.tsext-bar-detail{
  max-height: 0;
  overflow: hidden;
  padding: 0 12px;
  transition: max-height .28s ease,padding .2s ease;
  background: color-mix(in srgb,var(--tsext-panel2) 85%,transparent);
}

.tsext-bar-badge,.tsext-bar-class,.tsext-chip{ border-radius:var(--tsext-r-sm)}

#tsext-priceinfo{ margin-top:8px}

.tsext-priceinfo b{
  color: var(--tsext-accent);
  font-weight: 900;
}

.tsext-obpanel-title,.tsext-ob-title{ font-weight:900 !important}

#tsext-host.tsext-theme-contrast .tsext-bar:hover{ box-shadow:none}

@media (prefers-reduced-motion: reduce){
    #tsext-host *, #tsext-host *::before, #tsext-host *::after{
      animation-duration:.01ms !important; animation-iteration-count:1 !important;
      transition-duration:.01ms !important; scroll-behavior:auto !important}
    .tsext-bar:hover{ transform:none}
  }

#tsext-head::before{
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  background: var(--tsext-accent);
  height: 3px;
  opacity: .9;
  height: 4px;
  background: linear-gradient(90deg,#06b6d4 0%,#4f46e5 45%,#7c3aed 72%,#ec4899 100%) !important;
  opacity: 1;
  animation: none !important;
}

.tsext-btn{
  background: transparent;
  border: 1px solid transparent;
  cursor: pointer;
  font-family: inherit;
  font-size: var(--tsext-fs-sm);
  font-weight: 700;
  min-height: 29px;
  padding: 5px 8px;
  border-radius: var(--tsext-r-sm);
  color: var(--tsext-muted);
  transition: transform .14s ease,background .16s ease,color .16s ease,box-shadow .16s ease;
  min-height: 31px;
  border-radius: var(--tsext-r-sm);
  font-weight: 800 !important;
  transition: all .18s ease !important;
}

.tsext-btn:hover{
  transform: translateY(-1px);
  background: color-mix(in srgb,var(--tsext-accent) 9%,var(--tsext-panel));
  color: var(--tsext-bright);
  box-shadow: 0 4px 12px rgba(15,23,42,.06);
  color: #4338ca !important;
  transform: translateY(-1px);
}

#tsext-head > .tsext-row:first-of-type{
  margin-top: 11px;
  margin-top: 13px;
}

.tsext-input:hover{
  background: var(--tsext-input);
  border-color: color-mix(in srgb,var(--tsext-border) 55%,var(--tsext-accent));
  box-shadow: 0 4px 12px rgba(79,70,229,.07) !important;
}

.tsext-input:focus{
  border-color: var(--tsext-accent);
  transform: translateY(-1px);
  background: var(--tsext-input);
  box-shadow: 0 0 0 3px color-mix(in srgb,var(--tsext-accent) 12%,transparent),0 5px 12px rgba(15,23,42,.05);
  border-color: #6366f1 !important;
  box-shadow: 0 0 0 4px rgba(99,102,241,.12),0 6px 16px rgba(79,70,229,.08) !important;
  transform: none;
}

[id^="tsext-go-"]:hover{
  background: color-mix(in srgb,var(--tsext-accent) 85%,#000);
  filter: saturate(1.08) brightness(1.02);
  box-shadow: 0 10px 20px color-mix(in srgb,var(--tsext-accent) 30%,transparent);
  transform: translateY(-1px);
  transform: translateY(-2px);
  filter: saturate(1.08) brightness(1.02) !important;
  box-shadow: 0 13px 25px rgba(79,70,229,.3) !important;
}

.tsext-tab::before{font-size:var(--tsext-fs-base);margin-inline-end:5px;vertical-align:-1px}

.tsext-tab[data-s="pospanj"]::before{content:'✦';color:#10b981}

.tsext-tab[data-s="combo"]::before{content:'⇄';color:#06b6d4}

.tsext-tab[data-s="jamp"]::before{content:'↗';color:#8b5cf6}

.tsext-modes-row .tsext-tab::before{display:none}

.tsext-modes-row .tsext-tab.active{background:linear-gradient(135deg,#0ea5e9,#06b6d4) !important;box-shadow:0 6px 14px rgba(6,182,212,.2) !important}

.tsext-strategy-panel{
  display: none;
  max-width: 100%;
  box-sizing: border-box;
  overflow: visible;
  margin-top: 9px;
  padding: 10px;
  background: color-mix(in srgb,var(--tsext-panel) 78%,transparent);
  border: 1px solid color-mix(in srgb,var(--tsext-border) 80%,transparent);
  border-radius: var(--tsext-r-lg);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.45),0 5px 14px rgba(15,23,42,.035);
  margin-top: 10px;
  padding: 12px;
  border-radius: var(--tsext-r-lg);
  background: rgba(255,255,255,.82) !important;
  box-shadow: 0 7px 20px rgba(15,23,42,.045) !important;
}

.tsext-section{
  margin-top: 11px;
  padding-top: 10px;
  border-top: 1px dashed color-mix(in srgb,var(--tsext-border) 82%,transparent);
  margin-top: 12px;
  padding-top: 11px;
}

.tsext-section-title{
  color: var(--tsext-bright);
  font-weight: 800;
  letter-spacing: .01em;
  font-size: var(--tsext-fs-md);
  margin-bottom: 6px;
  font-weight: 900 !important;
}

.tsext-settings-toggle:hover{
  color: var(--tsext-accent);
  border-color: var(--tsext-accent);
  transform: translateY(-1px);
  background: color-mix(in srgb,var(--tsext-accent) 7%,var(--tsext-panel));
  color: #4338ca !important;
}

#tsext-list{
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  background: transparent;
  background: transparent !important;
}

.tsext-bar-strip{
  width: 3px;
  min-width: 3px;
  align-self: stretch;
  border-radius: 0;
  background: var(--tsext-sw-X);
  justify-self: stretch;
  width: 5px;
  min-width: 5px;
  border-radius: var(--tsext-r-pill);
  box-shadow: 0 0 10px currentColor;
}

.tsext-bar-class{
  font-size: var(--tsext-fs-xs);
  font-weight: 800;
  border-radius: var(--tsext-r-sm);
  padding: 2px 5px;
  border: 1px solid;
  min-width: 28px;
  text-align: center;
  background: color-mix(in srgb,currentColor 12%,transparent);
  justify-self: center;
  padding: 4px 6px;
  min-width: 31px;
  border-radius: var(--tsext-r-sm);
  font-weight: 900 !important;
}

.tsext-bar-name{
  color: var(--tsext-bright);
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  overflow: hidden;
  font-weight: 900;
  letter-spacing: -.02em;
  font-size: var(--tsext-fs-md) !important;
  font-weight: 900 !important;
}

.tsext-bar-strike{
  color: var(--tsext-bright);
  text-align: center;
  font-variant-numeric: tabular-nums;
  font-weight: 800;
  overflow: visible;
  text-overflow: clip !important;
  white-space: nowrap;
  min-width: 0;
  font-size: var(--tsext-fs-md);
  font-size: var(--tsext-fs-base) !important;
  font-weight: 900 !important;
}

.tsext-bar-days{
  color: var(--tsext-fg);
  text-align: center;
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  font-size: var(--tsext-fs-md);
  font-weight: 800 !important;
}

.tsext-bar-profit{
  text-align: center;
  font-variant-numeric: tabular-nums;
  letter-spacing: -.01em;
  padding: 3px 8px;
  overflow: visible;
  text-overflow: clip !important;
  white-space: nowrap;
  min-width: 0;
  max-width: none;
  border-radius: var(--tsext-r-sm);
  font-size: var(--tsext-fs-base);
  font-weight: 900;
  font-size: var(--tsext-fs-lg) !important;
  font-weight: 950 !important;
  padding: 5px 9px;
  border-radius: var(--tsext-r-md);
}

.tsext-bar-badge{
  display: inline-block;
  margin-inline-start: 5px;
  font-size: var(--tsext-fs-xxs);
  font-weight: 700;
  color: var(--tsext-accent);
  border: 1px solid color-mix(in srgb,var(--tsext-accent) 45%,var(--tsext-border));
  background: color-mix(in srgb,var(--tsext-accent) 8%,transparent);
  border-radius: var(--tsext-r-xs);
  padding: 1px 8px;
  vertical-align: middle;
  padding: 2px 6px;
  border-radius: var(--tsext-r-sm);
  color: #4f46e5 !important;
}

.tsext-bar-open,.tsext-bar-obbtn{
  border-radius: var(--tsext-r-sm);
  height: 28px;
  width: 28px;
  border-radius: var(--tsext-r-sm);
}

.tsext-bar-open:hover,.tsext-bar-obbtn:hover{color:#4338ca !important}

.tsext-bar.open{
  border-color: var(--tsext-accent);
  box-shadow: 0 0 0 1px color-mix(in srgb,var(--tsext-accent) 22%,transparent),0 10px 24px color-mix(in srgb,var(--tsext-accent) 9%,transparent);
  box-shadow: 0 0 0 2px rgba(129,140,248,.12),0 13px 28px rgba(79,70,229,.10) !important;
}

.tsext-empty{
  text-align: center;
  color: var(--tsext-muted);
  font-size: var(--tsext-fs-base);
  font-weight: 600;
  line-height: 1.9;
  border: 1px dashed color-mix(in srgb,var(--tsext-border) 80%,transparent);
  margin-top: 9px;
  padding: 34px 16px;
  border-radius: var(--tsext-r-lg);
  background: linear-gradient(135deg,color-mix(in srgb,var(--tsext-accent) 4%,var(--tsext-panel)),color-mix(in srgb,var(--tsext-panel2) 92%,transparent));
  padding: 38px 16px;
  border-radius: var(--tsext-r-lg);
}

.tsext-obpanel-head > span,#tsext-obpanel-title{font-weight:900 !important}

#tsext-host.tsext-theme-contrast{
  --tsext-border: #a3a3a3;
  --tsext-soft-shadow: none;
  --tsext-float-shadow: 0 10px 25px rgba(0,0,0,.5);
  --tsext-accent: #22d3ee;
}

@media (prefers-reduced-motion:reduce){
    #tsext-host *,#tsext-host *::before,#tsext-host *::after{transition-duration:.01ms !important;animation:none !important}
    .tsext-bar:hover,.tsext-btn:hover,.tsext-tab:hover{transform:none;}
  }

.tsext-col-grip::before{
    content:'';
    position:absolute;
    inset-inline-end:3px !important;
    top:0;
    bottom:0;
    width:2px;
    border-radius:var(--tsext-r-xxs);
    background:color-mix(in srgb, var(--tsext-fg) 48%, transparent) !important;
    transition: background .12s ease, width .12s ease, box-shadow .12s ease !important}

.tsext-col-grip::after{ content:none; display:none}

.tsext-col-grip:hover::before,
  .tsext-col-grip:active::before,
  .tsext-col-grip.is-dragging::before{
    width:3px;
    background:var(--tsext-accent) !important;
    box-shadow:0 0 0 1px color-mix(in srgb, var(--tsext-accent) 25%, transparent) !important}

body.tsext-col-resizing{ cursor:col-resize !important; user-select:none !important; -webkit-user-select:none !important; }

body.tsext-col-resizing *{ cursor:col-resize !important; }

.tsext-cols-actions{
  min-width: 52px;
  font-size: var(--tsext-fs-sm) !important;
  font-weight: 800 !important;
  color: var(--tsext-accent) !important;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  position: relative;
  cursor: pointer !important;
}

#tsext-head{
  position: relative;
  overflow: hidden;
  flex-shrink: 0;
  padding: 12px 13px 11px;
  background: radial-gradient(130% 180% at 100% -10%, color-mix(in srgb,var(--tsext-accent) 14%,transparent), transparent 60%),
      linear-gradient(180deg,
        color-mix(in srgb,var(--tsext-panel) 96%,var(--tsext-accent)),
        color-mix(in srgb,var(--tsext-panel2) 94%,var(--tsext-accent)));
  border-bottom: 1px solid color-mix(in srgb,var(--tsext-border) 82%,var(--tsext-accent));
  padding: 10px 12px 9px;
  background: radial-gradient(110% 170% at 100% 0%,color-mix(in srgb,var(--tsext-accent) 13%,transparent),transparent 58%),var(--tsext-panel) !important;
}

.tsext-titlebar{
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  gap: 12px;
  min-height: 34px;
}

.tsext-brand{
  display: flex;
  align-items: center;
  min-width: 0;
  flex: 1;
  gap: 11px;
  gap: 10px;
}

.tsext-logo{
  flex-shrink: 0;
  background-size: 220% 220%;
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 800;
  animation: tsextLogoGlow 3.8s ease-in-out infinite;
  background: linear-gradient(135deg,var(--tsext-accent),color-mix(in srgb,var(--tsext-accent) 48%,#7c3aed),var(--tsext-accent));
  width: 42px;
  height: 42px;
  border-radius: var(--tsext-r-lg);
  background: linear-gradient(135deg,#06b6d4 0%,#4f46e5 52%,#7c3aed 100%) !important;
  box-shadow: 0 10px 24px rgba(79,70,229,.26) !important;
  font-size: var(--tsext-fs-2xl) !important;
  animation: none !important;
  width: 34px;
  height: 34px;
  border-radius: var(--tsext-r-md);
  font-size: var(--tsext-fs-2xl);
  box-shadow: 0 5px 16px color-mix(in srgb,var(--tsext-accent) 25%,transparent);
}

.tsext-title{
  font-weight: 800;
  color: var(--tsext-bright);
  white-space: nowrap;
  font-size: var(--tsext-fs-lg);
  letter-spacing: -.01em;
  font-weight: 900 !important;
  letter-spacing: -.025em !important;
  font-size: var(--tsext-fs-lg) !important;
}

.tsext-subtitle{
  font-weight: 600;
  color: color-mix(in srgb,var(--tsext-accent) 70%,var(--tsext-muted));
  white-space: nowrap;
  font-size: var(--tsext-fs-xs);
  opacity: .92;
  margin-top: 1px;
  color: #6366f1 !important;
  font-weight: 800 !important;
  font-size: var(--tsext-fs-xs) !important;
}

.tsext-tools{
  display: flex;
  align-items: center;
  flex-shrink: 0;
  border: 1px solid var(--tsext-border);
  gap: 3px;
  padding: 3px;
  border-radius: var(--tsext-r-md);
  background: color-mix(in srgb,var(--tsext-panel) 72%,transparent);
  box-shadow: 0 3px 12px rgba(15,23,42,.05);
  box-shadow: 0 4px 16px rgba(15,23,42,.05) !important;
  gap: 3px;
  padding: 4px;
  border-radius: var(--tsext-r-md);
  background: color-mix(in srgb,var(--tsext-panel2) 82%,transparent) !important;
}

.tsext-tools .tsext-btn{min-width:31px;height:28px;padding:3px 8px;border-radius:var(--tsext-r-sm)}

.tsext-row{
  display: flex;
  gap: 6px;
  align-items: center;
  margin-top: 6px;
  flex-wrap: wrap;
  gap: 7px;
  margin-top: 8px;
}

.tsext-input{
  color: var(--tsext-bright);
  border: 1px solid var(--tsext-border);
  font-family: inherit;
  font-size: var(--tsext-fs-base);
  font-weight: 700;
  outline: none;
  min-height: 34px;
  padding: 7px 10px;
  border-radius: var(--tsext-r-sm);
  border-color: color-mix(in srgb,var(--tsext-border) 88%,var(--tsext-accent));
  background: color-mix(in srgb,var(--tsext-input) 96%,var(--tsext-panel));
  transition: border-color .16s ease,box-shadow .16s ease,transform .12s ease,background .16s ease;
  min-height: 38px;
  box-shadow: 0 2px 7px rgba(15,23,42,.025) !important;
  height: 34px;
  border-radius: var(--tsext-r-sm);
  padding: 7px 10px;
  background: var(--tsext-input) !important;
  box-shadow: inset 0 1px 1px color-mix(in srgb,#000 5%,transparent);
}

[id^="tsext-go-"]{
  color: #ffffff !important;
  -webkit-text-fill-color: #ffffff !important;
  border: none;
  cursor: pointer;
  font-family: inherit;
  font-size: var(--tsext-fs-base);
  font-weight: 800;
  min-height: 34px;
  padding: 7px 17px;
  border-radius: var(--tsext-r-md);
  background: linear-gradient(135deg,var(--tsext-accent),color-mix(in srgb,var(--tsext-accent) 72%,#7c3aed));
  box-shadow: 0 7px 16px color-mix(in srgb,var(--tsext-accent) 25%,transparent);
  transition: transform .14s ease,box-shadow .16s ease,filter .16s ease;
  min-height: 38px;
  background: linear-gradient(135deg,#4f46e5,#7c3aed 60%,#8b5cf6) !important;
  box-shadow: 0 9px 18px rgba(79,70,229,.25) !important;
  font-weight: 900 !important;
  height: 34px;
  border-radius: var(--tsext-r-sm);
  padding: 6px 20px;
}

.tsext-tabs{
  display: flex;
  flex: 1;
  gap: 5px;
  padding: 4px;
  border-radius: var(--tsext-r-md);
  background: color-mix(in srgb,var(--tsext-panel2) 86%,transparent);
  border: 1px solid color-mix(in srgb,var(--tsext-border) 85%,transparent);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.9),0 5px 16px rgba(79,70,229,.06) !important;
  display: grid;
  grid-template-columns: 1fr;
  gap: 4px;
  padding: 4px;
  border-radius: var(--tsext-r-md);
  background: var(--tsext-surface2) !important;
  box-shadow: inset 0 0 0 1px var(--tsext-line);
}

.tsext-tab{
  background: transparent;
  border: 1px solid transparent;
  cursor: pointer;
  font-family: inherit;
  white-space: nowrap;
  overflow: hidden;
  border-radius: var(--tsext-r-sm);
  padding: 7px 10px;
  color: var(--tsext-muted);
  font-size: var(--tsext-fs-md);
  font-weight: 800;
  transition: transform .14s ease,background .16s ease,color .16s ease,box-shadow .16s ease;
  position: relative;
  min-height: 36px;
  font-size: var(--tsext-fs-md) !important;
  position: relative;
  min-height: 34px;
  padding: 6px 8px;
  border-radius: var(--tsext-r-sm);
  font-weight: 800 !important;
  transition: transform .16s,background .16s,color .16s,box-shadow .16s !important;
}

.tsext-tab:hover{
  background: color-mix(in srgb,var(--tsext-accent) 7%,var(--tsext-panel));
  color: var(--tsext-bright);
  transform: translateY(-1px);
  background: var(--tsext-soft) !important;
  color: var(--tsext-bright) !important;
  transform: translateY(-1px);
}

.tsext-tab.active{
  background: var(--tsext-accent);
  color: #fff;
  box-shadow: none;
  background: linear-gradient(135deg,var(--tsext-accent),color-mix(in srgb,var(--tsext-accent) 72%,#7c3aed)) !important;
  box-shadow: 0 5px 14px color-mix(in srgb,var(--tsext-accent) 25%,transparent) !important;
  transform: translateY(-1px);
}

.tsext-tab.active::after{
  display: none;
  content: '';
  position: absolute;
  left: 18%;
  right: 18%;
  bottom: 2px;
  height: 2px;
  border-radius: var(--tsext-r-xxs);
  background: rgba(255,255,255,.75);
}

.tsext-strategy-panel.active{
  display: block;
  display: block;
  animation: tsextPanelIn .18s ease both;
}

@keyframes tsextPanelIn{from{opacity:.45;transform:translateY(2px)}to{opacity:1;transform:none}}

.tsext-strategy-panel > .tsext-row:first-child{padding:2px 0 1px}

.tsext-settings-toggle{
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 32px;
  padding: 0 10px;
  flex-shrink: 0;
  color: var(--tsext-muted);
  border: 1px solid var(--tsext-border);
  cursor: pointer;
  font-family: inherit;
  font-size: var(--tsext-fs-md);
  font-weight: 700;
  white-space: nowrap;
  display: none;
  min-height: 34px;
  border-radius: var(--tsext-r-sm);
  background: color-mix(in srgb,var(--tsext-panel) 55%,transparent);
  transition: transform .14s ease,background .16s ease,border-color .16s ease,color .16s ease;
  min-height: 36px;
  height: 34px;
  border-radius: var(--tsext-r-sm);
  background: var(--tsext-surface2) !important;
  color: var(--tsext-fg) !important;
  font-weight: 800 !important;
}

.tsext-settings-toggle:hover,.tsext-settings-toggle.open{background:var(--tsext-soft) !important;color:var(--tsext-accent) !important;border-color:var(--tsext-accent) !important}

.tsext-settings-body{
  display: block;
  border-top: 1px dashed color-mix(in srgb,var(--tsext-border) 70%,transparent);
  max-height: none;
  overflow: visible;
  padding-bottom: 12px;
  padding-top: 10px;
  margin-top: 10px;
  margin-top: 9px;
  padding: 10px;
  border: 1px solid var(--tsext-line) !important;
  border-radius: var(--tsext-r-md);
  background: var(--tsext-surface2) !important;
}

.tsext-settings-grid{
  display: grid;
  grid-template-columns: repeat(2,minmax(0,1fr));
  gap: 8px 9px;
  gap: 8px 9px;
}

.tsext-field{
  display: flex;
  flex-direction: column;
  min-width: 0;
  margin: 0;
  gap: 4px;
  gap: 4px;
}

.tsext-field > label,.tsext-settings-hint,.tsext-section-title{color:var(--tsext-muted) !important;font-weight:800 !important}

.tsext-field > label{font-size:var(--tsext-fs-xs) !important}

.tsext-modes-row{
  border: 1px solid var(--tsext-border);
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  width: 100%;
  box-sizing: border-box;
  margin-top: 8px;
  padding: 4px;
  border-radius: var(--tsext-r-md);
  background: color-mix(in srgb,var(--tsext-panel) 72%,transparent);
  margin-top: 9px;
  padding: 4px;
  border-radius: var(--tsext-r-md);
  background: var(--tsext-surface2) !important;
}

.tsext-modes-row .tsext-tab{
  padding: 4px 5px;
  font-size: var(--tsext-fs-sm);
  min-height: 26px;
  flex: 1 1 calc(50% - 4px);
  min-width: 72px;
  max-width: 100%;
  text-align: center;
  font-size: var(--tsext-fs-sm) !important;
  min-height: 31px;
}

.tsext-tickmode-note{
  word-break: break-word;
  overflow-wrap: anywhere;
  display: flex;
  align-items: flex-start;
  gap: 7px;
  margin-top: 7px;
  font-size: var(--tsext-fs-sm);
  line-height: 1.7;
  color: var(--tsext-fg);
  border: 1px solid color-mix(in srgb,var(--tsext-border) 70%,transparent);
  border-inline-start: 3px solid var(--tsext-accent);
  background: linear-gradient(135deg,color-mix(in srgb,var(--tsext-accent) 6%,var(--tsext-panel)),color-mix(in srgb,var(--tsext-panel) 88%,transparent));
  border-radius: var(--tsext-r-md);
  padding: 8px 10px;
  border-radius: var(--tsext-r-sm);
  background: var(--tsext-soft) !important;
}

.tsext-hdr{
  font-size: var(--tsext-fs-md);
  color: var(--tsext-fg);
  font-weight: 600;
  padding: 7px 10px;
  line-height: 1.7;
  background: color-mix(in srgb,var(--tsext-panel) 70%,transparent);
  border-radius: var(--tsext-r-md);
  margin-bottom: 6px;
  border: 1px solid color-mix(in srgb,var(--tsext-border) 70%,transparent);
  border-inline-start: 3px solid var(--tsext-accent);
  margin-bottom: 8px;
  border-inline-start: 4px solid #6366f1 !important;
  box-shadow: 0 5px 15px rgba(15,23,42,.035) !important;
  margin-top: 8px;
  padding: 9px 11px;
  border-radius: var(--tsext-r-md);
  background: var(--tsext-surface) !important;
  box-shadow: var(--tsext-shadow-soft);
}

.tsext-priceinfo{
  font-size: var(--tsext-fs-md);
  color: var(--tsext-fg);
  font-weight: 600;
  margin-top: 7px;
  line-height: 1.8;
  padding: 6px 10px;
  margin-top: 8px;
  border-radius: var(--tsext-r-sm);
  background: var(--tsext-surface2);
  border: 1px solid var(--tsext-line);
}

.tsext-legend{
  font-size: var(--tsext-fs-xs);
  color: var(--tsext-muted);
  font-weight: 700;
  padding: 2px 4px 7px;
  margin-bottom: 2px;
  display: flex;
  flex-wrap: wrap;
  gap: 3px 6px;
  align-items: center;
  line-height: 1.7;
  gap: 5px 7px;
  padding: 7px 8px;
  margin: 5px 0 4px;
  border-radius: var(--tsext-r-sm);
  background: var(--tsext-surface2);
  border: 1px solid var(--tsext-line);
}

.tsext-candlist{
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 4px;
  gap: 7px;
  padding: 5px 2px;
}

.tsext-cand{
  background: var(--tsext-panel2);
  border: 1px solid var(--tsext-border);
  border-radius: var(--tsext-r-md);
  padding: 9px 12px;
  font-size: var(--tsext-fs-md);
  font-weight: 700;
  color: var(--tsext-bright);
  cursor: pointer;
  text-align: right;
  transition: border-color .15s,background .15s;
  padding: 10px 12px;
  border-radius: var(--tsext-r-md);
  background: var(--tsext-surface) !important;
  box-shadow: 0 2px 8px color-mix(in srgb,#000 6%,transparent);
}

.tsext-cand:hover{
  border-color: var(--tsext-accent);
  background: color-mix(in srgb,var(--tsext-accent) 6%,var(--tsext-panel2));
  transform: translateY(-1px);
  box-shadow: 0 5px 14px color-mix(in srgb,var(--tsext-accent) 10%,transparent);
}

.tsext-grid{
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px 16px;
  margin-top: 2px;
  gap: 5px;
  padding: 2px;
}

.tsext-cell{
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
  padding: 4px 0;
  border-bottom: 1px solid color-mix(in srgb,var(--tsext-border) 60%,transparent);
  padding: 7px 8px;
  border: 1px solid var(--tsext-line);
  border-radius: var(--tsext-r-sm);
  background: var(--tsext-surface2);
}

.tsext-cell .lbl{
  font-size: var(--tsext-fs-sm);
  color: var(--tsext-muted);
  font-weight: 600;
  white-space: nowrap;
  color: var(--tsext-muted) !important;
  font-size: var(--tsext-fs-xs) !important;
  font-weight: 800 !important;
}

.tsext-cell .val{
  font-weight: 600;
  color: var(--tsext-bright);
  font-size: var(--tsext-fs-xs);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  font-weight: 900 !important;
}

.tsext-grid-divider{
  grid-column: 1 / -1;
  border-top: 1px dashed color-mix(in srgb,var(--tsext-border) 80%,transparent);
  margin: 5px 0 2px;
  margin: 5px 0;
  border-color: var(--tsext-line) !important;
}

.tsext-cols{
  display: grid;
  grid-template-columns: var(--tsext-grid-cols);
  align-items: center;
  column-gap: var(--tsext-grid-gap);
  margin: 0;
  box-sizing: border-box;
  width: 100%;
  padding: 8px 11px 7px;
  background: color-mix(in srgb,var(--tsext-panel2) 72%,transparent);
  border-radius: var(--tsext-r-md) 12px 7px 7px;
  position: relative;
  overflow: visible;
  min-width: max-content;
  padding: 5px 7px;
  border: 1px solid var(--tsext-line);
  border-radius: var(--tsext-r-sm);
  background: var(--tsext-surface2) !important;
}

.tsext-col{height:28px;display:flex;align-items:center;justify-content:center;position:relative;border-radius:var(--tsext-r-xs);color:var(--tsext-accent) !important;font-weight:800 !important;background:color-mix(in srgb,var(--tsext-accent) 10%,transparent) !important;box-shadow:none !important}

.tsext-col.on{color:var(--tsext-accent) !important;background:color-mix(in srgb,var(--tsext-accent) 10%,transparent) !important;box-shadow:none !important;font-weight:800 !important}

.tsext-bar{
  border: 1px solid var(--tsext-border);
  overflow: hidden;
  position: relative;
  margin-bottom: 9px;
  border-radius: var(--tsext-r-lg);
  background: linear-gradient(145deg,
      color-mix(in srgb,var(--tsext-panel) 98%,transparent),
      color-mix(in srgb,var(--tsext-panel2) 94%,transparent));
  border-color: color-mix(in srgb,var(--tsext-border) 84%,transparent);
  box-shadow: 0 2px 10px rgba(15,23,42,.045);
  transition: border-color .16s ease,transform .16s ease,box-shadow .18s ease,background .16s ease;
  overflow: hidden;
  box-shadow: 0 4px 14px rgba(15,23,42,.045) !important;
  transition: transform .18s ease,box-shadow .18s ease,border-color .18s ease !important;
  animation: none !important;
  min-width: max-content;
  border-radius: var(--tsext-r-md);
  margin-bottom: 7px;
  background: var(--tsext-surface) !important;
}

.tsext-bar-main{
  display: grid;
  grid-template-columns: var(--tsext-grid-cols);
  align-items: center;
  column-gap: var(--tsext-grid-gap);
  cursor: pointer;
  user-select: none;
  box-sizing: border-box;
  width: 100%;
  padding: 11px 11px;
  padding: 12px 11px;
  min-width: 0; width: 100%; max-width: 100%;
}

.tsext-bar:hover{
  background: color-mix(in srgb,var(--tsext-panel) 97%,var(--tsext-accent));
  border-color: color-mix(in srgb,var(--tsext-accent) 38%,var(--tsext-border));
  box-shadow: 0 9px 22px color-mix(in srgb,var(--tsext-accent) 10%,transparent),0 3px 10px rgba(15,23,42,.05);
  transform: translateY(-3px);
  box-shadow: 0 12px 26px rgba(79,70,229,.11),0 5px 14px rgba(15,23,42,.045) !important;
  transform: translateY(-1px);
}

.tsext-bar.active-ob{
  border-color: var(--tsext-accent) !important;
  background: color-mix(in srgb,var(--tsext-accent) 10%,var(--tsext-panel));
  box-shadow: 0 0 0 1px color-mix(in srgb,var(--tsext-accent) 40%,transparent);
  transform: none;
}

.tsext-bar-actions{
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
  min-width: 0;
  gap: 5px;
}

.tsext-bar-obbtn{
  background: transparent;
  border: 1px solid var(--tsext-border);
  color: var(--tsext-muted);
  border-radius: var(--tsext-r-sm);
  padding: 0 7px;
  height: 22px;
  line-height: 1;
  cursor: pointer;
  font-size: var(--tsext-fs-xs);
  font-family: inherit;
  font-weight: 800;
  white-space: nowrap;
  flex-shrink: 0;
  transition: color .15s,border-color .15s,background .15s;
  width: auto;
  height: 25px;
  padding: 0 8px;
  border-radius: var(--tsext-r-sm);
  background: var(--tsext-surface2) !important;
}

#tsext-obpanel{
  display: none;
  position: fixed;
  top: 0;
  width: 400px;
  height: 500px;
  max-height: calc(100vh - 12px);
  flex-direction: column;
  border: 1px solid var(--tsext-border);
  background: var(--tsext-panel);
  z-index: 2147483647;
  border-radius: var(--tsext-r-xl);
  box-shadow: var(--tsext-float-shadow);
  overflow: visible;
  border-radius: var(--tsext-r-lg);
  background: var(--tsext-panel) !important;
  box-shadow: var(--tsext-shadow) !important;
}

.tsext-obpanel-head{
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 6px;
  border-bottom: 1px solid var(--tsext-border);
  flex-shrink: 0;
  cursor: move;
  user-select: none;
  padding: 10px 12px;
  background: linear-gradient(135deg,color-mix(in srgb,var(--tsext-accent) 9%,var(--tsext-panel)),var(--tsext-panel2));
  border-bottom-color: color-mix(in srgb,var(--tsext-border) 78%,transparent);
  border-radius: var(--tsext-r-lg) 15px 0 0;
  padding: 11px 13px;
  background: var(--tsext-surface2) !important;
  border-radius: var(--tsext-r-lg) 13px 0 0;
}

#tsext-obpanel-body{
  border-radius: 0 0 var(--tsext-r-lg) var(--tsext-r-lg);
  background: var(--tsext-panel);
  flex: 1;
  min-height: 0;
  overflow: hidden;
  padding: 0;
  display: flex;
  flex-direction: column;
  overscroll-behavior: contain;
  padding: 0;
  background: var(--tsext-panel) !important;
}

#tsext-ob-books .tsext-ob-title{
  font-size: var(--tsext-fs-xs) !important;
  border-bottom: 1px solid var(--tsext-border);
  padding: 5px 8px;
  border-radius: 0;
}

#tsext-ob-books .tsext-ob{
  margin: 0;
  border: none !important;
  box-shadow: none !important;
  border-radius: 0;
}

#tsext-ob-books .tsext-ob-table th{
  height: 24px;
}

#tsext-ob-books .tsext-ob-table td{
  height: 22px;
}

.tsext-empty,.tsext-ob-empty,.tsext-ob-loading{border-radius:var(--tsext-r-md);background:var(--tsext-surface2) !important;border-color:var(--tsext-line) !important;padding:20px 14px}

@media (max-width:520px){.tsext-tabs{grid-template-columns:repeat(2,minmax(0,1fr))}.tsext-settings-grid{grid-template-columns:1fr}.tsext-field-wide{grid-column:auto}.tsext-tools .tsext-btn{min-width:28px;padding-inline:6px}}

#tsext-host, #tsext-host *{ -webkit-font-smoothing:antialiased; text-rendering:optimizeLegibility; }

#tsext-host button, #tsext-host input, #tsext-host select, #tsext-host textarea{ color:var(--tsext-bright) !important}

#tsext-host .tsext-title, #tsext-host .tsext-subtitle, #tsext-host .tsext-tab, #tsext-host .tsext-btn,
  #tsext-host .tsext-field > label, #tsext-host .tsext-section-title, #tsext-host .tsext-settings-hint,
  #tsext-host .tsext-col, #tsext-host .tsext-bar, #tsext-host .tsext-priceinfo,
  #tsext-host .tsext-hdr, #tsext-host .tsext-legend, #tsext-host .tsext-cell,
  #tsext-host .tsext-status, #tsext-host #tsext-status, #tsext-host .tsext-obpanel-head,
  #tsext-host .tsext-ob-table th, #tsext-host .tsext-ob-table td, #tsext-host .tsext-empty,
  #tsext-host .tsext-ob-empty, #tsext-host .tsext-ob-loading{ text-shadow:none !important}

#tsext-host .tsext-title, #tsext-host #tsext-obpanel-title{ color:var(--tsext-bright) !important; font-weight:900 !important}

#tsext-host .tsext-subtitle, #tsext-host .tsext-field > label, #tsext-host .tsext-settings-hint,
  #tsext-host .tsext-section-title, #tsext-host .tsext-legend{ color:var(--tsext-muted) !important; opacity:1}

#tsext-host .tsext-mini, #tsext-host .tsext-priceinfo, #tsext-host .tsext-hdr{ color:var(--tsext-fg) !important; opacity:1}

#tsext-host .tsext-hdr b, #tsext-host .tsext-priceinfo b{ color:var(--tsext-bright) !important}

#tsext-host .tsext-cell .val:not([class*="tsext-risk-"]){ color:var(--tsext-bright) !important}

#tsext-host .tsext-cell .val.neg{ color:var(--tsext-red) !important}

#tsext-host .tsext-cell .val.warn{ color:var(--tsext-orange) !important}

#tsext-host .tsext-bar-main, #tsext-host .tsext-bar-main *{ color:var(--tsext-fg)}

#tsext-host .tsext-bar-main b, #tsext-host .tsext-bar-main strong,
  #tsext-host .tsext-bar-main .tsext-bar-name, #tsext-host .tsext-bar-main .tsext-bar-strike{ color:var(--tsext-bright) !important; font-weight:900 !important}

#tsext-host .tsext-bar-delta.up{ color:var(--tsext-green) !important; opacity:1}

#tsext-host .tsext-bar-delta.down{ color:var(--tsext-red) !important; opacity:1}

#tsext-host .tsext-market-open{ color:var(--tsext-green) !important; opacity:1}

#tsext-host .tsext-market-closed{ color:var(--tsext-orange) !important; opacity:1}

#tsext-host .tsext-obpanel-head > span, #tsext-host .tsext-obpanel-head button{ color:var(--tsext-bright) !important}

#tsext-host .tsext-empty, #tsext-host .tsext-ob-empty, #tsext-host .tsext-ob-loading{ color:var(--tsext-fg) !important; opacity:1}

#tsext-host .tsext-tabs .tsext-tab:not(.active){ color:var(--tsext-fg) !important; opacity:1}

#tsext-host .tsext-tabs .tsext-tab.active{ opacity:1}

#tsext-host .tsext-tools .tsext-btn.tsext-close{ color:var(--tsext-red) !important}

#tsext-host select.tsext-input option{ color:var(--tsext-bright) !important; background:var(--tsext-panel) !important}

#tsext-host .tsext-settings-toggle.open{ color:var(--tsext-accent) !important}

#tsext-host .tsext-tickmode-note, #tsext-host .tsext-tickmode-note *{ color:var(--tsext-fg) !important; opacity:1}


#tsext-host #tsext-updated,
  #tsext-host #tsext-market,
  #tsext-host #tsext-status,
  #tsext-host .tsext-title,
  #tsext-host .tsext-subtitle,
  #tsext-host .tsext-mini,
  #tsext-host .tsext-field > label,
  #tsext-host .tsext-section-title,
  #tsext-host .tsext-settings-hint,
  #tsext-host .tsext-price-basis,
  #tsext-host .tsext-priceinfo,
  #tsext-host .tsext-hdr,
  #tsext-host .tsext-legend,
  #tsext-host .tsext-col,
  #tsext-host .tsext-bar-cell,
  #tsext-host .tsext-bar-risk,
  #tsext-host .tsext-bar-caret,
  #tsext-host .tsext-cand,
  #tsext-host .tsext-cell,
  #tsext-host .tsext-cell .lbl,
  #tsext-host .tsext-note,
  #tsext-host .tsext-ob-title,
  #tsext-host .tsext-ob-table th,
  #tsext-host .tsext-ob-table td,
  #tsext-host .tsext-ob-foot,
  #tsext-host .tsext-ob-foot .lbl,
  #tsext-host .tsext-empty,
  #tsext-host .tsext-ob-empty,
  #tsext-host .tsext-ob-loading,
  #tsext-host .tsext-tickmode-note,
  #tsext-host .tsext-tickmode-note span,
  #tsext-host .tsext-tickmode-note b,
  #tsext-host .tsext-bar-main,
  #tsext-host .tsext-bar-main span,
  #tsext-host .tsext-bar-main div,
  #tsext-host .tsext-bar-main button,
  #tsext-host .tsext-bar-main b,
  #tsext-host .tsext-bar-main strong {
    opacity:1;
    text-shadow:none !important;
  }

#tsext-host #tsext-updated { font-weight:900 !important; }

#tsext-host #tsext-updated.tsext-live-hot { color:var(--tsext-green) !important; }

#tsext-host #tsext-updated.tsext-live-warm { color:var(--tsext-green) !important; }

#tsext-host #tsext-updated.tsext-live-cold { color:var(--tsext-orange) !important; }

#tsext-host .tsext-tag-live { opacity:1; color:var(--tsext-green) !important; font-weight:900 !important}

#tsext-host .tsext-tag-close { opacity:1; font-weight:900 !important}

#tsext-host .tsext-market-open, #tsext-host .tsext-market-closed { opacity:1; font-weight:900 !important}

#tsext-host .tsext-bar-profit, #tsext-host .tsext-bar-delta, #tsext-host .tsext-cell .val { opacity:1; font-weight:900 !important}

#tsext-host .tsext-col.on { opacity:1; font-weight:800 !important}

#tsext-host .tsext-tab, #tsext-host .tsext-btn, #tsext-host .tsext-settings-toggle { opacity:1}

#tsext-host input::placeholder, #tsext-host textarea::placeholder {
  color: var(--tsext-muted) !important;
  opacity: 1;
}

#tsext-host .tsext-ob-table td.tsext-ob-oor {
    opacity:.38;
  }

#tsext-host .tsext-ob-table td.tsext-ob-oor .tsext-ob-oor {
    opacity:1}

#tsext-host .tsext-ob-table .px-ask.tsext-ob-oor,
  #tsext-host .tsext-ob-table .px-bid.tsext-ob-oor {
    color:var(--tsext-muted) !important;
    background:color-mix(in srgb,var(--tsext-muted) 16%,transparent) !important;
    box-shadow:none !important}

.tsext-empty-guide{ text-align:start; padding:22px 18px; }

.tsext-empty-title{ font-size:var(--tsext-fs-lg); font-weight:900; color:var(--tsext-bright); margin-bottom:10px; text-align:center; }

.tsext-empty-steps{ margin:0 0 14px; padding-inline-start:22px; color:var(--tsext-fg); font-size:var(--tsext-fs-base); font-weight:700; line-height:2; }

.tsext-empty-steps li{ margin:2px 0; }

.tsext-recent-wrap{ display:flex; flex-wrap:wrap; gap:6px; justify-content:center; margin-top:8px; }

.tsext-recent-lbl{ width:100%; text-align:center; font-size:var(--tsext-fs-sm); font-weight:800; color:var(--tsext-muted); margin-bottom:2px; }

.tsext-recent-chip{ border:1px solid var(--tsext-border); background:var(--tsext-panel2); color:var(--tsext-accent); border-radius:var(--tsext-r-pill); padding:5px 12px; font-size:var(--tsext-fs-md); font-weight:800; cursor:pointer; font-family:inherit; }

.tsext-recent-chip:hover{ border-color:var(--tsext-accent); background:color-mix(in srgb,var(--tsext-accent) 10%,transparent); }

.tsext-ua-suggest{
    background:var(--tsext-panel, #fff);
    color:var(--tsext-fg, #111);
    border:1px solid var(--tsext-border, #cbd5e1);
    border-radius:10px;
    box-shadow:0 10px 28px rgba(0,0,0,.14);
    max-height:240px;
    overflow-y:auto;
    font-family:inherit;
    direction:rtl;
  }

.tsext-ua-item{
    padding:8px 12px;
    cursor:pointer;
    font-size:13px;
    font-weight:700;
    border-bottom:1px solid color-mix(in srgb,var(--tsext-border,#cbd5e1) 55%,transparent);
  }

.tsext-ua-item:last-child{ border-bottom:none; }

.tsext-ua-item:hover, .tsext-ua-item.active{
    background:color-mix(in srgb,var(--tsext-accent,#4f46e5) 12%,transparent);
    color:var(--tsext-accent,#4f46e5);
  }

.tsext-show-more{ display:block; width:100%; margin:10px 0 4px; padding:10px 12px; border:1px dashed color-mix(in srgb,var(--tsext-accent) 40%,var(--tsext-border)); background:color-mix(in srgb,var(--tsext-accent) 6%,transparent); color:var(--tsext-accent); border-radius:var(--tsext-r-md); font-size:var(--tsext-fs-base); font-weight:800; cursor:pointer; font-family:inherit; }

.tsext-show-more:hover{ background:color-mix(in srgb,var(--tsext-accent) 12%,transparent); }

.tsext-actions-short{ display:none; }

#tsext-host.tsext-narrow .tsext-cols-actions .tsext-actions-full{ display:none; }

#tsext-host.tsext-narrow .tsext-cols-actions .tsext-actions-short{ display:inline; }

#tsext-status{
  font-size: var(--tsext-fs-md);
  font-weight: 600;
  color: var(--tsext-muted);
  flex-shrink: 0;
  letter-spacing: .01em;
  padding: 9px 14px;
  border-top: 1px solid color-mix(in srgb,var(--tsext-border) 82%,transparent);
  background: color-mix(in srgb,var(--tsext-panel) 84%,transparent);
  box-shadow: 0 -3px 10px rgba(15,23,42,.025);
  padding: 7px 12px;
  background: var(--tsext-surface2) !important;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
}

#tsext-host .tsext-cols .tsext-col:hover{
    color: var(--tsext-accent) !important;
    background: color-mix(in srgb, var(--tsext-accent) 18%, transparent) !important;
  }

#tsext-host .tsext-bar:hover{
    border-color: color-mix(in srgb, var(--tsext-accent) 40%, var(--tsext-border)) !important;
    transform: translateY(-1px);
    background: color-mix(in srgb, var(--tsext-panel) 92%, var(--tsext-accent)) !important}

#tsext-host .tsext-bar-strip{
    width: 3px;
    min-width: 3px;
    border-radius: var(--tsext-r-xxs);
    box-shadow: 0 0 8px color-mix(in srgb, currentColor 25%, transparent)}

#tsext-host .tsext-bar-class{
    font-size: var(--tsext-fs-xs) !important;
    font-weight: 900 !important;
    min-width: 30px;
    padding: 3px 6px;
    border-radius: var(--tsext-r-sm);
    letter-spacing: .02em !important}

#tsext-host .tsext-bar-name{
    font-size: var(--tsext-fs-base) !important;
    font-weight: 800 !important}

#tsext-host .tsext-bar-strike,
  #tsext-host .tsext-bar-days{
    font-variant-numeric: tabular-nums !important;
    font-weight: 800 !important}

#tsext-host .tsext-bar-date{
    font-size: var(--tsext-fs-sm) !important;
    font-weight: 700 !important;
    color: var(--tsext-fg) !important;
    opacity: 1}

#tsext-host .tsext-bar:hover .tsext-bar-profit{
    transform: scale(1.03)}

#tsext-host .tsext-bar-obbtn .tsext-obbtn-ico{
    font-size: var(--tsext-fs-sm) !important;
    line-height: 1 !important;
    opacity: .85}

#tsext-host .tsext-bar-obbtn .tsext-obbtn-lbl{
    font-size: var(--tsext-fs-xs) !important}

#tsext-host .tsext-bar-obbtn:hover{
    color: var(--tsext-accent) !important;
    border-color: var(--tsext-accent) !important;
    background: color-mix(in srgb, var(--tsext-accent) 12%, transparent) !important;
    transform: translateY(-1px)}

#tsext-host .tsext-bar-open:hover{
    color: var(--tsext-accent) !important;
    border-color: var(--tsext-accent) !important;
    background: color-mix(in srgb, var(--tsext-accent) 12%, transparent) !important;
    transform: translateY(-1px)}

@media (max-width: 720px){
    #tsext-host .tsext-bar-obbtn .tsext-obbtn-lbl{ display:none}
    #tsext-host .tsext-bar-obbtn{ padding: 0; width: 26px}
  }

#tsext-host .tsext-priceinfo{
    font-size: var(--tsext-fs-md) !important;
    line-height: 1.65 !important;
    margin-top: 8px;
    padding: 8px 12px;
    border-radius: var(--tsext-r-md);
    background: color-mix(in srgb, var(--tsext-panel2) 75%, transparent) !important;
    border: 1px solid color-mix(in srgb, var(--tsext-border) 70%, transparent) !important;
    color: color-mix(in srgb, var(--tsext-fg) 88%, var(--tsext-muted)) !important;
  }

#tsext-host .tsext-priceinfo b{
    color: var(--tsext-accent) !important;
    font-weight: 900 !important}

#tsext-host .tsext-pi-sep{
    display: inline-block;
    width: 3px;
    height: 3px;
    margin: 0 8px;
    border-radius: 50%;
    background: color-mix(in srgb, var(--tsext-muted) 55%, transparent) !important;
    vertical-align: middle}

#tsext-host .tsext-pi-meta{
    color: var(--tsext-muted) !important;
    font-weight: 600 !important}

#tsext-host .tsext-chip{
    border-radius: var(--tsext-r-pill);
    padding: 2px 10px;
    font-size: var(--tsext-fs-xs) !important;
    transition: transform .12s var(--tsext-ease), background .12s ease, opacity .12s ease !important;
  }

#tsext-host .tsext-chip:not(.off):hover{
    transform: translateY(-1px);
    background: color-mix(in srgb, currentColor 10%, transparent) !important}

#tsext-host .tsext-tab{
    border-radius: 8px;
    font-weight: 700 !important;
    transition: background .15s ease, color .15s ease, transform .12s var(--tsext-ease) !important;
  }

#tsext-host .tsext-tab:hover{
    transform: translateY(-0.5px)}

#tsext-host #tsext-tabs .tsext-tab{
    position: relative;
    font-weight: 600 !important;
  }

#tsext-host #tsext-tabs .tsext-tab.active{
    font-weight: 800 !important;
    border-inline-start: 3px solid #fff !important;
  }

#tsext-host .tsext-check{ font-weight: 600 !important; }

#tsext-host .tsext-input.tsext-num{ font-weight: 700 !important; font-variant-numeric: tabular-nums; }

#tsext-host .tsext-empty{
    padding: 42px 18px;
    border-radius: var(--tsext-r-xl);
    border: 1px dashed color-mix(in srgb, var(--tsext-border) 80%, var(--tsext-accent)) !important;
    background: linear-gradient(160deg,
      color-mix(in srgb, var(--tsext-accent) 6%, transparent),
      color-mix(in srgb, var(--tsext-panel2) 80%, transparent)) !important;
    color: var(--tsext-muted) !important;
    font-size: var(--tsext-fs-base) !important;
  }

#tsext-host #tsext-list-body::-webkit-scrollbar{ width: 8px; height: 8px; }

#tsext-host #tsext-list-body::-webkit-scrollbar-thumb{
    background: color-mix(in srgb, var(--tsext-muted) 35%, transparent);
    border-radius: var(--tsext-r-sm)}

#tsext-host #tsext-list-body::-webkit-scrollbar-thumb:hover{
    background: color-mix(in srgb, var(--tsext-accent) 45%, transparent)}

#tsext-host.tsext-narrow .tsext-bar-risk{ font-size: var(--tsext-fs-xxs) !important; padding: 2px 6px; }

#tsext-host .tsext-bar-obbtn:focus-visible,
  #tsext-host .tsext-bar-open:focus-visible,
  #tsext-host .tsext-col:focus-visible,
  #tsext-host .tsext-tab:focus-visible{
    outline: 2px solid color-mix(in srgb, var(--tsext-accent) 60%, transparent) !important;
    outline-offset: 2px !important;
  }

#tsext-host .tsext-cell .val.pos,
  #tsext-host #tsext-obpanel-body .tsext-cell .val.pos{
    background: linear-gradient(135deg, rgba(34,197,94,.12), rgba(34,197,94,.05)) !important;
    box-shadow: inset 0 0 0 1px rgba(34,197,94,.22) !important;
    border-radius: var(--tsext-r-sm);
    padding: 2px 8px;
    display: inline-block;
  }

#tsext-host .tsext-cell .val.neg,
  #tsext-host #tsext-obpanel-body .tsext-cell .val.neg{
    background: linear-gradient(135deg, rgba(239,68,68,.12), rgba(239,68,68,.05)) !important;
    box-shadow: inset 0 0 0 1px rgba(239,68,68,.22) !important;
    border-radius: var(--tsext-r-sm);
    padding: 2px 8px;
    display: inline-block}

#tsext-host .tsext-cell .val.warn,
  #tsext-host #tsext-obpanel-body .tsext-cell .val.warn{
    background: linear-gradient(135deg, rgba(245,158,11,.14), rgba(245,158,11,.05)) !important;
    box-shadow: inset 0 0 0 1px rgba(245,158,11,.25) !important;
    border-radius: var(--tsext-r-sm);
    padding: 2px 8px;
    display: inline-block}

#tsext-host #tsext-obpanel{
  background: var(--tsext-panel) !important;
  border-radius: var(--tsext-r-xl);
  border: 1px solid color-mix(in srgb, var(--tsext-border) 80%, transparent) !important;
  box-shadow: 0 18px 50px color-mix(in srgb, #000 18%, transparent), 0 2px 8px color-mix(in srgb, #000 6%, transparent) !important;
  overflow: hidden;
}

#tsext-host .tsext-obpanel-head{
  padding: 12px 14px;
  background: linear-gradient(135deg,
      color-mix(in srgb, var(--tsext-accent) 10%, var(--tsext-panel2)),
      var(--tsext-panel2)) !important;
  border-bottom: 1px solid color-mix(in srgb, var(--tsext-border) 75%, transparent) !important;
}

#tsext-host #tsext-obpanel-title{
    font-size: var(--tsext-fs-base) !important;
    font-weight: 900 !important;
    letter-spacing: -.01em !important}

#tsext-host .tsext-ob-active-tag{
    display: inline-flex;
    align-items: center;
    margin-inline-start: 6px;
    padding: 1px 8px;
    border-radius: var(--tsext-r-pill);
    font-size: var(--tsext-fs-xxs) !important;
    font-weight: 800 !important;
    background: color-mix(in srgb, var(--tsext-accent) 14%, transparent) !important;
    color: var(--tsext-accent) !important;
    border: 1px solid color-mix(in srgb, var(--tsext-accent) 30%, transparent) !important;
    vertical-align: middle}

#tsext-host #tsext-obpanel-body{
    padding: 0}

#tsext-host #tsext-ob-calc{
    padding: 10px 12px 12px}

#tsext-host #tsext-ob-books{
    padding: 8px 10px 10px}

#tsext-host #tsext-ob-books .tsext-ob-title{
    font-size: var(--tsext-fs-xs) !important;
    font-weight: 900 !important;
    letter-spacing: .03em !important;
    text-transform: none !important;
    color: var(--tsext-muted) !important;
    background: var(--tsext-panel2) !important;
    border: 0 !important;
    border-bottom: 1px solid var(--tsext-border) !important;
    padding: 5px 8px;
    margin: 0}

#tsext-host .tsext-grid{
    gap: 6px;
    display: grid;
    grid-template-columns: 1fr 1fr}

#tsext-host .tsext-cell{
    padding: 9px 10px;
    border-radius: var(--tsext-r-md);
    border: 1px solid color-mix(in srgb, var(--tsext-border) 70%, transparent) !important;
    background: color-mix(in srgb, var(--tsext-panel2) 70%, transparent) !important;
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-height: 52px;
    transition: border-color .15s ease, box-shadow .15s ease !important}

#tsext-host .tsext-cell:hover{
    border-color: color-mix(in srgb, var(--tsext-accent) 28%, var(--tsext-border)) !important;
    box-shadow: 0 2px 10px color-mix(in srgb, var(--tsext-accent) 8%, transparent) !important}

#tsext-host .tsext-cell .lbl{
    font-size: var(--tsext-fs-xs) !important;
    font-weight: 700 !important;
    color: var(--tsext-muted) !important;
    letter-spacing: .01em !important}

#tsext-host .tsext-cell .val{
    font-size: var(--tsext-fs-lg) !important;
    font-weight: 900 !important;
    font-variant-numeric: tabular-nums !important;
    line-height: 1.35 !important}

#tsext-host .tsext-grid-divider{
    grid-column: 1 / -1;
    height: 1px;
    margin: 4px 0;
    border: 0 !important;
    background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--tsext-border) 80%, transparent), transparent) !important}

#tsext-host #tsext-ob-calc .tsext-grid{
    gap: 4px 8px}

#tsext-host #tsext-ob-calc .tsext-cell{
    padding: 5px 7px;
    border-radius: var(--tsext-r-sm);
    min-height: 0;
    gap: 2px}

#tsext-host #tsext-ob-calc .tsext-cell .lbl{
    font-size: var(--tsext-fs-xxs) !important}

#tsext-host #tsext-ob-calc .tsext-cell .val{
    font-size: var(--tsext-fs-md) !important;
    line-height: 1.25 !important}

#tsext-host #tsext-ob-calc .tsext-hero{
    grid-template-columns: 1fr;
    gap: 0}

#tsext-host #tsext-ob-calc .tsext-hero-card{
    padding: 14px 12px 15px}

#tsext-host #tsext-ob-calc .tsext-hero-card .h-lbl{
    font-size: var(--tsext-fs-md) !important;
    color: #64748b !important;
    margin-bottom: 6px}

#tsext-host #tsext-ob-calc .tsext-hero-card .h-val{
    font-size: var(--tsext-fs-hero) !important;
    color: #0f172a !important;
    font-weight: 900 !important;
    line-height: 1.15 !important}

#tsext-host #tsext-ob-calc .tsext-hero-card.pos .h-val,
  #tsext-host #tsext-ob-calc .tsext-hero-card.main.pos .h-val{
    color: #047857 !important}

#tsext-host #tsext-ob-calc .tsext-hero-card.neg .h-val,
  #tsext-host #tsext-ob-calc .tsext-hero-card.main.neg .h-val{
    color: #b91c1c !important}

#tsext-host #tsext-ob-books .tsext-ob-table th{
    height: 24px;
    font-size: var(--tsext-fs-xs) !important;
    padding: 2px 3px}

#tsext-host #tsext-ob-books .tsext-ob-table td{
    height: 22px;
    font-size: var(--tsext-fs-xs) !important;
    padding: 2px 3px}

#tsext-host .tsext-ob{
    border-radius: var(--tsext-r-md);
    overflow: hidden;
    border: 1px solid color-mix(in srgb, var(--tsext-border) 75%, transparent) !important;
    box-shadow: 0 2px 10px color-mix(in srgb, #000 5%, transparent) !important;
  }

#tsext-host .tsext-ob-title{
  font-weight: 900 !important;
  letter-spacing: .04em !important;
  text-transform: none !important;
  color: var(--tsext-muted) !important;
  background: color-mix(in srgb, var(--tsext-panel2) 90%, transparent) !important;
  padding: 8px 12px;
  font-size: var(--tsext-fs-sm) !important;
}

#tsext-host .tsext-ob-table th{
  color: var(--tsext-muted) !important;
  opacity: 1;
  font-size: var(--tsext-fs-xs) !important;
  font-weight: 800 !important;
  letter-spacing: .02em !important;
  padding: 7px 4px;
}

#tsext-host .tsext-ob-table td{
  color: var(--tsext-fg) !important;
  opacity: 1;
  font-variant-numeric: tabular-nums !important;
  font-weight: 700 !important;
}

#tsext-host .tsext-ob-table .px-ask{
    border-radius: var(--tsext-r-xs);
    font-weight: 900 !important}

#tsext-host .tsext-ob-table .px-bid{
    border-radius: var(--tsext-r-xs);
    font-weight: 900 !important}

#tsext-host .tsext-bar.active-ob{
  transform: none;
  border-color: color-mix(in srgb, var(--tsext-accent) 55%, var(--tsext-border)) !important;
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--tsext-accent) 25%, transparent),
                0 10px 28px color-mix(in srgb, var(--tsext-accent) 12%, transparent) !important;
}

#tsext-host .tsext-bar-risk{
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-weight: 800 !important;
  border-radius: var(--tsext-r-pill);
  border: 1px solid transparent !important;
  text-align: center;
  letter-spacing: .01em !important;
  font-size: var(--tsext-fs-xxs) !important;
  padding: 3px 7px;
  max-width: none;
  overflow: visible;
  text-overflow: clip !important;
  white-space: nowrap;
}

#tsext-host .tsext-input:focus{
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--tsext-accent) 16%, transparent) !important}

#tsext-host .tsext-tab.active{
  box-shadow: 0 4px 14px color-mix(in srgb, var(--tsext-accent) 28%, transparent) !important;
  border-radius: var(--tsext-r-sm);
}

#tsext-host .tsext-live-dot{
    box-shadow: 0 0 0 0 color-mix(in srgb, var(--tsext-green) 50%, transparent) !important;
  }

#tsext-host .tsext-bar-main,
  #tsext-host .tsext-cols{
    column-gap:var(--tsext-grid-gap);
  }

#tsext-host .tsext-bar-profit,
  #tsext-host .tsext-cols .tsext-bar-profit,
  #tsext-host .tsext-cols .tsext-col[data-resize="profit"]{
    margin-inline-end: 2px;
    padding-inline-end: 4px;
    justify-self: center;
    max-width: 100%;
    box-sizing: border-box;
  }

#tsext-host .tsext-bar-actions,
  #tsext-host .tsext-cols-actions{
    min-width: var(--tsext-col-actions, 92px);
    width: var(--tsext-col-actions, 92px);
    justify-self: end;
    justify-content: flex-end;
    gap: 6px;
    padding-inline-start: 6px;
    box-sizing: border-box;
    flex-shrink: 0;
  }

#tsext-host .tsext-bar-obbtn,
  #tsext-host .tsext-bar-open{
    flex-shrink: 0}

#tsext-host .tsext-cols .tsext-col,
  #tsext-host .tsext-cols .tsext-bar-name,
  #tsext-host .tsext-cols .tsext-bar-strike,
  #tsext-host .tsext-cols .tsext-bar-days,
  #tsext-host .tsext-cols .tsext-bar-date,
  #tsext-host .tsext-cols .tsext-bar-risk,
  #tsext-host .tsext-cols .tsext-bar-profit,
  #tsext-host .tsext-cols .tsext-cols-class,
  #tsext-host .tsext-cols .tsext-cols-actions{
  font-size: var(--tsext-fs-sm) !important;
  letter-spacing: .02em !important;
  height: 30px;
  border-radius: var(--tsext-r-sm);
  color: var(--tsext-accent) !important;
  background: color-mix(in srgb, var(--tsext-accent) 10%, transparent) !important;
  box-shadow: none !important;
  font-weight: 800 !important;
  opacity: 1;
}

#tsext-host .tsext-cols .tsext-cols-actions{
    color: var(--tsext-accent) !important;
    background: color-mix(in srgb, var(--tsext-accent) 10%, transparent) !important;
    box-shadow: none !important;
    font-weight: 800 !important;
    opacity: 1;
    font-size: var(--tsext-fs-sm) !important;
    justify-content: center;
  }

#tsext-host .tsext-cols .tsext-col,
  #tsext-host .tsext-cols .tsext-col.on,
  #tsext-host .tsext-cols .tsext-bar-name,
  #tsext-host .tsext-cols .tsext-bar-strike,
  #tsext-host .tsext-cols .tsext-bar-days,
  #tsext-host .tsext-cols .tsext-bar-date,
  #tsext-host .tsext-cols .tsext-bar-risk,
  #tsext-host .tsext-cols .tsext-bar-profit,
  #tsext-host .tsext-cols .tsext-cols-class,
  #tsext-host .tsext-cols .tsext-cols-actions{
    color: var(--tsext-accent) !important;
    background: color-mix(in srgb, var(--tsext-accent) 10%, transparent) !important;
    box-shadow: none !important;
    font-weight: 800 !important;
    font-size: var(--tsext-fs-sm) !important;
    opacity: 1;
  }

#tsext-host #tsext-head{
    padding: 5px 10px 4px;
  }

#tsext-host .tsext-titlebar{
    gap: 6px;
    min-height: 0;
  }

#tsext-host .tsext-title{
  letter-spacing: -.01em !important;
  font-size: var(--tsext-fs-base) !important;
  line-height: 1.2 !important;
}

#tsext-host .tsext-subtitle{
  font-weight: 600 !important;
  font-size: var(--tsext-fs-xxs) !important;
  margin-top: 0;
  opacity: .85;
  line-height: 1.2 !important;
}

#tsext-host .tsext-tools{
    padding: 2px;
    gap: 1px;
  }

#tsext-host #tsext-head > .tsext-row{
    margin-top: 4px;
  }

#tsext-host .tsext-tabs{
  padding: 4px;
  gap: 7px;
  border-radius: var(--tsext-r-sm);
}

#tsext-host .tsext-tabs .tsext-tab{
    min-height: 36px;
    padding: 8px 10px;
    font-size: var(--tsext-fs-md) !important;
    border-radius: var(--tsext-r-sm);
  }

#tsext-host .tsext-strategy-panel{
    margin-top: 4px;
    padding: 4px 0 2px;
  }

#tsext-host .tsext-strategy-panel > .tsext-row{
    margin-top: 3px;
  }

#tsext-host .tsext-strategy-panel > .tsext-row:first-child{
    margin-top: 0;
    padding: 0;
  }

#tsext-host .tsext-input{
  font-weight: 600 !important;
  border-radius: var(--tsext-r-md);
  transition: border-color .15s ease, box-shadow .15s ease, background .15s ease !important;
  height: 32px;
  min-height: 32px;
  padding: 4px 10px;
  font-size: var(--tsext-fs-base) !important;
}

#tsext-host .tsext-settings-toggle{
  color: var(--tsext-fg) !important;
  height: 32px;
  padding: 0 8px;
  font-size: var(--tsext-fs-sm) !important;
}

#tsext-host .tsext-settings-body{
    margin-top: 6px;
    padding: 7px 8px;
  }

#tsext-host .tsext-settings-grid{
    gap: 5px 7px;
  }

#tsext-host .tsext-modes-row{
    margin-top: 4px;
    padding: 2px;
  }

#tsext-host .tsext-modes-row .tsext-tab{
    min-height: 26px;
    font-size: var(--tsext-fs-sm) !important;
  }

#tsext-host .tsext-tickmode-note{
    margin-top: 4px;
    padding: 5px 8px;
    font-size: var(--tsext-fs-xs) !important;
    line-height: 1.45 !important;
  }

#tsext-host #tsext-head > .tsext-row:last-of-type,
  #tsext-host #tsext-head .tsext-row:has(#tsext-market-wrap){
    margin-top: 3px;
    min-height: 0;
  }

#tsext-host #tsext-market-wrap,
  #tsext-host #tsext-updated{
    font-size: var(--tsext-fs-xs) !important;
  }

#tsext-host #tsext-priceinfo,
  #tsext-host .tsext-priceinfo{
    margin-top: 3px;
    margin-bottom: 0;
    padding: 3px 8px;
    font-size: var(--tsext-fs-sm) !important;
    line-height: 1.4 !important;
    border-radius: var(--tsext-r-sm);
  }

#tsext-host .tsext-hdr{
  border-inline-start-width: 3px !important;
  background: color-mix(in srgb, var(--tsext-panel2) 80%, transparent) !important;
  margin-top: 2px;
  margin-bottom: 3px;
  padding: 4px 8px;
  font-size: var(--tsext-fs-sm) !important;
  line-height: 1.4 !important;
  border-radius: var(--tsext-r-sm);
}

#tsext-host .tsext-price-basis{
  color: var(--tsext-muted) !important;
  padding: 0 6px 3px;
  font-size: var(--tsext-fs-xs) !important;
  line-height: 1.3 !important;
  opacity: .88;
}

#tsext-host .tsext-legend{
    padding: 3px 6px;
    margin: 2px 0 3px;
    font-size: var(--tsext-fs-xs) !important;
    gap: 2px 4px;
    line-height: 1.35 !important;
    border-radius: var(--tsext-r-sm);
  }

#tsext-host .tsext-legend .tsext-chip{
    padding: 2px 7px;
    font-size: var(--tsext-fs-xs) !important;
  }

#tsext-host .tsext-cols .tsext-col,
  #tsext-host .tsext-cols .tsext-cols-actions{
    height: 24px;
    min-height: 24px;
    font-size: var(--tsext-fs-xs) !important;
  }

#tsext-host #tsext-list-body{
    padding: 6px 8px 10px;
  }

#tsext-host #tsext-status{
  letter-spacing: .01em !important;
  opacity: .92;
  padding: 4px 10px;
  font-size: var(--tsext-fs-sm) !important;
}

#tsext-host .tsext-bar{
  border-radius: var(--tsext-r-md);
  border: 1px solid color-mix(in srgb, var(--tsext-border) 90%, transparent) !important;
  background: color-mix(in srgb, var(--tsext-panel) 96%, transparent) !important;
  box-shadow: 0 1px 2px color-mix(in srgb, #000 6%, transparent) !important;
  transition: border-color .18s var(--tsext-ease-out), box-shadow .22s var(--tsext-ease-out), transform .18s var(--tsext-ease-out), background .18s ease !important;
  margin-bottom: 4px;
}


#tsext-host #tsext-obpanel-body .tsext-grid,
  #tsext-host #tsext-obpanel-body .tsext-cell,
  #tsext-host #tsext-obpanel-body .tsext-ob-title,
  #tsext-host #tsext-obpanel-body .tsext-price-basis,
  #tsext-host #tsext-obpanel-body .tsext-note{
    direction: rtl !important;
    text-align: right;
  }

#tsext-host #tsext-obpanel-body .tsext-cell .lbl,
  #tsext-host #tsext-obpanel-body .tsext-cell .val{
    text-align: right;
    width: 100%}

#tsext-host #tsext-obpanel-body .tsext-ob,
  #tsext-host #tsext-obpanel-body .tsext-ob-table,
  #tsext-host #tsext-obpanel-body .tsext-ob-foot{
    direction: ltr !important;
    unicode-bidi: isolate !important;
    text-align: center}

#tsext-host .tsext-bar.active-ob::before{
  content: 'جزئیات باز';
  position: absolute;
  top: 0;
  inset-inline-end: 12px !important;
  inset-inline-start: auto !important;
  width: auto;
  z-index: 4;
  font-size: var(--tsext-fs-xxs) !important;
  font-weight: 800 !important;
  padding: 2px 10px;
  border-radius: 0 0 8px 8px;
  background: var(--tsext-accent) !important;
  color: #fff !important;
  box-shadow: 0 4px 10px color-mix(in srgb, var(--tsext-accent) 35%, transparent) !important;
  pointer-events: none;
  letter-spacing: .02em !important;
}

#tsext-host .tsext-bar-risk,
  #tsext-host .tsext-bar-main .tsext-bar-risk {
    overflow: visible;
    text-overflow: clip !important;
    white-space: nowrap;
    max-width: none;
    min-width: 5.5em;
    opacity: 1;
    visibility: visible;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-wrap: nowrap;
    gap: 3px;
    box-sizing: border-box;
  }

#tsext-host .tsext-bar-profit,
  #tsext-host .tsext-bar-cell.tsext-bar-profit,
  #tsext-host .tsext-bar-main .tsext-bar-profit {
    overflow: visible;
    text-overflow: clip !important;
    white-space: nowrap;
    max-width: none;
    min-width: 4.8em;
    opacity: 1;
    visibility: visible;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
  }

#tsext-host .tsext-bar-main {
  min-width: calc(
      4px + var(--tsext-col-class) + var(--tsext-col-name) + var(--tsext-col-strike)
      + var(--tsext-col-days) + var(--tsext-col-date) + var(--tsext-col-risk)
      + var(--tsext-col-profit) + var(--tsext-col-actions) + 48px
    );
  padding: 7px 10px;
  grid-template-columns: var(--tsext-grid-cols);
}

#tsext-host .tsext-cols {
  gap: 0;
  background: color-mix(in srgb, var(--tsext-panel2) 88%, var(--tsext-accent)) !important;
  border: 1px solid color-mix(in srgb, var(--tsext-border) 85%, var(--tsext-accent)) !important;
  box-shadow: inset 0 1px 0 color-mix(in srgb, #fff 4%, transparent) !important;
  min-width: calc(
      4px + var(--tsext-col-class) + var(--tsext-col-name) + var(--tsext-col-strike)
      + var(--tsext-col-days) + var(--tsext-col-date) + var(--tsext-col-risk)
      + var(--tsext-col-profit) + var(--tsext-col-actions) + 48px
    );
  padding: 3px 5px;
  border-radius: var(--tsext-r-sm);
  column-gap: 5px;
  grid-template-columns: var(--tsext-grid-cols);
}

#tsext-host .tsext-bar-profit{
  opacity: 1;
  font-size: var(--tsext-fs-lg) !important;
  font-weight: 900 !important;
  border-radius: var(--tsext-r-sm);
  letter-spacing: -.01em !important;
  font-variant-numeric: tabular-nums !important;
  transition: transform .15s var(--tsext-ease), box-shadow .15s ease !important;
  padding: 4px 8px;
  overflow: hidden;
  text-overflow: ellipsis !important;
  margin-inline-end: 4px;
}

#tsext-host .tsext-cell .val.pos{
  color: #15803d !important;
}

#tsext-host .tsext-col-grip::after{ content: none; display: none; }


#tsext-list-hdr{
  flex-shrink: 0;
  border-bottom: 1px solid color-mix(in srgb,var(--tsext-border) 65%,transparent);
  padding: 10px 13px 0;
  border-bottom-color: color-mix(in srgb,var(--tsext-border) 78%,transparent);
  border-bottom: 0 !important;
  padding: 8px 12px 5px;
  background: var(--tsext-bg);
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none !important;
}

#tsext-list-hdr::-webkit-scrollbar{ width:0; height:0; display:none; }

.tsext-cols,
  .tsext-bar-main{
    display:grid;
    grid-template-columns:var(--tsext-grid-cols);
    column-gap:var(--tsext-grid-gap);
    padding-block:10px;
    padding-inline:11px;
    box-sizing:border-box;
    width:100%;
    min-width:0;
  }

.tsext-cols,
  .tsext-bar{
    border-width:1px !important;
    border-style:solid !important;
    box-sizing:border-box;
    min-width:0;
  }

.tsext-bar-strip,
  .tsext-cols-strip{
    width:5px;
    min-width:5px;
    max-width:5px;
  }

.tsext-cols .tsext-bar-name,
  .tsext-bar-main .tsext-bar-name{
    padding-inline:0;
    text-align:start;
    justify-self:stretch;
  }

.tsext-col[data-resize]{
  position: relative;
  padding-inline-end: 0;
}

.tsext-col-grip{
  position: absolute;
  inset-inline-end: 0 !important;
  top: 4px;
  bottom: 4px;
  cursor: col-resize !important;
  z-index: 50;
  border: 0 !important;
  border-radius: 0;
  background: transparent !important;
  box-shadow: none !important;
  opacity: 1;
  pointer-events: auto;
  touch-action: none !important;
  width: 10px;
}

#tsext-host.tsext-narrow .tsext-bar-main,
  #tsext-host.tsext-narrow .tsext-cols{
  grid-template-columns: var(--tsext-grid-cols-narrow);
  column-gap: var(--tsext-grid-gap);
  grid-template-columns: var(--tsext-grid-cols-narrow);
  column-gap: var(--tsext-grid-gap);
}

#tsext-host.tsext-compact .tsext-bar-main,
  #tsext-host.tsext-compact .tsext-cols{
    padding-inline:11px;
  }

#tsext-host .tsext-logo{
  box-shadow: 0 4px 12px color-mix(in srgb, var(--tsext-accent) 30%, transparent) !important;
  width: 24px;
  height: 24px;
  font-size: var(--tsext-fs-md) !important;
  animation: none !important;
}

#tsext-host #tsext-head::before{
  height: 2px;
  animation: none !important;
  opacity: .85;
}

#tsext-host .tsext-bar-open{
  padding: 0;
  font-weight: 800 !important;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--tsext-panel2) 90%, transparent) !important;
  border: 1px solid color-mix(in srgb, var(--tsext-border) 80%, transparent) !important;
  color: var(--tsext-muted) !important;
  transition: color .15s ease, border-color .15s ease, background .15s ease, transform .15s var(--tsext-ease) !important;
  width: 30px;
  height: 30px;
  font-size: var(--tsext-fs-base) !important;
  border-radius: var(--tsext-r-sm);
}

#tsext-host .tsext-tools .tsext-btn{
  color: var(--tsext-fg) !important;
  opacity: 1;
  height: 26px;
  min-width: 26px;
  padding: 0 6px;
  font-size: var(--tsext-fs-sm) !important;
  min-height: 32px;
}

#tsext-host .tsext-cols .tsext-col{
  color: var(--tsext-accent) !important;
  opacity: 1;
  min-height: 32px;
}

#tsext-host.tsext-compact .tsext-bar-main{
  padding-block: 8px;
  padding-inline: 11px;
  padding-block: 8px;
  padding-inline: 11px;
}

#tsext-host.tsext-compact .tsext-bar{
  margin-bottom: 6px;
  border-radius: var(--tsext-r-sm);
  margin-bottom: 6px;
}

#tsext-host.tsext-compact .tsext-bar-profit{
  font-size: var(--tsext-fs-base);
  font-size: var(--tsext-fs-base) !important;
  padding: 3px 8px;
}

#tsext-host.tsext-compact .tsext-cols{
  padding-block: 8px 6px;
  padding-inline: 11px;
  padding-block: 6px 5px;
  padding-inline: 11px;
}

#tsext-host .tsext-bar-main .tsext-bar-risk,
  #tsext-host .tsext-cols .tsext-bar-risk{
    max-width:100%;
    white-space:normal;
    flex-wrap:wrap;
    row-gap:2px;
    column-gap:3px;
    line-height:1.35 !important;
    text-align:center;
    overflow:visible;
    text-overflow:clip !important;
  }

#tsext-host .tsext-bar-main .tsext-bar-profit,
  #tsext-host .tsext-cols .tsext-bar-profit{
    max-width:100%;
    overflow:visible;
    text-overflow:clip !important;
    white-space:nowrap;
  }

#tsext-host .tsext-liq-warn,
  #tsext-host .tsext-exer-warn{
  overflow: visible;
  text-overflow: clip !important;
  flex-shrink: 0;
  max-width: none;
  flex: 0 0 auto;
  white-space: nowrap;
}

#tsext-host #tsext-list-hdr,
  #tsext-host #tsext-list-body{
    padding-inline-start:12px;
    padding-inline-end:12px;
    box-sizing:border-box;
    overflow-x:auto;
  }

#tsext-host #tsext-list-hdr{
  padding: 4px 8px 3px;
  padding-inline-end: calc(12px + var(--tsext-sbw, 0px));
}

#tsext-host .tsext-cols,
  #tsext-host #tsext-list-body .tsext-bar{
    margin-inline:0 !important;
    border-width:1px !important;
    border-style:solid !important;
    box-sizing:border-box;
  }

#tsext-host .tsext-cols,
  #tsext-host .tsext-bar-main{
    display:grid;
    grid-template-columns:var(--tsext-grid-cols);
    column-gap:var(--tsext-grid-gap);
    padding-inline:11px;
    margin-inline:0 !important;
    align-items:center;
    box-sizing:border-box;
  }

#tsext-host .tsext-cols .tsext-col,
  #tsext-host .tsext-cols .tsext-col[data-resize]{
    padding-inline:0;
    margin-inline:0 !important;
    text-align:center;
    justify-content:center;
  }

#tsext-host .tsext-col-grip{
    position:absolute;
    inset-inline-end:-5px !important;
    width:10px;
  }

#tsext-host .tsext-cols .tsext-cols-strip,
  #tsext-host .tsext-bar-main .tsext-bar-strip{ justify-self:stretch; }

#tsext-host .tsext-cols .tsext-bar-name,
  #tsext-host .tsext-cols .tsext-col-name,
  #tsext-host .tsext-bar-main .tsext-bar-name{
    justify-self:stretch;
    text-align:start;
    justify-content:flex-start;
    padding-inline-start:6px;
    padding-inline-end:0;
  }

#tsext-host .tsext-cols .tsext-bar-strike,
  #tsext-host .tsext-cols .tsext-col-strike,
  #tsext-host .tsext-bar-main .tsext-bar-strike,
  #tsext-host .tsext-cols .tsext-bar-days,
  #tsext-host .tsext-cols .tsext-col-days,
  #tsext-host .tsext-bar-main .tsext-bar-days,
  #tsext-host .tsext-cols .tsext-bar-date,
  #tsext-host .tsext-cols .tsext-col-date,
  #tsext-host .tsext-bar-main .tsext-bar-date{
    justify-self:stretch;
    text-align:center;
    justify-content:center;
    padding-inline:0;
    margin-inline:0 !important;
  }

#tsext-host .tsext-cols .tsext-cols-class,
  #tsext-host .tsext-bar-main .tsext-bar-class,
  #tsext-host .tsext-cols .tsext-bar-risk,
  #tsext-host .tsext-cols .tsext-col-risk,
  #tsext-host .tsext-bar-main .tsext-bar-risk,
  #tsext-host .tsext-cols .tsext-bar-profit,
  #tsext-host .tsext-cols .tsext-col-profit,
  #tsext-host .tsext-bar-main .tsext-bar-profit{
    justify-self:center;
    margin-inline:0 !important;
    text-align:center;
  }

#tsext-host .tsext-cols .tsext-cols-class{ flex:0 0 31px; width:31px; }

#tsext-host .tsext-cols .tsext-cols-strip{ flex:0 0 3px; width:3px; }

#tsext-host .tsext-cols .tsext-cols-actions,
  #tsext-host .tsext-bar-main .tsext-bar-actions{
    justify-self:stretch;
    justify-content:center;
    width:auto;
    min-width:0;
    padding-inline:0;
    margin-inline:0 !important;
    text-align:center;
  }

#tsext-host .tsext-cell .val[class*="tsext-risk-"]{
    display: inline-block;
    padding: 2px 8px;
    border-radius: var(--tsext-r-sm);
    border: 1px solid transparent !important;
    font-weight: 800 !important;
  }

#tsext-host .tsext-cell .val.tsext-risk-vlow,
  #tsext-host #tsext-obpanel-body .tsext-cell .val.tsext-risk-vlow{
    color: var(--tsext-sw-A) !important;
    background: color-mix(in srgb, var(--tsext-sw-A) 14%, transparent) !important;
    border-color: color-mix(in srgb, var(--tsext-sw-A) 32%, transparent) !important;
  }

#tsext-host .tsext-cell .val.tsext-risk-low,
  #tsext-host #tsext-obpanel-body .tsext-cell .val.tsext-risk-low{
    color: var(--tsext-sw-B) !important;
    background: color-mix(in srgb, var(--tsext-sw-B) 14%, transparent) !important;
    border-color: color-mix(in srgb, var(--tsext-sw-B) 32%, transparent) !important;
  }

#tsext-host .tsext-cell .val.tsext-risk-mid,
  #tsext-host #tsext-obpanel-body .tsext-cell .val.tsext-risk-mid{
    color: var(--tsext-sw-X) !important;
    background: color-mix(in srgb, var(--tsext-sw-X) 14%, transparent) !important;
    border-color: color-mix(in srgb, var(--tsext-sw-X) 32%, transparent) !important;
  }

#tsext-host .tsext-cell .val.tsext-risk-high,
  #tsext-host #tsext-obpanel-body .tsext-cell .val.tsext-risk-high{
    color: var(--tsext-sw-mB) !important;
    background: color-mix(in srgb, var(--tsext-sw-mB) 14%, transparent) !important;
    border-color: color-mix(in srgb, var(--tsext-sw-mB) 32%, transparent) !important;
  }

#tsext-host .tsext-cell .val.tsext-risk-vhigh,
  #tsext-host #tsext-obpanel-body .tsext-cell .val.tsext-risk-vhigh{
    color: var(--tsext-sw-mA) !important;
    background: color-mix(in srgb, var(--tsext-sw-mA) 14%, transparent) !important;
    border-color: color-mix(in srgb, var(--tsext-sw-mA) 32%, transparent) !important;
  }

#tsext-host .tsext-bar-risk.tsext-risk-vlow,
  #tsext-host .tsext-cell .val.tsext-risk-vlow,
  #tsext-host #tsext-obpanel-body .tsext-cell .val.tsext-risk-vlow,
  #tsext-host #tsext-ob-calc .tsext-cell .val.tsext-risk-vlow {
    color: var(--tsext-sw-A) !important;
    background: color-mix(in srgb, var(--tsext-sw-A) 20%, transparent) !important;
    border-color: color-mix(in srgb, var(--tsext-sw-A) 40%, transparent) !important;
  }

#tsext-host .tsext-bar-risk.tsext-risk-low,
  #tsext-host .tsext-cell .val.tsext-risk-low,
  #tsext-host #tsext-obpanel-body .tsext-cell .val.tsext-risk-low,
  #tsext-host #tsext-ob-calc .tsext-cell .val.tsext-risk-low {
    color: var(--tsext-sw-B) !important;
    background: color-mix(in srgb, var(--tsext-sw-B) 20%, transparent) !important;
    border-color: color-mix(in srgb, var(--tsext-sw-B) 40%, transparent) !important;
  }

#tsext-host .tsext-bar-risk.tsext-risk-mid,
  #tsext-host .tsext-cell .val.tsext-risk-mid,
  #tsext-host #tsext-obpanel-body .tsext-cell .val.tsext-risk-mid,
  #tsext-host #tsext-ob-calc .tsext-cell .val.tsext-risk-mid {
    color: var(--tsext-sw-X) !important;
    background: color-mix(in srgb, var(--tsext-sw-X) 20%, transparent) !important;
    border-color: color-mix(in srgb, var(--tsext-sw-X) 40%, transparent) !important;
  }

#tsext-host .tsext-bar-risk.tsext-risk-high,
  #tsext-host .tsext-bar[data-c="−B"] .tsext-bar-risk,
  #tsext-host .tsext-bar[data-c="-B"] .tsext-bar-risk,
  #tsext-host .tsext-cell .val.tsext-risk-high,
  #tsext-host #tsext-obpanel-body .tsext-cell .val.tsext-risk-high,
  #tsext-host #tsext-ob-calc .tsext-cell .val.tsext-risk-high {
    color: var(--tsext-sw-mB) !important;
    background: color-mix(in srgb, var(--tsext-sw-mB) 22%, transparent) !important;
    border-color: color-mix(in srgb, var(--tsext-sw-mB) 42%, transparent) !important;
  }

#tsext-host .tsext-bar-risk.tsext-risk-vhigh,
  #tsext-host .tsext-bar[data-c="−A"] .tsext-bar-risk,
  #tsext-host .tsext-bar[data-c="-A"] .tsext-bar-risk,
  #tsext-host .tsext-cell .val.tsext-risk-vhigh,
  #tsext-host #tsext-obpanel-body .tsext-cell .val.tsext-risk-vhigh,
  #tsext-host #tsext-ob-calc .tsext-cell .val.tsext-risk-vhigh {
    color: var(--tsext-sw-mA) !important;
    background: color-mix(in srgb, var(--tsext-sw-mA) 22%, transparent) !important;
    border-color: color-mix(in srgb, var(--tsext-sw-mA) 42%, transparent) !important;
  }

#tsext-host .tsext-bar-risk.tsext-risk-high {
    border-radius: var(--tsext-r-pill);
    padding: 3px 7px;
  }

#tsext-host .tsext-bar-actions{
  margin-inline-start: 4px;
  padding-inline-start: 8px;
  border-inline-start: 1px solid color-mix(in srgb, var(--tsext-border) 55%, transparent) !important;
  position: relative;
  display: flex;
  justify-content: center;
  align-items: center;
  padding-inline-end: 0;
}

#tsext-host .tsext-bar-obbtn{
  height: 26px;
  min-width: 26px;
  border-radius: var(--tsext-r-sm);
  font-size: var(--tsext-fs-xs) !important;
  font-weight: 800 !important;
  background: color-mix(in srgb, var(--tsext-panel2) 90%, transparent) !important;
  border: 1px solid color-mix(in srgb, var(--tsext-border) 80%, transparent) !important;
  color: var(--tsext-muted) !important;
  transition: color .15s ease, border-color .15s ease, background .15s ease, transform .15s var(--tsext-ease) !important;
  min-height: 30px;
  padding: 4px 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
}

#tsext-host .tsext-bar-cmp{
    position: absolute;
    inset-inline-end: 0 !important;
    top: 50%;
    transform: translateY(-50%);
    width: 18px;
    height: 18px;
    padding: 0;
    font-size: var(--tsext-fs-xs) !important;
    opacity: .55;
  }

#tsext-host .tsext-bar-cmp:hover{ opacity: 1 }

#tsext-host .tsext-cols-actions{
    display: flex;
    align-items: center;
    justify-content: center;
  }

#tsext-host #pr-wl-add-btn,
  #tsext-host .pr-wl-add button,
  #tsext-host [id^="tsext-go-"]{
    color:#ffffff !important;
    -webkit-text-fill-color:#ffffff !important;
    opacity:1;
  }

#tsext-host .tsext-cols .tsext-col.tsext-bar-profit,
  #tsext-host .tsext-cols .tsext-col.tsext-bar-profit.on,
  #tsext-host .tsext-cols .tsext-bar-profit {
    color: var(--tsext-accent) !important;
    background: color-mix(in srgb, var(--tsext-accent) 10%, transparent) !important;
    box-shadow: none !important;
    font-weight: 800 !important;
    opacity: 1;
  }

#tsext-host .tsext-cols .tsext-col,
  #tsext-host .tsext-cols .tsext-col.on,
  #tsext-host .tsext-cols .tsext-col:hover,
  #tsext-host .tsext-cols .tsext-col-name,
  #tsext-host .tsext-cols .tsext-col-strike,
  #tsext-host .tsext-cols .tsext-col-days,
  #tsext-host .tsext-cols .tsext-col-date,
  #tsext-host .tsext-cols .tsext-col-risk,
  #tsext-host .tsext-cols .tsext-col-profit,
  #tsext-host .tsext-cols .tsext-cols-class,
  #tsext-host .tsext-cols .tsext-cols-actions,
  #tsext-host .tsext-cols .tsext-bar-name,
  #tsext-host .tsext-cols .tsext-bar-strike,
  #tsext-host .tsext-cols .tsext-bar-days,
  #tsext-host .tsext-cols .tsext-bar-date,
  #tsext-host .tsext-cols .tsext-bar-risk,
  #tsext-host .tsext-cols .tsext-bar-profit {
    font-size: var(--tsext-fs-sm) !important;
    font-weight: 800 !important;
    line-height: 1.3 !important;
    letter-spacing: .01em !important;
    color: var(--tsext-accent) !important;
    background: color-mix(in srgb, var(--tsext-accent) 10%, transparent) !important;
    box-shadow: none !important;
    opacity: 1;
    height: 28px;
    min-height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 3px;
  }

#tsext-host .tsext-cols .tsext-col-name {
    justify-content: flex-start;
    text-align: start;
    padding-inline-start: 6px;
  }

#tsext-host .tsext-sort-arrow {
    display: inline-block;
    font-size: 9px !important;
    font-weight: 900 !important;
    line-height: 1 !important;
    opacity: .85;
    margin-inline-start: 2px;
    color: var(--tsext-accent) !important;
    transform: translateY(-0.5px);
  }

#tsext-host .tsext-cols .tsext-col.on {
  color: var(--tsext-accent) !important;
  background: color-mix(in srgb, var(--tsext-accent) 10%, transparent) !important;
  font-weight: 800 !important;
  box-shadow: inset 0 -2px 0 var(--tsext-accent) !important;
}

#tsext-host .tsext-empty-hints {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    justify-content: center;
    margin: 10px 0 4px;
    max-width: 420px;
  }

#tsext-host .tsext-empty-hint {
    font-size: var(--tsext-fs-xxs) !important;
    font-weight: 700 !important;
    color: var(--tsext-muted) !important;
    background: color-mix(in srgb, var(--tsext-panel2) 80%, transparent) !important;
    border: 1px solid color-mix(in srgb, var(--tsext-border) 80%, transparent) !important;
    border-radius: var(--tsext-r-sm);
    padding: 3px 8px;
  }
  }

  @layer tsext-theme {
  /* قوانین خالص تم (فقط selectorهای data-tsext-theme) — از components جدا شدند */
#tsext-host[data-tsext-theme="dark"] .tsext-stale-banner,
  #tsext-host[data-tsext-theme="contrast"] .tsext-stale-banner{
    color:#fde68a !important; background:color-mix(in srgb,#78350f 55%,#0f172a) !important;
    border-bottom-color:#b45309 !important;
  }

#tsext-host[data-tsext-theme="dark"] .tsext-health-banner, #tsext-host[data-tsext-theme="contrast"] .tsext-health-banner{ color:#fecaca; background:color-mix(in srgb,#7f1d1d 55%,var(--tsext-panel2)); border-bottom-color:color-mix(in srgb,#ef4444 55%,transparent); }

#tsext-host[data-tsext-theme="dark"] .tsext-fav-showall,
  #tsext-host[data-tsext-theme="contrast"] .tsext-fav-showall{
    color:#fbbf24 !important; border-color:#f59e0b !important;
  }

#tsext-host[data-tsext-theme="dark"] .tsext-bar-fav{
    color:#fbbf24 !important;
    background:color-mix(in srgb,#f59e0b 14%, transparent);
    border-color:color-mix(in srgb,#f59e0b 40%, #334155);
  }

#tsext-host[data-tsext-theme="dark"] .tsext-bar-fav.on,
  #tsext-host[data-tsext-theme="contrast"] .tsext-bar-fav.on{
    color:#111 !important;
    background:#fbbf24 !important;
    border-color:#f59e0b !important;
  }

#tsext-host[data-tsext-theme="contrast"] .tsext-bar-fav{
    color:#fbbf24 !important;
    border-color:#fbbf24;
  }

#tsext-host[data-tsext-theme="dark"] .tsext-bar-profit.pos,
  #tsext-host[data-tsext-theme="dark"] .val.pos{ color:#4ade80 !important }

#tsext-host[data-tsext-theme="dark"] .tsext-bar-profit.neg,
  #tsext-host[data-tsext-theme="dark"] .val.neg{ color:#f87171 !important }

#tsext-host[data-tsext-theme="contrast"] .tsext-bar-profit.pos,
  #tsext-host[data-tsext-theme="contrast"] .val.pos{ color:#86efac !important }

#tsext-host[data-tsext-theme="contrast"] .tsext-bar-profit.neg,
  #tsext-host[data-tsext-theme="contrast"] .val.neg{ color:#fca5a5 !important }

#tsext-host[data-tsext-theme="dark"] .tsext-liq-warn{background:color-mix(in srgb,#f59e0b 22%,transparent);color:#fbbf24;border-color:color-mix(in srgb,#f59e0b 40%,transparent)}

#tsext-host[data-tsext-theme="dark"] .tsext-exer-warn{background:color-mix(in srgb,#ef4444 20%,transparent);color:#fca5a5;border-color:color-mix(in srgb,#ef4444 35%,transparent)}

#tsext-host[data-tsext-theme="dark"] .tsext-bar.open{border-color:#5b8def !important;box-shadow:0 0 0 1px rgba(91,141,239,.2) !important}

#tsext-host[data-tsext-theme="contrast"] .tsext-tools,#tsext-host[data-tsext-theme="contrast"] .tsext-tabs,#tsext-host[data-tsext-theme="contrast"] .tsext-strategy-panel,#tsext-host[data-tsext-theme="contrast"] .tsext-bar,#tsext-host[data-tsext-theme="contrast"] #tsext-obpanel{box-shadow:none !important}

#tsext-host[data-tsext-theme="dark"] .tsext-col-grip:hover::before,
  #tsext-host[data-tsext-theme="dark"] .tsext-col-grip:active::before,
  #tsext-host[data-tsext-theme="dark"] .tsext-col-grip.is-dragging::before,
  #tsext-host[data-tsext-theme="contrast"] .tsext-col-grip:hover::before,
  #tsext-host[data-tsext-theme="contrast"] .tsext-col-grip:active::before,
  #tsext-host[data-tsext-theme="contrast"] .tsext-col-grip.is-dragging::before{
    background:var(--tsext-accent) !important}

#tsext-host[data-tsext-theme="dark"] .tsext-title,
  #tsext-host[data-tsext-theme="dark"] #tsext-obpanel-title{ color:#fff !important; }

#tsext-host[data-tsext-theme="dark"] .tsext-bar-main,
  #tsext-host[data-tsext-theme="dark"] .tsext-bar-main *{ color:#dbe4ee}

#tsext-host[data-tsext-theme="contrast"] *{ opacity:1; }

#tsext-host[data-tsext-theme="contrast"] .tsext-bar-main,
  #tsext-host[data-tsext-theme="contrast"] .tsext-bar-main *{ color:#f5f5f5}

#tsext-host[data-tsext-theme="light"]{
    --tsext-muted:#475569 !important;
    --tsext-fg:#1e293b !important;
    --tsext-bright:#0f172a !important;
  }

#tsext-host[data-tsext-theme="light"] #tsext-updated,
  #tsext-host[data-tsext-theme="light"] #tsext-market,
  #tsext-host[data-tsext-theme="light"] .tsext-subtitle,
  #tsext-host[data-tsext-theme="light"] .tsext-mini,
  #tsext-host[data-tsext-theme="light"] .tsext-field > label,
  #tsext-host[data-tsext-theme="light"] .tsext-section-title,
  #tsext-host[data-tsext-theme="light"] .tsext-settings-hint,
  #tsext-host[data-tsext-theme="light"] .tsext-price-basis,
  #tsext-host[data-tsext-theme="light"] .tsext-legend,
  #tsext-host[data-tsext-theme="light"] .tsext-col,
  #tsext-host[data-tsext-theme="light"] .tsext-bar-risk,
  #tsext-host[data-tsext-theme="light"] .tsext-cell .lbl,
  #tsext-host[data-tsext-theme="light"] .tsext-ob-table th,
  #tsext-host[data-tsext-theme="light"] .tsext-ob-foot .lbl,
  #tsext-host[data-tsext-theme="light"] .tsext-disclaimer,
  #tsext-host[data-tsext-theme="light"] .tsext-sec,
  #tsext-host[data-tsext-theme="light"] .tsext-chip,
  #tsext-host[data-tsext-theme="light"] .tsext-bar-date,
  #tsext-host[data-tsext-theme="light"] .tsext-bar-days,
  #tsext-host[data-tsext-theme="light"] .tsext-bar-strike,
  #tsext-host[data-tsext-theme="light"] .tsext-empty,
  #tsext-host[data-tsext-theme="light"] .tsext-empty-sub,
  #tsext-host[data-tsext-theme="light"] .tsext-tag-close,
  #tsext-host[data-tsext-theme="light"] .tsext-hero-card .h-lbl,
  #tsext-host[data-tsext-theme="light"] #tsext-status,
  #tsext-host[data-tsext-theme="light"] .tsext-ds-inline .tsext-mini {
    color:#334155 !important;
    opacity:1;
  }

#tsext-host[data-tsext-theme="light"] .tsext-input::placeholder{
    color:#64748b !important;
    opacity:1;
  }

#tsext-host[data-tsext-theme="dark"] #tsext-updated,
  #tsext-host[data-tsext-theme="dark"] #tsext-market,
  #tsext-host[data-tsext-theme="dark"] .tsext-subtitle,
  #tsext-host[data-tsext-theme="dark"] .tsext-mini,
  #tsext-host[data-tsext-theme="dark"] .tsext-field > label,
  #tsext-host[data-tsext-theme="dark"] .tsext-section-title,
  #tsext-host[data-tsext-theme="dark"] .tsext-settings-hint,
  #tsext-host[data-tsext-theme="dark"] .tsext-price-basis,
  #tsext-host[data-tsext-theme="dark"] .tsext-legend,
  #tsext-host[data-tsext-theme="dark"] .tsext-col,
  #tsext-host[data-tsext-theme="dark"] .tsext-bar-risk,
  #tsext-host[data-tsext-theme="dark"] .tsext-cell .lbl,
  #tsext-host[data-tsext-theme="dark"] .tsext-ob-table th,
  #tsext-host[data-tsext-theme="dark"] .tsext-ob-foot .lbl { color:#d7e0eb !important; }

#tsext-host[data-tsext-theme="contrast"] #tsext-updated,
  #tsext-host[data-tsext-theme="contrast"] #tsext-market,
  #tsext-host[data-tsext-theme="contrast"] .tsext-subtitle,
  #tsext-host[data-tsext-theme="contrast"] .tsext-mini,
  #tsext-host[data-tsext-theme="contrast"] .tsext-field > label,
  #tsext-host[data-tsext-theme="contrast"] .tsext-section-title,
  #tsext-host[data-tsext-theme="contrast"] .tsext-settings-hint,
  #tsext-host[data-tsext-theme="contrast"] .tsext-price-basis,
  #tsext-host[data-tsext-theme="contrast"] .tsext-legend,
  #tsext-host[data-tsext-theme="contrast"] .tsext-col,
  #tsext-host[data-tsext-theme="contrast"] .tsext-bar-risk,
  #tsext-host[data-tsext-theme="contrast"] .tsext-cell .lbl,
  #tsext-host[data-tsext-theme="contrast"] .tsext-ob-table th,
  #tsext-host[data-tsext-theme="contrast"] .tsext-ob-foot .lbl { color:#ffffff !important; }

#tsext-host[data-tsext-theme="dark"]::after{ box-shadow:inset 0 1px 0 rgba(255,255,255,.06) !important; }

#tsext-host[data-tsext-theme="contrast"]::after{ box-shadow:none !important; }

#tsext-host[data-tsext-theme="dark"] .tsext-tab:not(.active),
  #tsext-host[data-tsext-theme="dark"] .tsext-btn,
  #tsext-host[data-tsext-theme="dark"] .tsext-settings-toggle,
  #tsext-host[data-tsext-theme="dark"] .tsext-check,
  #tsext-host[data-tsext-theme="dark"] .tsext-col,
  #tsext-host[data-tsext-theme="dark"] .tsext-bar-risk,
  #tsext-host[data-tsext-theme="dark"] .tsext-mini,
  #tsext-host[data-tsext-theme="dark"] .tsext-subtitle,
  #tsext-host[data-tsext-theme="dark"] .tsext-legend,
  #tsext-host[data-tsext-theme="dark"] .tsext-price-basis,
  #tsext-host[data-tsext-theme="dark"] .tsext-field > label,
  #tsext-host[data-tsext-theme="dark"] .tsext-settings-hint,
  #tsext-host[data-tsext-theme="dark"] .tsext-ob-table th,
  #tsext-host[data-tsext-theme="dark"] .tsext-ob-foot .lbl{
    opacity:1}

#tsext-host[data-tsext-theme="contrast"] .tsext-tab:not(.active),
  #tsext-host[data-tsext-theme="contrast"] .tsext-btn,
  #tsext-host[data-tsext-theme="contrast"] .tsext-settings-toggle,
  #tsext-host[data-tsext-theme="contrast"] .tsext-check,
  #tsext-host[data-tsext-theme="contrast"] .tsext-col,
  #tsext-host[data-tsext-theme="contrast"] .tsext-bar-risk,
  #tsext-host[data-tsext-theme="contrast"] .tsext-mini,
  #tsext-host[data-tsext-theme="contrast"] .tsext-subtitle,
  #tsext-host[data-tsext-theme="contrast"] .tsext-legend,
  #tsext-host[data-tsext-theme="contrast"] .tsext-price-basis,
  #tsext-host[data-tsext-theme="contrast"] .tsext-field > label,
  #tsext-host[data-tsext-theme="contrast"] .tsext-settings-hint,
  #tsext-host[data-tsext-theme="contrast"] .tsext-ob-table th,
  #tsext-host[data-tsext-theme="contrast"] .tsext-ob-foot .lbl{
    opacity:1}

#tsext-host[data-tsext-theme="dark"] .tsext-bar-class,
  #tsext-host[data-tsext-theme="contrast"] .tsext-bar-class{
    background:#141c29 !important;
    color:#ffffff !important;
    border-color:#64748b !important;
    box-shadow:none !important;
    text-shadow:none !important;
  }

#tsext-host[data-tsext-theme="dark"] .tsext-legend .tsext-chip,
  #tsext-host[data-tsext-theme="contrast"] .tsext-legend .tsext-chip{
    background:transparent !important;
    text-shadow:none !important;
    opacity:1;
  }

#tsext-host[data-tsext-theme="dark"] .tsext-legend .tsext-chip.off,
  #tsext-host[data-tsext-theme="contrast"] .tsext-legend .tsext-chip.off{opacity:.45}

#tsext-host[data-tsext-theme="dark"],
  #tsext-host[data-tsext-theme="contrast"]{
    color-scheme:dark !important;
  }

#tsext-host[data-tsext-theme="dark"] .tsext-tools,
  #tsext-host[data-tsext-theme="contrast"] .tsext-tools{
    background:var(--tsext-panel2) !important;
    border-color:var(--tsext-border) !important;
    box-shadow:none !important}

#tsext-host[data-tsext-theme="dark"] .tsext-btn,
  #tsext-host[data-tsext-theme="contrast"] .tsext-btn{
    color:var(--tsext-fg) !important;
    background:transparent !important;
    border-color:var(--tsext-border) !important}

#tsext-host[data-tsext-theme="dark"] .tsext-input,
  #tsext-host[data-tsext-theme="contrast"] .tsext-input{
    background:var(--tsext-input) !important;
    color:var(--tsext-bright) !important;
    border-color:var(--tsext-border) !important;
    box-shadow:none !important}

#tsext-host[data-tsext-theme="dark"] .tsext-input::placeholder,
  #tsext-host[data-tsext-theme="contrast"] .tsext-input::placeholder{color:var(--tsext-muted) !important;opacity:1}

#tsext-host[data-tsext-theme="dark"] .tsext-input:focus{
  border-color: #6ea8ff !important;
  box-shadow: 0 0 0 3px rgba(110,168,255,.16) !important;
}

#tsext-host[data-tsext-theme="contrast"] .tsext-input:focus{border-color:#38bdf8 !important;box-shadow:0 0 0 3px rgba(56,189,248,.18) !important}

#tsext-host[data-tsext-theme="dark"] select.tsext-input option,
  #tsext-host[data-tsext-theme="contrast"] select.tsext-input option{background:var(--tsext-panel) !important;color:var(--tsext-bright) !important}

#tsext-host[data-tsext-theme="dark"] .tsext-tabs,
  #tsext-host[data-tsext-theme="contrast"] .tsext-tabs{
    background:var(--tsext-panel2) !important;
    border-color:var(--tsext-border) !important;
    box-shadow:none !important;
  }

#tsext-host[data-tsext-theme="dark"] .tsext-tab,
  #tsext-host[data-tsext-theme="contrast"] .tsext-tab{
    color:var(--tsext-fg) !important}

#tsext-host[data-tsext-theme="dark"] .tsext-modes-row,
  #tsext-host[data-tsext-theme="contrast"] .tsext-modes-row{
    background:var(--tsext-panel2) !important;
    border-color:var(--tsext-border) !important}

#tsext-host[data-tsext-theme="dark"] .tsext-strategy-panel,
  #tsext-host[data-tsext-theme="contrast"] .tsext-strategy-panel,
  #tsext-host[data-tsext-theme="dark"] .tsext-settings-body,
  #tsext-host[data-tsext-theme="contrast"] .tsext-settings-body,
  #tsext-host[data-tsext-theme="dark"] .tsext-tickmode-note,
  #tsext-host[data-tsext-theme="contrast"] .tsext-tickmode-note,
  #tsext-host[data-tsext-theme="dark"] .tsext-hdr,
  #tsext-host[data-tsext-theme="contrast"] .tsext-hdr,
  #tsext-host[data-tsext-theme="dark"] .tsext-legend,
  #tsext-host[data-tsext-theme="contrast"] .tsext-legend{
    background:var(--tsext-panel2) !important;
    border-color:var(--tsext-border) !important;
    color:var(--tsext-fg) !important;
    box-shadow:none !important;
  }

#tsext-host[data-tsext-theme="dark"] .tsext-settings-toggle,
  #tsext-host[data-tsext-theme="contrast"] .tsext-settings-toggle{
    background:var(--tsext-panel2) !important;
    border-color:var(--tsext-border) !important;
    color:var(--tsext-fg) !important}

#tsext-host[data-tsext-theme="dark"] #tsext-list,
  #tsext-host[data-tsext-theme="contrast"] #tsext-list{background:var(--tsext-bg) !important;}

#tsext-host[data-tsext-theme="dark"] .tsext-cols,
  #tsext-host[data-tsext-theme="contrast"] .tsext-cols{
    background:var(--tsext-panel2) !important;
    border-color:var(--tsext-border) !important}

#tsext-host[data-tsext-theme="dark"] .tsext-cols .tsext-col,
  #tsext-host[data-tsext-theme="contrast"] .tsext-cols .tsext-col{color:var(--tsext-accent) !important}

#tsext-host[data-tsext-theme="dark"] .tsext-bar,
  #tsext-host[data-tsext-theme="contrast"] .tsext-bar{
    background:var(--tsext-panel) !important;
    border-color:var(--tsext-border) !important;
    box-shadow:0 4px 15px rgba(0,0,0,.28) !important}

#tsext-host[data-tsext-theme="dark"] .tsext-bar-open,
  #tsext-host[data-tsext-theme="dark"] .tsext-bar-obbtn,
  #tsext-host[data-tsext-theme="contrast"] .tsext-bar-open,
  #tsext-host[data-tsext-theme="contrast"] .tsext-bar-obbtn{
    background:var(--tsext-panel2) !important;
    border-color:var(--tsext-border) !important;
    color:var(--tsext-fg) !important}

#tsext-host[data-tsext-theme="dark"] #tsext-obpanel,
  #tsext-host[data-tsext-theme="contrast"] #tsext-obpanel{
    background:var(--tsext-panel) !important;
    border-color:var(--tsext-border) !important;
    box-shadow:0 24px 65px rgba(0,0,0,.48) !important;
  }

#tsext-host[data-tsext-theme="dark"] #tsext-obpanel-body,
  #tsext-host[data-tsext-theme="contrast"] #tsext-obpanel-body{background:var(--tsext-panel) !important}

#tsext-host[data-tsext-theme="dark"] .tsext-ob-title,
  #tsext-host[data-tsext-theme="contrast"] .tsext-ob-title,
  #tsext-host[data-tsext-theme="dark"] .tsext-ob-foot,
  #tsext-host[data-tsext-theme="contrast"] .tsext-ob-foot{
    background:var(--tsext-panel2) !important;
    border-color:var(--tsext-border) !important;
    color:var(--tsext-fg) !important}

#tsext-host[data-tsext-theme="dark"] .tsext-ob-table th,
  #tsext-host[data-tsext-theme="contrast"] .tsext-ob-table th{background:var(--tsext-panel2) !important;color:var(--tsext-muted) !important;border-color:var(--tsext-border) !important}

#tsext-host[data-tsext-theme="dark"] .tsext-ob-table td,
  #tsext-host[data-tsext-theme="contrast"] .tsext-ob-table td{background:transparent !important;color:var(--tsext-fg) !important;border-color:var(--tsext-border) !important}

#tsext-host[data-tsext-theme="dark"] .tsext-empty,
  #tsext-host[data-tsext-theme="dark"] .tsext-ob-empty,
  #tsext-host[data-tsext-theme="dark"] .tsext-ob-loading,
  #tsext-host[data-tsext-theme="contrast"] .tsext-empty,
  #tsext-host[data-tsext-theme="contrast"] .tsext-ob-empty,
  #tsext-host[data-tsext-theme="contrast"] .tsext-ob-loading{
    background:var(--tsext-panel2) !important;
    border-color:var(--tsext-border) !important;
    color:var(--tsext-fg) !important;
  }

#tsext-host[data-tsext-theme="dark"] #tsext-status,
  #tsext-host[data-tsext-theme="contrast"] #tsext-status{
    background:var(--tsext-panel2) !important;
    border-top-color:var(--tsext-border) !important;
    color:var(--tsext-muted) !important}

#tsext-host[data-tsext-theme="dark"] .tsext-title,
  #tsext-host[data-tsext-theme="contrast"] .tsext-title{color:#fff !important;}

#tsext-host[data-tsext-theme="dark"] .tsext-ob-table td.tsext-ob-oor,
  #tsext-host[data-tsext-theme="contrast"] .tsext-ob-table td.tsext-ob-oor{
    opacity:.38;
  }

#tsext-host[data-tsext-theme="dark"] .tsext-ob-table td.tsext-ob-oor .tsext-ob-oor,
  #tsext-host[data-tsext-theme="contrast"] .tsext-ob-table td.tsext-ob-oor .tsext-ob-oor{opacity:1}

#tsext-host[data-tsext-theme="dark"] #tsext-ob-calc .tsext-hero-card .h-lbl{
  color: #94a3b8 !important;
}

#tsext-host[data-tsext-theme="dark"] #tsext-ob-calc .tsext-hero-card .h-val{
  color: #f8fafc !important;
}

#tsext-host[data-tsext-theme="dark"] #tsext-ob-calc .tsext-hero-card.pos .h-val,
  #tsext-host[data-tsext-theme="dark"] #tsext-ob-calc .tsext-hero-card.main.pos .h-val{
  color: #34d399 !important;
}

#tsext-host[data-tsext-theme="dark"] #tsext-ob-calc .tsext-hero-card.neg .h-val,
  #tsext-host[data-tsext-theme="dark"] #tsext-ob-calc .tsext-hero-card.main.neg .h-val{
  color: #f87171 !important;
}

#tsext-host[data-tsext-theme="dark"] .tsext-cols .tsext-col,
  #tsext-host[data-tsext-theme="dark"] .tsext-cols .tsext-col.on,
  #tsext-host[data-tsext-theme="dark"] .tsext-cols .tsext-cols-actions{
    background: #172033 !important;
    color: #8fc0ff !important;
    box-shadow: none !important;
  }

#tsext-host[data-tsext-theme="contrast"] .tsext-cols .tsext-col,
  #tsext-host[data-tsext-theme="contrast"] .tsext-cols .tsext-col.on,
  #tsext-host[data-tsext-theme="contrast"] .tsext-cols .tsext-cols-actions{
    background: #202020 !important;
    color: #7dd3fc !important;
    box-shadow: none !important;
  }

#tsext-host[data-tsext-theme="light"] .tsext-tick-mode.active{ color:#fff !important}

#tsext-host[data-tsext-theme="light"] #tsext-head{
    background:
      radial-gradient(90% 180% at 100% 0%, rgba(99,102,241,.18), transparent 58%),
      linear-gradient(135deg,#ffffff 0%,#f8f7ff 55%,#f4f8ff 100%) !important;
    border-bottom:1px solid #e2e8f0 !important}

#tsext-host[data-tsext-theme="light"] .tsext-tools{border:1px solid #e2e8f0 !important}

#tsext-host[data-tsext-theme="light"] .tsext-btn:hover{background:#eef2ff !important}

#tsext-host[data-tsext-theme="light"] .tsext-btn.tsext-close:hover{background:#fee2e2 !important;color:#dc2626 !important}

#tsext-host[data-tsext-theme="light"] .tsext-input{
    border:1px solid #d8e1ef !important; background:#fff !important}

#tsext-host[data-tsext-theme="light"] .tsext-input:hover{border-color:#a5b4fc !important}

#tsext-host[data-tsext-theme="light"] .tsext-tabs{
    background:linear-gradient(135deg,#eef2ff,#f5f3ff 58%,#ecfeff) !important;
    border:1px solid #dbe4ff !important}

#tsext-host[data-tsext-theme="light"] .tsext-tab{ color:#64748b !important}

#tsext-host[data-tsext-theme="light"] .tsext-tab.active{
    color:#fff !important}

#tsext-host[data-tsext-theme="light"] .tsext-tab.active::before{color:#fff !important}

#tsext-host[data-tsext-theme="light"] .tsext-modes-row{background:#f8fafc !important;border:1px solid #e2e8f0 !important}

#tsext-host[data-tsext-theme="light"] .tsext-strategy-panel{ border:1px solid #e1e7f0 !important}

#tsext-host[data-tsext-theme="light"] .tsext-section{border-top:1px dashed #dbe3ee !important}

#tsext-host[data-tsext-theme="light"] .tsext-section-title{color:#334155 !important}

#tsext-host[data-tsext-theme="light"] .tsext-settings-toggle{background:#f8fafc !important}

#tsext-host[data-tsext-theme="light"] .tsext-settings-toggle:hover{background:#eef2ff !important}

#tsext-host[data-tsext-theme="light"] .tsext-tickmode-note{background:linear-gradient(135deg,#eef2ff,#f0fdfa) !important;border:1px solid #dce4ff !important}

#tsext-host[data-tsext-theme="light"] .tsext-hdr{
    border:1px solid #dde5f1 !important}

#tsext-host[data-tsext-theme="light"] .tsext-cols{
    background:linear-gradient(90deg,#eef2ff,#f8fafc,#ecfeff) !important;
    border:1px solid #dce4ef !important}

#tsext-host[data-tsext-theme="light"] .tsext-bar-class{background:color-mix(in srgb,currentColor 10%,#fff) !important}

#tsext-host[data-tsext-theme="light"] .tsext-bar .tsext-bar-profit{
    background:linear-gradient(135deg,#ecfdf5,#d1fae5) !important;color:#047857 !important}

#tsext-host[data-tsext-theme="light"] .tsext-bar .tsext-bar-profit.neg{background:linear-gradient(135deg,#fff1f2,#ffe4e6) !important;color:#be123c !important}

#tsext-host[data-tsext-theme="light"] .tsext-bar-badge{background:#eef2ff !important;border-color:#c7d2fe !important}

#tsext-host[data-tsext-theme="light"] .tsext-bar-open, #tsext-host[data-tsext-theme="light"] .tsext-bar-obbtn{background:#f8fafc !important;border-color:#dbe3ef !important}

#tsext-host[data-tsext-theme="light"] .tsext-bar-obbtn{color:#475569 !important}

#tsext-host[data-tsext-theme="light"] .tsext-bar-open:hover, #tsext-host[data-tsext-theme="light"] .tsext-bar-obbtn:hover{background:#eef2ff !important;border-color:#a5b4fc !important}

#tsext-host[data-tsext-theme="light"] .tsext-bar.open{border-color:#818cf8 !important}

#tsext-host[data-tsext-theme="light"] .tsext-empty{background:linear-gradient(135deg,#f5f3ff,#ecfeff) !important;border:1px dashed #c7d2fe !important}

#tsext-host[data-tsext-theme="light"] #tsext-status{border-top:1px solid #cfd8dc !important;color:#263238 !important;font-weight:700 !important;opacity:1;background:#eceff1 !important}

#tsext-host[data-tsext-theme="light"] #tsext-status,
  #tsext-host[data-tsext-theme="light"] #tsext-status #pr-status-text,
  #tsext-host[data-tsext-theme="light"] #pr-status-text {
    color:#1e293b !important;
    opacity:1;
    font-weight:800 !important;
  }

#tsext-host[data-tsext-theme="light"] #tsext-obpanel{background:#fff !important}

#tsext-host[data-tsext-theme="light"] .tsext-obpanel-head{background:linear-gradient(135deg,#eef2ff,#f5f3ff 60%,#ecfeff) !important}

#tsext-host[data-tsext-theme="light"] .tsext-obpanel-head > span, #tsext-host[data-tsext-theme="light"] #tsext-obpanel-title{color:#1e1b4b !important}

#tsext-host[data-tsext-theme="dark"] #tsext-head{
  background: radial-gradient(90% 180% at 100% 0%,rgba(96,165,250,.16),transparent 58%),linear-gradient(135deg,#101827 0%,#111827 55%,#0b1220 100%) !important;
  border-bottom-color: #243044 !important;
}

#tsext-host[data-tsext-theme="dark"] .tsext-tools{
  background: rgba(17,24,39,.82) !important;
  box-shadow: 0 5px 18px rgba(0,0,0,.24) !important;
  border-color: #243044 !important;
}

#tsext-host[data-tsext-theme="dark"] .tsext-btn{color:#aebbd0 !important}

#tsext-host[data-tsext-theme="dark"] .tsext-input{
  box-shadow: none !important;
  border-color: #2a3950 !important;
  background: #0d1520 !important;
  color: #e5edf7 !important;
}

#tsext-host[data-tsext-theme="dark"] .tsext-tabs{
  box-shadow: none !important;
  background: #0d1520 !important;
  border-color: #243044 !important;
}

#tsext-host[data-tsext-theme="dark"] .tsext-tab{color:#8b98a9 !important}

#tsext-host[data-tsext-theme="dark"] .tsext-tab.active{background:linear-gradient(135deg,#2563eb,#4f46e5) !important;color:#fff !important}

#tsext-host[data-tsext-theme="dark"] .tsext-strategy-panel{
  box-shadow: none !important;
  background: #101925 !important;
  border-color: #243044 !important;
}

#tsext-host[data-tsext-theme="dark"] .tsext-modes-row{background:#0c1420 !important;border-color:#243044 !important}

#tsext-host[data-tsext-theme="dark"] .tsext-hdr{
  box-shadow: none !important;
  background: linear-gradient(135deg,#111b2a,#101827) !important;
  border-color: #243044 !important;
}

#tsext-host[data-tsext-theme="dark"] .tsext-cols{background:linear-gradient(90deg,#152033,#0f1825,#10202a) !important;border-color:#243044 !important}

#tsext-host[data-tsext-theme="dark"] .tsext-bar{
  box-shadow: none !important;
  background: #111827 !important;
  border-color: #243044 !important;
}

#tsext-host[data-tsext-theme="dark"] .tsext-bar-open, #tsext-host[data-tsext-theme="dark"] .tsext-bar-obbtn{background:#0d1520 !important;border-color:#2a3950 !important;color:#aebbd0 !important}

#tsext-host[data-tsext-theme="dark"] #tsext-status{background:#263238 !important;border-top-color:#455a64 !important;color:#eceff1 !important;font-weight:700 !important;opacity:1}

#tsext-host[data-tsext-theme="dark"] #tsext-obpanel{
  box-shadow: 0 12px 36px rgba(0,0,0,.35) !important;
  background: #111827 !important;
}

#tsext-host[data-tsext-theme="dark"] #tsext-obpanel-title{color:#fff !important}

#tsext-host[data-tsext-theme="contrast"] .tsext-tools, #tsext-host[data-tsext-theme="contrast"] .tsext-tabs, #tsext-host[data-tsext-theme="contrast"] .tsext-strategy-panel, #tsext-host[data-tsext-theme="contrast"] .tsext-bar, #tsext-host[data-tsext-theme="contrast"] #tsext-obpanel{background:#050505 !important;border-color:#737373 !important}

#tsext-host[data-tsext-theme="contrast"] .tsext-tab:hover, #tsext-host[data-tsext-theme="contrast"] .tsext-btn:hover{background:#171717 !important;color:#fff !important}

#tsext-host[data-tsext-theme="dark"] .tsext-col-grip::before, #tsext-host[data-tsext-theme="contrast"] .tsext-col-grip::before{
    background:color-mix(in srgb, #fff 48%, transparent) !important}

#tsext-host[data-tsext-theme="light"] .tsext-input:focus{box-shadow:0 0 0 3px color-mix(in srgb,var(--tsext-accent) 14%,transparent),inset 0 1px 1px color-mix(in srgb,#000 5%,transparent) !important}

#tsext-host[data-tsext-theme="light"] .tsext-bar{
  background: #fff !important;
  border: 1px solid #dde5ef !important;
  box-shadow: 0 2px 7px color-mix(in srgb,#000 5%,transparent) !important;
}

#tsext-host[data-tsext-theme="light"] .tsext-tabs .tsext-tab.active{ color:#fff !important}

#tsext-host[data-tsext-theme="dark"] .tsext-bar-main b, #tsext-host[data-tsext-theme="dark"] .tsext-bar-main strong, #tsext-host[data-tsext-theme="dark"] .tsext-bar-name, #tsext-host[data-tsext-theme="dark"] .tsext-bar-strike{ color:#fff !important}

#tsext-host[data-tsext-theme="dark"] .tsext-mini, #tsext-host[data-tsext-theme="dark"] .tsext-priceinfo, #tsext-host[data-tsext-theme="dark"] .tsext-hdr{ color:#dbe4ee !important}

#tsext-host[data-tsext-theme="dark"] .tsext-field > label, #tsext-host[data-tsext-theme="dark"] .tsext-settings-hint, #tsext-host[data-tsext-theme="dark"] .tsext-section-title, #tsext-host[data-tsext-theme="dark"] .tsext-legend{ color:#aebbd0 !important}

#tsext-host[data-tsext-theme="contrast"] .tsext-title, #tsext-host[data-tsext-theme="contrast"] #tsext-obpanel-title, #tsext-host[data-tsext-theme="contrast"] .tsext-bar-main b, #tsext-host[data-tsext-theme="contrast"] .tsext-bar-main strong{ color:#fff !important}

#tsext-host[data-tsext-theme="contrast"] .tsext-field > label, #tsext-host[data-tsext-theme="contrast"] .tsext-settings-hint, #tsext-host[data-tsext-theme="contrast"] .tsext-section-title, #tsext-host[data-tsext-theme="contrast"] .tsext-legend{ color:#e5e5e5 !important}

#tsext-host[data-tsext-theme="contrast"] .tsext-input{
  background: #090909 !important;
  border-color: #737373 !important;
  color: #fff !important;
}

#tsext-host[data-tsext-theme="light"] .tsext-title, #tsext-host[data-tsext-theme="light"] .tsext-hdr, #tsext-host[data-tsext-theme="light"] .tsext-priceinfo, #tsext-host[data-tsext-theme="light"] .tsext-note, #tsext-host[data-tsext-theme="light"] .tsext-ob-title, #tsext-host[data-tsext-theme="light"] .tsext-ob-table td, #tsext-host[data-tsext-theme="light"] .tsext-empty, #tsext-host[data-tsext-theme="light"] .tsext-ob-empty, #tsext-host[data-tsext-theme="light"] .tsext-ob-loading, #tsext-host[data-tsext-theme="light"] .tsext-tickmode-note, #tsext-host[data-tsext-theme="light"] .tsext-bar-main{
    color:#172033 !important}

#tsext-host[data-tsext-theme="dark"] .tsext-title, #tsext-host[data-tsext-theme="dark"] .tsext-hdr, #tsext-host[data-tsext-theme="dark"] .tsext-priceinfo, #tsext-host[data-tsext-theme="dark"] .tsext-note, #tsext-host[data-tsext-theme="dark"] .tsext-ob-title, #tsext-host[data-tsext-theme="dark"] .tsext-ob-table td, #tsext-host[data-tsext-theme="dark"] .tsext-empty, #tsext-host[data-tsext-theme="dark"] .tsext-ob-empty, #tsext-host[data-tsext-theme="dark"] .tsext-ob-loading, #tsext-host[data-tsext-theme="dark"] .tsext-tickmode-note, #tsext-host[data-tsext-theme="dark"] .tsext-bar-main{ color:#f1f5f9 !important}

#tsext-host[data-tsext-theme="contrast"] .tsext-title, #tsext-host[data-tsext-theme="contrast"] .tsext-hdr, #tsext-host[data-tsext-theme="contrast"] .tsext-priceinfo, #tsext-host[data-tsext-theme="contrast"] .tsext-note, #tsext-host[data-tsext-theme="contrast"] .tsext-ob-title, #tsext-host[data-tsext-theme="contrast"] .tsext-ob-table td, #tsext-host[data-tsext-theme="contrast"] .tsext-empty, #tsext-host[data-tsext-theme="contrast"] .tsext-ob-empty, #tsext-host[data-tsext-theme="contrast"] .tsext-ob-loading, #tsext-host[data-tsext-theme="contrast"] .tsext-tickmode-note, #tsext-host[data-tsext-theme="contrast"] .tsext-bar-main{ color:#ffffff !important}

#tsext-host[data-tsext-theme="dark"] #tsext-head, #tsext-host[data-tsext-theme="dark"] .tsext-tools, #tsext-host[data-tsext-theme="dark"] .tsext-tabs, #tsext-host[data-tsext-theme="dark"] .tsext-strategy-panel, #tsext-host[data-tsext-theme="dark"] .tsext-modes-row, #tsext-host[data-tsext-theme="dark"] .tsext-tickmode-note, #tsext-host[data-tsext-theme="dark"] .tsext-hdr, #tsext-host[data-tsext-theme="dark"] .tsext-cols, #tsext-host[data-tsext-theme="dark"] .tsext-bar, #tsext-host[data-tsext-theme="dark"] .tsext-bar-detail, #tsext-host[data-tsext-theme="dark"] #tsext-status, #tsext-host[data-tsext-theme="dark"] #tsext-obpanel, #tsext-host[data-tsext-theme="dark"] #tsext-obpanel-body, #tsext-host[data-tsext-theme="dark"] .tsext-ob-title, #tsext-host[data-tsext-theme="dark"] .tsext-ob-foot, #tsext-host[data-tsext-theme="dark"] .tsext-empty, #tsext-host[data-tsext-theme="dark"] .tsext-cand, #tsext-host[data-tsext-theme="dark"] .tsext-sum-card, #tsext-host[data-tsext-theme="dark"] .tsext-settings-panel, #tsext-host[data-tsext-theme="dark"] .tsext-filter-panel{
    background:#101722 !important;
    color:#dbe4ee !important;
    border-color:#2a3950 !important}

#tsext-host[data-tsext-theme="dark"] #tsext-list{ background:#0a0f16 !important}

#tsext-host[data-tsext-theme="dark"] .tsext-input, #tsext-host[data-tsext-theme="dark"] select.tsext-input{
    background:#0b1320 !important;
    color:#f1f5f9 !important;
    border-color:#33445c !important}

#tsext-host[data-tsext-theme="dark"] .tsext-input::placeholder{
  opacity: 1;
  color: #94a3b8 !important;
}

#tsext-host[data-tsext-theme="dark"] .tsext-tab:not(.active), #tsext-host[data-tsext-theme="dark"] .tsext-btn, #tsext-host[data-tsext-theme="dark"] .tsext-settings-toggle, #tsext-host[data-tsext-theme="dark"] .tsext-check, #tsext-host[data-tsext-theme="dark"] .tsext-col, #tsext-host[data-tsext-theme="dark"] .tsext-mini, #tsext-host[data-tsext-theme="dark"] .tsext-subtitle, #tsext-host[data-tsext-theme="dark"] .tsext-legend, #tsext-host[data-tsext-theme="dark"] .tsext-price-basis, #tsext-host[data-tsext-theme="dark"] .tsext-field > label, #tsext-host[data-tsext-theme="dark"] .tsext-settings-hint, #tsext-host[data-tsext-theme="dark"] .tsext-ob-table th, #tsext-host[data-tsext-theme="dark"] .tsext-ob-foot .lbl{
    color:#cbd5e1 !important}

#tsext-host[data-tsext-theme="dark"] .tsext-title, #tsext-host[data-tsext-theme="dark"] .tsext-hdr, #tsext-host[data-tsext-theme="dark"] .tsext-section-title, #tsext-host[data-tsext-theme="dark"] .tsext-priceinfo, #tsext-host[data-tsext-theme="dark"] .tsext-note, #tsext-host[data-tsext-theme="dark"] .tsext-bar-main, #tsext-host[data-tsext-theme="dark"] .tsext-bar-main *{
  opacity: 1;
  color: #f1f5f9 !important;
}

#tsext-host[data-tsext-theme="dark"] .tsext-bar-name, #tsext-host[data-tsext-theme="dark"] .tsext-bar-strike, #tsext-host[data-tsext-theme="dark"] .tsext-ob-table td, #tsext-host[data-tsext-theme="dark"] #tsext-obpanel-title{ color:#ffffff !important}

#tsext-host[data-tsext-theme="dark"] .tsext-cell .val{ color:#f1f5f9 !important}

#tsext-host[data-tsext-theme="dark"] .tsext-cell .val.pos{ color:#4ade80 !important}

#tsext-host[data-tsext-theme="dark"] .tsext-cell .val.neg{ color:#f87171 !important}

#tsext-host[data-tsext-theme="dark"] .tsext-cell .val.warn{ color:#fbbf24 !important}

#tsext-host[data-tsext-theme="dark"] .tsext-ob-table tbody tr:nth-child(odd){ background:#101925 !important}

#tsext-host[data-tsext-theme="dark"] .tsext-ob-table .px-ask{
  background: rgba(248,113,113,.13) !important;
  color: #fca5a5 !important;
}

#tsext-host[data-tsext-theme="dark"] .tsext-ob-table .px-ask.tsext-ob-oor, #tsext-host[data-tsext-theme="dark"] .tsext-ob-table .px-bid.tsext-ob-oor{
  background: rgba(148,163,184,.10) !important;
  color: #94a3b8 !important;
}

#tsext-host[data-tsext-theme="contrast"] #tsext-head, #tsext-host[data-tsext-theme="contrast"] .tsext-tools, #tsext-host[data-tsext-theme="contrast"] .tsext-tabs, #tsext-host[data-tsext-theme="contrast"] .tsext-strategy-panel, #tsext-host[data-tsext-theme="contrast"] .tsext-modes-row, #tsext-host[data-tsext-theme="contrast"] .tsext-tickmode-note, #tsext-host[data-tsext-theme="contrast"] .tsext-hdr, #tsext-host[data-tsext-theme="contrast"] .tsext-cols, #tsext-host[data-tsext-theme="contrast"] .tsext-bar, #tsext-host[data-tsext-theme="contrast"] .tsext-bar-detail, #tsext-host[data-tsext-theme="contrast"] #tsext-status, #tsext-host[data-tsext-theme="contrast"] #tsext-obpanel, #tsext-host[data-tsext-theme="contrast"] #tsext-obpanel-body, #tsext-host[data-tsext-theme="contrast"] .tsext-ob-title, #tsext-host[data-tsext-theme="contrast"] .tsext-ob-foot, #tsext-host[data-tsext-theme="contrast"] .tsext-empty, #tsext-host[data-tsext-theme="contrast"] .tsext-cand, #tsext-host[data-tsext-theme="contrast"] .tsext-sum-card, #tsext-host[data-tsext-theme="contrast"] .tsext-settings-panel, #tsext-host[data-tsext-theme="contrast"] .tsext-filter-panel{
  box-shadow: none !important;
  background: #050505 !important;
  color: #fff !important;
  border-color: #8a8a8a !important;
}

#tsext-host[data-tsext-theme="contrast"] #tsext-list{ background:#000 !important}

#tsext-host[data-tsext-theme="contrast"] .tsext-input, #tsext-host[data-tsext-theme="contrast"] select.tsext-input{
    background:#080808 !important;
    color:#fff !important;
    border-color:#a3a3a3 !important}

#tsext-host[data-tsext-theme="contrast"] .tsext-input::placeholder{
  opacity: 1;
  color: #d4d4d4 !important;
}

#tsext-host[data-tsext-theme="contrast"] .tsext-tab:not(.active), #tsext-host[data-tsext-theme="contrast"] .tsext-btn, #tsext-host[data-tsext-theme="contrast"] .tsext-settings-toggle, #tsext-host[data-tsext-theme="contrast"] .tsext-check, #tsext-host[data-tsext-theme="contrast"] .tsext-col, #tsext-host[data-tsext-theme="contrast"] .tsext-mini, #tsext-host[data-tsext-theme="contrast"] .tsext-subtitle, #tsext-host[data-tsext-theme="contrast"] .tsext-legend, #tsext-host[data-tsext-theme="contrast"] .tsext-price-basis, #tsext-host[data-tsext-theme="contrast"] .tsext-field > label, #tsext-host[data-tsext-theme="contrast"] .tsext-settings-hint, #tsext-host[data-tsext-theme="contrast"] .tsext-ob-table th, #tsext-host[data-tsext-theme="contrast"] .tsext-ob-foot .lbl{
    color:#f0f0f0 !important}

#tsext-host[data-tsext-theme="contrast"] .tsext-title, #tsext-host[data-tsext-theme="contrast"] .tsext-hdr, #tsext-host[data-tsext-theme="contrast"] .tsext-section-title, #tsext-host[data-tsext-theme="contrast"] .tsext-priceinfo, #tsext-host[data-tsext-theme="contrast"] .tsext-note, #tsext-host[data-tsext-theme="contrast"] .tsext-bar-main, #tsext-host[data-tsext-theme="contrast"] .tsext-bar-main *{
  opacity: 1;
  color: #fff !important;
}

#tsext-host[data-tsext-theme="contrast"] .tsext-bar-name, #tsext-host[data-tsext-theme="contrast"] .tsext-bar-strike, #tsext-host[data-tsext-theme="contrast"] .tsext-ob-table td, #tsext-host[data-tsext-theme="contrast"] #tsext-obpanel-title{ color:#fff !important}

#tsext-host[data-tsext-theme="contrast"] .tsext-cell .val{ color:#fff !important}

#tsext-host[data-tsext-theme="contrast"] .tsext-cell .val.pos{ color:#86efac !important}

#tsext-host[data-tsext-theme="contrast"] .tsext-cell .val.neg{ color:#fca5a5 !important}

#tsext-host[data-tsext-theme="contrast"] .tsext-cell .val.warn{ color:#fde68a !important}

#tsext-host[data-tsext-theme="contrast"] .tsext-ob-table tbody tr:nth-child(odd){ background:#000 !important}

#tsext-host[data-tsext-theme="contrast"] .tsext-ob-table .px-ask.tsext-ob-oor, #tsext-host[data-tsext-theme="contrast"] .tsext-ob-table .px-bid.tsext-ob-oor{ color:#c4c4c4 !important; background:#161616 !important}

#tsext-host[data-tsext-theme="dark"] .tsext-bar[data-c="A"] .tsext-bar-class{
  background: rgba(52,211,153,.12) !important;
  color: #6ee7b7 !important;
  border-color: #34d399 !important;
}

#tsext-host[data-tsext-theme="dark"] .tsext-bar[data-c="B"] .tsext-bar-class{
  background: rgba(110,231,183,.11) !important;
  color: #86efac !important;
  border-color: #6ee7b7 !important;
}

#tsext-host[data-tsext-theme="dark"] .tsext-bar[data-c="X"] .tsext-bar-class{
  background: rgba(56,189,248,.12) !important;
  border-color: #38bdf8 !important;
  color: #67d8ff !important;
}

#tsext-host[data-tsext-theme="dark"] .tsext-bar[data-c="−B"] .tsext-bar-class{
  background: rgba(251,191,36,.12) !important;
  color: #fcd34d !important;
  border-color: #fbbf24 !important;
}

#tsext-host[data-tsext-theme="dark"] .tsext-bar[data-c="−A"] .tsext-bar-class{
  background: rgba(248,113,113,.12) !important;
  color: #fca5a5 !important;
  border-color: #f87171 !important;
}

#tsext-host[data-tsext-theme="contrast"] .tsext-bar-class{background:#111111 !important}

#tsext-host[data-tsext-theme="contrast"] .tsext-bar[data-c="A"] .tsext-bar-class{background:#092015 !important;color:#86efac !important;border-color:#22c55e !important}

#tsext-host[data-tsext-theme="contrast"] .tsext-bar[data-c="B"] .tsext-bar-class{background:#102016 !important;color:#a7f3b8 !important;border-color:#86efac !important}

#tsext-host[data-tsext-theme="contrast"] .tsext-bar[data-c="X"] .tsext-bar-class{
  border-color: #38bdf8 !important;
  background: #071a22 !important;
  color: #7dd3fc !important;
}

#tsext-host[data-tsext-theme="contrast"] .tsext-bar[data-c="−B"] .tsext-bar-class{background:#211a05 !important;color:#fde68a !important;border-color:#fbbf24 !important}

#tsext-host[data-tsext-theme="contrast"] .tsext-bar[data-c="−A"] .tsext-bar-class{background:#210b0b !important;color:#fecaca !important;border-color:#f87171 !important}

#tsext-host[data-tsext-theme="contrast"]{
  --tsext-bg: #000000;
  --tsext-panel: #080808;
  --tsext-panel2: #111111;
  --tsext-fg: #f5f5f5;
  --tsext-bright: #ffffff;
  --tsext-muted: #e0e0e0;
  --tsext-border: #737373;
  --tsext-input: #171717;
  --tsext-accent: #38bdf8;
  --tsext-green: #22c55e;
  --tsext-red: #f87171;
  --tsext-orange: #fbbf24;
  --tsext-sw-a: #22c55e;
  --tsext-sw-b: #86efac;
  --tsext-sw-x: #38bdf8;
  --tsext-sw-mb: #fbbf24;
  --tsext-sw-ma: #f87171;
  color: #fff !important;
  background: #000 !important;
  border-color: #737373 !important;
}

#tsext-host[data-tsext-theme="contrast"] #tsext-head{
  background: #050505 !important;
  border-bottom-color: #737373 !important;
}

#tsext-host[data-tsext-theme="dark"] .tsext-btn:hover{
  background: #172033 !important;
  color: #fff !important;
}

#tsext-host[data-tsext-theme="contrast"] .tsext-btn:hover{background:#1b1b1b !important;color:#fff !important}

#tsext-host[data-tsext-theme="dark"] .tsext-close, #tsext-host[data-tsext-theme="contrast"] .tsext-close{color:#f87171 !important}

#tsext-host[data-tsext-theme="dark"] .tsext-input:hover{
  border-color: #4d78ad !important;
}

#tsext-host[data-tsext-theme="contrast"] .tsext-input:hover{border-color:#a3a3a3 !important}

#tsext-host[data-tsext-theme="dark"] .tsext-tab:hover{
  background: #162033 !important;
  color: #fff !important;
}

#tsext-host[data-tsext-theme="contrast"] .tsext-tab:hover{background:#171717 !important;color:#fff !important}

#tsext-host[data-tsext-theme="dark"] .tsext-section{border-top-color:#314055 !important}

#tsext-host[data-tsext-theme="contrast"] .tsext-section{border-top-color:#737373 !important}

#tsext-host[data-tsext-theme="dark"] .tsext-settings-toggle:hover{background:#172033 !important;color:#fff !important}

#tsext-host[data-tsext-theme="contrast"] .tsext-settings-toggle:hover{background:#191919 !important;color:#fff !important}

#tsext-host[data-tsext-theme="dark"] .tsext-tickmode-note{
  border-color: #263955 !important;
  background: #0d1928 !important;
}

#tsext-host[data-tsext-theme="contrast"] .tsext-tickmode-note{background:#101010 !important}

#tsext-host[data-tsext-theme="dark"] .tsext-cols .tsext-col{
  background: #172033 !important;
  color: #8fc0ff !important;
  box-shadow: none !important;
}

#tsext-host[data-tsext-theme="contrast"] .tsext-cols .tsext-col{
  background: #202020 !important;
  color: #7dd3fc !important;
  box-shadow: none !important;
  font-weight: 800 !important;
}

#tsext-host[data-tsext-theme="dark"] .tsext-bar:hover{
  box-shadow: 0 12px 28px rgba(0,0,0,.34) !important;
  background: #142033 !important;
  border-color: #3c5f8f !important;
}

#tsext-host[data-tsext-theme="contrast"] .tsext-bar:hover{
  box-shadow: none !important;
  background: #121212 !important;
  border-color: #9a9a9a !important;
}

#tsext-host[data-tsext-theme="dark"] .tsext-bar-badge{background:#18243a !important;border-color:#334b70 !important;color:#9fc6ff !important}

#tsext-host[data-tsext-theme="contrast"] .tsext-bar-badge{background:#1a1a1a !important;border-color:#737373 !important;color:#7dd3fc !important}

#tsext-host[data-tsext-theme="dark"] .tsext-bar-open:hover, #tsext-host[data-tsext-theme="dark"] .tsext-bar-obbtn:hover{background:#172033 !important;color:#fff !important}

#tsext-host[data-tsext-theme="contrast"] .tsext-bar-open:hover, #tsext-host[data-tsext-theme="contrast"] .tsext-bar-obbtn:hover{background:#1b1b1b !important;color:#fff !important}

#tsext-host[data-tsext-theme="dark"] .tsext-bar .tsext-bar-profit{
  background: rgba(34,197,94,.14) !important;
  color: #4ade80 !important;
}

#tsext-host[data-tsext-theme="dark"] .tsext-bar .tsext-bar-profit.neg{
  background: rgba(248,113,113,.14) !important;
  color: #f87171 !important;
}

#tsext-host[data-tsext-theme="contrast"] .tsext-bar .tsext-bar-profit{background:#10351f !important;color:#4ade80 !important}

#tsext-host[data-tsext-theme="contrast"] .tsext-bar .tsext-bar-profit.neg{background:#38171b !important;color:#f87171 !important}

#tsext-host[data-tsext-theme="dark"] .tsext-bar-detail{
  background: #0d1520 !important;
  border-color: #243044 !important;
}

#tsext-host[data-tsext-theme="contrast"] .tsext-bar-detail{
  background: #101010 !important;
  border-color: #737373 !important;
}

#tsext-host[data-tsext-theme="dark"] .tsext-obpanel-head{
  background: linear-gradient(135deg,#182338,#171d31 60%,#10252b) !important;
  border-color: #243044 !important;
}

#tsext-host[data-tsext-theme="contrast"] .tsext-obpanel-head{background:#101010 !important;border-color:#737373 !important}

#tsext-host[data-tsext-theme="dark"] .tsext-ob-table tbody tr:nth-child(even){
  background: #0d1520 !important;
}

#tsext-host[data-tsext-theme="contrast"] .tsext-ob-table tbody tr:nth-child(even){
  background: #101010 !important;
}

#tsext-host[data-tsext-theme="dark"] .tsext-ob-table .px-bid{
  background: rgba(34,197,94,.13) !important;
  color: #4ade80 !important;
}

#tsext-host[data-tsext-theme="contrast"] .tsext-ob-table .px-ask{
  background: #210b0b !important;
  color: #ff7b86 !important;
}

#tsext-host[data-tsext-theme="contrast"] .tsext-ob-table .px-bid{
  background: #09200f !important;
  color: #63e88b !important;
}

#tsext-host[data-tsext-theme="dark"] .tsext-subtitle{color:#8fc0ff !important}

#tsext-host[data-tsext-theme="contrast"] .tsext-subtitle{color:#7dd3fc !important}

#tsext-host[data-tsext-theme="dark"] .tsext-section-title, #tsext-host[data-tsext-theme="dark"] .tsext-field > label, #tsext-host[data-tsext-theme="dark"] .tsext-settings-hint, #tsext-host[data-tsext-theme="dark"] .tsext-legend, #tsext-host[data-tsext-theme="dark"] .tsext-col{color:#aebbd0 !important}

#tsext-host[data-tsext-theme="contrast"] .tsext-section-title, #tsext-host[data-tsext-theme="contrast"] .tsext-field > label, #tsext-host[data-tsext-theme="contrast"] .tsext-settings-hint, #tsext-host[data-tsext-theme="contrast"] .tsext-legend, #tsext-host[data-tsext-theme="contrast"] .tsext-col{color:#e0e0e0 !important}

#tsext-host[data-tsext-theme="dark"] .tsext-hdr b, #tsext-host[data-tsext-theme="contrast"] .tsext-hdr b{color:#fff !important}

#tsext-host[data-tsext-theme="light"] .tsext-bar:hover{
  border-color: #a5b4fc !important;
  box-shadow: 0 4px 16px color-mix(in srgb, var(--tsext-accent) 12%, transparent), 0 1px 3px color-mix(in srgb, #000 8%, transparent) !important;
}

#tsext-host[data-tsext-theme="light"] .tsext-risk-vlow{
    color: #16a34a !important;
    background: color-mix(in srgb, #22c55e 14%, transparent) !important;
    border-color: color-mix(in srgb, #22c55e 35%, transparent) !important}

#tsext-host[data-tsext-theme="light"] .tsext-risk-low{
    color: #15803d !important;
    background: color-mix(in srgb, #4ade80 12%, transparent) !important;
    border-color: color-mix(in srgb, #4ade80 28%, transparent) !important}

#tsext-host[data-tsext-theme="light"] .tsext-risk-mid{
    color: #a16207 !important;
    background: color-mix(in srgb, #eab308 12%, transparent) !important;
    border-color: color-mix(in srgb, #eab308 30%, transparent) !important}

#tsext-host[data-tsext-theme="light"] .tsext-risk-high{
    color: var(--tsext-sw-mB, #d97706) !important;
    background: color-mix(in srgb, var(--tsext-sw-mB, #d97706) 14%, transparent) !important;
    border-color: color-mix(in srgb, var(--tsext-sw-mB, #d97706) 32%, transparent) !important}

#tsext-host[data-tsext-theme="light"] .tsext-risk-vhigh{
    color: #b91c1c !important;
    background: color-mix(in srgb, #ef4444 16%, transparent) !important;
    border-color: color-mix(in srgb, #ef4444 38%, transparent) !important}

#tsext-host[data-tsext-theme="dark"] .tsext-risk-vlow, #tsext-host[data-tsext-theme="contrast"] .tsext-risk-vlow{ color:#4ade80 !important}

#tsext-host[data-tsext-theme="dark"] .tsext-risk-low, #tsext-host[data-tsext-theme="contrast"] .tsext-risk-low{ color:#86efac !important}

#tsext-host[data-tsext-theme="dark"] .tsext-risk-mid, #tsext-host[data-tsext-theme="contrast"] .tsext-risk-mid{ color:#fde047 !important}

#tsext-host[data-tsext-theme="dark"] .tsext-risk-high, #tsext-host[data-tsext-theme="contrast"] .tsext-risk-high{ color:var(--tsext-sw-mB, #fbbf24) !important}

#tsext-host[data-tsext-theme="light"] .tsext-risk-high,
  #tsext-host[data-tsext-theme="light"] .tsext-cell .val.tsext-risk-high,
  #tsext-host[data-tsext-theme="light"] .tsext-bar-risk.tsext-risk-high {
    color: var(--tsext-sw-mB, #d97706) !important;
  }

#tsext-host[data-tsext-theme="dark"] .tsext-risk-high,
  #tsext-host[data-tsext-theme="dark"] .tsext-cell .val.tsext-risk-high,
  #tsext-host[data-tsext-theme="dark"] .tsext-bar-risk.tsext-risk-high,
  #tsext-host[data-tsext-theme="contrast"] .tsext-risk-high,
  #tsext-host[data-tsext-theme="contrast"] .tsext-cell .val.tsext-risk-high,
  #tsext-host[data-tsext-theme="contrast"] .tsext-bar-risk.tsext-risk-high {
    color: var(--tsext-sw-mB, #fbbf24) !important;
  }

#tsext-host[data-tsext-theme="dark"] .tsext-risk-vhigh, #tsext-host[data-tsext-theme="contrast"] .tsext-risk-vhigh{ color:#fca5a5 !important}

#tsext-host[data-tsext-theme="light"] .tsext-bar-profit.pos{
    color: #16a34a !important;
    background: linear-gradient(135deg, color-mix(in srgb, #22c55e 16%, transparent), color-mix(in srgb, #22c55e 8%, transparent)) !important;
    box-shadow: inset 0 0 0 1px color-mix(in srgb, #22c55e 28%, transparent) !important}

#tsext-host[data-tsext-theme="light"] .tsext-bar-profit.neg{
    color: #dc2626 !important;
    background: linear-gradient(135deg, color-mix(in srgb, #ef4444 14%, transparent), color-mix(in srgb, #ef4444 6%, transparent)) !important;
    box-shadow: inset 0 0 0 1px color-mix(in srgb, #ef4444 28%, transparent) !important}

#tsext-host[data-tsext-theme="dark"] .tsext-bar-profit.pos, #tsext-host[data-tsext-theme="contrast"] .tsext-bar-profit.pos{
  background: linear-gradient(135deg, rgba(34,197,94,.18), rgba(34,197,94,.08)) !important;
  color: #4ade80 !important;
}

#tsext-host[data-tsext-theme="dark"] .tsext-bar-profit.neg, #tsext-host[data-tsext-theme="contrast"] .tsext-bar-profit.neg{
  background: linear-gradient(135deg, rgba(248,113,113,.16), rgba(248,113,113,.06)) !important;
  color: #f87171 !important;
}

#tsext-host[data-tsext-theme="light"] .tsext-cell .val.neg, #tsext-host[data-tsext-theme="light"] #tsext-obpanel-body .tsext-cell .val.neg{
    color: #b91c1c !important}

#tsext-host[data-tsext-theme="light"] .tsext-cell .val.warn, #tsext-host[data-tsext-theme="light"] #tsext-obpanel-body .tsext-cell .val.warn{
    color: #b45309 !important}

#tsext-host[data-tsext-theme="light"] .tsext-bar.active-ob::before{
    color: #fff !important}

#tsext-host[data-tsext-theme="light"] .tsext-cell .val.neg{ color: #b91c1c !important}

#tsext-host[data-tsext-theme="light"] .tsext-cell .val.warn{ color: #b45309 !important}

#tsext-host[data-tsext-theme="dark"] .tsext-cell .val.pos, #tsext-host[data-tsext-theme="contrast"] .tsext-cell .val.pos{
  background: linear-gradient(135deg, rgba(34,197,94,.18), rgba(34,197,94,.06)) !important;
  color: #4ade80 !important;
}

#tsext-host[data-tsext-theme="dark"] .tsext-cell .val.neg, #tsext-host[data-tsext-theme="contrast"] .tsext-cell .val.neg{
  background: linear-gradient(135deg, rgba(248,113,113,.18), rgba(248,113,113,.06)) !important;
  color: #f87171 !important;
}

#tsext-host[data-tsext-theme="dark"] .tsext-cell .val.warn, #tsext-host[data-tsext-theme="contrast"] .tsext-cell .val.warn{
  background: linear-gradient(135deg, rgba(251,191,36,.16), rgba(251,191,36,.05)) !important;
  color: #fbbf24 !important;
}

#tsext-host[data-tsext-theme="contrast"] #tsext-ob-calc .tsext-hero-card .h-lbl{ color:#e0e0e0 !important }

#tsext-host[data-tsext-theme="contrast"] #tsext-ob-calc .tsext-hero-card .h-val{ color:#f5f5f5 !important }

#tsext-host[data-tsext-theme="contrast"] #tsext-ob-calc .tsext-hero-card.pos .h-val,
  #tsext-host[data-tsext-theme="contrast"] #tsext-ob-calc .tsext-hero-card.main.pos .h-val{ color:#86efac !important }

#tsext-host[data-tsext-theme="contrast"] #tsext-ob-calc .tsext-hero-card.neg .h-val,
  #tsext-host[data-tsext-theme="contrast"] #tsext-ob-calc .tsext-hero-card.main.neg .h-val{ color:#fca5a5 !important }

#tsext-host[data-tsext-theme="light"] #pr-wl-add-btn,
  #tsext-host[data-tsext-theme="light"] .pr-wl-add button,
  #tsext-host[data-tsext-theme="light"] [id^="tsext-go-"]{
    color:#ffffff !important;
    -webkit-text-fill-color:#ffffff !important;
    background:#1d4ed8 !important;
    background-image:linear-gradient(135deg,#1d4ed8,#2563eb) !important;
  }

#tsext-host[data-tsext-theme="dark"] #pr-wl-add-btn,
  #tsext-host[data-tsext-theme="contrast"] #pr-wl-add-btn,
  #tsext-host[data-tsext-theme="dark"] .pr-wl-add button,
  #tsext-host[data-tsext-theme="contrast"] .pr-wl-add button,
  #tsext-host[data-tsext-theme="dark"] [id^="tsext-go-"],
  #tsext-host[data-tsext-theme="contrast"] [id^="tsext-go-"]{
    color:#ffffff !important;
    -webkit-text-fill-color:#ffffff !important;
  }

#tsext-host[data-tsext-theme="light"] .tsext-bar-obbtn{
    color:#1e293b !important;
    background:#f1f5f9 !important;
    border-color:#cbd5e1 !important;
  }

#tsext-host[data-tsext-theme="dark"] .tsext-bar-obbtn,
  #tsext-host[data-tsext-theme="contrast"] .tsext-bar-obbtn{
    color:#e2e8f0 !important;
  }

#tsext-host[data-tsext-theme="dark"] .tsext-cols .tsext-col.tsext-bar-profit,
  #tsext-host[data-tsext-theme="dark"] .tsext-cols .tsext-col.tsext-bar-profit.on,
  #tsext-host[data-tsext-theme="dark"] .tsext-cols .tsext-bar-profit {
    color: #8fc0ff !important;
    background: #172033 !important;
    box-shadow: none !important;
  }

#tsext-host[data-tsext-theme="contrast"] .tsext-cols .tsext-col.tsext-bar-profit,
  #tsext-host[data-tsext-theme="contrast"] .tsext-cols .tsext-col.tsext-bar-profit.on,
  #tsext-host[data-tsext-theme="contrast"] .tsext-cols .tsext-bar-profit {
    color: #7dd3fc !important;
    background: #202020 !important;
    box-shadow: none !important;
  }

#tsext-host[data-tsext-theme="dark"] .tsext-cols .tsext-col,
  #tsext-host[data-tsext-theme="dark"] .tsext-cols .tsext-col.on,
  #tsext-host[data-tsext-theme="dark"] .tsext-cols .tsext-col-profit,
  #tsext-host[data-tsext-theme="dark"] .tsext-cols .tsext-cols-actions {
    color: #8fc0ff !important;
    background: #172033 !important;
  }

#tsext-host[data-tsext-theme="dark"] .tsext-sort-arrow { color: #8fc0ff !important; }

#tsext-host[data-tsext-theme="contrast"] .tsext-cols .tsext-col,
  #tsext-host[data-tsext-theme="contrast"] .tsext-cols .tsext-col.on,
  #tsext-host[data-tsext-theme="contrast"] .tsext-cols .tsext-col-profit,
  #tsext-host[data-tsext-theme="contrast"] .tsext-cols .tsext-cols-actions {
    color: #7dd3fc !important;
    background: #202020 !important;
  }

#tsext-host[data-tsext-theme="contrast"] .tsext-sort-arrow { color: #7dd3fc !important; }

#tsext-host[data-tsext-theme="dark"] .tsext-cols .tsext-col.on {
  background: #172033 !important;
  color: #8fc0ff !important;
  font-weight: 800 !important;
  box-shadow: inset 0 -2px 0 #8fc0ff !important;
}

#tsext-host[data-tsext-theme="contrast"] .tsext-cols .tsext-col.on {
  background: #202020 !important;
  color: #7dd3fc !important;
  font-weight: 800 !important;
  box-shadow: inset 0 -2px 0 #7dd3fc !important;
}

#tsext-host[data-tsext-theme="dark"] {
  --tsext-shadow: 0 18px 48px rgba(0,0,0,.58),0 3px 12px rgba(0,0,0,.42),0 0 0 1px rgba(255,255,255,.05);
  color: #dbe4ee !important;
  --tsext-bg: #0a0f16;
  --tsext-panel: #111827;
  --tsext-panel2: #0d1520;
  --tsext-fg: #dbe4ee;
  --tsext-bright: #ffffff;
  --tsext-muted: #aebbd0;
  --tsext-border: #243044;
  --tsext-input: #0c1220;
  --tsext-accent: #6ea8ff;
  --tsext-green: #22c55e;
  --tsext-red: #f87171;
  --tsext-orange: #fbbf24;
  --tsext-sw-a: #34d399;
  --tsext-sw-b: #6ee7b7;
  --tsext-sw-x: #38bdf8;
  --tsext-sw-mb: #fbbf24;
  --tsext-sw-ma: #f87171;
  background: #0a0f16 !important;
  border-color: #243044 !important;
  --tsext-muted: #a8b4c4 !important;
}

#tsext-host[data-tsext-theme="dark"] .tsext-mini,
  #tsext-host[data-tsext-theme="dark"] .tsext-subtitle,
  #tsext-host[data-tsext-theme="dark"] .tsext-empty-sub,
  #tsext-host[data-tsext-theme="dark"] #tsext-status,
  #tsext-host[data-tsext-theme="dark"] .tsext-settings-hint {
    color: #a8b4c4 !important;
    opacity: 1;
  }
  }

  @layer tsext-patches {

/* رنگ‌کوری: سود/زیان فقط با رنگ مشخص نمی‌شود — فلش ▲ / ▼ همراه رنگ */
  #tsext-host .tsext-bar-profit.pos::before,
  #tsext-host .tsext-cell .val.pos::before,
  #tsext-host .tsext-hero-card.pos .h-val::before,
  #tsext-host .tsext-priceinfo b.pos::before,
  #tsext-host .tsext-sum-card .s-val.pos::before{ content:"▲ "; font-size:.72em; font-weight:900; vertical-align:.08em }
  #tsext-host .tsext-bar-profit.neg::before,
  #tsext-host .tsext-cell .val.neg::before,
  #tsext-host .tsext-hero-card.neg .h-val::before,
  #tsext-host .tsext-priceinfo b.neg::before,
  #tsext-host .tsext-sum-card .s-val.neg::before{ content:"▼ "; font-size:.72em; font-weight:900; vertical-align:.08em }

  /* نماد متوقف */
  #tsext-host .tsext-halt-badge,
  #tsext-host .tsext-halt-chip{ display:inline-block; margin-inline-start:6px; padding:1px 6px; border-radius:var(--tsext-r-xs,5px);
    font-size:10.5px; font-weight:800; white-space:nowrap; color:#fff; background:#b45309; border:1px solid #92400e }
  #tsext-host .tsext-bar-halted .tsext-bar-profit{ opacity:.55 }

  /* عنوان کناری (ساخته‌شده در قالب، نه با جابه‌جایی DOM توسط pro.js): در حالت غیر-PRO فقط وضعیت بازار دیده می‌شود */
  html:not(.tsext-pro) #tsext-host .tsext-cap-icon,
  html:not(.tsext-pro) #tsext-host .tsext-cap-text{ display:none }
  html:not(.tsext-pro) #tsext-host #pr-side-caption{ padding:2px 8px }
  html:not(.tsext-pro) #tsext-host #pr-side-caption:not(:has(#tsext-market-wrap:not(:empty))){ display:none }

  /* راهنمای «؟» — عدد و رنگ در دید، توضیح پشت tooltip
     --tsext-text وجود ندارد؛ از --tsext-fg/--tsext-bright استفاده می‌شود تا در تم تیره/کنتراست خوانا بماند. */
  #tsext-host .tsext-help{ display:inline-flex; align-items:center; justify-content:center; width:16px; height:16px; margin-inline-start:6px;
    border-radius:50%; border:1px solid var(--tsext-border); color:var(--tsext-muted); background:transparent;
    font:700 10px/1 inherit; cursor:help; padding:0; vertical-align:middle }
  #tsext-host .tsext-help:hover, #tsext-host .tsext-help:focus-visible{ color:var(--tsext-bright); border-color:currentColor; outline:none }
  #tsext-host .tsext-help-pop, .tsext-help-pop{ position:fixed; z-index:2147483647; max-width:min(340px,86vw); padding:8px 10px; border-radius:6px;
    background:var(--tsext-panel,#111827); color:var(--tsext-fg,#dbe4ee); border:1px solid var(--tsext-border,#243044);
    box-shadow:0 6px 20px rgba(0,0,0,.45); font-size:12px; line-height:1.7; font-weight:600; white-space:pre-line; pointer-events:none }

  /* حالت قیمت: آخرین قیمت / قابل‌اجرا */
  #tsext-host .tsext-pm-badge{ display:inline-block; padding:1px 6px; border-radius:var(--tsext-r-xs,5px); font-size:10.5px; font-weight:800;
    color:var(--tsext-fg); border:1px solid var(--tsext-border) }
  #tsext-host .tsext-pm-badge.exec{ border-color:var(--tsext-accent); color:var(--tsext-accent) }
  #tsext-host .tsext-vol-tag{ font-size:10.5px; font-weight:700; color:var(--tsext-muted) }

  /* سلامت داده */
  #tsext-host .tsext-health-dot{ display:inline-flex; align-items:center; gap:4px; font-size:10.5px; cursor:pointer; color:var(--tsext-muted) }
  #tsext-host .tsext-health-dot i{ width:14px; height:14px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center;
    background:#15803d; color:#fff; font:800 9px/1 inherit; font-style:normal }
  #tsext-host .tsext-health-dot i::before{ content:"✓" }
  #tsext-host .tsext-health-dot.warn i{ background:#b45309 }
  #tsext-host .tsext-health-dot.warn i::before{ content:"!" }
  #tsext-host .tsext-health-dot.bad i{ background:#b91c1c }
  #tsext-host .tsext-health-dot.bad i::before{ content:"✕" }

  /* ========== INSTITUTIONAL UI — پوستهٔ تخت رسمی (روی DELIGHT/POLISH) ========== */
  #tsext-host{
    --tsext-r-sm:6px !important; --tsext-r-md:8px !important; --tsext-r-lg:10px !important; --tsext-r-xl:12px !important;
    background:var(--tsext-bg) !important;
    box-shadow:0 4px 20px rgba(15,23,42,.10), 0 0 0 1px var(--tsext-border) !important;
    letter-spacing:0 !important;
  }
  #tsext-host::after{ display:none; }
  
  #tsext-host #tsext-head::before{
    height:2px; opacity:1;
    background:var(--tsext-accent) !important;
    animation:none !important;
  }
  #tsext-host .tsext-logo{
    background:var(--tsext-accent) !important;
    background-size:auto !important;
    animation:none !important;
    border-radius:6px;
    box-shadow:none !important;
  }
  #tsext-host .tsext-title{ font-weight:700 !important; letter-spacing:0 !important; }
  #tsext-host .tsext-tabs,
  #tsext-host .tsext-tools,
  #tsext-host .tsext-strategy-panel{
    background:var(--tsext-panel) !important;
    box-shadow:none !important;
  }
  
  #tsext-host .tsext-tab.active,
  #tsext-host .tsext-tab.on,
  #tsext-host .tsext-tab[aria-selected="true"]{
    background:var(--tsext-accent) !important; color:#fff !important; box-shadow:none !important;
  }
  #tsext-host .tsext-tab.active::after,
  #tsext-host .tsext-tab.on::after{ display:none; }
  #tsext-host [id^="tsext-go-"]{
    background:var(--tsext-accent) !important;
    box-shadow:none !important;
    border:none !important;
    font-weight:700 !important;
  }
  #tsext-host [id^="tsext-go-"]:hover{ filter:brightness(1.05); transform:none; }
  #tsext-host .tsext-input,
  #tsext-host .tsext-select{
    min-height:30px;
    border:1px solid var(--tsext-border) !important;
    background:var(--tsext-input) !important;
    box-shadow:none !important;
    border-radius:6px;
  }
  #tsext-host .tsext-input:hover,
  #tsext-host .tsext-select:hover{
    border-color:color-mix(in srgb,var(--tsext-accent) 35%,var(--tsext-border)) !important;
    transform:none;
  }
  
  #tsext-host .tsext-cols{
    background:var(--tsext-panel2) !important;
    border:none !important;
    border-bottom:1px solid var(--tsext-border) !important;
    border-radius:0;
    box-shadow:none !important;
    padding:6px 10px;
  }
  #tsext-host .tsext-cols .tsext-col,
  #tsext-host .tsext-cols .tsext-bar-name,
  #tsext-host .tsext-cols .tsext-bar-strike,
  #tsext-host .tsext-cols .tsext-bar-days,
  #tsext-host .tsext-cols .tsext-bar-date,
  #tsext-host .tsext-cols .tsext-bar-risk,
  #tsext-host .tsext-cols .tsext-bar-profit,
  #tsext-host .tsext-cols .tsext-cols-class,
  #tsext-host .tsext-cols .tsext-cols-actions{
    color:var(--tsext-bright) !important;
    background:transparent !important;
    font-weight:700 !important;
    font-size:var(--tsext-fs-sm) !important;
    height:auto;
    letter-spacing:0 !important;
    box-shadow:none !important;
    opacity:1;
  }
  #tsext-host .tsext-cols .tsext-col.on{
    color:var(--tsext-accent) !important;
    background:color-mix(in srgb,var(--tsext-accent) 10%,transparent) !important;
    font-weight:800 !important;
    box-shadow:inset 0 -2px 0 var(--tsext-accent) !important;
  }
  #tsext-host .tsext-bar{
    background:var(--tsext-panel) !important;
    border:1px solid var(--tsext-border) !important;
    border-radius:8px;
    box-shadow:none !important;
    margin-bottom:5px;
    transform:none;
    transition:border-color .12s ease, background .12s ease !important;
  }
  #tsext-host .tsext-bar:hover{
    transform:none;
    border-color:color-mix(in srgb,var(--tsext-accent) 30%,var(--tsext-border)) !important;
    background:var(--tsext-panel) !important;
    box-shadow:none !important;
  }
  #tsext-host .tsext-bar.open,
  #tsext-host .tsext-bar.active-ob{
    border-color:var(--tsext-accent) !important;
    box-shadow:0 0 0 1px color-mix(in srgb,var(--tsext-accent) 22%,transparent) !important;
    transform:none;
  }
  #tsext-host .tsext-bar-name{ font-weight:700 !important; letter-spacing:0 !important; }
  #tsext-host .tsext-bar-profit{ font-weight:700 !important; }
  #tsext-host .tsext-bar-strip{ width:3px; min-width:3px; border-radius:0; }
  #tsext-host .tsext-chip{ font-weight:600 !important; border-radius:4px; box-shadow:none !important; }
  #tsext-host #tsext-list-body{ padding:8px 10px 12px; background:var(--tsext-bg) !important; }
  #tsext-host #tsext-status{
    background:var(--tsext-panel) !important;
    box-shadow:none !important;
    border-top:1px solid var(--tsext-border) !important;
  }
  #tsext-host #tsext-obpanel{
    border-radius:10px;
    box-shadow:0 8px 28px rgba(15,23,42,.14) !important;
    border:1px solid var(--tsext-border) !important;
  }
  #tsext-host .tsext-obpanel-head{
    background:var(--tsext-panel) !important;
    border-bottom:1px solid var(--tsext-border) !important;
    border-radius:10px 10px 0 0;
  }
  #tsext-host .tsext-ob-title{ font-weight:600 !important; background:var(--tsext-panel) !important; }
  #tsext-host .tsext-ob-table .tsext-ob-grouprow th.ask-c,
  #tsext-host .tsext-ob-table .tsext-ob-grouprow th.bid-c{ background:var(--tsext-panel2) !important; }
  #tsext-host .tsext-hero-card,
  #tsext-host .tsext-hero-card.main{
    background:var(--tsext-panel) !important;
    box-shadow:none !important;
    border:1px solid var(--tsext-border) !important;
  }
  #tsext-host .tsext-hero-card.main.pos{ border-color:color-mix(in srgb,var(--tsext-green) 40%,var(--tsext-border)) !important; }
  #tsext-host .tsext-hero-card.main.neg{ border-color:color-mix(in srgb,var(--tsext-red) 40%,var(--tsext-border)) !important; }
  #tsext-host .tsext-empty{ background:var(--tsext-panel) !important; border:1px dashed var(--tsext-border) !important; }
  #tsext-host .tsext-tickmode-note{ background:var(--tsext-panel2) !important; border:1px solid var(--tsext-border) !important; }
  #tsext-host[data-tsext-theme="dark"] .tsext-bar,
  #tsext-host[data-tsext-theme="dark"] .tsext-bar:hover{
    box-shadow:none !important;
    background:var(--tsext-panel) !important;
  }
  #tsext-host[data-tsext-theme="dark"] .tsext-cols{ background:var(--tsext-panel2) !important; }

  /* ----- حس ایزی‌تریدر: دیدهبان فشرده + دفتر سفارش واضح ----- */
  #tsext-host #tsext-head{
  border-bottom: 1px solid var(--tsext-border) !important;
  padding: 10px 12px 9px;
  box-shadow: none !important;
  background: linear-gradient(180deg,#ffffff 0%,#f7f9fc 100%) !important;
}
  #tsext-host[data-tsext-theme="dark"] #tsext-head{
    background:linear-gradient(180deg,#1a222d 0%,#151c26 100%) !important;
  }
  #tsext-host .tsext-bar-main{ padding:8px 10px; }
  #tsext-host .tsext-bar-profit.pos{ color:var(--tsext-green) !important; }
  #tsext-host .tsext-bar-profit.neg{ color:var(--tsext-red) !important; }
  #tsext-host .tsext-ob-table .px-ask{ color:var(--tsext-red) !important; font-weight:700 !important; }
  #tsext-host .tsext-ob-table .px-bid{ color:var(--tsext-green) !important; font-weight:700 !important; }
  #tsext-host .tsext-ob-table .vol-bar.ask{
    background:linear-gradient(90deg,transparent,color-mix(in srgb,var(--tsext-red) 55%,transparent)) !important;
    opacity:.35;
  }
  #tsext-host .tsext-ob-table .vol-bar.bid{
    background:linear-gradient(90deg,color-mix(in srgb,var(--tsext-green) 55%,transparent),transparent) !important;
    opacity:.35;
  }
  #tsext-host .tsext-ob-table tbody tr.tsext-ob-best td{
    background:color-mix(in srgb,var(--tsext-accent) 6%,transparent) !important;
  }
  #tsext-host .tsext-ob-table .tsext-ob-grouprow th.ask-c{
    color:var(--tsext-red) !important;
    background:color-mix(in srgb,var(--tsext-red) 8%,var(--tsext-panel2)) !important;
  }
  #tsext-host .tsext-ob-table .tsext-ob-grouprow th.bid-c{
    color:var(--tsext-green) !important;
    background:color-mix(in srgb,var(--tsext-green) 8%,var(--tsext-panel2)) !important;
  }
  #tsext-host .tsext-rangebar-track .rb-band{ border-radius:2px; height:7px; top:8.5px; }
  #tsext-host .tsext-rangebar-track .rb-wick{ height:1.5px; top:11px; }
  #tsext-host .tsext-tabs{
    background:var(--tsext-panel2) !important;
    border-radius:6px;
    padding:3px;
    gap:2px;
  }
  #tsext-host .tsext-tab{
  font-weight: 600 !important;
  box-shadow: none !important;
  border-radius: 4px;
  padding: 5px 10px;
}
  #tsext-host .tsext-tab.active{
    background:var(--tsext-panel) !important;
    color:var(--tsext-accent) !important;
    box-shadow:0 1px 2px rgba(15,23,42,.08) !important;
    font-weight:700 !important;
  }
  #tsext-host #tsext-display-settings{
    background:var(--tsext-panel) !important;
    border-bottom:1px solid var(--tsext-border) !important;
  }

  /* ----- رفع متن ناپیدا روی کلیک/فعال (تم روشن و همهٔ تم‌ها) ----- */
  /* مشکل: بعضی قوانین color:#fff روی تب فعال + پس‌زمینه سفید از لایهٔ بعدی → متن محو */
  #tsext-host .tsext-tab,
  #tsext-host .tsext-modes-row .tsext-tab,
  #tsext-host .tsext-jamp-modes .tsext-tab{
    color:var(--tsext-fg) !important;
    background:transparent !important;
    opacity:1;
  }
  #tsext-host .tsext-tab:hover,
  #tsext-host .tsext-modes-row .tsext-tab:hover,
  #tsext-host .tsext-jamp-modes .tsext-tab:hover{
    color:var(--tsext-bright) !important;
    background:color-mix(in srgb,var(--tsext-accent) 12%,var(--tsext-panel)) !important;
    transform:none;
  }
  #tsext-host .tsext-tab.active,
  #tsext-host .tsext-tab.on,
  #tsext-host .tsext-tab[aria-selected="true"],
  #tsext-host .tsext-modes-row .tsext-tab.active,
  #tsext-host .tsext-jamp-modes .tsext-tab.active,
  #tsext-host .tsext-tick-mode.active{
    color:#ffffff !important;
    background:var(--tsext-accent) !important;
    box-shadow:none !important;
    opacity:1;
  }
  #tsext-host .tsext-tab.active:hover,
  #tsext-host .tsext-modes-row .tsext-tab.active:hover,
  #tsext-host .tsext-jamp-modes .tsext-tab.active:hover{
    color:#ffffff !important;
    background:var(--tsext-accent) !important;
    filter:brightness(1.06);
  }
  /* محتوای زیرحالت‌ها و پنل استراتژی همیشه خوانا */
  #tsext-host .tsext-strategy-panel,
  #tsext-host .tsext-jamp-sub,
  #tsext-host .tsext-tick-sub{
    color:var(--tsext-fg) !important;
  }
  #tsext-host .tsext-strategy-panel label,
  #tsext-host .tsext-jamp-sub label,
  #tsext-host .tsext-tick-sub label,
  #tsext-host .tsext-field > label,
  #tsext-host .tsext-ds-inline,
  #tsext-host .tsext-ds-inline .tsext-mini{
    color:var(--tsext-fg) !important;
    opacity:1;
  }
  #tsext-host .tsext-ds-inline .tsext-mini{ color:var(--tsext-muted) !important; }
  #tsext-host .tsext-input,
  #tsext-host .tsext-select,
  #tsext-host select.tsext-ds-select{
    color:var(--tsext-bright) !important;
    background:var(--tsext-input) !important;
    -webkit-text-fill-color:var(--tsext-bright) !important;
  }
  #tsext-host .tsext-input:focus,
  #tsext-host .tsext-select:focus{
  border-color: var(--tsext-accent) !important;
  box-shadow: 0 0 0 2px color-mix(in srgb,var(--tsext-accent) 18%,transparent) !important;
  transform: none;
  color: var(--tsext-bright) !important;
  -webkit-text-fill-color: var(--tsext-bright) !important;
  background: var(--tsext-input) !important;
}
  #tsext-host .tsext-tickmode-note,
  #tsext-host .tsext-tickmode-note *{
    color:var(--tsext-fg) !important;
    opacity:1;
  }
  #tsext-host .tsext-btn{
    color:var(--tsext-fg) !important;
  }
  #tsext-host .tsext-btn:hover{
    color:var(--tsext-bright) !important;
  }
  #tsext-host [id^="tsext-go-"],
  #tsext-host .tsext-btn.primary{
    color:#ffffff !important;
  }
  #tsext-host .tsext-chip:not(.tsext-class-tog),
  #tsext-host .tsext-legend .tsext-chip:not(.tsext-class-tog){
    color:inherit !important;
    opacity:1;
  }

  /* ----- فیلتر کلاس: سگمنت بزرگ با حالت روشن/خاموش واضح ----- */
  #tsext-host .tsext-class-seg{
    display:flex;
    flex-wrap:wrap;
    align-items:center;
    gap:6px;
    padding:0;
    margin:0;
    background:transparent !important;
    border:none !important;
  }
  #tsext-host .tsext-class-seg-lbl{
    font-size:var(--tsext-fs-xs) !important;
    font-weight:800 !important;
    color:var(--tsext-muted) !important;
    margin-inline-end:2px;
    flex-shrink:0;
  }
  #tsext-host .tsext-class-tog,
  #tsext-host .tsext-legend .tsext-class-tog{
    display:inline-flex;
    align-items:center;
    justify-content:center;
    gap:5px;
    min-width:52px;
    min-height:32px;
    padding:5px 12px;
    border-radius:8px;
    border:2px solid var(--chip, var(--tsext-border)) !important;
    font:inherit !important;
    font-size:var(--tsext-fs-md) !important;
    font-weight:800 !important;
    line-height:1 !important;
    cursor:pointer !important;
    user-select:none !important;
    transition:background .12s ease, color .12s ease, border-color .12s ease, box-shadow .12s ease, opacity .12s ease !important;
    box-shadow:none !important;
    opacity:1;
    text-decoration:none !important;
    -webkit-text-fill-color:unset !important;
  }
  #tsext-host .tsext-class-tog .tsext-chip-mark{
    font-size:13px !important;
    font-weight:900 !important;
    line-height:1 !important;
  }
  #tsext-host .tsext-class-tog .tsext-chip-lab{
    font-weight:800 !important;
    letter-spacing:.02em !important;
  }
  #tsext-host .tsext-class-tog.on,
  #tsext-host .tsext-legend .tsext-class-tog.on{
    background:var(--chip) !important;
    border-color:var(--chip) !important;
    color:#fff !important;
    box-shadow:0 1px 4px color-mix(in srgb, var(--chip) 35%, transparent) !important;
  }
  #tsext-host .tsext-class-tog.on .tsext-chip-mark,
  #tsext-host .tsext-class-tog.on .tsext-chip-lab{
    color:#fff !important;
  }
  #tsext-host .tsext-class-tog.off,
  #tsext-host .tsext-legend .tsext-class-tog.off{
    background:var(--tsext-panel) !important;
    border-color:color-mix(in srgb, var(--chip) 35%, var(--tsext-border)) !important;
    border-style:dashed !important;
    color:var(--tsext-muted) !important;
    opacity:.72;
    box-shadow:none !important;
  }
  #tsext-host .tsext-class-tog.off .tsext-chip-mark,
  #tsext-host .tsext-class-tog.off .tsext-chip-lab{
    color:var(--tsext-muted) !important;
  }
  #tsext-host .tsext-class-tog:hover{ filter:brightness(1.05); }
  #tsext-host .tsext-class-tog.off:hover{
    opacity:1;
    border-color:var(--chip) !important;
    color:var(--chip) !important;
  }
  #tsext-host .tsext-class-tog.off:hover .tsext-chip-mark,
  #tsext-host .tsext-class-tog.off:hover .tsext-chip-lab{
    color:var(--chip) !important;
  }
  #tsext-display-settings .tsext-class-filter-host{ overflow:visible; }
  #tsext-display-settings .tsext-class-filter-host .tsext-legend{
    flex-wrap:wrap;
    overflow:visible;
  }
  
  }


/* ---- چگالی دستی فشرده (جدا از auto-compact عرض) ---- */

#tsext-host.tsext-density-compact .tsext-bar{
  margin-bottom: 4px;
  border-radius: var(--tsext-r-sm);
}
#tsext-host.tsext-density-compact .tsext-bar-main{
  padding-block: 6px;
  padding-inline: 9px;
}
#tsext-host.tsext-density-compact .tsext-bar-profit{
  font-size: var(--tsext-fs-sm) !important;
  padding: 2px 6px;
}
#tsext-host.tsext-density-compact .tsext-cols{
  padding-block: 5px 4px;
  padding-inline: 9px;
}
#tsext-host.tsext-density-compact .tsext-bar-cell{
  font-size: var(--tsext-fs-sm);
}
#tsext-host.tsext-density-compact .tsext-bar-open,
#tsext-host.tsext-density-compact .tsext-bar-fav{
  width: 18px; height: 18px;
}

/* اسکلتون روی لیست قبلی هنگام تعویض نماد */
#tsext-list.tsext-list-loading > .tsext-bar{
  opacity: 0.38;
  pointer-events: none;
  filter: grayscale(0.25);
  transition: opacity .2s ease;
}
#tsext-list.tsext-list-loading > .tsext-skel-overlay{
  position: sticky;
  top: 0;
  z-index: 5;
  padding: 8px 12px;
  text-align: center;
  font-size: var(--tsext-fs-sm);
  font-weight: 800;
  color: var(--tsext-accent);
  background: color-mix(in srgb, var(--tsext-panel) 88%, transparent);
  border-bottom: 1px solid color-mix(in srgb, var(--tsext-accent) 30%, transparent);
  backdrop-filter: blur(2px);
}

/* ردیف داده ناقص / بدون صف قابل‌اجرا — کم‌رنگ، حذف‌نشده */
.tsext-bar.tsext-incomplete{
  opacity: 0.55;
}
.tsext-bar.tsext-incomplete .tsext-bar-profit{
  color: var(--tsext-muted) !important;
  background: transparent !important;
}

/* اعداد کمی کهنه (سن داده > ۳ث) — ملایم */
#tsext-host.tsext-data-stale .tsext-bar-profit,
#tsext-host.tsext-data-stale .tsext-bar-cell.tsext-bar-strike{
  opacity: 0.82;
}
#tsext-host.tsext-data-stale .tsext-bar-profit{
  transition: opacity .35s ease;
}

/* نشان کوچک کارمزد کنار فیلد */
.tsext-comm-hint{
  font-size: var(--tsext-fs-xxs);
  font-weight: 700;
  color: var(--tsext-muted);
  margin-inline-start: 4px;
  white-space: nowrap;
}
`;

  function ensureStyleBlock() {
    let s = document.getElementById('tsext-style');
    if (!s) {
      s = document.createElement('style');
      s.id = 'tsext-style';
      document.head.appendChild(s);
    }
    s.textContent = '@layer tsext-tokens, tsext-base, tsext-components, tsext-theme, tsext-patches, tsext-pro;\n' + CSS;
    // استایل دکمه شناور حذف شد — محصول فقط panel.html است
  }

  // ----- from src/06b-mirror-rtl.js -----
  // --------------------------------------------------------- آینه/راست‌چین
  // با یک کلیک: کل پنل (متن، چیدمان داخلی ستون‌ها/ردیف‌ها) راست‌به‌چپ می‌شود، پنل به لبهٔ راست
  // دسکتاپ می‌چسبد، و چون پنل جزئیات همیشه در فضای خالیِ بیشتر باز می‌شود، خودش از سمت چپ ظاهر خواهد شد
  function applyMirror() {
    if (!panelHost) return;
    const on = isMirror();
    panelHost.classList.toggle('tsext-mirror', on);
    panelHost.setAttribute('dir', on ? 'rtl' : 'ltr');
    try {
      document.body.classList.toggle('tsext-side-right', !!on);
      document.body.classList.toggle('tsext-side-left', !on);
    } catch (e) {}
    const btn = $id(panelHost, 'tsext-mirror-btn');
    const lbl = $id(panelHost, 'tsext-mirror-label');
    if (lbl) lbl.textContent = on ? 'راست' : 'چپ';
    if (btn) btn.title = on ? 'برگشت به چیدمان چپ (پیش‌فرض)' : 'راست‌چین‌کردن پنل (آینه‌ای)';
  }
  function setMirror(on) {
    try { lsSet('tsext-mirror', on ? '1' : '0'); } catch (e) {}
    applyMirror();
    // چسباندن شناور به لبه حذف شد (محصول تمام‌صفحه است)
    if (state.obInsCode) placeOrderBookPanel();
  }

  // makeDraggable حذف شد (پنل شناور دیگر نیست)

  // makeResizable حذف شد

  function ensureFontFace() {
    if (document.getElementById('tsext-fontface')) return;
    // فونت متغیر Vazirmatn همراه افزونه — preload وووف۲ تا پرش فونت کمتر شود
    let cssHref = '', woffHref = '';
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.getURL === 'function') {
        cssHref = chrome.runtime.getURL('fonts/vazirmatn.css');
        woffHref = chrome.runtime.getURL('fonts/vazirmatn.woff2');
      }
    } catch (e) {}
    if (!cssHref) return;
    if (woffHref && !document.getElementById('tsext-font-preload')) {
      const pre = document.createElement('link');
      pre.id = 'tsext-font-preload';
      pre.rel = 'preload';
      pre.as = 'font';
      pre.type = 'font/woff2';
      pre.href = woffHref;
      pre.crossOrigin = 'anonymous';
      document.head.appendChild(pre);
    }
    const link = document.createElement('link');
    link.id = 'tsext-fontface';
    link.rel = 'stylesheet';
    link.href = cssHref;
    document.head.appendChild(link);
  }

  function ensureSidebar() {
    // در PRO فقط وجود host کافی است (دکمه شناور دیگر ساخته نمی‌شود)
    if (panelHost && document.body.contains(panelHost)) return panelHost;
    // بازسازی پنل
    if (panelHost && document.body && document.body.contains(panelHost)) {
      try { saveSettings(); } catch (e) {}
      try { panelHost.remove(); } catch (e) {}
    }
    ensureFontFace();
    ensureStyleBlock();
    panelHost = document.createElement('div');
    panelHost.id = 'tsext-host';
    panelHost.setAttribute('data-tsext-shell', 'product');
    try { panelHost.setAttribute('data-tsext-theme', lsGet('tsext-theme') || 'light'); } catch (e) {}
    // محصول: panel.html تمام‌صفحه
    panelHost.style.cssText = 'display:flex;';
    panelHost.innerHTML = `
      <div id="tsext-maincol">
      <div id="tsext-head">
        <div id="pr-side-caption" class="tsext-side-caption"><span class="tsext-cap-icon" aria-hidden="true">◈</span><span class="tsext-cap-text">استراتژی‌های معاملاتی</span><span id="tsext-market-wrap"></span></div>
        <div class="tsext-titlebar">
          <div class="tsext-brand">
            <span class="tsext-logo">◈</span>
            <div>
              <div class="tsext-title">دستیار هوشمند آپشن</div>
              <div class="tsext-subtitle">پیشنهاد فرصت · مثبت‌پنج · ترکیبی · جامپ</div>
            </div>
          </div>
          <div class="tsext-tools">
            <button id="tsext-fs-dec" class="tsext-btn" title="کوچک‌تر">A−</button>
            <button id="tsext-fs-inc" class="tsext-btn" title="بزرگ‌تر">A+</button>
            <button id="tsext-theme-cycle" class="tsext-btn" title="تم: روشن / تیره / کنتراست">◐ <span id="tsext-theme-cycle-label">روشن</span></button>
            <button id="tsext-mirror-btn" class="tsext-btn" title="راست‌چین‌کردن پنل (آینه‌ای)">⇄ <span id="tsext-mirror-label">چپ</span></button>
            <button id="tsext-close" class="tsext-btn tsext-close" title="بستن">✕</button>
          </div>
        </div>
        <div class="tsext-row" id="tsext-market-row">
          <span id="tsext-updated"></span>
          <span id="tsext-errbadge" title=""></span>
        </div>
        <div class="tsext-row">
          <div class="tsext-tabs" id="tsext-tabs">
            <button type="button" class="tsext-tab" data-s="pospanj" title="اعمال‌های با احتمال بازگشت سرمایه بالای ۵٪ در ماه">مثبت‌پنج</button>
            <button type="button" class="tsext-tab" data-s="combo" title="خرید اعمال نزدیک‌سررسید و فروش اعمال با سررسید بلندتر">معاملات ترکیبی</button>
            <button type="button" class="tsext-tab" data-s="jamp" title="مقایسهٔ بازدهی/مدیریت جامپ بین اعمال‌های زنجیره">فرصت‌های جامپ</button>
          </div>
        </div>

        <div class="tsext-strategy-panel" id="tsext-panel-pospanj" data-strategy="pospanj">
          <div class="tsext-row">
            <input id="tsext-underlying-pospanj" class="tsext-input" placeholder="نماد پایه + Enter" style="flex:1;">
          </div>
          <div class="tsext-settings-body">
            <div class="tsext-settings-grid tsext-settings-grid-compact">
              <div class="tsext-field">
                <label class="tsext-mini" for="tsext-manual-pospanj" title="قیمت زندهٔ نماد پایه از TSETMC می‌آید؛ قیمت دستی (اختیاری) فقط برای دقت بیشتر">قیمت دستی</label>
                <input id="tsext-manual-pospanj" class="tsext-input tsext-num" type="text" inputmode="decimal" placeholder="اختیاری" value="">
              </div>
              <div class="tsext-field tsext-field-secondary">
                <label class="tsext-mini" for="tsext-comm-pospanj" title="اختیاری — فقط در صورت وارد کردن روی سود ماهانه اعمال می‌شود">کارمزد٪</label>
                <input id="tsext-comm-pospanj" class="tsext-input tsext-num" type="text" inputmode="decimal" placeholder="۰" value=""><span class="tsext-comm-hint" title="اگر خالی بماند در محاسبه صفر در نظر گرفته می‌شود">کارمزد: ۰٪</span>
              </div>
            </div>
            <div class="tsext-tickmode-note" title="مثبت‌پنج (Covered Call): سهم پایه را می‌خریم و اختیار خرید می‌فروشیم. سرمایه درگیر = قیمت سهم با کارمزد − پرمیوم دریافتی. سود = اعمال + پرمیوم − قیمت سهم با کارمزد. سود ماهانه = سود٪ / روز × ۳۰. بدون اعمال هم سود پرمیوم حساب می‌شود."><span>◈</span><span><b>مثبت‌پنج (Covered Call):</b> سهم می‌خریم و اختیار خرید می‌فروشیم. سرمایه درگیر = قیمت سهم − پرمیوم؛ سود ماهانه = سود٪ / روز × ۳۰.</span></div>
          </div>
        </div>

        <div class="tsext-strategy-panel" id="tsext-panel-combo" data-strategy="combo">
          <div class="tsext-row">
            <input id="tsext-underlying-combo" class="tsext-input" placeholder="نماد پایه + Enter" style="flex:1;">
          </div>
          <div class="tsext-settings-body">
            <div class="tsext-row">
              <label class="tsext-mini" for="tsext-combo-buy" title="فقط قراردادهای با کمتر از ۱۰ روز تا سررسید — جایگزین خرید سهم">قرارداد خرید</label>
              <select id="tsext-combo-buy" class="tsext-input tsext-select" title="فقط قراردادهای با کمتر از ۱۰ روز تا سررسید — جایگزین خرید سهم">
                <option value="">ابتدا نماد را جستجو کنید</option>
              </select>
            </div>
            <div class="tsext-settings-grid tsext-settings-grid-compact">
              <div class="tsext-field tsext-field-secondary">
                <label class="tsext-mini" for="tsext-comm-combo" title="اختیاری — فقط در صورت وارد کردن روی سود ماهانه اعمال می‌شود">کارمزد٪</label>
                <input id="tsext-comm-combo" class="tsext-input tsext-num" type="text" inputmode="decimal" placeholder="۰" value=""><span class="tsext-comm-hint" title="اگر خالی بماند در محاسبه صفر در نظر گرفته می‌شود">کارمزد: ۰٪</span>
              </div>
            </div>
            <div class="tsext-tickmode-note" title="معاملات ترکیبی: قرارداد خرید (<۱۰ روز) جایگزین خرید سهم می‌شود. سهم پایه جدید = اعمال خرید + پرمیوم خرید زنده. سپس قراردادهای با سررسید بیشتر مثل مثبت‌پنج محاسبه می‌شوند. فقط فروش با روز بیشتر بررسی می‌شود."><span>◈</span><span><b>معاملات ترکیبی:</b> قرارداد خرید (<۱۰ روز) جای خرید سهم می‌نشیند؛ سهم پایه = اعمال خرید + پرمیوم زنده. فروش فقط با سررسید دورتر.</span></div>
          </div>
        </div>

        <div class="tsext-strategy-panel" id="tsext-panel-jamp" data-strategy="jamp">
          <div class="tsext-row">
            <input id="tsext-underlying-jamp" class="tsext-input" placeholder="نماد پایه + Enter" style="flex:1;">
          </div>
          <div class="tsext-row tsext-modes-row" id="tsext-jamp-modes">
            <button type="button" class="tsext-tab active" data-jampmode="yield" title="📌 بازدهی&#10;قرارداد فعلی‌تان را از زنجیره انتخاب کنید تا به سررسید دورتر جامپ کنید.&#10;سود مثل مثبت‌پنج محاسبه می‌شود.">بازدهی</button>
            <button type="button" class="tsext-tab" data-jampmode="downshift" title="📌 جامپ (کاهش اعمال و سرمایه درگیر)&#10;قرارداد جاری را از فهرست انتخاب کنید و پرمیوم دریافتی‌اش را وارد کنید.&#10;فقط قراردادهای با اعمال کمتر از جاری بررسی می‌شوند.&#10;قیمت سهم پایه = اعمال جاری + (بازخرید زنده − پرمیوم دریافتی)&#10;سپس هر قرارداد با پرمیوم زنده، اعمال و روزماندهٔ خودش مثل مثبت‌پنج (بدون کارمزد) محاسبه می‌شود.&#10;حتی با سود صفر، سرمایه درگیر کم می‌شود و پول آزاد می‌شود.">کاهش اعمال و سرمایه درگیر</button>
            <button type="button" class="tsext-tab" data-jampmode="upshift" title="📌 جامپ (افزایش اعمال و سود)&#10;قرارداد جاری را از فهرست انتخاب کنید و پرمیوم دریافتی‌اش را وارد کنید.&#10;فقط قراردادهای با اعمال بالاتر از جاری بررسی می‌شوند.&#10;قیمت سهم پایه = اعمال جاری + (بازخرید زنده − پرمیوم دریافتی)&#10;سپس هر قرارداد با پرمیوم زنده، اعمال و روزماندهٔ خودش مثل مثبت‌پنج (بدون کارمزد) محاسبه می‌شود.">افزایش اعمال و سود</button>
            <button type="button" class="tsext-tab" data-jampmode="challenge" title="📌 چالشی&#10;قرارداد جاری را از فهرست انتخاب کنید و پرمیومی که بابت آن گرفته‌اید را وارد کنید.&#10;قیمت سهم پایه = اعمال جاری + (بازخرید زندهٔ قرارداد جاری − پرمیوم دریافتی)&#10;سپس هر قرارداد با پرمیوم زنده، اعمال و روزماندهٔ خودش مثل مثبت‌پنج محاسبه می‌شود — بدون کارمزد (سهمی خریده نمی‌شود).">چالشی</button>
          </div>
          <div class="tsext-settings-body">
            <!-- v1.25.1: فرصت‌های جامپ فیلد کارمزد ندارد — در هر چهار زیرحالت سهمی خریده/فروخته نمی‌شود و همهٔ محاسبات با کارمزد صفر است -->
            <div class="tsext-jamp-sub active" id="tsext-jamp-sub-yield" data-jampsub="yield">
              <div class="tsext-row">
                <select id="tsext-jamp-old-yield" class="tsext-input tsext-select" style="flex:1;" title="قرارداد فعلی‌تان را از زنجیره انتخاب کنید — فقط قراردادهای با سررسید دورتر بررسی می‌شوند">
                  <option value="">قرارداد فعلی (زنده)</option>
                </select>
              </div>
              <div class="tsext-tickmode-note" title="بازدهی (بدون فیلد دستی): قرارداد جاری را از فهرست انتخاب کنید — اعمال، پرمیوم آفست و روزمانده همه از قیمت زندهٔ همان قرارداد می‌آید. فقط قراردادهای با روز مانده بیشتر از جاری بررسی می‌شوند. فرمول: سهم پایه جدید = اعمال جاری + پرمیوم آفست زنده · سپس مثل مثبت‌پنج با کارمزد صفر محاسبه می‌شود (سود ماهانه). هیچ فیلد دستی اضافی ندارد — محاسبات دقیقاً مثل قبل است."><span>◈</span><span><b>بازدهی (بدون فیلد دستی):</b> قرارداد جاری را انتخاب کنید؛ سهم پایه جدید = اعمال جاری + پرمیوم آفست زنده. فقط سررسیدهای دورتر، بدون کارمزد.</span></div>
            </div>

            <div class="tsext-jamp-sub" id="tsext-jamp-sub-downshift" data-jampsub="downshift">
              <div class="tsext-row">
                <select id="tsext-jamp-old-downshift" class="tsext-input tsext-select" title="قرارداد جاری: قراردادی که الان فروخته‌اید و می‌خواهید به اعمال پایین‌تر بروید — اعمال و پرمیوم بازخرید زنده‌اش از همین‌جا خوانده می‌شود">
                  <option value="">ابتدا نماد را جستجو کنید</option>
                </select>
              </div>
              <div class="tsext-settings-grid tsext-jamp-manual-grid">
                <div class="tsext-field tsext-field-wide">
                  <label class="tsext-mini tsext-mini-wrap" for="tsext-jamp-recv-premium-d" title="پرمیومی که هنگام فروش قرارداد جاری دریافت کرده‌اید — هر سهم، به ریال">پرمیوم دریافتی قرارداد جاری (ریال)</label>
                  <input id="tsext-jamp-recv-premium-d" class="tsext-input tsext-num" type="text" inputmode="decimal" placeholder="ریال" title="پرمیوم دریافتی هنگام فروش قرارداد جاری (هر سهم، ریال) — از بازخرید زنده کم می‌شود">
                </div>
              </div>
              <div class="tsext-tickmode-note" title="جامپ (کاهش اعمال و سرمایه درگیر): قرارداد جاری را از فهرست انتخاب کنید و پرمیوم دریافتی آن را (ریال) وارد کنید. فقط قراردادهای با اعمال کمتر از جاری بررسی می‌شوند. فرمول: قیمت سهم پایه = اعمال جاری + (بازخرید زندهٔ جاری − پرمیوم دریافتی) — مثل چالشی. هر کاندید با پرمیوم زندهٔ خودش، اعمال و روزماندهٔ خودش (روز = روز کاندید) با همان اکسل مثبت‌پنج و بدون کارمزد ارزیابی می‌شود. هدف: حتی اگر سود ماهانه صفر باشد، سرمایه درگیر کم می‌شود و پول آزاد می‌شود — مقدار آزادشده = اعمال جاری − اعمال جدید."><span>◈</span><span><b>جامپ (کاهش اعمال و سرمایه درگیر):</b> قرارداد جاری و پرمیوم دریافتی را وارد کنید. قیمت سهم پایه = اعمال جاری + (بازخرید زنده − پرمیوم دریافتی)؛ فقط اعمال‌های کمتر، بدون کارمزد.</span></div>
            </div>

            <div class="tsext-jamp-sub" id="tsext-jamp-sub-upshift" data-jampsub="upshift">
              <div class="tsext-row">
                <select id="tsext-jamp-old-upshift" class="tsext-input tsext-select" title="قرارداد جاری: قراردادی که الان فروخته‌اید و می‌خواهید به اعمال بالاتر بروید — اعمال و پرمیوم بازخرید زنده‌اش از همین‌جا خوانده می‌شود">
                  <option value="">ابتدا نماد را جستجو کنید</option>
                </select>
              </div>
              <div class="tsext-settings-grid tsext-jamp-manual-grid">
                <div class="tsext-field tsext-field-wide">
                  <label class="tsext-mini tsext-mini-wrap" for="tsext-jamp-recv-premium-u" title="پرمیومی که هنگام فروش قرارداد جاری دریافت کرده‌اید — هر سهم، به ریال">پرمیوم دریافتی قرارداد جاری (ریال)</label>
                  <input id="tsext-jamp-recv-premium-u" class="tsext-input tsext-num" type="text" inputmode="decimal" placeholder="ریال" title="پرمیوم دریافتی هنگام فروش قرارداد جاری (هر سهم، ریال) — از بازخرید زنده کم می‌شود">
                </div>
              </div>
              <div class="tsext-tickmode-note" title="جامپ (افزایش اعمال و سود): قرارداد جاری را از فهرست انتخاب کنید و پرمیوم دریافتی آن را وارد کنید. فقط قراردادهای با اعمال بالاتر از جاری بررسی می‌شوند. فرمول: قیمت سهم پایه = اعمال جاری + (بازخرید زندهٔ جاری − پرمیوم دریافتی) — دقیقاً مثل کاهش اعمال. هر کاندید با پرمیوم زندهٔ خودش، اعمال و روزماندهٔ خودش (روز = روز کاندید) با همان اکسل مثبت‌پنج و بدون کارمزد ارزیابی می‌شود. هدف: اعمال بالاتر → سود ماهانه بیشتر."><span>◈</span><span><b>جامپ (افزایش اعمال و سود):</b> قرارداد جاری و پرمیوم دریافتی را وارد کنید. فقط اعمال‌های بالاتر، بدون کارمزد؛ هدف: سود ماهانه بیشتر.</span></div>
            </div>

            <div class="tsext-jamp-sub" id="tsext-jamp-sub-challenge" data-jampsub="challenge">
              <div class="tsext-row">
                <select id="tsext-jamp-old-challenge" class="tsext-input tsext-select" title="قرارداد جاری: قراردادی که الان فروخته‌اید و در چالش است — اعمال و پرمیوم بازخرید زنده‌اش از همین‌جا خوانده می‌شود">
                  <option value="">ابتدا نماد را جستجو کنید</option>
                </select>
              </div>
              <div class="tsext-settings-grid tsext-jamp-manual-grid">
                <div class="tsext-field tsext-field-wide">
                  <label class="tsext-mini tsext-mini-wrap" for="tsext-jamp-recv-premium" title="پرمیومی که هنگام فروش قرارداد جاری دریافت کرده‌اید — هر سهم، به ریال">پرمیوم دریافتی قرارداد جاری (ریال)</label>
                  <input id="tsext-jamp-recv-premium" class="tsext-input tsext-num" type="text" inputmode="decimal" placeholder="ریال" title="پرمیوم دریافتی هنگام فروش قرارداد جاری (هر سهم، ریال) — از بازخرید زنده کم می‌شود">
                </div>
              </div>
              <div class="tsext-tickmode-note" title="چالشی: قرارداد جاری را از فهرست انتخاب کنید و پرمیوم دریافتی آن را وارد کنید. فرمول: قیمت سهم پایه = اعمال جاری + (بازخرید زندهٔ جاری − پرمیوم دریافتی) · سپس هر قرارداد زنجیره (هر اعمال، هر سررسید به‌جز خودِ جاری) با پرمیوم زندهٔ خودش، اعمال و روزماندهٔ خودش مثل مثبت‌پنج و بدون کارمزد (سهمی خریده نمی‌شود) محاسبه می‌شود. خالص پرداختی = بازخرید − دریافتی."><span>◈</span><span><b>چالشی:</b> قرارداد جاری و پرمیوم دریافتی را وارد کنید. قیمت سهم پایه = اعمال جاری + (بازخرید زنده − پرمیوم دریافتی)؛ بقیهٔ زنجیره بدون کارمزد بررسی می‌شود.</span></div>
            </div>
          </div>
        </div>

        

        <div id="tsext-priceinfo" class="tsext-priceinfo"></div>
      </div>
<div id="tsext-list" role="table" aria-label="فهرست قراردادهای اختیار"><div id="tsext-display-settings" class="tsext-display-settings" title="تنظیمات نمایش">
          <div class="tsext-ds-row tsext-ds-row-controls">
            <label class="tsext-ds-inline" title="معیار مرتب‌سازی">
              <span class="tsext-mini">ترتیب</span>
              <select id="tsext-sort" class="tsext-input tsext-select tsext-ds-select">
                <option value="profit">بیشترین سود</option>
                <option value="date">تاریخ اعمال</option>
                <option value="strike">قیمت اعمال</option>
                <option value="class">کلاس‌بندی</option>
              </select>
            </label>
            <label class="tsext-ds-inline" title="مبنای قیمت محاسبه">
              <span class="tsext-mini">قیمت</span>
              <select id="tsext-price-mode" class="tsext-input tsext-select tsext-ds-select" title="مبنای قیمت محاسبات — روی همهٔ فرصت‌ها اثر می‌گذارد">
                <option value="last">تابلو · آخرین معامله</option>
                <option value="exec">صف · قابل‌اجرا (ask/bid)</option>
              </select>
              <button type="button" class="tsext-help" aria-label="راهنما" data-help="تابلو · آخرین معامله: عدد آخرین معامله روی تابلو (پیش‌فرض، سریع‌تر) — ممکن است با قیمت واقعی معاملهٔ شما فرق کند.&#10;&#10;صف · قابل‌اجرا: خرید با بهترین فروش (ask) و فروش با بهترین خرید (bid) از دفتر سفارش + حجم قابل‌معامله. اگر صف خالی باشد آن ردیف کنار گذاشته می‌شود.&#10;&#10;با عوض کردن حالت، لیست و جزئیات فوراً از نو حساب می‌شوند.">؟</button>
              <span id="tsext-price-mode-badge" class="tsext-price-mode-badge" aria-live="polite"></span>
            </label>
            <label class="tsext-ds-inline" title="نمایش همه یا فقط موردعلاقه‌ها">
              <span class="tsext-mini">نمایش</span>
              <select id="tsext-fav-filter" class="tsext-input tsext-select tsext-ds-select">
                <option value="all">همه</option>
                <option value="fav">★ علاقه‌ها</option>
              </select>
            </label>
            <label class="tsext-ds-inline" title="چگالی ردیف‌ها — فشرده برای مانیتور کوچک یا لیست شلوغ">
              <span class="tsext-mini">چگالی</span>
              <select id="tsext-density" class="tsext-input tsext-select tsext-ds-select">
                <option value="normal">عادی</option>
                <option value="compact">فشرده</option>
              </select>
            </label>
            <label class="tsext-ds-inline" title="فیلتر ماه سررسید شمسی">
              <span class="tsext-mini">ماه</span>
              <select id="tsext-monthfilter" class="tsext-input tsext-select tsext-ds-select">
                <option value="">همه</option>
                <option value="1">فروردین</option>
                <option value="2">اردیبهشت</option>
                <option value="3">خرداد</option>
                <option value="4">تیر</option>
                <option value="5">مرداد</option>
                <option value="6">شهریور</option>
                <option value="7">مهر</option>
                <option value="8">آبان</option>
                <option value="9">آذر</option>
                <option value="10">دی</option>
                <option value="11">بهمن</option>
                <option value="12">اسفند</option>
              </select>
            </label>
          </div>
          <div class="tsext-ds-row tsext-ds-row-class">
            <div id="tsext-class-filter-host" class="tsext-class-filter-host"></div>
          </div>
        </div><div id="tsext-list-hdr" role="rowgroup"></div><div id="tsext-list-body" role="rowgroup"></div></div>
      <div id="tsext-status"></div>
      <div id="tsext-disclaimer" class="tsext-disclaimer" title="این افزونه صرفاً محاسباتی و اطلاعاتی است و توصیهٔ خرید یا فروش نیست. تصمیم معاملاتی با شماست.">ابزار محاسباتی · توصیهٔ معاملاتی نیست</div>
      </div>
      <div id="tsext-obpanel">
        <div class="tsext-obpanel-head">
          <span id="tsext-obpanel-title">جزئیات</span>
          <div style="display:flex;align-items:center;gap:2px;flex-shrink:0;">
            <button type="button" id="tsext-ob-zoom-dec" class="tsext-btn" title="کوچک‌نمایی">−</button>
            <button type="button" id="tsext-ob-zoom-inc" class="tsext-btn" title="بزرگ‌نمایی">+</button>
            <button type="button" id="tsext-obpanel-close" class="tsext-btn" title="بستن">✕</button>
          </div>
        </div>
        <div id="tsext-obpanel-body"><div class="tsext-ob-empty">روی «جزئیات» هر قرارداد کلیک کنید</div></div>
        <div id="tsext-ob-rz-e" class="tsext-resize-handle tsext-resize-e" title="تغییر عرض"></div>
        <div id="tsext-ob-rz-w" class="tsext-resize-handle tsext-resize-w" title="تغییر عرض"></div>
        <div id="tsext-ob-rz-s" class="tsext-resize-handle tsext-resize-s" title="تغییر ارتفاع"></div>
        <div id="tsext-ob-rz-n" class="tsext-resize-handle tsext-resize-n" title="تغییر ارتفاع"></div>
        <div id="tsext-ob-rz-se" class="tsext-resize-handle tsext-resize-se" title="تغییر اندازه"></div>
        <div id="tsext-ob-rz-sw" class="tsext-resize-handle tsext-resize-sw" title="تغییر اندازه"></div>
        <div id="tsext-ob-rz-ne" class="tsext-resize-handle tsext-resize-ne" title="تغییر اندازه"></div>
        <div id="tsext-ob-rz-nw" class="tsext-resize-handle tsext-resize-nw" title="تغییر اندازه"></div>
      </div>
`;
    document.body.appendChild(panelHost);
    try { upgradeNotesToHelp(panelHost); initHelpPopovers(panelHost); } catch (e) {}
    try { loadFavorites(); } catch (e) {}
    restoreSettingsToDom();
    try { legendHtml(); } catch (e) {} // چیپ‌های کلاس در نوار تنظیمات نمایش
    try { updateFavFilterBtn(); } catch (e) {}
    applyTheme();
    applyZoomToList();
    applyZoomToOb();
    applyMirror();
    applyUiPrefs();
    loadObLayoutPersist();

    applyMirror();

    panelHost.querySelector('#tsext-close').addEventListener('click', () => {
      try { window.close(); } catch (e) {}
      try { closePanelAndReset(); } catch (e2) {}
    });
    const obClose = panelHost.querySelector('#tsext-obpanel-close');
    if (obClose) obClose.addEventListener('click', () => closeOrderBookPanel());
    panelHost.querySelector('#tsext-fs-dec').addEventListener('click', () => setZoom(getZoom() - 0.2));
    panelHost.querySelector('#tsext-fs-inc').addEventListener('click', () => setZoom(getZoom() + 0.2));
    const obZoomDec = panelHost.querySelector('#tsext-ob-zoom-dec');
    const obZoomInc = panelHost.querySelector('#tsext-ob-zoom-inc');
    if (obZoomDec) obZoomDec.addEventListener('click', () => setObZoom(getObZoom() - 0.2));
    if (obZoomInc) obZoomInc.addEventListener('click', () => setObZoom(getObZoom() + 0.2));
    const mirrorBtn = panelHost.querySelector('#tsext-mirror-btn');
    if (mirrorBtn) mirrorBtn.addEventListener('click', () => setMirror(!isMirror()));
    const errBadge = panelHost.querySelector('#tsext-errbadge');
    if (errBadge) errBadge.addEventListener('click', async () => {
      if (!tsextErr.last && !tsextErr.n) return;
      const report = [
        'دستیار هوشمند آپشن — گزارش مشکل' + (extVersion() ? ' (نسخهٔ ' + extVersion() + ')' : ''),
        'زمان: ' + new Date().toISOString(),
        'تعداد خطا در این نشست: ' + tsextErr.n,
        'آخرین: ' + (tsextErr.last || '—'),
        'UA: ' + (typeof navigator !== 'undefined' ? navigator.userAgent : ''),
        '',
        '--- ' + tsextErr.log.length + ' خطای اخیر (قدیمی → جدید) ---',
        errLogText(),
        '',
        '--- وضعیت ---',
        diagText(),
      ].join('\n');
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(report);
          setStatus('گزارش مشکل در کلیپ‌بورد کپی شد');
        } else {
          setStatus('آخرین خطا: ' + tsextErr.last);
        }
      } catch (e) {
        setStatus('آخرین خطا: ' + tsextErr.last);
      }
    });
    const themeCycle = panelHost.querySelector('#tsext-theme-cycle');
    function updateThemeCycleLabel() {
      const map = { light: 'روشن', dark: 'تیره', contrast: 'کنتراست' };
      const cur = lsGet('tsext-theme') || 'light';
      const lbl = panelHost.querySelector('#tsext-theme-cycle-label');
      if (lbl) lbl.textContent = map[cur] || map.light;
    }
    if (themeCycle) themeCycle.addEventListener('click', () => {
      const order = ['light', 'dark', 'contrast'];
      const cur = lsGet('tsext-theme') || 'light';
      lsSet('tsext-theme', order[(order.indexOf(cur) + 1) % order.length]);
      applyTheme(); applyUiPrefs(); updateThemeCycleLabel();
    });
    updateThemeCycleLabel();
    // (شنوندهٔ Esc به init سراسری منتقل شد تا با هر بازسازی پنل تکرار نشود — نشت listener)
    // اگر همان نماد قبلاً برای این تب واکشی و کش شده، فقط نمایش بازسازی می‌شود؛ در غیر این صورت واکشی تازه انجام می‌شود
    function renderOrFetchForCurrentTerm() {
      const term = ($id(panelHost, 'tsext-underlying-' + state.strategy).value || '').trim();
      if (!term) { state.cache = null; renderActive(); return; }
      if (state.cache && state.cache.term === term) renderActive(); else fetchAndRender();
    }
    // دکمهٔ «تنظیمات» هر استراتژی — باز/بسته‌کردن بخش تنظیمات فشرده (پیش‌فرض بسته تا فضا برای لیست نمادها بیشینه باشد)
    panelHost.querySelectorAll('.tsext-settings-toggle').forEach((btn) => {
      btn.addEventListener('click', () => {
        const panel = btn.closest('.tsext-strategy-panel');
        const body = panel ? panel.querySelector('.tsext-settings-body') : null;
        if (body) {
          const open = body.classList.toggle('open');
          btn.classList.toggle('open', open);
          if (open) {
            try {
              requestAnimationFrame(() => {
                try {
                  body.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                  const head = panelHost.querySelector('#tsext-head') || document.getElementById('tsext-head');
                  if (head) {
                    const br = body.getBoundingClientRect();
                    const hr = head.getBoundingClientRect();
                    if (br.bottom > hr.bottom - 8) {
                      head.scrollTop += (br.bottom - hr.bottom + 24);
                    }
                  }
                } catch (e2) {}
              });
            } catch (e) {}
          }
        }
      });
    });


    function bindSelectOpenDown(sel) {
      // پنل شناور با اسکرول واقعی — ترکیبی و جامپ
      if (!sel || sel.__tsextOpenDown) return;
      sel.__tsextOpenDown = true;

      const SELECT_IDS = {
        'tsext-combo-buy': 1,
        'tsext-jamp-old-yield': 1,
        'tsext-jamp-old-downshift': 1,
        'tsext-jamp-old-upshift': 1,
        'tsext-jamp-old-challenge': 1
      };

      const ensurePanel = () => {
        let p = document.getElementById('tsext-select-float-panel');
        if (p) return p;
        p = document.createElement('div');
        p.id = 'tsext-select-float-panel';
        p.className = 'tsext-select-panel';
        p.setAttribute('role', 'listbox');
        p.style.cssText = 'display:none;position:fixed;z-index:2147483647;box-sizing:border-box;'
          + 'overflow-y:auto;overflow-x:hidden;max-height:320px;min-width:200px;'
          + 'background:#ffffff;color:#0f172a;border:1px solid #4f46e5;border-radius:10px;'
          + 'box-shadow:0 16px 40px rgba(0,0,0,.35);padding:4px 0;direction:rtl;text-align:right;'
          + 'font-family:Vazirmatn,Tahoma,Arial,sans-serif;font-size:12px;font-weight:700;'
          + 'overscroll-behavior:contain;scrollbar-width:thin;';
        (document.body || document.documentElement).appendChild(p);
        return p;
      };

      const hidePanel = () => {
        const p = document.getElementById('tsext-select-float-panel');
        if (p) {
          p.style.display = 'none';
          p.innerHTML = '';
          p.__ownerSel = null;
        }
        try { sel.classList.remove('tsext-select-open'); } catch (e) {}
        try { if (panelHost) panelHost.classList.remove('tsext-select-expanded'); } catch (e) {}
      };

      const showPanel = () => {
        const opts = Array.from(sel.options || []);
        const p = ensurePanel();
        // theme-aware colors from host if possible
        try {
          const cs = panelHost ? getComputedStyle(panelHost) : null;
          if (cs) {
            const bg = cs.getPropertyValue('--tsext-panel').trim() || '#ffffff';
            const fg = cs.getPropertyValue('--tsext-fg').trim() || '#0f172a';
            const accent = cs.getPropertyValue('--tsext-accent').trim() || '#4f46e5';
            p.style.background = bg;
            p.style.color = fg;
            p.style.borderColor = accent;
          }
        } catch (e) {}

        p.innerHTML = '';
        p.__ownerSel = sel;

        if (!opts.length) {
          const empty = document.createElement('div');
          empty.style.cssText = 'padding:10px 12px;opacity:.7;';
          empty.textContent = 'موردی برای نمایش نیست';
          p.appendChild(empty);
        } else {
          opts.forEach((opt, idx) => {
            const item = document.createElement('div');
            item.setAttribute('role', 'option');
            item.setAttribute('data-value', opt.value);
            item.textContent = opt.textContent || opt.label || opt.value || '—';
            const isPh = !opt.value || opt.disabled;
            item.style.cssText = 'padding:8px 12px;cursor:' + (isPh ? 'default' : 'pointer')
              + ';line-height:1.45;white-space:normal;word-break:break-word;'
              + (opt.selected ? 'background:rgba(79,70,229,.16);font-weight:900;color:#4f46e5;' : '')
              + (isPh ? 'opacity:.65;font-weight:600;' : '');
            if (!isPh) {
              item.addEventListener('mouseenter', () => {
                if (!opt.selected) item.style.background = 'rgba(79,70,229,.10)';
              });
              item.addEventListener('mouseleave', () => {
                item.style.background = opt.selected ? 'rgba(79,70,229,.16)' : '';
              });
            }
            item.addEventListener('click', (ev) => {
              ev.preventDefault();
              ev.stopPropagation();
              if (isPh) { hidePanel(); return; }
              const prev = sel.value;
              sel.selectedIndex = idx;
              sel.value = opt.value;
              hidePanel();
              if (String(sel.value) !== String(prev)) {
                try { sel.dispatchEvent(new Event('input', { bubbles: true })); } catch (e1) {}
                try { sel.dispatchEvent(new Event('change', { bubbles: true })); } catch (e2) {}
              }
            });
            p.appendChild(item);
          });
        }

        const rect = sel.getBoundingClientRect();
        const spaceBelow = window.innerHeight - rect.bottom - 8;
        const maxH = Math.min(320, Math.max(140, spaceBelow > 120 ? spaceBelow : 220));
        let top = rect.bottom + 4;
        if (spaceBelow < 120 && rect.top > 160) {
          // اگر پایین جا نیست، بالای فیلد باز کن ولی با اسکرول
          top = Math.max(8, rect.top - maxH - 4);
        }
        p.style.top = Math.round(top) + 'px';
        p.style.left = Math.round(rect.left) + 'px';
        p.style.width = Math.round(Math.max(rect.width, 240)) + 'px';
        p.style.maxHeight = Math.round(maxH) + 'px';
        p.style.display = 'block';

        sel.classList.add('tsext-select-open');
        try { if (panelHost) panelHost.classList.add('tsext-select-expanded'); } catch (e) {}

        try {
          const cur = p.querySelector('[data-value="' + CSS.escape(sel.value) + '"]');
          if (cur) cur.scrollIntoView({ block: 'nearest' });
        } catch (e3) {}
      };

      const togglePanel = (e) => {
        if (e) {
          e.preventDefault();
          e.stopPropagation();
        }
        const p = document.getElementById('tsext-select-float-panel');
        const open = p && p.style.display !== 'none' && p.__ownerSel === sel;
        if (open) hidePanel();
        else showPanel();
      };

      // mousedown: هم native را می‌بندد هم پنل را باز می‌کند (preventDefault روی mousedown جلوی click را می‌گیرد)
      sel.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        togglePanel(null);
        try { sel.focus(); } catch (e2) {}
      }, true);
      sel.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') { hidePanel(); return; }
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
          e.preventDefault();
          showPanel();
        }
      });

      // یک‌بار برای همه: کلیک بیرون ببندد
      if (!window.__tsextSelectPanelDocBound) {
        window.__tsextSelectPanelDocBound = true;
        document.addEventListener('mousedown', (e) => {
          const p = document.getElementById('tsext-select-float-panel');
          if (!p || p.style.display === 'none') return;
          if (p.contains(e.target)) return;
          if (e.target && e.target.closest && e.target.closest('select.tsext-select')) return;
          p.style.display = 'none';
          p.innerHTML = '';
          p.__ownerSel = null;
          try {
            document.querySelectorAll('select.tsext-select-open').forEach((s) => s.classList.remove('tsext-select-open'));
          } catch (e2) {}
        }, true);
        document.addEventListener('keydown', (e) => {
          if (e.key !== 'Escape') return;
          const p = document.getElementById('tsext-select-float-panel');
          if (p) { p.style.display = 'none'; p.innerHTML = ''; p.__ownerSel = null; }
        }, true);
      }

      try { sel.size = 1; sel.removeAttribute('size'); } catch (e) {}
    }

    function onStrategySelectChange() {
      state.forceReorder = true;
      try { closeOrderBookPanel(); } catch (e) {}
      try { saveSettings(); } catch (e) {}
      try { setStatus('در حال به‌روزرسانی…'); } catch (e) {}
      if (state.cache) renderActive();
    }
        STRATS.forEach((s) => {
      ['#tsext-underlying-' + s, '#tsext-manual-' + s].forEach((sel) => {
        const elx = panelHost.querySelector(sel);
        if (elx) {
          elx.addEventListener('keydown', (e) => {
            // اگر لیست پیشنهاد باز است، Enter را bindUaAutocomplete مدیریت می‌کند
            if (e.key === 'Enter') {
              const box = document.getElementById('tsext-ua-suggest');
              if (box && box.style.display !== 'none' && state.uaSuggestActive >= 0) return;
              fetchAndRender();
            }
          });
          // ذخیرهٔ فوری (با تأخیر کوتاه) روی هر تایپ — تا اگر پنل به هر دلیلی دوباره ساخته شد، آخرین مقدار از دست نرود
          elx.addEventListener('input', () => {
            debouncedSaveSettings();
            // ورودی عددی دستی: بلافاصله (با تأخیر کوتاه) دوباره محاسبه — بدون نیاز به Enter
            if (sel.indexOf('manual') >= 0 && state.cache) {
              try { state.forceReorder = true; } catch (e0) {}
              try { if (!window.__tsextDebouncedRender) window.__tsextDebouncedRender = debounce(function () { if (state.cache) renderActive(); }, 120); window.__tsextDebouncedRender(); } catch (e1) {}
            }
          });
          if (sel.indexOf('underlying') >= 0) {
            bindUaAutocomplete(elx);
            elx.addEventListener('focus', () => { try { ensureUaCatalog(false); } catch (e) {} });
            elx.addEventListener('change', () => { const v = (elx.value || '').trim(); if (v) { try { closeOrderBookPanel(); } catch (e) {} fetchAndRender(); } });
          }
        }
      });
      // تغییر کارمزد/ماه سررسید فقط نمایش را دوباره می‌سازد؛ چون دادهٔ زنجیره از قبل کش شده، نیاز به fetch جدید نیست
      // جامپ کارمزد ندارد (همیشه صفر طبق فرمول رسمی) پس فیلد کارمزدش در HTML حذف شده — این حلقه باید ایمن باشد
      ['#tsext-comm-' + s].forEach((sel) => {
        const elx = panelHost.querySelector(sel);
        if (!elx) return;
        elx.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); state.cache ? renderActive() : fetchAndRender(); } });
        elx.addEventListener('change', () => { state.forceReorder = true; saveSettings(); if (state.cache) renderActive(); });
        elx.addEventListener('input', () => {
          debouncedSaveSettings();
          try { state.forceReorder = true; } catch (e0) {}
          try { if (!window.__tsextDebouncedRender) window.__tsextDebouncedRender = debounce(function () { if (state.cache) renderActive(); }, 120); window.__tsextDebouncedRender(); } catch (e1) {}
        });
      });
    });
    // تنظیمات نمایش سراسری (ترتیب + ماه سررسید) — یک‌بار bind
    const sortEl = panelHost.querySelector('#tsext-sort');
    if (sortEl) sortEl.addEventListener('change', () => { state.forceReorder = true; saveSettings(); if (state.cache) renderActive(); else fetchAndRender(); });
    const monEl = panelHost.querySelector('#tsext-monthfilter');
    if (monEl) {
      monEl.addEventListener('change', () => {
        const raw = String(monEl.value || '').trim();
        const n = parseInt(raw, 10);
        state.monthFilter = (n >= 1 && n <= 12) ? n : null;
        state.forceReorder = true;
        syncMonthSelects();
        saveSettings();
        if (state.cache) renderActive();
      });
    }
    const densSel = panelHost.querySelector('#tsext-density');
    if (densSel) {
      densSel.value = (state.listDensity === 'compact') ? 'compact' : 'normal';
      densSel.addEventListener('change', () => {
        state.listDensity = densSel.value === 'compact' ? 'compact' : 'normal';
        applyListDensity();
        try { debouncedSaveSettings(); } catch (e) {}
      });
    }
    applyListDensity();
    const pmSel = panelHost.querySelector('#tsext-price-mode');
    const syncPriceModeBadge = () => {
      const badge = panelHost && panelHost.querySelector('#tsext-price-mode-badge');
      if (!badge) return;
      const exec = state.priceMode === 'exec';
      badge.textContent = exec ? 'مبنای محاسبه: صف ask/bid' : 'مبنای محاسبه: آخرین معامله تابلو';
      badge.className = 'tsext-price-mode-badge' + (exec ? ' is-exec' : ' is-last');
      badge.title = exec
        ? 'قیمت‌ها از دفتر سفارش (خرید=ask، فروش=bid) گرفته می‌شوند'
        : 'قیمت‌ها از آخرین معاملهٔ ثبت‌شده روی تابلو گرفته می‌شوند';
    };
    if (pmSel) {
      pmSel.value = state.priceMode === 'exec' ? 'exec' : 'last';
      pmSel.addEventListener('change', () => { setPriceMode(pmSel.value); syncPriceModeBadge(); });
      try { syncPriceModeBadge(); } catch (e) {}
    }
    const favFilterSel = panelHost.querySelector('#tsext-fav-filter');
    if (favFilterSel) {
      favFilterSel.addEventListener('change', () => { applyFavFilterFromSelect(); });
      try { updateFavFilterBtn(); } catch (e) {}
    }
    try { syncMonthSelects(); } catch (e) {}
    // ورودی‌های دستی جامپ (اعمال/قیمت/سررسید قرارداد خودتان) — فقط نمایش را دوباره می‌سازد
    ['#tsext-jamp-recv-premium-d', '#tsext-jamp-recv-premium-u', '#tsext-jamp-recv-premium'].forEach((sel) => {
      const elx = panelHost.querySelector(sel);
      if (!elx) return;
      elx.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); state.cache ? renderActive() : fetchAndRender(); } });
      elx.addEventListener('change', () => { state.forceReorder = true; saveSettings(); if (state.cache) renderActive(); });
      elx.addEventListener('input', () => {
        debouncedSaveSettings();
        try { state.forceReorder = true; } catch (e0) {}
        try { if (!window.__tsextDebouncedRender) window.__tsextDebouncedRender = debounce(function () { if (state.cache) renderActive(); }, 120); window.__tsextDebouncedRender(); } catch (e1) {}
      });
    });
    // کشویی‌های ترکیبی/جامپ — change + input برای به‌روزرسانی آنی
    ['#tsext-combo-buy', '#tsext-jamp-old-upshift', '#tsext-jamp-old-challenge', '#tsext-jamp-old-yield', '#tsext-jamp-old-downshift'].forEach((sel) => {
      const el = panelHost.querySelector(sel);
      if (!el) return;
      const go = () => onStrategySelectChange();
      el.addEventListener('change', go);
      el.addEventListener('input', go);
      try { bindSelectOpenDown(el); } catch (e) {}
    });
    // v1.27: بازدهی فقط حالت زنده دارد — فیلدهای دستی حذف شدند، پس نیازی به پاک‌کردن کشویی نیست
    // سوییچ نوع جامپ (بازدهی / کاهش ریسک / افزایش اعمال / چالشی)
    panelHost.querySelectorAll('#tsext-jamp-modes .tsext-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        const next = btn.getAttribute('data-jampmode');
        if (next === state.jampMode) return;
        state.jampMode = next;
        updateJampModeUI();
        saveSettings();
        try { updateFavFilterBtn(); } catch (e) {}
        state.forceReorder = true;
        if (state.strategy === 'jamp' && state.cache) renderActive();
      });
    });
    panelHost.querySelectorAll('#tsext-tabs .tsext-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        const next = btn.getAttribute('data-s');
        if (!next) return;
        // حتی اگر state همان تب باشد، UI را همگام کن (بعد از بستن/باز کردن ممکن است از هم جدا شده باشند)
        if (next === state.strategy) {
          updateActiveTab();
          return;
        }
        state.strategy = next;
        // با تعویض تب، لیست و هدر قبلی پاک شود تا هدر/نوار تب قبل قاطی نشود
        const lst = listEl();
        if (lst) { lst.innerHTML = ''; lst.removeAttribute('data-strategy'); state.listTerm = null; }
        setListHeader('');
        closeOrderBookPanel();
        updateActiveTab();
        saveSettings();
        try { updateFavFilterBtn(); } catch (e) {}
        state.forceReorder = true;
        // هر تب آخرین نماد خودش را دارد — از ورودی همان تب بارگذاری کن
        if (state.candidates) renderActive();
        else {
          const term = ($id(panelHost, 'tsext-underlying-' + next).value || '').trim();
          if (!term) {
            clearCache();
            renderActive();
          } else if (state.cache && state.cache.term === term) {
            renderActive();
          } else {
            // preferCache: اگر قبلاً این نماد در تب دیگر کش شده، فوری نشان بده
            try { loadSymbol(term, { preferCache: true }); } catch (e) { renderOrFetchForCurrentTerm(); }
          }
        }
      });
    });
    // کلیک روی سرستون‌های لیست مثبت‌پنج برای مرتب‌سازی
    listEl().addEventListener('click', (e) => {
      const col = e.target.closest('.tsext-cols .tsext-col[data-sort]');
      if (!col) return;
      const sel = $id(panelHost, 'tsext-sort');
      let sk = col.getAttribute('data-sort');
      if (sk === 'days') sk = 'date'; // روزمانده از ترتیب نمایش حذف شد — معادل تاریخ اعمال
      if (sel && sk && sel.value !== sk) {
        sel.value = sk;
        state.forceReorder = true;
        saveSettings();
        if (state.cache) renderActive(); else fetchAndRender();
      }
    });
    // مرتب‌سازی با کیبورد روی سرستون‌ها (Enter/Space) — v1.21.6
    panelHost.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
      const col = e.target && e.target.closest && e.target.closest('.tsext-cols .tsext-col[data-sort]');
      if (!col) return;
      e.preventDefault();
      col.click();
    });
    // تغییر عرض ستون با کیبورد (فلش چپ/راست روی دستگیره) — v1.21.6
    panelHost.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      const grip = e.target && e.target.closest && e.target.closest('.tsext-col-grip');
      if (!grip) return;
      const cell = grip.closest('[data-resize]');
      const key = cell && cell.getAttribute('data-resize');
      if (!key || !COLUMN_LIMITS[key]) return;
      e.preventDefault();
      const rtl = getComputedStyle(panelHost).direction === 'rtl';
      const dir = (e.key === 'ArrowRight' ? 1 : -1) * (rtl ? -1 : 1);
      const widths = getColumnWidths();
      const next = Math.max(COLUMN_LIMITS[key][0], Math.min(COLUMN_LIMITS[key][1], widths[key] + dir * 8));
      if (next === widths[key]) return;
      widths[key] = next;
      panelHost.style.setProperty('--tsext-col-' + key, next + 'px');
      saveColumnWidths(widths);
      try { syncListGutter(); } catch (err) {}
    });
    // نوار نوسان قیمت: حرکت ماوس روی محور → برچسب «قیمت · ±درصد» زیر ماوس
    panelHost.addEventListener('mousemove', (e) => {
      const t = e.target && e.target.closest ? e.target.closest('.tsext-rangebar-track') : null;
      if (t) rangeBarHoverMove(t, e.clientX); else if (rbHover.track) rangeBarHoverHide();
    }, { passive: true });
    panelHost.addEventListener('mouseleave', () => { rangeBarHoverHide(); }, { passive: true });
    // هر تعامل کاربر → توربو فعال بماند
    panelHost.addEventListener('pointerdown', () => { noteUserInteract(); }, { passive: true });
    panelHost.addEventListener('keydown', () => { noteUserInteract(); }, { passive: true });
    // چیپ «بازار بسته» → ۵ دقیقه رفرش کامل (جلسهٔ فوق‌العاده / تست)
    panelHost.addEventListener('click', (e) => {
      const chip = e.target && e.target.closest ? e.target.closest('#tsext-market.tsext-market-click') : null;
      if (chip) { e.preventDefault(); forceLiveNow(); }
    });
    // نمادهای اخیر در empty state
    panelHost.addEventListener('click', (e) => {
      const recent = e.target.closest('.tsext-recent-chip');
      if (recent) {
        noteUserInteract();
        const term = recent.getAttribute('data-term') || '';
        if (!term) return;
        STRATS.forEach((s) => {
          const inp = $id(panelHost, 'tsext-underlying-' + s);
          if (inp) inp.value = term;
        });
        saveSettings();
        fetchAndRender(false);
        return;
      }
    });
    // کلیک روی برچسب‌های راهنما (X/A/B/−B/−A) برای فیلتر کردن نمایش، بدون تغییر محاسبات
    panelHost.addEventListener('click', (e) => {
      const chip = e.target.closest('.tsext-legend .tsext-chip, .tsext-class-tog');
      if (chip) {
        e.preventDefault();
        const c = chip.getAttribute('data-c');
        if (state.classFilter.has(c)) state.classFilter.delete(c); else state.classFilter.add(c);
        if (state.classFilter.size === 0) ALL_CLASSES.forEach((k) => state.classFilter.add(k));
        state.forceReorder = true;
        saveSettings();
        if (state.cache) renderActive();
        return;
      }
      });
    // (بازیابی تنظیمات ذخیره‌شده حذف شد — ذخیره‌سازی دائمی وجود ندارد و loadSettings همیشه null است؛
    // این بلوک عملاً کد مرده بود. ورودی‌های کاربر فقط در همین نشست زنده‌اند.)
    updateActiveTab();
    updateJampModeUI();
    setupAutoRefresh();
    // بازیابی نماد فعال دیدبان یا ورودی — واکشی قطعی بعد از آماده شدن UI
    try {
      const bootLoad = () => {
        try {
          if (state.cache && state.cache.rows && state.cache.rows.length) return;
          let term = (readInputs().term || '').trim();
          if (!term) {
            try { term = (localStorage.getItem('pr-watchlist-active') || '').trim(); } catch (e2) {}
          }
          if (term) loadSymbol(term, { force: true });
        } catch (e) {}
      };
      setTimeout(bootLoad, 120);
      setTimeout(bootLoad, 500);
      setTimeout(bootLoad, 1200);
    } catch (e) {}
        // جابه‌جایی/resize شناور حذف شده — چیدمان از pro.css
    try {
      // ResizeObserver هنگام تغییر اندازهٔ پنل اصلی هر قاب صدا می‌شود؛ کار سنگین (نوشتن layout در
      // localStorage و جابه‌جایی پنل جزئیات) را با rAF هم‌قاب می‌کنیم و حین کشیدن/تغییر اندازه اصلاً
      // ذخیره نمی‌کنیم (همان لحظهٔ پایانِ تغییر اندازه ذخیره می‌شود) تا حرکت کاملاً روان بماند.
      let roRaf = 0;
      new ResizeObserver(() => {
        if (state.uiInteracting || state.colResizing) return; // حین درگ هیچ کار اضافه
        if (roRaf) return;
        roRaf = requestAnimationFrame(() => {
          roRaf = 0;
          if (state.uiInteracting || state.colResizing) return;
          if (panelHost) {
            const w = panelHost.getBoundingClientRect().width;
            panelHost.classList.toggle('tsext-narrow', w < 420);
            panelHost.classList.toggle('tsext-compact', w < 360);
            try { syncListGutter(); } catch (e) {}
          }
        });
      }).observe(panelHost);
      const w0 = panelHost.getBoundingClientRect().width;
      panelHost.classList.toggle('tsext-narrow', w0 < 420);
    } catch (e) {}

    // اگر پیش‌تر صریحاً باز شده (کاربر خودش دکمه را زده)، در هر صفحه/تب جدید tsetmc هم از همان
    // ابتدا باز است (بدون پرش display)؛ اما اگر هیچ‌وقت باز نشده (sv2 === null)، پیش‌فرض بسته
    // است — باز شدن همیشه باید نتیجهٔ یک کلیک صریح باشد، نه پیش‌فرض خودکار صفحهٔ تازه
    if (panelHost.style.display !== 'flex') panelHost.style.display = 'flex';
    applyTheme();
    if (state.cache) {
      renderActive();
    } else {
      const termEl = $id(panelHost, 'tsext-underlying-' + state.strategy);
      if (termEl && (termEl.value || '').trim()) {
        fetchAndRender();
      }
    }
    return panelHost;
  }

  function updateActiveTab() {
    if (!panelHost) return;
    panelHost.querySelectorAll('#tsext-tabs .tsext-tab').forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-s') === state.strategy);
    });
    panelHost.querySelectorAll('.tsext-strategy-panel').forEach((p) => {
      p.classList.toggle('active', p.getAttribute('data-strategy') === state.strategy);
    });
    applyStrategyAccent();
  }

  // سوییچ بین چهار زیرحالت جامپ: بازدهی (تغییر سررسید) / کاهش اعمال (اعمال پایین‌تر، فقط اعمال کمتر) /
  // افزایش اعمال (اعمال بالاتر، همان سررسید). فقط UI را جابه‌جا می‌کند؛ محاسبه در renderJamp بر اساس state.jampMode انجام می‌شود
  function updateJampModeUI() {
    if (!panelHost) return;
    const mode = state.jampMode || 'yield';
    panelHost.querySelectorAll('#tsext-jamp-modes .tsext-tab').forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-jampmode') === mode);
    });
    panelHost.querySelectorAll('.tsext-jamp-sub').forEach((p) => {
      p.classList.toggle('active', p.getAttribute('data-jampsub') === mode);
    });
  }

  function noteUserInteract() {
    state.lastInteractAt = Date.now();
    // اگر Adaptive بود و کاربر برگشت، سریع‌تر شویم
    if (state.noChangeStreak > 2) state.noChangeStreak = Math.max(0, state.noChangeStreak - 3);
  }
  // فاصلهٔ فعلی تیک حیاتی بر اساس توربو / Adaptive
  function applyListDensity() {
    if (!panelHost) return;
    const compact = state.listDensity === 'compact';
    panelHost.classList.toggle('tsext-density-compact', compact);
  }
  function refreshModeFactor() {
    // ضریب فاصله بر اساس حالت انتخابی کاربر (v1.22.0)
    const m = state.refreshMode || 'normal';
    if (m === 'conservative') return 2.2; // فاصله‌ها حدود ۲٫۲ برابر → فشار کمتر روی tsetmc
    if (m === 'turbo') return 0.7;        // سریع‌تر برای قیمت زنده
    return 1;
  }
  function netSoftSlowFactor() {
    // وقتی شکست شبکه پیاپی است، فاصلهٔ تیک‌ها را ملایم زیاد کن (نه Adaptive کامل)
    const n = state.netFailCount || 0;
    if (n < NET_SOFT_SLOW_FROM) return 1;
    const steps = Math.min(6, n - NET_SOFT_SLOW_FROM + 1);
    return Math.min(NET_SOFT_SLOW_MAX, 1 + steps * 0.15);
  }
  function getCritIntervalMs() {
    // توربو: پنل دیده می‌شود + (جزئیات باز یا تعامل اخیر یا تب فعال)
    const panelVisible = panelHost && panelHost.style.display !== 'none';
    const detailOpen = !!(state.obKey || state.obCtx);
    const recentInteract = (Date.now() - (state.lastInteractAt || 0)) < 12000;
    const pageVisible = typeof document !== 'undefined' && !document.hidden;
    state.turboActive = panelVisible && pageVisible && (detailOpen || recentInteract || true); // پیش‌فرض توربو وقتی پنل باز است
    let base;
    if (state.noChangeStreak >= ADAPT_STREAK) base = CRIT_ADAPT_MS;
    else if (state.turboActive) base = CRIT_TURBO_MS;
    else base = CRIT_REFRESH_MS;
    // خطای شبکه خیلی مکرر → کمی فاصله بیشتر (ملایم؛ اولویت با زنده بودن)
    if ((state.netFailCount || 0) >= 8) base = Math.max(base, CRIT_ADAPT_MS);
    return Math.round(base * refreshModeFactor() * marketFactor() * netSoftSlowFactor());
  }
  function getVisIntervalMs() {
    let base = (state.noChangeStreak >= ADAPT_STREAK) ? VIS_ADAPT_MS : VIS_REFRESH_MS;
    if ((state.netFailCount || 0) >= 8) base = Math.max(base, VIS_ADAPT_MS);
    return Math.round(base * refreshModeFactor() * marketFactor() * netSoftSlowFactor());
  }
  function getChainIntervalMs() {
    const chainMs = Math.max(800, state.chainRefreshMs || CHAIN_REFRESH_MS);
    const mode = state.refreshMode === 'conservative' ? 1.8 : state.refreshMode === 'turbo' ? 0.85 : 1;
    return Math.min(MKT_CHAIN_MAX_MS, Math.round(chainMs * mode * marketFactor()));
  }
  function getObIntervalMs() {
    let base = OB_REFRESH_MS;
    if ((state.netFailCount || 0) >= 8) base = Math.round(base * 1.3);
    return Math.round(base * refreshModeFactor() * marketFactor());
  }
  // ===== زمان‌بند واحد (v1.23) =====
  // به‌جای ۵ تایمر جدا (زنجیره / حیاتی / دیدنی / سن داده / صف سفارشات) فقط یک setInterval با پالس ۸۰ms داریم؛
  // هر کار «موعد» خودش را دارد و فاصلهٔ واقعی از توابع getXxxIntervalMs می‌آید (توربو / Adaptive / حالت کاربر / مرحلهٔ بازار).
  // مزیت: بیدارشدن کمتر CPU، رقابت نکردن تیک‌ها با هم، و یک نقطه برای «مدار قطع‌کنندهٔ» شبکه.
  const sched = { timer: null, listOn: false, obOn: false, lastChain: 0, lastCrit: 0, lastVis: 0, lastAge: 0, lastOb: 0, lastDiag: 0, ticks: 0 };
  function schedEnsure() {
    if (sched.timer) return;
    sched.timer = setInterval(schedTick, SCHED_PULSE_MS);
    state.autoTimer = sched.timer; // سازگاری با نام قدیمی
  }
  function schedMaybeStop() {
    if (sched.timer && !sched.listOn && !sched.obOn && !state.diagOpen) {
      clearInterval(sched.timer);
      sched.timer = null;
      state.autoTimer = null;
    }
  }
  function schedTick() {
    sched.ticks++;
    const now = Date.now();
    if (!panelHost || panelHost.style.display === 'none') return;
    if (typeof document !== 'undefined' && document.hidden) return;
    // پنل تشخیصی (اگر باز است) — هر ثانیه
    if (state.diagOpen && now - sched.lastDiag >= 1000) { sched.lastDiag = now; try { renderDiagPanel(); } catch (e) {} }
    const busy = state.uiInteracting || state.colResizing;
    if (sched.listOn) {
      // برچسب سن داده — سبک
      if (now - sched.lastAge >= 250) { sched.lastAge = now; try { updateAgeLabel(); } catch (e) {} }
      if (!busy && !isNetBackingOff()) {
        // ۱) زنجیرهٔ کامل
        if (now - sched.lastChain >= getChainIntervalMs()) {
          sched.lastChain = now;
          try { const inp = readInputs(); if (inp.term) fetchAndRender(true); } catch (e) { noteError(e, 'sched:chain'); }
        }
        // ۲) تیک حیاتی (سهم پایه + قرارداد باز)
        if (now - sched.lastCrit >= getCritIntervalMs() - 20) {
          sched.lastCrit = now;
          try { const r = criticalPriceTick(); if (r && r.catch) r.catch((e) => noteError(e, 'sched:crit')); } catch (e) { noteError(e, 'sched:crit'); }
        }
        // ۲.۵) صف سفارش همهٔ قراردادها — فقط در حالت «قابل‌اجرا»
        if (state.priceMode === 'exec' && now - (sched.lastBook || 0) >= 350) {
          sched.lastBook = now;
          try { const r = bookSweepTick(); if (r && r.catch) r.catch((e) => noteError(e, 'sched:book')); } catch (e) { noteError(e, 'sched:book'); }
        }
        // ۳) تیک ردیف‌های دیدنی
        if (now - sched.lastVis >= getVisIntervalMs() - 30) {
          sched.lastVis = now;
          try { const r = visiblePriceTick(); if (r && r.catch) r.catch((e) => noteError(e, 'sched:vis')); } catch (e) { noteError(e, 'sched:vis'); }
        }
      }
    }
    // ۴) صف سفارشات پنل جزئیات — مستقل از رفرش لیست (با Space متوقف نمی‌شود)
    if (sched.obOn && !busy && !isNetBackingOff() && state.obKey && state.obCtx && panelHost.classList.contains('tsext-with-ob')) {
      if (!state.obFetchInFlight && now - sched.lastOb >= getObIntervalMs()) {
        sched.lastOb = now;
        state.obFetchInFlight = true;
        Promise.resolve()
          .then(() => loadOrderBookSlots(state.obKey, state.obCtx, false))
          .catch((e) => noteError(e, 'sched:ob'))
          .then(() => { state.obFetchInFlight = false; });
      }
    }
  }
  function setupAutoRefresh() {
    if (!state.autoRefresh) return;
    // اولین زنجیره بعد از یک فاصلهٔ کامل (مثل قبل)؛ تیک‌های قیمت بلافاصله
    sched.listOn = true;
    sched.lastChain = Date.now();
    sched.lastCrit = 0;
    sched.lastVis = 0;
    schedEnsure();
  }
  // فقط تیک‌های لیست را متوقف می‌کند — بدون دست زدن به صف سفارشات یا IntersectionObserver.
  function stopAutoRefreshTimers() {
    sched.listOn = false;
    state.chainTimer = null; state.critTimer = null; state.visTimer = null; state.ageTimer = null;
    schedMaybeStop();
  }
  // تصویر لحظه‌ای و cycleRefreshMode و toggleAutoRefresh (میان‌برها) در ۱.۲۹ حذف شدند.

  // ----- from src/07a-net.js -----
  // ========== MODULE [7a] net / orderbook ==================================
  // لایهٔ شبکه: AbortController، backoff، single-flight، کش کوتاه
  // + قالب/پچ دفتر سفارشات

  // ========== MODULE [7] net / fetch ========================================
  // لایهٔ شبکه با:
  //   • AbortController + تایم‌اوت
  //   • backoff نمایی بین تلاش‌ها
  //   • شمارش شکست پیاپی (state.netFailCount) و توقف موقت رفرش خودکار
  //   • پیام خطای قابل‌نمایش به کاربر (state.lastNetError)
  function liveUrl(url) {
    const sep = url.indexOf('?') >= 0 ? '&' : '?';
    return url + sep + '_t=' + Date.now() + '&_r=' + Math.random().toString(36).slice(2, 8);
  }
  const LIVE_FETCH_OPTS = {
    cache: 'no-store',
    headers: {
      'Accept': 'application/json, */*',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      'Pragma': 'no-cache',
    },
  };
  // backoff نمایی: 300ms, 600ms, 1200ms, ... سقف 4s
  function backoffDelay(attemptIndex) {
    return Math.min(4000, 300 * Math.pow(2, attemptIndex));
  }
  function noteNetSuccess() {
    state.netFailCount = 0;
    state.lastNetError = null;
    state.netBackoffUntil = 0;
    try { showStaleBanner(false); } catch (e) {}
  }
  function noteNetFailure(msg) {
    // لیست را پاک نکن؛ بنر «اتصال ضعیف» نشان داده نمی‌شود.
    // فقط backoff خیلی کوتاه و خاموش تا فشار روی tsetmc کم بماند.
    state.netFailCount = (state.netFailCount || 0) + 1;
    state.lastNetError = msg || 'مشکل موقت شبکه';
    if (state.netFailCount === 1 || state.netFailCount % 20 === 0) noteError(state.lastNetError + ' (#' + state.netFailCount + ')', 'net', { quiet: true });
    if (state.netFailCount >= 2) {
      try { showStaleBanner(true); } catch (e0) {}
    }
    if (state.netFailCount >= 6) {
      const pauseMs = Math.min(2500, 500 * Math.min(state.netFailCount, 6));
      state.netBackoffUntil = Date.now() + pauseMs;
    }
  }
  function isNetBackingOff() {
    return state.netBackoffUntil && Date.now() < state.netBackoffUntil;
  }
  function netStatusHint() {
    // پیام اتصال ضعیف / مکث در نوار وضعیت نمایش داده نمی‌شود
    return null;
  }
  function showStaleBanner(on, msg) {
    try {
      if (!panelHost) return;
      let el = panelHost.querySelector('#tsext-stale-banner');
      if (!on) {
        if (el) el.remove();
        return;
      }
      if (!el) {
        el = document.createElement('div');
        el.id = 'tsext-stale-banner';
        el.className = 'tsext-stale-banner';
        el.setAttribute('role', 'status');
        const list = panelHost.querySelector('#tsext-list');
        if (list && list.parentNode) list.parentNode.insertBefore(el, list);
        else panelHost.appendChild(el);
      }
      let t = '';
      try {
        if (state.lastDataAt) t = new Date(state.lastDataAt).toLocaleTimeString('fa-IR', { hour12: false });
      } catch (e2) {}
      const hasCache = !!(state.cache && state.cache.rows && state.cache.rows.length);
      el.textContent = msg || (hasCache
        ? ('اتصال tsetmc قطع/ناپایدار · نمایش آخرین زنجیره' + (t ? (' · به‌روز شده: ' + t) : '') + ' · فقط‌خواندنی')
        : ('اتصال tsetmc برقرار نیست' + (t ? (' · آخرین تلاش: ' + t) : '')));
      el.title = 'دادهٔ روی صفحه ممکن است کهنه باشد. با بازگشت شبکه به‌صورت خودکار تازه می‌شود.';
    } catch (e) {}
  }

  // ---------- single-flight + کش خیلی کوتاه (v1.23) ----------
  // اگر همین URL همین الان در حال دریافت است، همان Promise را برمی‌گرداند؛ اگر پاسخش ≤ NET_MICRO_TTL_MS پیش آمده،
  // همان را می‌دهد. تیک‌های مختلف (حیاتی/دیدنی/نوار/صف) دیگر یک URL را هم‌زمان دو بار نمی‌گیرند.
  const netInflight = new Map();  // key -> Promise
  const netRecent = new Map();    // key -> { at, v }
  const diag = { req: 0, ok: 0, fail: 0, dedup: 0, lat: [], stamps: [], kinds: {}, startedAt: Date.now(), lastErr: '' };
  function diagNote(kind, ok, ms) {
    diag.req++;
    if (ok) diag.ok++; else diag.fail++;
    diag.kinds[kind] = (diag.kinds[kind] || 0) + 1;
    if (ms >= 0) { diag.lat.push(ms); if (diag.lat.length > 60) diag.lat.shift(); }
    const now = Date.now();
    diag.stamps.push(now);
    while (diag.stamps.length && now - diag.stamps[0] > 60000) diag.stamps.shift();
  }
  function netDedup(key, factory) {
    const now = Date.now();
    const r = netRecent.get(key);
    if (r && (now - r.at) <= NET_MICRO_TTL_MS) { diag.dedup++; return Promise.resolve(r.v); }
    const f = netInflight.get(key);
    if (f) { diag.dedup++; return f; }
    const p = Promise.resolve()
      .then(factory)
      .then((v) => {
        if (v != null) netRecent.set(key, { at: Date.now(), v });
        if (netRecent.size > 400) { for (const [k, e] of netRecent) { if (Date.now() - e.at > 5000) netRecent.delete(k); } }
        return v;
      })
      .catch(() => null)
      .then((v) => { netInflight.delete(key); return v; });
    netInflight.set(key, p);
    return p;
  }
  async function apiGet(path, attempts = 3, minRows = 0, extraOpts) {
    return netDedup('I:' + path, () => apiGetUncached(path, attempts, minRows, extraOpts));
  }
  async function apiGetUncached(path, attempts = 3, minRows = 0, extraOpts) {
    const t0 = Date.now();
    const base = 'https://cdn.tsetmc.com/api/Instrument' + path;
    const delay = (ms) => new Promise((r) => setTimeout(r, ms));
    let lastErr = null;
    for (let i = 0; i < attempts; i++) {
      let timer = null;
      try {
        let signal;
        if (typeof AbortController !== 'undefined') {
          const ctrl = new AbortController();
          signal = ctrl.signal;
          timer = setTimeout(() => { try { ctrl.abort(); } catch (e) {} }, 7000);
        }
        const resp = await fetch(liveUrl(base), Object.assign({}, LIVE_FETCH_OPTS, extraOpts || {}, { signal }));
        if (!resp.ok) {
          lastErr = 'سرور پاسخ نداد (کد ' + resp.status + ')';
          await delay(backoffDelay(i));
          continue;
        }
        const j = await resp.json().catch(() => null);
        if (!j) {
          lastErr = 'پاسخ JSON نامعتبر';
          await delay(backoffDelay(i));
          continue;
        }
        const probe = j.instrumentSearch || j.instrumentOptMarketWatch || j.instrumentInfo;
        if (Array.isArray(probe) && probe.length < minRows) {
          lastErr = 'داده ناقص از سرور';
          await delay(backoffDelay(i));
          continue;
        }
        try {
          if (Array.isArray(j.instrumentOptMarketWatch) && j.instrumentOptMarketWatch.length) checkDataShape('chain', j.instrumentOptMarketWatch[0]);
          else if (Array.isArray(j.instrumentSearch) && j.instrumentSearch.length) checkDataShape('search', j.instrumentSearch[0]);
        } catch (e) {}
        noteNetSuccess();
        diagNote('instrument', true, Date.now() - t0);
        try { state.lastDataAt = Date.now(); } catch (e) {}
        return j;
      } catch (e) {
        lastErr = (e && e.name === 'AbortError') ? 'اتصال کند بود — دوباره تلاش می‌کنیم' : 'ارتباط موقتاً قطع شد';
      } finally {
        if (timer) clearTimeout(timer);
      }
      await delay(backoffDelay(i));
    }
    diagNote('instrument', false, Date.now() - t0);
    diag.lastErr = lastErr || '';
    noteNetFailure(lastErr || 'دریافت داده ناموفق بود');
    return null;
  }

  async function apiGetRaw(url, attempts = 2, extraOpts) {
    return netDedup('R:' + url, () => apiGetRawUncached(url, attempts, extraOpts));
  }
  async function apiGetRawUncached(url, attempts = 2, extraOpts) {
    const t0 = Date.now();
    const delay = (ms) => new Promise((r) => setTimeout(r, ms));
    let lastErr = null;
    for (let i = 0; i < attempts; i++) {
      let timer = null;
      try {
        let signal;
        if (typeof AbortController !== 'undefined') {
          const ctrl = new AbortController();
          signal = ctrl.signal;
          timer = setTimeout(() => { try { ctrl.abort(); } catch (e) {} }, 7000);
        }
        const resp = await fetch(liveUrl(url), Object.assign({}, LIVE_FETCH_OPTS, extraOpts || {}, { signal }));
        if (!resp.ok) {
          lastErr = 'پاسخ نامعتبر (' + resp.status + ')';
          await delay(backoffDelay(i));
          continue;
        }
        const j = await resp.json().catch(() => null);
        if (j) {
          noteNetSuccess();
          diagNote('raw', true, Date.now() - t0);
          return j;
        }
        lastErr = 'JSON نامعتبر';
      } catch (e) {
        lastErr = (e && e.name === 'AbortError') ? 'اتصال کند بود — دوباره تلاش می‌کنیم' : 'ارتباط موقتاً قطع شد';
      } finally {
        if (timer) clearTimeout(timer);
      }
      await delay(backoffDelay(i));
    }
    // تیک‌های پس‌زمینه (قیمت/جزئیات) نباید نوار وضعیت را پر کنند — ولی در «مدار قطع‌کننده» شمرده می‌شوند
    diagNote('raw', false, Date.now() - t0);
    diag.lastErr = lastErr || '';
    noteNetFailure(lastErr || 'دریافت داده ناموفق بود');
    return null;
  }

  // پنج صف اول خرید/فروش (Best Limits)
  async function fetchBestLimits(insCode, timeoutMs, extraOpts) {
    if (!insCode) return null;
    return netDedup('B:' + String(insCode), () => fetchBestLimitsUncached(insCode, timeoutMs, extraOpts));
  }
  async function fetchBestLimitsUncached(insCode, timeoutMs, extraOpts) {
    const t0 = Date.now();
    const url = 'https://cdn.tsetmc.com/api/BestLimits/' + encodeURIComponent(String(insCode));
    let ctrl = null;
    let timer = null;
    try {
      if (typeof AbortController !== 'undefined') {
        ctrl = new AbortController();
        timer = setTimeout(() => { try { ctrl.abort(); } catch (e) {} }, timeoutMs || 5000);
      }
      const resp = await fetch(liveUrl(url), Object.assign({}, LIVE_FETCH_OPTS, extraOpts || {}, { signal: ctrl ? ctrl.signal : undefined }));
      if (!resp.ok) { diagNote('bestlimits', false, Date.now() - t0); return null; }
      const j = await resp.json().catch(() => null);
      const rows = (j && (j.bestLimits || j.BestLimits || j)) || [];
      diagNote('bestlimits', !!j, Date.now() - t0);
      try { if (Array.isArray(rows) && rows.length) checkDataShape('bestlimits', rows[0]); } catch (e) {}
      return Array.isArray(rows) ? rows.slice(0, 5) : null;
    } catch (e) {
      diagNote('bestlimits', false, Date.now() - t0);
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  // آیا قیمت خارج از دامنهٔ نوسان مجاز امروز است؟ (سفارش قدیمی/باقی‌مانده از قبل که سایت پاک نکرده)
  function isOutOfRange(price, thresh) {
    if (!price || !thresh) return false;
    if (thresh.max > 0 && price > thresh.max) return true;
    if (thresh.min > 0 && price < thresh.min) return true;
    return false;
  }
  const OOR_TITLE = 'خارج از دامنهٔ نوسان امروز — احتمالاً سفارش قدیمی (صف روزهای قبل) که هنوز حذف نشده';
  // همیشه دقیقاً ۵ سرخط — حتی اگر داده کمتر/خالی باشد (ارتفاع جدول ثابت می‌ماند)
  const OB_LEVELS = 5;
  function padOrderBookRows(rows) {
    const src = Array.isArray(rows) ? rows.slice(0, OB_LEVELS) : [];
    const out = src.slice();
    while (out.length < OB_LEVELS) out.push({});
    return out;
  }
  function formatOrderBook(rows, thresh, range) {
    // چپ = فروش (Ask) · راست = خرید (Bid) — مثل tsetmc
    const levels = padOrderBookRows(rows);
    let maxVol = 1;
    levels.forEach((r) => {
      maxVol = Math.max(maxVol, asNum(r && r.qTitMeDem, 0), asNum(r && r.qTitMeOf, 0));
    });
    if (!(maxVol > 0)) maxVol = 1;
    let body = '';
    let sumAskVol = 0, sumAskCnt = 0, sumBidVol = 0, sumBidCnt = 0;
    levels.forEach((r, i) => {
      const bidVol = asNum(r && r.qTitMeDem, 0);
      const bidCnt = asNum(r && r.zOrdMeDem, 0);
      const bidP = asNum(r && r.pMeDem, 0);
      const askP = asNum(r && r.pMeOf, 0);
      const askCnt = asNum(r && r.zOrdMeOf, 0);
      const askVol = asNum(r && r.qTitMeOf, 0);
      sumAskVol += askVol; sumAskCnt += askCnt;
      sumBidVol += bidVol; sumBidCnt += bidCnt;
      const empty = !(askP || bidP || askVol || bidVol || askCnt || bidCnt);
      const askW = askVol ? Math.max(4, Math.round((askVol / maxVol) * 100)) : 0;
      const bidW = bidVol ? Math.max(4, Math.round((bidVol / maxVol) * 100)) : 0;
      const bestCls = (i === 0 && !empty) ? ' tsext-ob-best' : '';
      const emptyCls = empty ? ' tsext-ob-empty-row' : '';
      const askOor = isOutOfRange(askP, thresh) ? ' tsext-ob-oor' : '';
      const bidOor = isOutOfRange(bidP, thresh) ? ' tsext-ob-oor' : '';
      const askTitle = askOor ? ' title="' + OOR_TITLE + '"' : '';
      const bidTitle = bidOor ? ' title="' + OOR_TITLE + '"' : '';
      body += '<tr class="tsext-ob-row' + bestCls + emptyCls + '">'
        + '<td class="ask-c' + askOor + '"' + askTitle + '>' + (askCnt ? num(askCnt) : '–') + '</td>'
        + '<td class="vol-cell ask-c' + askOor + '"' + askTitle + '><span class="vol-bar ask" style="width:' + askW + '%"></span><span class="vol-txt">' + (askVol ? num(askVol) : '–') + '</span></td>'
        + '<td class="' + askOor.trim() + '"' + askTitle + '><span class="px-ask' + askOor + '">' + (askP ? num(askP) : '–') + '</span></td>'
        + '<td class="' + bidOor.trim() + '"' + bidTitle + '><span class="px-bid' + bidOor + '">' + (bidP ? num(bidP) : '–') + '</span></td>'
        + '<td class="vol-cell bid-c' + bidOor + '"' + bidTitle + '><span class="vol-bar bid" style="width:' + bidW + '%"></span><span class="vol-txt">' + (bidVol ? num(bidVol) : '–') + '</span></td>'
        + '<td class="bid-c' + bidOor + '"' + bidTitle + '>' + (bidCnt ? num(bidCnt) : '–') + '</td>'
        + '</tr>';
    });
    const foot = '<div class="tsext-ob-foot" dir="ltr">'
      + '<span class="ask-tot">▼ ' + num(sumAskCnt) + ' <span class="lbl">·</span> ' + num(sumAskVol) + '</span>'
      + '<span class="lbl">جمع صف</span>'
      + '<span class="bid-tot">' + num(sumBidVol) + ' <span class="lbl">·</span> ' + num(sumBidCnt) + ' ▲</span>'
      + '</div>';
    return (range ? formatRangeBar(range) : '')
      + '<div class="tsext-ob tsext-ob-fresh" dir="ltr">'
      + '<table class="tsext-ob-table tsext-ob-fixed5" dir="ltr"><thead>'
      + '<tr class="tsext-ob-grouprow"><th colspan="3" class="ask-c">فروش</th><th colspan="3" class="bid-c">خرید</th></tr>'
      + '<tr><th>تعداد</th><th>حجم</th><th>قیمت</th><th>قیمت</th><th>حجم</th><th>تعداد</th></tr>'
      + '</thead><tbody>' + body + '</tbody></table>'
      + foot + '</div>';
  }
  // به‌روزرسانی نرمِ جدول سفارشات (بدون بازسازی/چشمک کل جدول): فقط سلول‌هایی که مقدارشان
  // واقعاً عوض شده به‌روز می‌شوند و یک هایلایت بسیار کوتاه می‌گیرند؛ بقیهٔ سلول‌ها اصلاً دست نمی‌خورند
  // تا قیمت‌ها تا حد امکان «زنده/ثابت» بمانند و چشم با پرش/تکان کل جدول اذیت نشود.
  // اگر ساختار جدول موجود با ردیف‌های جدید هم‌خوان نباشد (تعداد ردیف فرق کند و ...)، false برمی‌گرداند
  // تا فراخوانندهٔ آن به بازسازی کامل قدیمی برگردد.
  function patchOorCell(td, inner, isOor) {
    if (!td) return;
    td.classList.toggle('tsext-ob-oor', !!isOor);
    if (isOor) td.title = OOR_TITLE; else td.removeAttribute('title');
    if (inner) inner.classList.toggle('tsext-ob-oor', !!isOor);
  }
  function patchOrderBook(slot, rows, thresh) {
    const levels = padOrderBookRows(rows);
    const tbody = slot.querySelector('.tsext-ob-table tbody');
    if (!tbody) return false;
    const trs = tbody.querySelectorAll('tr.tsext-ob-row');
    // همیشه ۵ ردیف ثابت — اگر ساختار فرق کند full rebuild
    if (trs.length !== OB_LEVELS) return false;
    let maxVol = 1;
    levels.forEach((r) => { maxVol = Math.max(maxVol, asNum(r && r.qTitMeDem, 0), asNum(r && r.qTitMeOf, 0)); });
    if (!(maxVol > 0)) maxVol = 1;
    let sumAskVol = 0, sumAskCnt = 0, sumBidVol = 0, sumBidCnt = 0;
    levels.forEach((r, i) => {
      const tr = trs[i];
      const cells = tr.children;
      if (cells.length < 6) return;
      const bidVol = asNum(r && r.qTitMeDem, 0);
      const bidCnt = asNum(r && r.zOrdMeDem, 0);
      const bidP = asNum(r && r.pMeDem, 0);
      const askP = asNum(r && r.pMeOf, 0);
      const askCnt = asNum(r && r.zOrdMeOf, 0);
      const askVol = asNum(r && r.qTitMeOf, 0);
      sumAskVol += askVol; sumAskCnt += askCnt;
      sumBidVol += bidVol; sumBidCnt += bidCnt;
      const empty = !(askP || bidP || askVol || bidVol || askCnt || bidCnt);
      tr.classList.toggle('tsext-ob-empty-row', empty);
      tr.classList.toggle('tsext-ob-best', i === 0 && !empty);
      const askW = askVol ? Math.max(4, Math.round((askVol / maxVol) * 100)) : 0;
      const bidW = bidVol ? Math.max(4, Math.round((bidVol / maxVol) * 100)) : 0;
      const askOor = isOutOfRange(askP, thresh);
      const bidOor = isOutOfRange(bidP, thresh);
      patchCellText(cells[0], askCnt ? num(askCnt) : '–');
      patchVolCell(cells[1], askVol, askW);
      patchCellText(cells[2].querySelector('.px-ask') || cells[2], askP ? num(askP) : '–');
      patchCellText(cells[3].querySelector('.px-bid') || cells[3], bidP ? num(bidP) : '–');
      patchVolCell(cells[4], bidVol, bidW);
      patchCellText(cells[5], bidCnt ? num(bidCnt) : '–');
      patchOorCell(cells[0], null, askOor);
      patchOorCell(cells[1], null, askOor);
      patchOorCell(cells[2], cells[2].querySelector('.px-ask'), askOor);
      patchOorCell(cells[3], cells[3].querySelector('.px-bid'), bidOor);
      patchOorCell(cells[4], null, bidOor);
      patchOorCell(cells[5], null, bidOor);
    });
    const foot = slot.querySelector('.tsext-ob-foot');
    if (foot) {
      const askTot = foot.querySelector('.ask-tot');
      const bidTot = foot.querySelector('.bid-tot');
      if (askTot) askTot.innerHTML = '▼ ' + num(sumAskCnt) + ' <span class="lbl">·</span> ' + num(sumAskVol);
      if (bidTot) bidTot.innerHTML = num(sumBidVol) + ' <span class="lbl">·</span> ' + num(sumBidCnt) + ' ▲';
    }
    return true;
  }
  function patchCellText(el, text) {
    if (!el) return;
    if (el.textContent !== text) {
      el.textContent = text;
      flashCellSoft(el);
    }
  }
  function patchVolCell(td, vol, widthPct) {
    if (!td) return;
    const bar = td.querySelector('.vol-bar');
    const txt = td.querySelector('.vol-txt');
    if (bar) bar.style.width = widthPct + '%';
    if (txt) {
      const newTxt = vol ? num(vol) : '–';
      if (txt.textContent !== newTxt) { txt.textContent = newTxt; flashCellSoft(txt); }
    }
  }
  function flashCellSoft(el) {
    el.classList.remove('tsext-ob-cell-flash');
    void el.offsetWidth;
    el.classList.add('tsext-ob-cell-flash');
    setTimeout(() => { try { el.classList.remove('tsext-ob-cell-flash'); } catch (e) {} }, 500);
  }

  // ----- from src/07a-input-sort.js -----
  // ========== MODULE [7a] input / sort ======================================
  // خواندن ورودی‌های UI + فیلتر ماه + مرتب‌سازی قطعی مشترک همه تب‌ها

  // --------------------------------------------------------------- خواندن ورودی
  function readInputs() {
    const host = ensureSidebar();
    const s = state.strategy;
    const term = ($id(host, 'tsext-underlying-' + s).value || '').trim();
    // جامپ دیگر فیلد قیمت دستی/زنده ندارد (بی‌اثر و حذف شد)؛ برای بقیهٔ تب‌ها همچنان می‌خوانیم
    const manualEl = $id(host, 'tsext-manual-' + s);
    const mv = ((manualEl ? manualEl.value : '') || '').trim();
    const manual = mv === '' ? null : parseUserNumber(mv);
    // فیلتر «حداقل سود» از رابط کاربری حذف شده — همیشه بدون فیلتر سود: همهٔ اعمال، با هر میزان
    // سود یا حتی زیان، نمایش داده می‌شوند (−Infinity در مقایسهٔ profitMonth >= minProfit
    // هیچ‌چیز را رد نمی‌کند).
    const minProfit = -Infinity;
    const commEl = $id(host, 'tsext-comm-' + s);
    const cv = String((commEl ? commEl.value : '') || '').trim();
    // کارمزد فقط اگر عدد مثبت وارد شود اعمال می‌شود؛ در غیر این صورت اعمال نمی‌شود (پیش‌فرض ۰)
    let commission = cv === '' ? null : parseUserNumber(cv);
    if (commission !== null && (isNaN(commission) || commission < 0)) commission = null;
    return {
      term,
      manual,
      minProfit,
      commission: (commission === null || isNaN(commission) || commission <= 0) ? null : commission,
      strategy: s,
      sort: (function () {
        const v = ($id(host, 'tsext-sort') || {}).value || 'profit';
        if (v === 'days') return 'date';
        if (v === 'name') return 'profit'; // گزینه نماد حذف شد
        return v;
      })(),
    };
  }
  // ماه شمسی سررسید از روی Date (تقویم فارسی)
  function shamsiMonthOf(d) {
    if (!d || isNaN(d.getTime())) return null;
    try {
      const parts = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { month: 'numeric' }).formatToParts(d);
      const m = parts.find((p) => p.type === 'month');
      if (m) return parseInt(faDigits(m.value), 10) || null;
    } catch (e) {}
    return null;
  }
  const MONTH_LABELS = ['', 'فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];
  function passesMonthFilter(o) {
    const mf = state.monthFilter;
    if (mf == null || mf === '' || mf === 0) return true; // همه ماه‌ها
    const want = Number(mf);
    if (!(want >= 1 && want <= 12)) return true;
    const d = o.expiry || (o.days != null ? expiryOf({ remainedDay: o.days }, o.days) : null);
    // اگر تاریخ سررسید حدسی است (از today+days ساخته شده)، ماه را فیلتر نکن تا فرصت واقعی حذف نشود
    if (o && (o.expiryGuessed || o.expiryFarGuessed)) return true;
    const m = shamsiMonthOf(d);
    if (m == null) return true;
    return m === want;
  }
  function monthSelectOptionsHtml() {
    const cur = state.monthFilter == null ? '' : String(state.monthFilter);
    const opts = ['<option value="">همه ماه‌ها</option>'];
    for (let i = 1; i <= 12; i++) {
      const sel = String(i) === cur ? ' selected' : '';
      opts.push('<option value="' + i + '"' + sel + '>' + MONTH_LABELS[i] + ' (ماه ' + faDigits(String(i)) + ')</option>');
    }
    return opts.join('');
  }
  function syncMonthSelects() {
    if (!panelHost) return;
    const v = state.monthFilter == null ? '' : String(state.monthFilter);
    const el = $id(panelHost, 'tsext-monthfilter');
    if (el) el.value = v;
  }

  // --------------------------------------------------------- مرتب‌سازی مشترک (قطعی در همه تب‌ها)
  // قانون کلی: حتی با رفرش خودکار و بازار بسته، ترتیب لیست نباید جابه‌جا شود.
  // - کلید سود با دقت نمایش (۲ رقم اعشار) گرد می‌شود تا نوسان جزئی float جابه‌جایی نسازد
  // - در تساوی همیشه تای‌برک پایدار: اعمال → سررسید → شناسه یکتا (insCode / جفت تیک / نماد)
  function round2(v) { const n = Number(v); return isNaN(n) ? 0 : Math.round(n * 100) / 100; }
  function round4(v) { const n = Number(v); return isNaN(n) ? 0 : Math.round(n * 10000) / 10000; }
  function strikeOf(o) {
    const s = (o.strike != null ? o.strike
      : (o.strikeSell != null ? o.strikeSell
        : (o.lower != null ? o.lower : 0)));
    const n = Number(s);
    return isNaN(n) ? 0 : n;
  }
  function expOf(o) {
    if (o.expiry && !isNaN(o.expiry.getTime())) return o.expiry.getTime();
    const d = Number(o.days != null ? o.days : o.targetDays);
    return isNaN(d) ? 0 : d;
  }
  function idOf(o) {
    if (o.insCode != null && o.insCode !== '') return 'i:' + String(o.insCode);
    if (o.insCodeSell != null && o.insCodeSell !== '') {
      return 'c:' + String(o.insCodeBuy || '') + '>' + String(o.insCodeSell);
    }
    if (o.lower != null && o.upper != null) {
      return 't:' + String(o.lower) + '-' + String(o.upper) + ':' + String(o.days || 0);
    }
    if (o.ticker) return 'n:' + String(o.ticker);
    if (o.tickerSell) return 'n:' + String(o.tickerSell);
    return 'k:' + String(strikeOf(o)) + ':' + String(expOf(o));
  }
  function tieBreak(a, b) {
    const s = strikeOf(a) - strikeOf(b); if (s) return s;
    const e = expOf(a) - expOf(b); if (e) return e;
    return idOf(a).localeCompare(idOf(b), 'en');
  }
  function classRank(o) {
    const c = (o && o.class) != null ? String(o.class) : 'X';
    return CLASS_ORDER.hasOwnProperty(c) ? CLASS_ORDER[c] : 9;
  }
  function cmpProfitDesc(a, b) {
    const d = round2(b.profitMonth) - round2(a.profitMonth);
    return d || tieBreak(a, b);
  }
  function nameOf(o) {
    const n = (o && (o.ticker || o.name || o.tickerSell || o.tickerBuy || '')) || '';
    return String(n);
  }
  function daysOf(o) {
    const d = Number(o && (o.days != null ? o.days : o.targetDays));
    return isNaN(d) ? 0 : d;
  }
  function applySort(list, sort, kind) {
    // days از UI حذف شد (با date یکی بود) — تنظیمات قدیمی days≡date
    if (sort === 'date' || sort === 'days') list.sort((a, b) => (expOf(a) - expOf(b)) || tieBreak(a, b));
    else if (sort === 'name') list.sort((a, b) => nameOf(a).localeCompare(nameOf(b), 'fa') || tieBreak(a, b));
    else if (sort === 'strike') list.sort((a, b) => (strikeOf(a) - strikeOf(b)) || tieBreak(a, b));
    else if (sort === 'class') list.sort((a, b) => (classRank(a) - classRank(b)) || cmpProfitDesc(a, b));
    else list.sort(cmpProfitDesc); // pospanj / jamp / combo / پیش‌فرض سود
    return list;
  }

  // ----- from src/07a-live-data.js -----
  // ========== MODULE [7a] live data / health / range ========================
  // سلامت داده، نوار قیمت، توقف نماد، closing، قیمت قابل‌اجرا، تیک‌های زنده

  // --------------------------------------------------------------- دریافت داده (یک‌بار) + رندر
  // فقط این تابع به شبکه وصل می‌شود؛ سوییچ بین تب‌ها/مرتب‌سازی/فیلتر کلاس از renderActive (بدون fetch) استفاده می‌کند.
  function setGoLoading(on) {
    // بی‌صدا در پس‌زمینه انجام می‌شود؛ دکمه یا وضعیت تغییر نمی‌کند
  }
  function setUpdatedNow() {
    state.lastDataAt = Date.now();
    updateAgeLabel();
  }
  // ---------- v1.29: نشانگر سلامت داده (سبز/زرد/قرمز + آخرین به‌روزرسانی موفق) ----------
  //   قرمز = ساختار پاسخ tsetmc عوض شده (checkDataShape)  ·  زرد = شبکه ناپایدار/داده کهنه  ·  سبز = سالم
  function healthLevel(ageSec) {
    if (Object.keys(dataHealth.bad).length) return 'bad';
    if ((state.netFailCount || 0) > 0 || ageSec >= 30) return 'warn';
    return 'ok';
  }
  function healthDotHtml(ageSec) {
    const lv = healthLevel(ageSec);
    let t;
    try { t = new Date(state.lastDataAt).toLocaleTimeString('fa-IR', { hour12: false }); } catch (e) { t = ''; }
    const label = lv === 'bad' ? 'ساختار داده تغییر کرده' : (lv === 'warn' ? 'داده کهنه یا شبکه ناپایدار' : 'داده سالم');
    const title = 'سلامت داده: ' + label + '\nآخرین به‌روزرسانی موفق: ' + t
      + (lv === 'bad' ? '\n' + healthSummary() : '') + (lv === 'warn' && state.netFailCount ? '\nشکست‌های پیاپی شبکه: ' + state.netFailCount : '') + '\n(کلیک: پنل تشخیصی محلی)';
    return ' <span class="tsext-health-dot ' + lv + '" role="status" aria-label="' + esc(label) + '" title="' + esc(title) + '"><i></i></span>';
  }
  function updateAgeLabel() {
    const el = panelHost && panelHost.querySelector('#tsext-updated');
    if (el) {
      if (!state.lastDataAt) {
        el.innerHTML = '';
        el.classList.remove('tsext-live-hot', 'tsext-live-warm', 'tsext-live-cold', 'tsext-live-close');
      } else {
        const ageSec = (Date.now() - state.lastDataAt) / 1000;
        const baseLive = !!(state.cache && state.cache.livePriceIsLive);
        const baseTag = baseLive ? 'زنده' : 'پایانی';
        let txt, cls;
        if (ageSec < 0.9) {
          txt = '<span class="tsext-pulse-dot" aria-hidden="true"></span> ' + baseTag + ' · همین الان';
          cls = baseLive ? 'tsext-live-hot' : 'tsext-live-close';
        } else if (ageSec < 3) {
          txt = '<span class="tsext-pulse-dot" aria-hidden="true"></span> ' + baseTag + ' · ' + faDigits(ageSec.toFixed(1)) + 'ث پیش';
          cls = baseLive ? 'tsext-live-hot' : 'tsext-live-close';
        } else if (ageSec < 60) {
          txt = '<span class="tsext-pulse-dot tsext-pulse-slow" aria-hidden="true"></span> ' + baseTag + ' · ' + faDigits(ageSec.toFixed(1)) + 'ث پیش';
          cls = baseLive ? 'tsext-live-warm' : 'tsext-live-close';
        } else {
          txt = '<span class="tsext-pulse-dot tsext-pulse-slow" aria-hidden="true"></span> آخرین داده · ' + faDigits(Math.round(ageSec / 60)) + 'د پیش';
          cls = 'tsext-live-cold';
        }
        el.innerHTML = txt + healthDotHtml(ageSec);
        el.title = (baseLive ? 'قیمت سهم پایه از آخرین معامله امروز' : 'قیمت سهم پایه: پایانی (امروز معامله نشده یا داده زنده نیست)')
          + ' · سن داده از tsetmc'
          + (state.turboActive ? ' · توربو فعال' : '')
          + (state.noChangeStreak >= ADAPT_STREAK ? ' · Adaptive (بازار ساکت)' : '');
        el.classList.remove('tsext-live-hot', 'tsext-live-warm', 'tsext-live-cold', 'tsext-live-close');
        el.classList.add(cls);
        el.style.color = '';
        // سن داده > ۳ث → اعداد لیست کمی کم‌رنگ (حس زنده بودن بدون آلارم)
        try {
          if (panelHost) panelHost.classList.toggle('tsext-data-stale', ageSec >= 3);
        } catch (eSt) {}
      }
    }
    const mw = panelHost && panelHost.querySelector('#tsext-market-wrap');
    if (mw) mw.innerHTML = marketStatusHtml();
  }

  // واکشی قیمت لحظه‌ای یک نماد — سبک‌تر و معمولاً تازه‌تر از OptionMarketWatch
  async function fetchClosingInfo(insCode, extraOpts) {
    if (!insCode) return null;
    const j = await apiGetRaw('https://cdn.tsetmc.com/api/ClosingPrice/GetClosingPriceInfo/' + encodeURIComponent(String(insCode)), 1, extraOpts);
    const info = (j && (j.closingPriceInfo || j.closingpriceinfo)) || null;
    if (!info) return null;
    try { checkDataShape('closing', info); } catch (e) {}
    const pLast = Number(info.pDrCotVal) || Number(info.pl) || Number(info.last) || 0;
    const pClose = Number(info.pClosing) || Number(info.pc) || 0;
    const yPrice = Number(info.priceYesterday) || Number(info.py) || 0;
    // کمینه/بیشینهٔ معامله‌شدهٔ امروز + اولین قیمت (در صورت موجود بودن)
    const dayLow = Number(info.priceMin) || Number(info.pMin) || Number(info.min) || 0;
    const dayHigh = Number(info.priceMax) || Number(info.pMax) || Number(info.max) || 0;
    const pFirst = Number(info.priceFirst) || Number(info.pf) || Number(info.first) || 0;
    // تعداد معاملات امروز (اگر فیلدش باشد) — برای تشخیص «امروز معامله نشده» در نوار نوسان قیمت
    const nTr = (info.zTotTran !== undefined && info.zTotTran !== null) ? Number(info.zTotTran) : null;
    // وضعیت نماد (مجاز / ممنوع / متوقف …) + ساعت آخرین معامله (hEven به شکل HHMMSS) — v1.23
    const st = info.instrumentState || info.instrumentstate || null;
    const status = st ? String(st.cEtavalTitle || st.cetavaltitle || '').trim() : '';
    const hEven = Number(info.hEven) || Number(info.heven) || 0;
    // تاریخ آخرین معامله (dEven به شکل YYYYMMDD) — اگر «امروزِ تهران» باشد و ساعتی ثبت شده، یعنی بازار واقعاً
    // معامله دارد؛ در روزهای تعطیلِ تقویم، همین باعث بازگشت خودکار به حالت زنده می‌شود (v1.24)
    const dEven = Number(info.dEven) || Number(info.deven) || 0;
    if (dEven && hEven > 0) { try { if (dEven === tehranDEven()) state.lastTodayTradeAt = Date.now(); } catch (e) {} }
    const out = { insCode: String(insCode), pLast, pClose, yPrice, dayLow, dayHigh, pFirst, nTrades: nTr, status, hEven, dEven, raw: info };
    // کش کوتاه‌مدت: تیک حیاتی هر ~۳۰۰ms همین داده را می‌گیرد؛ نوار نوسان قیمت از همین کش می‌خواند
    // تا درخواست تکراری به tsetmc نرود و نشانگر «آخرین قیمت» همیشه زنده بماند.
    try {
      if (!state.closingCache) state.closingCache = Object.create(null);
      state.closingCache[out.insCode] = { at: Date.now(), info: out };
    } catch (e) {}
    return out;
  }

  // بهترین خرید/فروش از ۵ سرخط صف — برای نوار نوسان قیمت (وقتی امروز معامله‌ای نشده)
  function bookPriceHints(rows) {
    if (!Array.isArray(rows) || !rows.length) return null;
    let bestBid = 0, bestAsk = 0;
    for (const r of rows) {
      const bid = asNum(r && r.pMeDem, 0);
      const ask = asNum(r && r.pMeOf, 0);
      if (bid > 0 && (!bestBid || bid > bestBid)) bestBid = bid;
      if (ask > 0 && (!bestAsk || ask < bestAsk)) bestAsk = ask;
    }
    if (!(bestBid > 0) && !(bestAsk > 0)) return null;
    const mid = (bestBid > 0 && bestAsk > 0) ? ((bestBid + bestAsk) / 2) : (bestBid || bestAsk);
    return { bestBid, bestAsk, mid };
  }

  // رنگ کندل (منطق ایزی‌تریدر): سبز اگر آخرین ≥ اولین معاملهٔ امروز، قرمز اگر کمتر.
  // اگر امروز معامله نشده یا «اولین» را نداریم: نسبت به پایانی دیروز.
  function rangeIsUp(d) {
    if (!d) return true;
    const last = d.last || 0;
    if (d.hasTrades && d.pFirst > 0 && last > 0 && !d.lastIsMid) return last >= d.pFirst;
    if (last > 0 && d.y > 0) return last >= d.y;
    return true;
  }

  // تکمیل دادهٔ نوار با قیمت‌های صف: بهترین خرید/فروش + اگر «آخرین» نداریم، وسطِ صف
  function refineRangeWithBook(data, rows) {
    if (!data) return data;
    const book = bookPriceHints(rows);
    if (!book) return data;
    const out = Object.assign({}, data);
    out.bestBid = book.bestBid || 0;
    out.bestAsk = book.bestAsk || 0;
    if (!(out.last > 0) && book.mid > 0) { out.last = book.mid; out.lastIsMid = true; }
    if (out.hasTrades && out.last > 0 && !out.lastIsMid) {
      if (out.last < out.dayLow) out.dayLow = out.last;
      if (out.last > out.dayHigh) out.dayHigh = out.last;
    }
    out.up = rangeIsUp(out);
    return out;
  }

  // چقدر تازه بودن کش ClosingPriceInfo برای نوار کافی است (تیک حیاتی هر ~۳۰۰ms آن را تازه می‌کند)
  const OB_RANGE_FRESH_MS = 1500;

  // دادهٔ نوار نوسان قیمت یک نماد — همان اعدادی که «کندل افقی» ایزی‌تریدر از آن‌ها ساخته می‌شود:
  //   limitLow/limitHigh = کف/سقف مجاز امروز (psGelStaMin/psGelStaMax)  → دو سر خط زمینه
  //   y                  = پایانی دیروز (تیک وسط)   last = آخرین معامله (▼)   close = پایانی امروز (▲)
  //   pFirst             = اولین معاملهٔ امروز  → بدنهٔ کندل = pFirst تا last
  //   dayLow/dayHigh     = کمترین/بیشترین معاملهٔ امروز → سایهٔ کندل  (hasTrades=false اگر امروز معامله نشده)
  //   opts.option=true   = قرارداد اختیار: دو سر نوار = ۰ ریال تا ۲×پایانی دیروز (صفرِ نوار = پایانی دیروز)
  async function getObDayRange(insCode, hintRows, opts) {
    if (!insCode) return null;
    const key = String(insCode);
    const now = Date.now();
    if (!state.obDayRange) state.obDayRange = Object.create(null);
    const cached = state.obDayRange[key];
    try {
      // ۱) قیمت‌ها: از کش تازهٔ تیک حیاتی، وگرنه یک واکشی سبک
      let close = null;
      const cc = state.closingCache && state.closingCache[key];
      if (cc && cc.info && (now - cc.at) < OB_RANGE_FRESH_MS) close = cc.info;
      else close = await fetchClosingInfo(key, { priority: 'low' });
      // ۲) دامنهٔ مجاز: یک‌بار در روز (کش obThresh)
      const th = await getObThreshold(key);

      const y = (close && close.yPrice) || 0;
      const pClose = (close && close.pClose) || 0;
      const pFirst = (close && close.pFirst) || 0;
      let dayLow = (close && close.dayLow) || 0;
      let dayHigh = (close && close.dayHigh) || 0;
      const nTr = close ? close.nTrades : null;
      const hasTrades = dayLow > 0 && dayHigh > 0 && !(typeof nTr === 'number' && isFinite(nTr) && nTr <= 0);
      let last = (close && close.pLast) || 0;
      if (!(last > 0)) last = pClose || 0;
      let limitLow = (th && th.min) || 0;
      let limitHigh = (th && th.max) || 0;
      let synthetic = false;
      let mode = 'stock';
      const book = bookPriceHints(hintRows);
      if (!(last > 0) && book && book.mid > 0) last = book.mid;

      if (opts && opts.option) {
        // قرارداد اختیار (ایزی‌تریدر): محور همیشه ۰ تا ۲×مرجع؛ مرجع = پایانی دیروز
        mode = 'option';
        let yRef = y;
        if (!(yRef > 0)) {
          // هنوز پایانی دیروز نیست — مرجع موقت از آخرین/وسط صف تا محور شبیه سهم نشود
          yRef = last || (book && book.mid) || pClose || 0;
          if (yRef > 0) synthetic = true;
        }
        if (yRef > 0) {
          limitLow = 0;
          limitHigh = 2 * yRef;
          if (!(y > 0)) y = yRef; // مرکز نوار
        } else if (!(limitLow > 0 && limitHigh > limitLow && limitHigh < 1e12)) {
          const refs = [dayLow, dayHigh, last, pClose, pFirst, book && book.bestBid, book && book.bestAsk].filter((v) => v > 0);
          if (refs.length) {
            const mn = Math.min.apply(null, refs);
            const mx = Math.max.apply(null, refs);
            const pad = Math.max((mx - mn) * 0.25, mx * 0.05, mn * 0.05, 1);
            limitLow = Math.max(0, mn - pad);
            limitHigh = mx + pad;
            synthetic = true;
          } else if (cached && cached.data && cached.data.mode === 'option') {
            return refineRangeWithBook(cached.data, hintRows) || cached.data;
          } else {
            return null;
          }
        }
      } else if (!(limitLow > 0 && limitHigh > limitLow && limitHigh < 1e12)) {
        // سهم پایه / غیر اختیار
        const refs = [dayLow, dayHigh, last, y, pClose, pFirst, book && book.bestBid, book && book.bestAsk].filter((v) => v > 0);
        if (refs.length) {
          const mn = Math.min.apply(null, refs);
          const mx = Math.max.apply(null, refs);
          const pad = Math.max((mx - mn) * 0.25, mx * 0.05, mn * 0.05, 1);
          limitLow = Math.max(0, mn - pad);
          limitHigh = mx + pad;
          synthetic = true;
        } else if (cached && cached.data) {
          return refineRangeWithBook(cached.data, hintRows) || cached.data;
        } else {
          return null;
        }
      }
      if (hasTrades && dayHigh < dayLow) { const t = dayLow; dayLow = dayHigh; dayHigh = t; }
      if (hasTrades && last > 0 && close && close.pLast > 0) {
        if (last < dayLow) dayLow = last;
        if (last > dayHigh) dayHigh = last;
      }
      if (hasTrades && pFirst > 0) {
        if (pFirst < dayLow) dayLow = pFirst;
        if (pFirst > dayHigh) dayHigh = pFirst;
      }
      const data = {
        last, y, close: pClose, pFirst, dayLow, dayHigh, hasTrades,
        limitLow, limitHigh, synthetic, mode,
        bestBid: 0, bestAsk: 0, lastIsMid: false,
        status: (close && close.status) || '', hEven: (close && close.hEven) || 0,
        up: true,
      };
      data.up = rangeIsUp(data);
      state.obDayRange[key] = { at: now, data };
      return refineRangeWithBook(data, hintRows) || data;
    } catch (e) {
      return cached && cached.data ? (refineRangeWithBook(cached.data, hintRows) || cached.data) : null;
    }
  }

  // hEven (مثل 123045) → «۱۲:۳۰» یا با ثانیه «۱۲:۳۰:۴۵»
  function fmtHEven(h, withSec) {
    const n = Number(h) || 0;
    if (!(n > 0)) return '';
    const s = String(n).padStart(6, '0');
    const hh = s.slice(0, 2), mm = s.slice(2, 4), ss = s.slice(4, 6);
    return toDisplayDigits(hh + ':' + mm + (withSec ? (':' + ss) : ''));
  }
  // وضعیت نماد غیرعادی است؟ (هرچیزی جز «مجاز»)
  function statusIsAbnormal(status) {
    const s = String(status || '').trim();
    return !!s && s !== 'مجاز';
  }

  // ---------- v1.29: پرچم «نماد متوقف است» ----------
  // وضعیت نماد از ClosingPriceInfo (instrumentState.cEtavalTitle) می‌آید و در state.closingCache می‌ماند.
  // فقط نمادهایی که تیک قیمت برایشان می‌گیرد (سهم پایه + ردیف‌های دیدنی + جزئیات باز) وضعیتشان معلوم است.
  function isHaltedStatus(status) { return /متوقف/.test(String(status || '')); }
  function haltedByCode(code) {
    try {
      const c = state.closingCache && state.closingCache[String(code)];
      return !!(c && c.info && isHaltedStatus(c.info.status));
    } catch (e) { return false; }
  }
  function underlyingCode() {
    try { return (state.cache && state.cache.rows && state.cache.rows[0]) ? String(state.cache.rows[0].uaInsCode || '') : ''; } catch (e) { return ''; }
  }
  function underlyingHalted() { const u = underlyingCode(); return !!u && haltedByCode(u); }
  const HALT_TEXT = 'نماد متوقف است';
  function applyHaltFlags() {
    if (!panelHost) return;
    const uaHalt = underlyingHalted();
    panelHost.querySelectorAll('#tsext-list .tsext-bar').forEach((b) => {
      const sp = b.__tsextSpec || {};
      const codes = [sp.insCode, sp.insCodeBuy, sp.insCodeSell];
      const optHalt = codes.some((c) => c && haltedByCode(c));
      const cell = b.querySelector('.tsext-bar-name');
      if (!cell) return;
      let badge = cell.querySelector('.tsext-halt-badge');
      const want = optHalt || uaHalt;
      b.classList.toggle('tsext-bar-halted', want);
      if (want && !badge) {
        badge = document.createElement('span');
        badge.className = 'tsext-halt-badge';
        badge.textContent = HALT_TEXT;
        cell.appendChild(badge);
      }
      if (badge) {
        if (!want) badge.remove();
        else badge.title = optHalt ? 'قرارداد اختیار متوقف است — قیمت/صف قابل‌اتکا نیست' : 'سهم پایه متوقف است — قیمت مبنا قابل‌اتکا نیست';
      }
    });
    const pi = priceInfoEl();
    if (pi) {
      let chip = pi.querySelector('.tsext-halt-chip');
      if (uaHalt && !chip) {
        chip = document.createElement('span');
        chip.className = 'tsext-halt-chip';
        chip.textContent = 'سهم پایه: ' + HALT_TEXT;
        pi.appendChild(chip);
      } else if (!uaHalt && chip) chip.remove();
    }
  }
  function pctOnTrack(val, lo, hi) {
    if (!(hi > lo)) return 50;
    const p = ((Number(val) - lo) / (hi - lo)) * 100;
    return Math.max(0, Math.min(100, p));
  }

  // هندسه و متن‌های نوار — مشترک بین رندر اولیه (formatRangeBar) و به‌روزرسانی نرم (patchRangeBar)
  // کندل افقی ایزی‌تریدر: سایه = کمترین..بیشترین امروز، بدنه = اولین معامله..آخرین معامله
  function rangeBarGeom(range, sticky) {
    if (!range || !(range.limitHigh > range.limitLow)) return null;
    let lo = range.limitLow, hi = range.limitHigh;
    const last = range.last || 0;
    const y = range.y || 0;
    const close = range.close || 0;
    const first = range.pFirst || 0;
    const hasTrades = !!range.hasTrades;
    const realLast = hasTrades && last > 0 && !range.lastIsMid;
    // محور چسبنده: فقط وقتی حالت (اختیار/سهم) یکی است؛ وگرنه محور جدید
    if (sticky && sticky.hi > sticky.lo) {
      const isOpt = range.mode === 'option';
      const stickyOpt = sticky.mode === 'option' || (sticky.lo === 0 && sticky.y > 0 && Math.abs(sticky.hi - 2 * sticky.y) < 1);
      if (isOpt && !stickyOpt) {
        // قبلاً محور سهم/synthetic بود — برای اختیار از نو ۰..۲y
        if (y > 0) { lo = 0; hi = 2 * y; }
      } else if (!isOpt && stickyOpt) {
        // عوض شدن از اختیار به سهم — sticky را نادیده بگیر
      } else if (isOpt && y > 0 && sticky.y > 0 && Math.abs(sticky.y - y) / sticky.y > 0.01) {
        lo = 0; hi = 2 * y;
      } else if (isOpt || sticky.mode === range.mode || !sticky.mode) {
        lo = sticky.lo; hi = sticky.hi;
      }
    }
    // سایهٔ کندل: کمترین تا بیشترین معاملهٔ امروز
    let wLo = 0, wHi = 0, hasWick = false;
    if (hasTrades && range.dayLow > 0 && range.dayHigh > 0) {
      wLo = Math.min(range.dayLow, range.dayHigh); wHi = Math.max(range.dayLow, range.dayHigh); hasWick = true;
    }
    // بدنهٔ کندل: اولین معامله تا آخرین معامله
    let bLo = 0, bHi = 0, bandKind = '';
    if (realLast && first > 0) { bLo = Math.min(first, last); bHi = Math.max(first, last); bandKind = 'candle'; }
    else if (realLast && hasWick) { bLo = wLo; bHi = wHi; bandKind = 'day'; }
    else if (realLast) { bLo = bHi = last; bandKind = 'day'; }
    else if (range.bestBid > 0 && range.bestAsk > 0) { bLo = range.bestBid; bHi = range.bestAsk; bandKind = 'book'; }
    else if (range.bestBid > 0 || range.bestAsk > 0) { bLo = bHi = (range.bestBid || range.bestAsk); bandKind = 'book'; }
    if (bHi < bLo) { const t = bLo; bLo = bHi; bHi = t; }
    if (hasWick && bandKind !== 'book') { if (bLo < wLo) wLo = bLo; if (bHi > wHi) wHi = bHi; }
    const up = rangeIsUp(range);
    const chg = (last > 0 && y > 0) ? (((last - y) / y) * 100) : null;
    const chgTxt = (chg == null) ? '' : ((chg >= 0 ? '+' : '−') + num(Math.abs(Math.round(chg * 100) / 100)) + '٪');
    const bandL = bandKind ? pctOnTrack(bLo, lo, hi) : 0;
    const bandR = bandKind ? pctOnTrack(bHi, lo, hi) : 0;
    const wickL = hasWick ? pctOnTrack(wLo, lo, hi) : 0;
    const wickR = hasWick ? pctOnTrack(wHi, lo, hi) : 0;
    return {
      lo, hi, last, y, close, first, up, chgUp: (chg == null) ? up : (chg >= 0), chgTxt,
      hasTrades, hasWick, wLo, wHi, bandKind, bLo, bHi,
      synthetic: !!range.synthetic,
      isOption: range.mode === 'option',
      lastOver: last > hi, closeOver: close > hi,
      lastIsMid: !!range.lastIsMid,
      lastTime: hasTrades ? fmtHEven(range.hEven, false) : '',
      lastTimeFull: hasTrades ? fmtHEven(range.hEven, true) : '',
      status: String(range.status || ''),
      statusBad: statusIsAbnormal(range.status),
      pLast: last > 0 ? pctOnTrack(last, lo, hi) : null,
      pRef: y > 0 ? pctOnTrack(y, lo, hi) : null,
      pClose: close > 0 ? pctOnTrack(close, lo, hi) : null,
      wickL, wickW: hasWick ? Math.max(0, wickR - wickL) : 0,
      bandL, bandW: bandKind ? Math.max(0.6, bandR - bandL) : 0,
      showLast: last > 0,
      showClose: close > 0 && hasTrades,
    };
  }
  function rangeBarTitles(g) {
    const lastLbl = g.lastIsMid ? 'وسط صف (معامله‌ای نشده)' : 'آخرین معامله';
    const candleLbl = g.up ? 'کندل صعودی' : 'کندل نزولی';
    const bandTip = g.bandKind === 'candle'
      ? ('بدنهٔ ' + candleLbl + ': از اولین معامله ' + num(g.first) + ' تا آخرین معامله ' + num(g.last))
      : (g.bandKind === 'day'
        ? ('بازهٔ معاملات امروز: ' + num(g.bLo) + ' تا ' + num(g.bHi) + ' (قیمت اولین معامله دریافت نشد)')
        : (g.bandKind === 'book' ? ('امروز معامله نشده — بهترین خرید ' + num(g.bLo) + ' تا بهترین فروش ' + num(g.bHi)) : ''));
    const wickTip = g.hasWick ? ('سایهٔ کندل: کمترین ' + num(g.wLo) + ' تا بیشترین ' + num(g.wHi) + ' معاملهٔ امروز') : '';
    const overTip = ' — بیرون از نوار (بیش از +۱۰۰٪ پایانی دیروز)';
    const all = [
      g.isOption
        ? ('نوار قرارداد: ۰ ریال (−۱۰۰٪) تا ' + num(g.hi) + ' (+۱۰۰٪ پایانی دیروز)')
        : ('کف مجاز ' + num(g.lo) + ' · سقف مجاز ' + num(g.hi) + (g.synthetic ? ' (تقریبی)' : '')),
      g.y ? ('پایانی دیروز (قیمت مرجع) ' + num(g.y)) : '',
      (g.hasTrades && g.first) ? ('اولین معامله ' + num(g.first)) : '',
      g.last ? (lastLbl + ' ' + num(g.last) + (g.chgTxt ? (' (' + g.chgTxt + ')') : '') + (g.lastTimeFull ? (' · ساعت ' + g.lastTimeFull) : '') + (g.lastOver ? overTip : '')) : '',
      (g.hasTrades && g.close) ? ('پایانی امروز ' + num(g.close) + (g.closeOver ? overTip : '')) : '',
      g.status ? ('وضعیت نماد: ' + g.status) : '',
      wickTip,
      bandTip,
    ].filter(Boolean).join(String.fromCharCode(10));
    return {
      all,
      lo: g.isOption ? 'سر چپ نوار قرارداد: ۰ ریال (−۱۰۰٪ نسبت به پایانی دیروز)'
        : ('کف مجاز امروز' + (g.synthetic ? ' (تقریبی — از tsetmc دریافت نشد)' : '')),
      hi: g.isOption ? ('سر راست نوار قرارداد: ' + num(g.hi) + ' = ۲×پایانی دیروز (+۱۰۰٪)')
        : ('سقف مجاز امروز' + (g.synthetic ? ' (تقریبی — از tsetmc دریافت نشد)' : '')),
      ref: (g.isOption ? 'صفرِ نوار = پایانی دیروز ' : 'پایانی دیروز (قیمت مرجع) ') + num(g.y),
      last: '▼ ' + lastLbl + ' ' + num(g.last) + (g.chgTxt ? (' (' + g.chgTxt + ' نسبت به پایانی دیروز)') : '') + (g.lastTimeFull ? (' · ساعت ' + g.lastTimeFull) : '') + (g.lastOver ? overTip : ''),
      close: '▲ قیمت پایانی امروز ' + num(g.close) + (g.closeOver ? overTip : ''),
      wick: wickTip,
      band: bandTip,
    };
  }
  function rangeBarClass(g) {
    return 'tsext-rangebar' + (g.up ? ' is-up' : ' is-down') + (g.chgUp ? ' chg-up' : ' chg-down')
      + (g.hasTrades ? '' : ' no-trade') + (g.synthetic ? ' is-synthetic' : '') + (g.isOption ? ' is-option' : '');
  }
  function rangeBarCaptionHtml(g) {
    const parts = [];
    parts.push('<span class="rb-cap-last">' + (g.showLast ? ((g.lastIsMid ? 'وسط صف ' : 'آخرین ') + num(g.last)) : 'آخرین —')
      + (g.lastTime ? ('<span class="rb-cap-time" title="ساعت آخرین معامله ' + esc(g.lastTimeFull) + '">' + g.lastTime + '</span>') : '') + '</span>');
    parts.push('<span class="rb-cap-chg">' + (g.chgTxt || '') + '</span>');
    parts.push('<span class="rb-cap-close">' + (g.close ? ('پایانی ' + num(g.close)) : '') + '</span>');
    // وضعیت غیرعادی نماد (ممنوع/متوقف/…) در سطر جداگانه تا سطر اصلی سرریز نکند
    if (g.statusBad) parts.push('<span class="rb-cap-status-row"><span class="rb-cap-status" title="وضعیت نماد از tsetmc">' + esc(g.status) + '</span></span>');
    return parts.join('');
  }

  // نوار نوسان قیمت (کندل افقی ایزی‌تریدر) — HTML اولیه
  function formatRangeBar(range) {
    const g = rangeBarGeom(range);
    if (!g) return '';
    const t = rangeBarTitles(g);
    const hid = (show) => (show ? '' : ' rb-hidden');
    return '<div class="' + rangeBarClass(g) + '" title="' + esc(t.all) + '" dir="ltr">'
      + '<div class="tsext-rangebar-labels">'
      +   '<span class="rb-lo" data-v="' + g.lo + '" title="' + esc(t.lo) + '">' + num(g.lo) + '</span>'
      +   '<span class="rb-ref' + hid(g.pRef != null) + '" style="left:' + (g.pRef == null ? 50 : g.pRef) + '%" data-v="' + g.y + '" title="' + esc(t.ref) + '">' + (g.y ? num(g.y) : '') + '</span>'
      +   '<span class="rb-hi" data-v="' + g.hi + '" title="' + esc(t.hi) + '">' + num(g.hi) + '</span>'
      + '</div>'
      + '<div class="tsext-rangebar-track" title="" data-lo="' + g.lo + '" data-hi="' + g.hi + '" data-y="' + g.y + '" data-mode="' + (g.isOption ? 'option' : 'stock') + '">'
      +   '<span class="rb-base"></span>'
      +   '<span class="rb-wick' + hid(g.hasWick) + '" style="left:' + g.wickL + '%;width:' + g.wickW + '%" title="' + esc(t.wick) + '"></span>'
      +   '<span class="rb-tick' + hid(g.pRef != null) + '" style="left:' + (g.pRef == null ? 50 : g.pRef) + '%" title="' + esc(t.ref) + '"></span>'
      +   '<span class="rb-band' + hid(!!g.bandKind) + '" style="left:' + g.bandL + '%;width:' + g.bandW + '%" title="' + esc(t.band) + '"></span>'
      +   '<span class="rb-last' + hid(g.showLast) + (g.lastOver ? ' rb-over' : '') + '" style="left:' + (g.pLast == null ? 0 : g.pLast) + '%" title="' + esc(t.last) + '"></span>'
      +   '<span class="rb-close' + hid(g.showClose) + (g.closeOver ? ' rb-over' : '') + '" style="left:' + (g.pClose == null ? 0 : g.pClose) + '%" title="' + esc(t.close) + '"></span>'
      +   '<span class="rb-hover-line"></span><span class="rb-hover"></span>'
      + '</div>'
      + '<div class="tsext-rangebar-caption">' + rangeBarCaptionHtml(g) + '</div>'
      + '</div>';
  }

  // ===== پنل تشخیصی مخفی — فقط محلی، هیچ‌چیز ارسال نمی‌شود — v1.23 =====
  function toggleDiagPanel(force) {
    const open = (typeof force === 'boolean') ? force : !state.diagOpen;
    state.diagOpen = open;
    let el = panelHost && panelHost.querySelector('#tsext-diag');
    if (!open) { if (el) el.remove(); schedMaybeStop(); return; }
    if (!panelHost) return;
    if (!el) {
      el = document.createElement('div');
      el.id = 'tsext-diag';
      el.setAttribute('dir', 'rtl');
      panelHost.appendChild(el);
      el.addEventListener('click', (e) => {
        const b = e.target && e.target.closest ? e.target.closest('[data-diag]') : null;
        if (!b) return;
        const act = b.getAttribute('data-diag');
        if (act === 'close') toggleDiagPanel(false);
        else if (act === 'reset') { diag.req = diag.ok = diag.fail = diag.dedup = 0; diag.lat = []; diag.stamps = []; diag.kinds = {}; diag.lastErr = ''; diag.startedAt = Date.now(); tsextErr.log = []; tsextErr.n = 0; tsextErr.last = ''; try { renderErrorBadge(); } catch (e2) {} renderDiagPanel(); }
        else if (act === 'copy') { try { navigator.clipboard.writeText(diagText()); setStatus('گزارش تشخیصی کپی شد'); } catch (e2) {} }
      });
    }
    schedEnsure();
    renderDiagPanel();
  }
  function diagLines() {
    const now = Date.now();
    const perMin = diag.stamps.filter((t) => now - t <= 60000).length;
    const lat = diag.lat.length ? Math.round(diag.lat.reduce((a, b) => a + b, 0) / diag.lat.length) : 0;
    const latMax = diag.lat.length ? Math.max.apply(null, diag.lat) : 0;
    const up = Math.round((now - diag.startedAt) / 1000);
    const phase = marketPhase();
    const kinds = Object.keys(diag.kinds).map((k) => k + ' ' + diag.kinds[k]).join(' · ') || '—';
    const ccN = state.closingCache ? Object.keys(state.closingCache).length : 0;
    const thN = state.obThresh ? Object.keys(state.obThresh).length : 0;
    const hol = holidayToday();
    const errN = tsextErr.log.length;
    const lastE = errN ? tsextErr.log[errN - 1] : null;
    return [
      ['مرحلهٔ بازار', marketStatusFa() + ' (' + phase + ')' + (isForcedLive() ? ' · زندهٔ دستی' : '') + (hol ? ' · تعطیل رسمی' + (tradedToday() ? ' (معامله امروز)' : '') : '') + (function(){ try { var c=tehranClock(); return c.wdFa ? (' · ' + c.wdFa + (c.shamsi ? ' · ' + c.shamsi : '')) : ''; } catch(e){ return ''; } })()],
      ['سلامت داده', healthSummary() ? ('مشکل: ' + healthSummary()) : ('طبق انتظار · ' + dataHealth.checked + ' بررسی')],
      ['خطاهای اخیر', errN ? (errN + ' مورد · آخرین: [' + (lastE.ctx || '—') + '] ' + lastE.msg.slice(0, 70)) : 'هیچ'],
      ['درخواست در دقیقهٔ اخیر', String(perMin)],
      ['کل درخواست‌ها (موفق / ناموفق)', diag.req + ' (' + diag.ok + ' / ' + diag.fail + ')'],
      ['ادغام‌شده (single-flight)', String(diag.dedup)],
      ['در حال دریافت الان', String(netInflight.size)],
      ['تأخیر میانگین / بیشینه', lat + ' / ' + latMax + ' میلی‌ثانیه'],
      ['به تفکیک', kinds],
      ['فاصلهٔ فعلی تیک‌ها', 'حیاتی ' + getCritIntervalMs() + ' · دیدنی ' + getVisIntervalMs() + ' · صف ' + getObIntervalMs() + ' میلی‌ثانیه · زنجیره ' + Math.round(getChainIntervalMs() / 1000) + ' ثانیه'],
      ['حالت', (state.turboActive ? 'توربو' : 'عادی') + (state.noChangeStreak >= ADAPT_STREAK ? ' · Adaptive' : '') + ' · ' + (state.refreshMode || 'normal') + (state.autoRefresh ? '' : ' · رفرش متوقف')],
      ['شبکه', 'شکست پیاپی ' + (state.netFailCount || 0) + (isNetBackingOff() ? (' · مکث تا ' + Math.ceil((state.netBackoffUntil - now) / 1000) + 's') : '') + (diag.lastErr ? (' · آخرین خطا: ' + diag.lastErr) : '')],
      ['کش', 'ClosingInfo ' + ccN + ' · دامنهٔ مجاز ' + thN + ' · پاسخ‌های تازه ' + netRecent.size],
      ['زمان‌بند', 'پالس ' + SCHED_PULSE_MS + ' میلی‌ثانیه · تیک ' + sched.ticks + ' · لیست ' + (sched.listOn ? 'روشن' : 'خاموش') + ' · صف ' + (sched.obOn ? 'روشن' : 'خاموش')],
      ['نشست', up + ' ثانیه · نسخه ' + (extVersion() || '—') + ' · ' + (state.cache && state.cache.rows ? state.cache.rows.length : 0) + ' ردیف'],
    ];
  }
  function extVersion() {
    try { if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest) return chrome.runtime.getManifest().version || ''; } catch (e) {}
    return '';
  }
  function diagText() {
    const nl = String.fromCharCode(10);
    return diagLines().map((r) => r[0] + ': ' + r[1]).join(nl)
      + nl + nl + '--- ' + tsextErr.log.length + ' خطای اخیر (قدیمی → جدید) ---' + nl + errLogText();
  }
  function renderDiagPanel() {
    const el = panelHost && panelHost.querySelector('#tsext-diag');
    if (!el) return;
    const rows = diagLines().map((r) => '<div class="tsext-diag-row"><span>' + esc(r[0]) + '</span><b dir="ltr">' + esc(r[1]) + '</b></div>').join('');
    const errs = tsextErr.log.slice(-10).reverse();
    const errHtml = errs.length
      ? '<div class="tsext-diag-errs"><div class="tsext-diag-errs-h">' + faDigits(String(Math.min(10, errs.length))) + ' خطای آخر (از ' + faDigits(String(tsextErr.log.length)) + ')</div>'
        + errs.map((r) => {
          let t = '';
          try { t = new Date(r.at).toLocaleTimeString('fa-IR', { hour12: false }); } catch (e) {}
          return '<div class="tsext-diag-err' + (r.quiet ? ' is-quiet' : '') + '"><span class="tsext-diag-err-t">' + esc(t) + '</span><span class="tsext-diag-err-c">' + esc(r.ctx || '—') + '</span><span class="tsext-diag-err-m" title="' + esc(r.msg + (r.stack ? String.fromCharCode(10) + r.stack : '')) + '">' + esc(r.msg) + '</span></div>';
        }).join('') + '</div>'
      : '';
    el.innerHTML = '<div class="tsext-diag-head"><span>پنل تشخیصی (محلی)</span>'
      + '<span class="tsext-diag-btns"><button type="button" class="tsext-btn" data-diag="copy" title="کپی گزارش (شامل دفترچهٔ خطا)">کپی</button>'
      + '<button type="button" class="tsext-btn" data-diag="reset" title="صفر کردن شمارنده‌ها و دفترچهٔ خطا">صفر</button>'
      + '<button type="button" class="tsext-btn" data-diag="close" title="بستن">×</button></span></div>' + rows + errHtml;
  }

  // نشانگر ماوس روی محور نوار: قیمتِ زیر ماوس + درصدش نسبت به پایانی دیروز (صفرِ نوار)
  const rbHover = { track: null, x: null };
  function rangeBarHoverHide() {
    if (rbHover.track) { try { rbHover.track.classList.remove('is-hover'); } catch (e) {} }
    rbHover.track = null; rbHover.x = null;
  }
  function rangeBarHoverMove(track, clientX) {
    if (!track) return;
    const lo = Number(track.getAttribute('data-lo'));
    const hi = Number(track.getAttribute('data-hi'));
    const y = Number(track.getAttribute('data-y'));
    if (!(hi > lo)) return;
    const rect = track.getBoundingClientRect();
    if (!(rect.width > 0)) return;
    let frac = (clientX - rect.left) / rect.width;
    frac = Math.max(0, Math.min(1, frac));
    const price = Math.round(lo + frac * (hi - lo));
    let sign = '';
    let pctTxt = '';
    if (y > 0) {
      const r = Math.round(((price - y) / y) * 10000) / 100;
      sign = r > 0 ? 'is-pos' : (r < 0 ? 'is-neg' : '');
      pctTxt = (r > 0 ? '+' : (r < 0 ? '−' : '')) + num(Math.abs(r)) + '٪';
    }
    const txt = num(price) + (pctTxt ? ('\u2002(' + pctTxt + ')') : '');
    const html = '<span class="rb-hover-p">' + num(price) + '</span>' + (pctTxt ? ('<span class="rb-hover-pct">(' + pctTxt + ')</span>') : '');
    const lab = track.querySelector('.rb-hover');
    const line = track.querySelector('.rb-hover-line');
    if (rbHover.track && rbHover.track !== track) { try { rbHover.track.classList.remove('is-hover'); } catch (e) {} }
    rbHover.track = track; rbHover.x = clientX;
    track.classList.add('is-hover');
    if (line) line.style.left = (frac * 100) + '%';
    if (lab) {
      if (lab.getAttribute('data-t') !== txt) { lab.innerHTML = html; lab.setAttribute('data-t', txt); }
      const cls = 'rb-hover' + (sign ? ' ' + sign : '');
      if (lab.className !== cls) lab.className = cls;
      lab.style.left = (frac * 100) + '%';
      // وسطِ برچسب زیر ماوس باشد، ولی از دو سر نوار بیرون نزند
      const px = frac * rect.width;
      const w = lab.offsetWidth || 0;
      let shift = -w / 2;
      if (px + shift < 0) shift = -px;
      else if (px + shift + w > rect.width) shift = rect.width - px - w;
      lab.style.transform = 'translateX(' + Math.round(shift) + 'px)';
    }
  }

  // به‌روزرسانی نرم نوار (بدون بازسازی/چشمک): گرهٔ DOM ثابت می‌ماند؛ فقط style و متن عوض می‌شود.
  // محور (lo/hi) با تغییرات جزئی جابه‌جا نمی‌شود تا کندل «نپرد».
  function patchRangeBar(slot, range) {
    if (!slot || !range) return;
    let bar = slot.querySelector('.tsext-rangebar');
    // کلید پایدار محور: از data-ins اسلات یا insCode روی range
    const axisKey = (slot.getAttribute('data-ob-ins') || range.insCode || range.key || '').toString();
    if (!state.obRangeSticky) state.obRangeSticky = Object.create(null);
    let sticky = null;
    if (axisKey && state.obRangeSticky[axisKey] && state.obRangeSticky[axisKey].hi > state.obRangeSticky[axisKey].lo) {
      sticky = state.obRangeSticky[axisKey];
    } else {
      try {
        const tr0 = bar && bar.querySelector('.tsext-rangebar-track');
        if (tr0) {
          const slo = Number(tr0.getAttribute('data-lo'));
          const shi = Number(tr0.getAttribute('data-hi'));
          const sy = Number(tr0.getAttribute('data-y'));
          const sm = tr0.getAttribute('data-mode') || '';
          if (isFinite(slo) && isFinite(shi) && shi > slo) sticky = { lo: slo, hi: shi, y: isFinite(sy) ? sy : 0, mode: sm || undefined };
        }
      } catch (e) {}
    }
    const g = rangeBarGeom(range, sticky);
    if (!g) return;
    // ذخیرهٔ محور برای رفرش‌های بعدی (حتی اگر DOM نوار از نو ساخته شود)
    if (axisKey) state.obRangeSticky[axisKey] = { lo: g.lo, hi: g.hi, y: g.y, mode: range.mode || (g.isOption ? 'option' : 'stock') };
    const applyGeom = (barEl) => {
      const t = rangeBarTitles(g);
      const cls = rangeBarClass(g);
      if (barEl.className !== cls) barEl.className = cls;
      if (barEl.getAttribute('title') !== t.all) barEl.setAttribute('title', t.all);
      const q = (s) => barEl.querySelector(s);
      const track = q('.tsext-rangebar-track');
      if (track) {
        if (track.getAttribute('data-lo') !== String(g.lo)) track.setAttribute('data-lo', String(g.lo));
        if (track.getAttribute('data-hi') !== String(g.hi)) track.setAttribute('data-hi', String(g.hi));
        if (track.getAttribute('data-y') !== String(g.y)) track.setAttribute('data-y', String(g.y));
        const wantMode = g.isOption ? 'option' : 'stock';
        if (track.getAttribute('data-mode') !== wantMode) track.setAttribute('data-mode', wantMode);
        if (track.classList.contains('is-hover') && rbHover.x != null) rangeBarHoverMove(track, rbHover.x);
      }
      const setLeft = (el, pct, show, title) => {
        if (!el) return;
        el.classList.toggle('rb-hidden', !show);
        if (show) {
          const v = pct + '%';
          if (el.style.left !== v) el.style.left = v;
        }
        if (title != null && el.getAttribute('title') !== title) el.setAttribute('title', title);
      };
      const wick = q('.rb-wick');
      if (wick) {
        wick.classList.toggle('rb-hidden', !g.hasWick);
        const l = g.wickL + '%', w = g.wickW + '%';
        if (wick.style.left !== l) wick.style.left = l;
        if (wick.style.width !== w) wick.style.width = w;
        if (wick.getAttribute('title') !== t.wick) wick.setAttribute('title', t.wick);
      }
      setLeft(q('.rb-tick'), g.pRef == null ? 50 : g.pRef, g.pRef != null, t.ref);
      const band = q('.rb-band');
      if (band) {
        band.classList.toggle('rb-hidden', !g.bandKind);
        const l = g.bandL + '%', w = g.bandW + '%';
        if (band.style.left !== l) band.style.left = l;
        if (band.style.width !== w) band.style.width = w;
        if (band.getAttribute('title') !== t.band) band.setAttribute('title', t.band);
      }
      setLeft(q('.rb-last'), g.pLast == null ? 0 : g.pLast, g.showLast, t.last);
      setLeft(q('.rb-close'), g.pClose == null ? 0 : g.pClose, g.showClose, t.close);
      const lastEl = q('.rb-last'), closeEl = q('.rb-close');
      if (lastEl) lastEl.classList.toggle('rb-over', !!g.lastOver);
      if (closeEl) closeEl.classList.toggle('rb-over', !!g.closeOver);
      const loEl = q('.rb-lo'), hiEl = q('.rb-hi'), refEl = q('.rb-ref');
      if (loEl && loEl.getAttribute('data-v') !== String(g.lo)) { loEl.textContent = num(g.lo); loEl.setAttribute('data-v', String(g.lo)); loEl.setAttribute('title', t.lo); }
      if (hiEl && hiEl.getAttribute('data-v') !== String(g.hi)) { hiEl.textContent = num(g.hi); hiEl.setAttribute('data-v', String(g.hi)); hiEl.setAttribute('title', t.hi); }
      if (refEl) {
        refEl.classList.toggle('rb-hidden', g.pRef == null);
        if (g.pRef != null) {
          const l = g.pRef + '%';
          if (refEl.style.left !== l) refEl.style.left = l;
          if (refEl.getAttribute('data-v') !== String(g.y)) { refEl.textContent = num(g.y); refEl.setAttribute('data-v', String(g.y)); refEl.setAttribute('title', t.ref); }
        }
      }
      const cap = q('.tsext-rangebar-caption');
      if (cap) { const h = rangeBarCaptionHtml(g); if (cap.innerHTML !== h) cap.innerHTML = h; }
    };
    if (bar && bar.querySelector('.tsext-rangebar-track') && bar.querySelector('.rb-wick') && bar.querySelector('.rb-hover')) {
      try { applyGeom(bar); return; } catch (e) {}
    }
    // فقط اولین بار: گره را بساز و درج کن — بعداً هرگز replaceWith نکن
    if (bar) {
      // ساختار ناقص: محتوای داخلی را پر کن بدون تعویض خودِ bar
      try {
        const html = formatRangeBar(range);
        if (html) {
          const tmp = document.createElement('div');
          tmp.innerHTML = html;
          const fresh = tmp.firstChild;
          if (fresh) {
            bar.className = fresh.className;
            bar.innerHTML = fresh.innerHTML;
            bar.setAttribute('title', fresh.getAttribute('title') || '');
            bar.setAttribute('dir', 'ltr');
          }
        }
        applyGeom(bar);
      } catch (e) {}
      return;
    }
    const html = formatRangeBar(range);
    if (!html) return;
    const title = slot.querySelector('.tsext-ob-title');
    const wrap = document.createElement('div');
    wrap.innerHTML = html;
    const node = wrap.firstChild;
    if (!node) return;
    if (title && title.nextSibling) title.parentNode.insertBefore(node, title.nextSibling);
    else if (title) title.parentNode.appendChild(node);
    else slot.insertBefore(node, slot.firstChild);
  }
  // سقف/کف مجاز واقعیِ امروز (دامنهٔ نوسان قانونی) — توجه: این با priceMin/priceMax در
  // GetClosingPriceInfo فرق دارد؛ آن دو فقط کمترین/بیشترین قیمتِ معامله‌شدهٔ امروزند (بازهٔ واقعی
  // معاملات)، نه سقف/کف مجاز قانونی — به همین دلیل استفادهٔ اشتباه از آن‌ها باعث می‌شد قیمت‌های
  // کاملاً معتبرِ داخل صف (به‌خصوص در اختیار که دامنه‌اش خیلی بازتر از سهم پایه است) به‌غلط کم‌رنگ شوند.
  // سقف/کف واقعی از GetInstrumentInfo (فیلد psGelStaMax/psGelStaMin) خوانده می‌شود.
  async function fetchStaticThreshold(insCode, extraOpts) {
    if (!insCode) return null;
    const j = await apiGetRaw('https://cdn.tsetmc.com/api/Instrument/GetInstrumentInfo/' + encodeURIComponent(String(insCode)), 1, extraOpts);
    const info = (j && (j.instrumentInfo || j.InstrumentInfo || j)) || null;
    if (!info) return null;
    try { checkDataShape('instrument', info); } catch (e) {}
    // بسته به نسخهٔ پاسخ ممکن است این فیلدها مسطح باشند یا داخل یک زیرآبجکت staticThreshold
    const st = info.staticThreshold || info.StaticThreshold || null;
    const pMax = pickPosNum(info, ['psGelStaMax', 'PSGelStaMax']) || (st ? pickPosNum(st, ['psGelStaMax', 'PSGelStaMax']) : 0);
    const pMin = pickPosNum(info, ['psGelStaMin', 'PSGelStaMin']) || (st ? pickPosNum(st, ['psGelStaMin', 'PSGelStaMin']) : 0);
    return { pMax, pMin };
  }
  // سقف/کف مجاز امروز یک نماد را برمی‌گرداند — اگر قبلاً برای همین نماد گرفته شده از کش می‌خواند،
  // وگرنه یک‌بار واکشی می‌کند. چون این بازه در طول روز عوض نمی‌شود نیازی به رفرش مکرر نیست.
  async function getObThreshold(insCode) {
    if (!insCode) return null;
    const key = String(insCode);
    if (state.obThresh[key]) return state.obThresh[key];
    const info = await fetchStaticThreshold(key, { priority: 'low' });
    if (!info || !(info.pMax > 0 || info.pMin > 0)) return { max: 0, min: 0 }; // ناموفق/نامشخص — کش نمی‌شود تا تیک بعدی دوباره تلاش کند
    const th = { max: info.pMax, min: info.pMin };
    state.obThresh[key] = th;
    return th;
  }



  // کدهای حیاتی: قرارداد(های) جزئیات باز + سهم پایه — همیشه کم‌تعداد و تضمین‌شده، رقیبی در تیک خودشان ندارند
  function getCriticalInsCodes() {
    const out = [];
    const seen = new Set();
    const add = (c) => {
      if (c == null || c === '' || c === '0') return;
      const s = String(c);
      if (seen.has(s)) return;
      seen.add(s);
      out.push(s);
    };
    const ctx = state.obCtx;
    if (ctx) { add(ctx.insBuy); add(ctx.insSell); add(ctx.insCode); add(ctx.uaIns); }
    if (state.cache && state.cache.rows && state.cache.rows[0]) add(state.cache.rows[0].uaInsCode);
    return out.slice(0, CRIT_MAX_CODES);
  }

  // کدهای ردیف‌های قابل‌مشاهدهٔ دیگر در لیست — جدا از کدهای حیاتی تا با تیک ۵۰۰ میلی‌ثانیه‌ای رقابت نکنند
  function getVisibleInsCodes(excludeSet) {
    const out = [];
    const seen = new Set(excludeSet || []);
    const add = (c) => {
      if (c == null || c === '' || c === '0') return;
      const s = String(c);
      if (seen.has(s)) return;
      seen.add(s);
      out.push(s);
    };
    if (panelHost) {
      const bars = Array.from(panelHost.querySelectorAll('#tsext-list .tsext-bar'));
      const vis = bars.filter((b) => state.visibleKeys.has(b.getAttribute('data-key') || ''));
      const pool = vis.length ? vis : bars.slice(0, 8);
      for (let i = 0; i < pool.length && out.length < VIS_MAX_CODES; i++) {
        const sp = pool[i].__tsextSpec || {};
        add(sp.insCode); add(sp.insCodeBuy); add(sp.insCodeSell);
      }
    }
    return out.slice(0, VIS_MAX_CODES);
  }

  function patchRowFromClosing(row, info) {
    if (!row || !info) return false;
    let changed = false;
    if (info.pLast > 0) {
      if (Number(row.pDrCotVal_C) !== info.pLast) { row.pDrCotVal_C = info.pLast; changed = true; }
    }
    if (info.pClose > 0) {
      if (Number(row.pClosing_C) !== info.pClose) { row.pClosing_C = info.pClose; changed = true; }
    }
    return changed;
  }

  function patchUaFromClosing(rows, info) {
    if (!rows || !info) return false;
    let changed = false;
    const last = info.pLast > 0 ? info.pLast : 0;
    const close = info.pClose > 0 ? info.pClose : 0;
    if (!(last > 0 || close > 0)) return false;
    rows.forEach((r) => {
      if (last > 0 && Number(r.pDrCotVal_UA) !== last) { r.pDrCotVal_UA = last; changed = true; }
      if (close > 0 && Number(r.pClosing_UA) !== close) { r.pClosing_UA = close; changed = true; }
    });
    return changed;
  }

  // تیک سریع: فقط نمادهای اولویت‌دار با ClosingPriceInfo
  // اعمال نتایج ClosingPriceInfo (از هر دو تیک) روی state.cache — منطق مشترک، بدون تغییر در فرمول‌ها
  function applyClosingResults(results) {
    // محافظت در برابر race: بین چک تیک و await ممکن است state.cache پاک شود (سوییچ نماد / بستن پنل)
    if (!state.cache || !state.cache.rows || !state.cache.rows.length) return false;
    let changed = false;
    const uaKey = state.cache.rows[0] ? String(state.cache.rows[0].uaInsCode || '') : '';
    const byCode = {};
    results.forEach((info) => { if (info) byCode[info.insCode] = info; });

    // سهم پایه
    if (uaKey && byCode[uaKey]) {
      const info = byCode[uaKey];
      if (patchUaFromClosing(state.cache.rows, info)) changed = true;
      const live = info.pLast > 0 ? info.pLast : info.pClose;
      if (live > 0 && state.cache.livePrice !== live) {
        state.cache.livePrice = live;
        state.cache.livePriceIsLive = info.pLast > 0;
        changed = true;
      }
      if (info.yPrice > 0) {
        state.uaInfo = { uaInsCode: uaKey, yPrice: info.yPrice };
      }
      // تیک اسپارک
      if (live > 0) {
        if (!Array.isArray(state.uaTicks)) state.uaTicks = [];
        const tk = state.uaTicks, lastT = tk[tk.length - 1];
        if (!lastT || lastT.p !== live || (Date.now() - lastT.t) > 15000) {
          tk.push({ t: Date.now(), p: live });
          if (tk.length > 120) tk.splice(0, tk.length - 120);
        }
      }
    }

    // پرمیوم قراردادها
    state.cache.rows.forEach((row) => {
      const code = String(row.insCode_C || '');
      if (code && byCode[code]) {
        if (patchRowFromClosing(row, byCode[code])) changed = true;
      }
    });
    return changed;
  }

  // ---------- v1.29: قیمت قابل‌اجرا (دفتر سفارش) ----------
  // حالت «آخرین قیمت» (پیش‌فرض) همان رفتار قبلی است. در حالت «قابل‌اجرا» برای هر قرارداد + سهم پایه بهترین
  // سطح صف (BestLimits) گرفته می‌شود و رندر آن را در ردیف‌ها به‌صورت row.__exec می‌چسباند (خود ردیف خام دست نمی‌خورد).
  const BOOK_STALE_MS = 20000;
  const BOOK_BATCH = 8;
  function parseBestLevel(rows) {
    if (!Array.isArray(rows)) return null;
    let bidP = 0, bidQ = 0, askP = 0, askQ = 0;
    rows.forEach((r) => {
      const bp = asNum(r && r.pMeDem, 0), bq = asNum(r && r.qTitMeDem, 0);
      const ap = asNum(r && r.pMeOf, 0), aq = asNum(r && r.qTitMeOf, 0);
      if (bp > 0 && bq > 0) { if (bp > bidP) { bidP = bp; bidQ = bq; } else if (bp === bidP) bidQ += bq; }
      if (ap > 0 && aq > 0) { if (!askP || ap < askP) { askP = ap; askQ = aq; } else if (ap === askP) askQ += aq; }
    });
    return { bidP, bidQ, askP, askQ };
  }
  function bookOf(code) {
    const b = state.bookCache && state.bookCache[String(code)];
    return (b && (Date.now() - b.at) < BOOK_STALE_MS) ? b : null;
  }
  function withExecPrices(rows) {
    const ub = rows[0] ? bookOf(rows[0].uaInsCode) : null;
    return rows.map((r) => {
      const b = bookOf(r.insCode_C);
      const o = Object.assign({}, r);
      o.__exec = {
        optBid: b ? b.bidP : 0, optBidQ: b ? b.bidQ : 0, optAsk: b ? b.askP : 0, optAskQ: b ? b.askQ : 0,
        uaBid: ub ? ub.bidP : 0, uaBidQ: ub ? ub.bidQ : 0, uaAsk: ub ? ub.askP : 0, uaAskQ: ub ? ub.askQ : 0,
      };
      return o;
    });
  }
  function withExecRows(rows, r) {
    if (!r || !r.execMode || !Array.isArray(rows)) return rows;
    const t = r.tradable;
    return rows.concat([
      ['__sect__', 'قابل‌اجرا (دفتر سفارش)'],
      ['حجم قابل‌معامله', (t == null ? '—' : num(t) + ' قرارداد') + (r.tradeLimit ? ' <span class="tsext-vol-tag">(محدود به ' + r.tradeLimit + ')</span>' : ''), t === 0 ? 'neg' : ''],
    ]);
  }
  let bookSweepBusy = false;
  async function bookSweepTick() {
    if (state.priceMode !== 'exec' || bookSweepBusy) return;
    if (!panelHost || panelHost.style.display === 'none') return;
    if (!state.cache || !state.cache.rows || !state.cache.rows.length) return;
    bookSweepBusy = true;
    try {
      if (!state.bookCache) state.bookCache = Object.create(null);
      const rows = state.cache.rows;
      const all = [];
      const ua = underlyingCode();
      if (ua) all.push(ua);
      const crit = getCriticalInsCodes();
      crit.forEach((c) => { if (all.indexOf(String(c)) < 0) all.push(String(c)); });
      rows.forEach((r) => { const c = String(r.insCode_C || ''); if (c && all.indexOf(c) < 0) all.push(c); });
      // قدیمی‌ترین‌ها اول؛ سهم پایه و کدهای حیاتی همیشه در دور
      const age = (c) => (state.bookCache[c] ? state.bookCache[c].at : 0);
      const pinned = all.slice(0, 1 + crit.length);
      const rest = all.slice(1 + crit.length).sort((a, b) => age(a) - age(b));
      const batch = pinned.concat(rest).slice(0, BOOK_BATCH + pinned.length);
      const genAtStart = currentCacheGen();
      const res = await Promise.all(batch.map((c) => fetchBestLimits(c, 4000).then((rw) => ({ c, rw }))));
      if (genAtStart !== currentCacheGen() || !state.cache || !state.cache.rows || !state.cache.rows.length) return;
      let changed = false;
      res.forEach(({ c, rw }) => {
        const lv = parseBestLevel(rw);
        if (!lv) return; // پاسخ خالی → مقدار قبلی bookCache را نگه دار
        const prev = state.bookCache[c];
        if (!prev || prev.bidP !== lv.bidP || prev.askP !== lv.askP || prev.bidQ !== lv.bidQ || prev.askQ !== lv.askQ) changed = true;
        state.bookCache[c] = Object.assign({ at: Date.now() }, lv);
      });
      if (changed) renderActive();
    } catch (e) { noteError(e, 'book'); }
    finally { bookSweepBusy = false; }
  }
  function setPriceMode(mode) {
    const m = (mode === 'exec') ? 'exec' : 'last';
    if (state.priceMode === m) return;
    state.priceMode = m;
    state.forceReorder = true;
    // محور صف را رها کن تا با مبنای جدید دوباره قفل شود
    try { state.obRangeSticky = Object.create(null); } catch (e) {}
    try { debouncedSaveSettings(); } catch (e) {}
    try { setStatus(m === 'exec' ? 'قیمت: صف قابل‌اجرا' : 'قیمت: آخرین معامله'); } catch (e) {}
    if (m === 'exec') { try { bookSweepTick(); } catch (e) {} }
    renderActive();
    try { refreshOpenDetailCalc(); } catch (e) {}
  }

  // تیک حیاتی: فقط سهم پایه + قرارداد(های) جزئیات باز — تعداد کم، اولویت fetch بالا، هر ۵۰۰ میلی‌ثانیه بدون رقیب
  async function criticalPriceTick() {
    if (!panelHost || panelHost.style.display === 'none') return;
    if (!state.cache || !state.cache.rows || !state.cache.rows.length) return;
    if (state.critFetchInFlight) return;
    state.critFetchInFlight = true;
    const genAtStart = currentCacheGen();
    try {
      const codes = getCriticalInsCodes();
      if (!codes.length) return;
      const results = await Promise.all(codes.map((c) => fetchClosingInfo(c, { priority: 'high' })));
      // اگر وسط await نماد عوض شد یا cache پاک شد، نتیجه را دور بریز
      if (genAtStart !== currentCacheGen() || !state.cache || !state.cache.rows || !state.cache.rows.length) return;
      const changed = applyClosingResults(results);
      try { applyHaltFlags(); } catch (e) {}
      state.lastDataAt = Date.now();
      updateAgeLabel();
      if (changed) {
        state.noChangeStreak = 0; // بازار حرکت کرد → برگرد به توربو
        renderActive();
        refreshOpenDetailCalc();
      } else {
        state.noChangeStreak = (state.noChangeStreak || 0) + 1;
      }
    } finally {
      state.critFetchInFlight = false;
    }
  }

  // تیک ردیف‌های دیدنیِ دیگر — سرعت متوسط، جدا از تیک حیاتی تا با آن رقابت نکند
  async function visiblePriceTick() {
    if (!panelHost || panelHost.style.display === 'none') return;
    if (!state.cache || !state.cache.rows || !state.cache.rows.length) return;
    if (state.visFetchInFlight) return;
    state.visFetchInFlight = true;
    const genAtStart = currentCacheGen();
    try {
      const critCodes = getCriticalInsCodes();
      const codes = getVisibleInsCodes(critCodes);
      if (!codes.length) return;
      const results = await Promise.all(codes.map((c) => fetchClosingInfo(c)));
      if (genAtStart !== currentCacheGen() || !state.cache || !state.cache.rows || !state.cache.rows.length) return;
      const changed = applyClosingResults(results);
      try { applyHaltFlags(); } catch (e) {}
      state.lastDataAt = Date.now();
      updateAgeLabel();
      if (changed) {
        state.noChangeStreak = 0;
        renderActive();
        refreshOpenDetailCalc();
      } else {
        state.noChangeStreak = (state.noChangeStreak || 0) + 1;
      }
    } finally {
      state.visFetchInFlight = false;
    }
  }

  // بعد از soft-update، فقط ستون محاسبات را از spec تازه‌شده هم‌تراز کن — سفارشات دست‌نخورده می‌مانند
  function refreshOpenDetailCalc() {
    if (!panelHost || !state.obKey || !panelHost.classList.contains('tsext-with-ob')) return;
    let bar = panelHost.querySelector('.tsext-bar.active-ob');
    // بعد از rebuild کامل ممکن است active-ob از بین برود — با کلید ردیف پیدا کن
    if (!bar && state.obKey) {
      try {
        const all = panelHost.querySelectorAll('#tsext-list .tsext-bar, #tsext-list-body .tsext-bar');
        for (let i = 0; i < all.length; i++) {
          const b = all[i];
          const k = b.getAttribute('data-key') || (b.__tsextSpec && typeof rowKey === 'function' ? rowKey(b.__tsextSpec) : '');
          if (k && String(k) === String(state.obKey)) { bar = b; break; }
        }
        if (bar) {
          panelHost.querySelectorAll('.tsext-bar.active-ob').forEach((el) => el.classList.remove('active-ob'));
          bar.classList.add('active-ob');
        }
      } catch (eFind) {}
    }
    const spec = bar && bar.__tsextSpec;
    if (!spec || !spec.detailRows) return;
    const calc = panelHost.querySelector('#tsext-ob-calc');
    if (!calc) return;
    const basis = (state.priceMode === 'exec' ? 'قیمت‌ها: بهترین صف قابل‌اجرا' : 'قیمت‌ها: آخرین معامله')
      + (spec.baseIsManual ? ' · مبنای دستی' : '')
      + ' · واحد: ریال · تاریخ: شمسی';
    calc.innerHTML = grid(spec.detailRows)
      + '<div class="tsext-price-basis">' + basis + '</div>';
  }
  // پوشش ضدِ انباشت: اگر رفرش خودکار قبلی هنوز در جریان است، تیک بعدیِ تایمر رد می‌شود
  // (درخواست دستی «برو» همیشه عبور می‌کند). بدون این گارد، وقتی TSETMC کند است درخواست‌های
  // MarketWatch روی هم سوار می‌شوند و کانکشن‌ها اشغال — و سفارشات جزئیات هم کند می‌شود.
  async function fetchAndRender(isAuto) {
    if (isAuto && state.fetchInFlight) return;
    if (isAuto && typeof isNetBackingOff === 'function' && isNetBackingOff()) {
      const hint = netStatusHint();
      if (hint) setStatus(hint);
      return;
    }
    state.fetchInFlight = true;
    try {
      await fetchAndRenderInner();
    } catch (e) {
      noteError(e, 'fetch');
    } finally {
      state.fetchInFlight = false;
    }
  }

  // ----- from src/07a-fetch-render.js -----
  // ========== MODULE [7a] fetch cycle / UA / renderActive ===================
  // چرخهٔ fetchAndRender، autocomplete نماد پایه، renderActive و کمک‌های لیست

  function normSym(s) {
    return String(s || '').replace(/\s+/g, '').replace(/ي/g, 'ی').replace(/ك/g, 'ک').toLowerCase();
  }

  function rowUaInsCode(r) {
    if (!r) return '';
    const v = r.uaInsCode != null ? r.uaInsCode : (r.UaInsCode != null ? r.UaInsCode : (r.ua_ins_code != null ? r.ua_ins_code : ''));
    return String(v || '');
  }

  // از ردیف زنجیره، همهٔ نام‌های احتمالی نماد پایه را جمع کن
  function collectUaNamesFromRow(r) {
    if (!r || typeof r !== 'object') return [];
    const out = [];
    const preferKeys = [
      'lVal18AFC_UA', 'lval18AFC_UA', 'LVal18AFC_UA',
      'lVal30_UA', 'lval30_UA', 'LVal30_UA',
      'uaLVal18AFC', 'uaLVal30', 'uaName', 'uaSymbol',
    ];
    for (const k of preferKeys) {
      const t = String(r[k] || '').trim();
      if (t && out.indexOf(t) < 0) out.push(t);
    }
    if (!out.length) {
      for (const k of Object.keys(r)) {
        if (!/ua/i.test(k)) continue;
        if (/insCode|code|price|qty|vol|day|size|strike|remain/i.test(k)) continue;
        const t = String(r[k] || '').trim();
        if (t && t.length < 40 && out.indexOf(t) < 0) out.push(t);
      }
    }
    return out;
  }

  // ساخت کاتالوگ نمادهای پایه‌ای که در MarketWatch اختیار دارند
  function buildUaCatalogFromChain(chain) {
    const byCode = Object.create(null);
    for (const r of (chain || [])) {
      const code = rowUaInsCode(r);
      if (!code || code === '0') continue;
      if (!byCode[code]) byCode[code] = { insCode: r.uaInsCode != null ? r.uaInsCode : r.UaInsCode, name: '', names: [] };
      const entry = byCode[code];
      for (const t of collectUaNamesFromRow(r)) {
        if (entry.names.indexOf(t) < 0) entry.names.push(t);
        if (!entry.name || t.length < entry.name.length) entry.name = t;
      }
    }
    const list = Object.values(byCode).filter((e) => e.insCode != null && e.insCode !== '');
    list.forEach((e) => { if (!e.name) e.name = String(e.insCode); });
    list.sort((a, b) => String(a.name).localeCompare(String(b.name), 'fa'));
    state.uaCatalog = list;
    state.uaCatalogAt = Date.now();
    return list;
  }

  async function ensureUaCatalog(force) {
    // کاتالوگ مشترک — TTL طولانی؛ فقط با force=true (شکست جستجو) از نو ساخته می‌شود
    const ttl = state.uaCatalogTtlMs || (2 * 60 * 60 * 1000);
    if (!force && state.uaCatalog && state.uaCatalog.length && (Date.now() - state.uaCatalogAt) < ttl) {
      return state.uaCatalog;
    }
    try {
      const cj = await apiGet('/GetInstrumentOptionMarketWatch/0', 3, 1, { priority: 'low' });
      const chainRaw = cj && (cj.instrumentOptMarketWatch || cj.InstrumentOptMarketWatch || cj.optionMarketWatch || cj.instrumentOptionMarketWatch);
      if (Array.isArray(chainRaw) && chainRaw.length) return buildUaCatalogFromChain(chainRaw);
      // شکل پاسخ ناشناس — کلیدها را فقط در لاگ داخلی نگه دار
      try {
        const keys = Object.keys(cj || {}).slice(0, 20);
        state.lastApiShapeKeys = state.lastApiShapeKeys || Object.create(null);
        state.lastApiShapeKeys.chain = keys;
        noteError('MarketWatch keys=[' + keys.join(',') + ']', 'api-shape', { quiet: true });
      } catch (e0) {}
    } catch (e) {}
    return state.uaCatalog || [];
  }

  // فقط نمادهایی که اختیار دارند را پیشنهاد/تطبیق بده
  function matchUaFromCatalog(term, catalog) {
    const tn = normSym(term);
    if (!tn) return { exact: null, list: [] };
    const list = [];
    let exact = null;
    for (const e of (catalog || [])) {
      const names = e.names && e.names.length ? e.names : [e.name];
      let hit = false;
      for (const n of names) {
        const nn = normSym(n);
        if (nn === tn) { exact = exact || { insCode: e.insCode, name: e.name }; hit = true; break; }
        if (nn.indexOf(tn) === 0 || nn.indexOf(tn) >= 0) hit = true;
      }
      if (hit) list.push({ insCode: e.insCode, name: e.name });
    }
    // اولویت: شروع‌شونده با عبارت جستجو
    list.sort((a, b) => {
      const an = normSym(a.name), bn = normSym(b.name);
      const aStarts = an.indexOf(tn) === 0 ? 0 : 1;
      const bStarts = bn.indexOf(tn) === 0 ? 0 : 1;
      if (aStarts !== bStarts) return aStarts - bStarts;
      return an.localeCompare(bn, 'fa');
    });
    return { exact, list };
  }

  function hideUaSuggest() {
    const box = document.getElementById('tsext-ua-suggest');
    if (box) box.style.display = 'none';
    state.uaSuggestActive = -1;
  }

  function showUaSuggest(inputEl, items) {
    if (!inputEl || !items || !items.length) { hideUaSuggest(); return; }
    let box = document.getElementById('tsext-ua-suggest');
    if (!box) {
      box = document.createElement('div');
      box.id = 'tsext-ua-suggest';
      box.className = 'tsext-ua-suggest';
      document.body.appendChild(box);
    }
    const rect = inputEl.getBoundingClientRect();
    const w = Math.max(rect.width, 200);
    // اگر نزدیک لبهٔ چپ صفحه بود، به راست باز شود
    let left = rect.left;
    if (left + w > window.innerWidth - 8) left = Math.max(8, window.innerWidth - w - 8);
    box.style.cssText = 'display:block;position:fixed;top:' + (rect.bottom + 3) + 'px;left:' + left + 'px;width:' + w + 'px;z-index:2147483647;';
    box.innerHTML = items.slice(0, 10).map((it, i) =>
      '<div class="tsext-ua-item' + (i === state.uaSuggestActive ? ' active' : '') + '" data-i="' + i + '" data-name="' + esc(it.name) + '">' + esc(it.name) + '</div>'
    ).join('');
    box._items = items.slice(0, 10);
    box._input = inputEl;
    box.querySelectorAll('.tsext-ua-item').forEach((el) => {
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const name = el.getAttribute('data-name') || '';
        pickUaSuggest(inputEl, name);
      });
    });
  }

  function pickUaSuggest(inputEl, name) {
    if (!inputEl || !name) return;
    inputEl.value = name;
    hideUaSuggest();
    // همگام با همهٔ تب‌ها + سرچ سراسری
    try {
      STRATS.forEach((s) => {
        const el = $id(panelHost, 'tsext-underlying-' + s);
        if (el) el.value = name;
      });
      const gs = document.getElementById('pr-search');
      if (gs) gs.value = name;
    } catch (e) {}
    // اگر از ورودی دیدبان انتخاب شد، به واچ‌لیست هم اضافه کن
    try {
      if (inputEl.id === 'pr-wl-input') {
        inputEl.dispatchEvent(new CustomEvent('tsext-ua-picked', { bubbles: true, detail: { name: name } }));
      }
    } catch (e) {}
    fetchAndRender();
  }

  function bindUaAutocomplete(inputEl) {
    if (!inputEl || inputEl._uaBound) return;
    inputEl._uaBound = true;
    inputEl.setAttribute('autocomplete', 'off');
    inputEl.setAttribute('spellcheck', 'false');
    inputEl.addEventListener('input', () => {
      const q = (inputEl.value || '').trim();
      if (state.uaSuggestTimer) clearTimeout(state.uaSuggestTimer);
      if (q.length < 1) { hideUaSuggest(); return; }
      state.uaSuggestTimer = setTimeout(async () => {
        try {
          // کاتالوگ اختیار (ممکن است نام‌ها ناقص باشند)
          const cat = await ensureUaCatalog(false);
          const codeSet = Object.create(null);
          (cat || []).forEach((e) => { codeSet[String(e.insCode)] = e; });
          let list = matchUaFromCatalog(q, cat).list.filter((x) => x.name && !/^\d+$/.test(String(x.name)));
          const tn = normSym(q);
          const seen = Object.create(null);
          list.forEach((x) => { seen[String(x.insCode)] = true; });

          // همیشه جستجوی زندهٔ tsetmc — فقط نمادهایی که در کاتالوگ اختیار هستند
          // اگر کاتالوگ هنوز خالی است، نتایج جستجو را موقتاً نشان بده (اعتبار اختیار در Enter چک می‌شود)
          try {
            const sj = await apiGet('/GetInstrumentSearch/' + encodeURIComponent(q), 1, 0, { priority: 'low' });
            const results = (sj && sj.instrumentSearch) || [];
            for (const h of results) {
              if (!h || !(h.flow === 1 || h.flow === 2)) continue;
              const code = String(h.insCode || '');
              if (!code || seen[code]) continue;
              const nm = String(h.lVal18AFC || h.lVal30 || '').trim();
              if (!nm) continue;
              const nn = normSym(nm);
              if (nn.indexOf(tn) < 0 && tn.indexOf(nn) < 0) continue;
              // اگر کاتالوگ آماده است، فقط نماد دارای اختیار
              if (cat && cat.length && !codeSet[code]) continue;
              seen[code] = true;
              list.push({ insCode: h.insCode, name: nm });
              if (codeSet[code]) {
                if (!codeSet[code].name || /^\d+$/.test(String(codeSet[code].name))) codeSet[code].name = nm;
                if (codeSet[code].names.indexOf(nm) < 0) codeSet[code].names.push(nm);
              }
            }
          } catch (e) {}

          list.sort((a, b) => {
            const an = normSym(a.name), bn = normSym(b.name);
            const aStarts = an.indexOf(tn) === 0 ? 0 : 1;
            const bStarts = bn.indexOf(tn) === 0 ? 0 : 1;
            if (aStarts !== bStarts) return aStarts - bStarts;
            return an.localeCompare(bn, 'fa');
          });
          // یکتا بر اساس نام
          const uniq = [];
          const seenName = Object.create(null);
          for (const it of list) {
            const k = normSym(it.name);
            if (seenName[k]) continue;
            seenName[k] = true;
            uniq.push(it);
          }
          state.uaSuggestActive = uniq.length ? 0 : -1;
          showUaSuggest(inputEl, uniq.slice(0, 10));
        } catch (e) { hideUaSuggest(); }
      }, 120);
    });
    inputEl.addEventListener('keydown', (e) => {
      const box = document.getElementById('tsext-ua-suggest');
      const open = box && box.style.display !== 'none' && box._items && box._items.length;
      if (!open) return;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        state.uaSuggestActive = Math.min((state.uaSuggestActive < 0 ? 0 : state.uaSuggestActive + 1), box._items.length - 1);
        showUaSuggest(inputEl, box._items);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        state.uaSuggestActive = Math.max((state.uaSuggestActive < 0 ? 0 : state.uaSuggestActive - 1), 0);
        showUaSuggest(inputEl, box._items);
      } else if (e.key === 'Enter' && state.uaSuggestActive >= 0 && box._items[state.uaSuggestActive]) {
        e.preventDefault();
        e.stopPropagation();
        pickUaSuggest(inputEl, box._items[state.uaSuggestActive].name);
      } else if (e.key === 'Escape') {
        hideUaSuggest();
      }
    });
    inputEl.addEventListener('blur', () => { setTimeout(hideUaSuggest, 180); });
    inputEl.addEventListener('focus', () => { try { ensureUaCatalog(false); } catch (e) {} });
  }

  async function fetchAndRenderInner() {
    const host = ensureSidebar();
    const inp = readInputs();
    if (!inp.term) { setStatus('نماد پایه را بنویسید و Enter بزنید'); try { const el = listEl(); if (el) el.innerHTML = emptyGuideHtml(); setListHeader(''); } catch (e) {} return; }
    // تعویض نماد از ورودی/دیدبان: لیست قبلی را نگه ندار
    if (state.listTerm && state.listTerm !== inp.term) {
      state.forceReorder = true;
      state.listTerm = null;
      try {
        const el = listEl();
        if (el) {
          showLoadingOverlay(el, inp.term);
          el.removeAttribute('data-list-term');
          el.removeAttribute('data-strategy');
          setListHeader('');
          setStatus('بارگذاری «' + inp.term + '»…');
        }
      } catch (e) {}
    }
    state.showAllList = false;
    saveSettings();
    const seq = ++state.fetchSeq;
    hideUaSuggest();

    const cj = await apiGet('/GetInstrumentOptionMarketWatch/0', 5, 1, { priority: 'low' });
    if (seq !== state.fetchSeq) return; // پاسخ قدیمی؛ نادیده گرفته می‌شود
    if (!cj) {
      setGoLoading(false);
      setStatus('پاسخ tsetmc نامعتبر بود — اتصال یا ساختار API را بررسی کنید');
      return;
    }
    // لایهٔ سازگاری: اگر نام فیلد عوض شده باشد، چند alias رایج را امتحان می‌کنیم
    const chainRaw = cj.instrumentOptMarketWatch || cj.InstrumentOptMarketWatch || cj.optionMarketWatch || cj.instrumentOptionMarketWatch || null;
    if (!Array.isArray(chainRaw) || !chainRaw.length) {
      setGoLoading(false);
      const keys = Object.keys(cj || {}).slice(0, 8).join(', ');
      // کلیدهای پاسخ فقط در لاگ داخلی — کاربر پیام ساده می‌بیند
      try {
        state.lastApiShapeKeys = state.lastApiShapeKeys || Object.create(null);
        state.lastApiShapeKeys.chain = (keys || '').split(', ').filter(Boolean);
      } catch (eK) {}
      noteError(new Error('MarketWatch empty/keys=' + keys), 'api-shape', { quiet: true });
      setStatus('زنجیره خالی آمد — بازار شاید بسته است یا ساختار API عوض شده');
      return;
    }
    const chain = chainRaw;
    buildUaCatalogFromChain(chain);

    // شناسایی نماد — فقط تطبیق دقیق نام (شباهت جزئی = «نماد وجود ندارد» مگر چند نامزد دقیق برای انتخاب)
    let found = (state.symbolCache && state.symbolCache.term === inp.term) ? state.symbolCache.found : null;
    let candidates = null;
    if (!found) {
      const tn = normSym(inp.term);
      // ۱) تطبیق دقیق در کاتالوگ اختیار
      const matched = matchUaFromCatalog(inp.term, state.uaCatalog);
      if (matched.exact) {
        found = matched.exact;
      } else if (matched.list && matched.list.length) {
        const exacts = matched.list.filter((x) => normSym(x.name) === tn);
        if (exacts.length === 1) found = exacts[0];
        else if (exacts.length > 1) candidates = exacts.slice(0, 20);
        // شباهت جزئی را به‌عنوان یافت‌شده قبول نکن
      }

      // اگر در کاتالوگ پیدا نشد، یک‌بار کاتالوگ را اجباری تازه کن و دوباره تطبیق بده
      if (!found && !candidates) {
        try {
          await ensureUaCatalog(true);
          const rematch = matchUaFromCatalog(inp.term, state.uaCatalog);
          if (rematch.exact) found = rematch.exact;
          else if (rematch.list && rematch.list.length) {
            const exacts = rematch.list.filter((x) => normSym(x.name) === tn);
            if (exacts.length === 1) found = exacts[0];
            else if (exacts.length > 1) candidates = exacts.slice(0, 20);
          }
        } catch (eRem) {}
      }

      // ۲) جستجوی tsetmc — فقط نام دقیق
      if (!found && !candidates) {
        try {
          const sj = await apiGet('/GetInstrumentSearch/' + encodeURIComponent(inp.term), 3, 1);
          if (seq !== state.fetchSeq) return;
          const results = (sj && sj.instrumentSearch) || [];
          const hits = results.filter((x) => x && (x.lVal18AFC || x.lVal30) && (x.flow === 1 || x.flow === 2));
          // فقط تطبیق دقیق نام — نه includes
          const exactHits = hits.filter((x) => normSym(x.lVal18AFC) === tn || normSym(x.lVal30) === tn);

          if (!exactHits.length) {
            setGoLoading(false);
            setStatus('نمادی با این نام وجود ندارد');
            try {
              const el = listEl();
              if (el) el.innerHTML = '<div class="tsext-empty">نمادی با این نام وجود ندارد.</div>';
              setListHeader('');
            } catch (e) {}
            clearCache();
            return;
          }

          const withOpt = [];
          const withoutOpt = [];
          for (const h of exactHits) {
            const code = Number(h.insCode);
            if (!code) continue;
            const has = chain.some((r) => Number(rowUaInsCode(r)) === code);
            const item = { insCode: h.insCode, name: h.lVal18AFC || h.lVal30 || inp.term };
            if (has) withOpt.push(item);
            else withoutOpt.push(item);
          }

          if (withOpt.length === 1) {
            found = withOpt[0];
          } else if (withOpt.length > 1) {
            candidates = withOpt.slice(0, 20);
          } else if (withoutOpt.length) {
            // نام دقیق نماد در بازار هست، ولی اختیار ندارد
            setGoLoading(false);
            setStatus('قرارداد اختیار معامله برای این نماد یافت نشد');
            try {
              const el = listEl();
              if (el) el.innerHTML = '<div class="tsext-empty">قرارداد اختیار معامله برای این نماد یافت نشد.</div>';
              setListHeader('');
            } catch (e) {}
            clearCache();
            return;
          } else {
            setGoLoading(false);
            setStatus('نمادی با این نام وجود ندارد');
            try {
              const el = listEl();
              if (el) el.innerHTML = '<div class="tsext-empty">نمادی با این نام وجود ندارد.</div>';
              setListHeader('');
            } catch (e) {}
            clearCache();
            return;
          }
        } catch (e) {
          setGoLoading(false);
          setStatus('نمادی با این نام وجود ندارد');
          try {
            const el = listEl();
            if (el) el.innerHTML = '<div class="tsext-empty">نمادی با این نام وجود ندارد.</div>';
            setListHeader('');
          } catch (e2) {}
          clearCache();
          return;
        }
      }
      if (found && !candidates) {
        state.symbolCache = { term: inp.term, found };
        try { pushRecentSymbol(found.name || inp.term); } catch (e) {}
      }
    }

    setGoLoading(false);
    if (candidates) {
      state.candidates = { term: inp.term, list: candidates };
      clearCache();
      renderActive();
      return;
    }
    state.candidates = null;

    const uaIns = Number(found.insCode);
    const rows = chain.filter((r) => Number(rowUaInsCode(r)) === uaIns);
    if (!rows.length) {
      setStatus('قرارداد اختیار معامله برای این نماد یافت نشد');
      try {
        const el = listEl();
        if (el) el.innerHTML = '<div class="tsext-empty">قرارداد اختیار معامله برای این نماد یافت نشد.</div>';
        setListHeader('');
      } catch (e) {}
      clearCache();
      return;
    }
    // نام استاندارد کاتالوگ را در ورودی بنویس
    try {
      const displayName = found.name || inp.term;
      STRATS.forEach((s) => {
        const el = $id(panelHost, 'tsext-underlying-' + s);
        if (el && normSym(el.value) !== normSym(displayName)) el.value = displayName;
      });
      const gs = document.getElementById('pr-search');
      if (gs) gs.value = displayName;
    } catch (e) {}
    try { pushRecentSymbol(found.name || inp.term); } catch (e) {}

    const ua = rows.find((r) => Number(r.uaInsCode) === uaIns);
    const rawUaLive = asNum(ua && ua.pDrCotVal_UA, 0);
    const livePrice = rawUaLive || asNum(ua && ua.pClosing_UA, 0);
    const livePriceIsLive = rawUaLive > 0;
    // اگر نماد عوض شده، نوارهای باز قبلی و تیک‌های قیمت بی‌معناست + لیست باید از نو ساخته شود
    if (!state.cache || state.cache.term !== inp.term) {
      state.openKeys = new Set();
      state.uaTicks = [];
      state.prevBaseShown = null;
      state.forceReorder = true;
      if (state.listTerm && state.listTerm !== inp.term) state.listTerm = null;
    }
    state.cache = { term: inp.term, rows, livePrice, livePriceIsLive };
    state.cacheGen = (state.cacheGen || 0) + 1; // نسل جدید تا تیک‌های قدیمی اعمال نشوند
    try { putChainCache(state.cache); } catch (e) {}
    state.lastChainAt = Date.now();
    // ثبت تیک قیمت مبنا برای اسپارک‌لاین نشست (فقط تغییر قیمت یا هر ۳۰ ثانیه)
    if (livePrice > 0) {
      if (!Array.isArray(state.uaTicks)) state.uaTicks = [];
      const tk = state.uaTicks, lastT = tk[tk.length - 1];
      if (!lastT || lastT.p !== livePrice || (Date.now() - lastT.t) > 30000) tk.push({ t: Date.now(), p: livePrice });
      if (tk.length > 120) tk.splice(0, tk.length - 120);
    }
    // قیمت دیروز سهم پایه — یک‌بار برای هر نماد؛ برای نمایش «تغییر روز»
    const uaInsKey = String(uaIns);
    if (!state.uaInfo || state.uaInfo.uaInsCode !== uaInsKey) {
      apiGetRaw('https://cdn.tsetmc.com/api/ClosingPrice/GetClosingPriceInfo/' + encodeURIComponent(uaInsKey), 2).then((ji) => {
        const info = (ji && (ji.closingPriceInfo || ji.closingpriceinfo)) || null;
        const yPrice = info ? (Number(info.priceYesterday) || Number(info.py) || 0) : 0;
        if (yPrice > 0 && state.cache && state.cache.term === inp.term) {
          state.uaInfo = { uaInsCode: uaInsKey, yPrice };
          renderActive();
        }
      }).catch(() => {});
    }
    setUpdatedNow();
    try { updateFavFilterBtn(); } catch (e) {}
    renderActive();
    // بلافاصله یک تیک حیاتی (سهم پایه) و یک تیک ردیف‌های دیدنی، بدون معطلی برای تایمر بعدی
    try { criticalPriceTick(); } catch (e) {}
    try { visiblePriceTick(); } catch (e) {}
  }

  // انتخاب یکی از نامزدهای مبهم توسط کاربر (بدون فرض یا حدس خودکار)
  function renderCandidatePicker() {
    setListHeader(`<div class="tsext-hdr">چند نماد با «${esc(state.candidates.term)}» مطابقت داشت — یکی را انتخاب کنید:</div>`);
    const el = listEl(); el.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'tsext-candlist';
    state.candidates.list.forEach((c) => {
      const b = document.createElement('div');
      b.className = 'tsext-cand';
      b.textContent = c.name || '(بدون نام)';
      b.addEventListener('click', () => {
        $id(panelHost, 'tsext-underlying-' + state.strategy).value = c.name || '';
        state.candidates = null;
        fetchAndRender();
      });
      wrap.appendChild(b);
    });
    el.appendChild(wrap);
    setStatus('در انتظار انتخاب نماد');
  }

  // رندر مجدد از دادهٔ کش‌شده — بدون درخواست شبکه؛ برای سوییچ تب/مرتب‌سازی/فیلتر کلاس/تغییر سود-کارمزد
  function renderActive() {
    const host = ensureSidebar();
    try { clearLoadingOverlay(listEl()); } catch (e0) {}
    if (state.candidates) { renderCandidatePicker(); return; }
    if (!state.cache) {
      setListHeader('');
      const el = listEl();
      if (el) el.innerHTML = emptyGuideHtml();
      setStatus('نماد پایه را وارد کنید و Enter بزنید');
      return;
    }
    const inp = readInputs();
    const { term, livePrice, livePriceIsLive } = state.cache;
    const execOn = state.priceMode === 'exec';
    const rows = execOn ? withExecPrices(state.cache.rows) : state.cache.rows;
    const basePrice = (inp.manual !== null && inp.manual > 0) ? inp.manual : livePrice;
    // مثبت‌پنج: پیش‌فرض ۰.۵٪ مگر کاربر عدد بدهد
    const effComm = (inp.commission !== null) ? inp.commission : KB.DEFAULT_COMMISSION_PCT;
    // فرصت‌های جامپ (هر چهار زیرحالت): همیشه کارمزد صفر — سهمی جابه‌جا نمی‌شود و فیلد کارمزدی هم ندارد (v1.25.1)
    const jampComm = KB.JAMP_COMMISSION_PCT;
    const liveLabel = livePriceIsLive ? 'زنده' : 'پایانی (بدون معامله امروز)';
    // جامپ: قیمت سهم پایه همیشه همان «قیمت تمام‌شده»ای است که کاربر در بخش «مشخصات قرارداد
    // جاری» دستی وارد می‌کند — نه فیلد «قیمت دستی» بالای صفحه و نه قیمت زندهٔ بازار. آن فیلد
    // بالا برای جامپ استفاده نمی‌شود.
    const jampManual = readJampManual(host);
    let pinfo;
    if (inp.strategy === 'jamp') {
      const jm = state.jampMode || 'yield';
      if (jm === 'downshift') {
        if (jampManual && jampManual.mode === 'downshift') {
          pinfo = 'جامپ (کاهش اعمال و سرمایه درگیر) — قرارداد جاری: <b>' + esc(jampManual.oldLabel || jampManual.oldInsCode || '') + '</b>'
            + (jampManual.recvPremium != null
              ? ' · دریافتی: <b>' + num(jampManual.recvPremium) + '</b>' + helpBtn('سهم پایه = اعمال جاری + (بازخرید زنده − دریافتی)\nفقط اعمال کمتر از اعمال جاری بررسی می‌شود · بدون کارمزد · حتی با سود صفر، سرمایهٔ درگیر کم و پول آزاد می‌شود')
              : ' · <b>ناقص</b> — ⚠ پرمیوم دریافتی قرارداد جاری را وارد کنید');
        } else {
          pinfo = 'جامپ (کاهش اعمال و سرمایه درگیر): <b>ناقص</b> — ⚠ قرارداد جاری خود را از لیست انتخاب کنید و پرمیوم دریافتی آن را وارد کنید';
        }
      } else if (jm === 'upshift') {
        if (jampManual && jampManual.mode === 'upshift') {
          pinfo = 'جامپ (افزایش اعمال و سود) — قرارداد جاری: <b>' + esc(jampManual.oldLabel || jampManual.oldInsCode || '') + '</b>'
            + (jampManual.recvPremium != null
              ? ' · دریافتی: <b>' + num(jampManual.recvPremium) + '</b>' + helpBtn('سهم پایه = اعمال جاری + (بازخرید زنده − دریافتی)\nفقط اعمال بالاتر از اعمال جاری بررسی می‌شود · بدون کارمزد')
              : ' · <b>ناقص</b> — ⚠ پرمیوم دریافتی قرارداد جاری را وارد کنید');
        } else {
          pinfo = 'جامپ (افزایش اعمال و سود): <b>ناقص</b> — ⚠ قرارداد جاری خود را از لیست انتخاب کنید و پرمیوم دریافتی آن را وارد کنید';
        }
      } else if (jm === 'challenge') {
        if (jampManual && jampManual.mode === 'challenge') {
          pinfo = 'چالشی — قرارداد جاری: <b>' + esc(jampManual.oldLabel || jampManual.oldInsCode || '') + '</b>'
            + (jampManual.recvPremium != null
              ? ' · پرمیوم دریافتی: <b>' + num(jampManual.recvPremium) + '</b>' + helpBtn('سهم پایه = اعمال جاری + (بازخرید زنده − دریافتی) · بدون کارمزد')
              : ' · <b>ناقص</b> — ⚠ پرمیوم دریافتی قرارداد جاری را وارد کنید');
        } else {
          pinfo = 'چالشی: <b>ناقص</b> — ⚠ قرارداد جاری خود را از لیست انتخاب کنید و پرمیوم دریافتی آن را وارد کنید';
        }
      } else {
        if (jampManual && jampManual.live) {
          pinfo = 'جامپ بازدهی · <b style="color:var(--tsext-green)">⚡ زنده</b> — قرارداد: <b>' + esc(jampManual.oldLabel || jampManual.oldInsCode || '') + '</b>' + helpBtn('فقط قراردادهای با سررسید دورتر از قرارداد جاری · بدون کارمزد');
        } else {
          pinfo = 'جامپ بازدهی: <b>ناقص</b> — قرارداد را از فهرست زنده انتخاب کنید';
        }
      }
    } else {
      pinfo = (inp.manual !== null && inp.manual > 0)
        ? 'قیمت مبنا: <b>دستی ' + num(basePrice) + '</b>' + (livePrice ? ' (' + liveLabel + ': ' + num(livePrice) + ')' : '')
        : 'قیمت مبنا: <b>' + liveLabel + ' ' + num(basePrice) + '</b>';
      if (!(inp.manual !== null && inp.manual > 0)) {
        pinfo += ' — ⚠ برای دقت بیشتر قیمت دستی را وارد کنید';
      }
    }
    if (inp.strategy === 'jamp') {
      pinfo += '<span class="tsext-pi-sep"></span><span class="tsext-pi-meta">کارمزد: صفر</span>';
    } else if (inp.commission !== null && inp.commission > 0) {
      pinfo += '<span class="tsext-pi-sep"></span><span class="tsext-pi-meta">کارمزد: ' + inp.commission + '٪</span>';
    } else {
      pinfo += '<span class="tsext-pi-sep"></span><span class="tsext-pi-meta">کارمزد: اعمال‌نشده</span>';
    }
    pinfo += '<span class="tsext-pi-sep"></span><span class="tsext-pi-meta">ترتیب: ' + (SORTS[inp.sort] ? SORTS[inp.sort].label : SORTS.profit.label) + '</span>';
    // تغییر روز سهم پایه نسبت به دیروز + اسپارک‌لاین نشست (مثبت‌پنج — مبنی بر قیمت زنده)
    if (inp.strategy !== 'jamp' && livePrice > 0) {
      const uaInsKey = String((state.cache.rows && state.cache.rows[0] && state.cache.rows[0].uaInsCode) || '');
      const info = (state.uaInfo && state.uaInfo.uaInsCode === uaInsKey) ? state.uaInfo : null;
      if (info && info.yPrice > 0) {
        const chg = ((livePrice - info.yPrice) / info.yPrice) * 100;
        pinfo += ' · <span title="تغییر سهم پایه نسبت به قیمت دیروز">تغییر روز: <b class="' + (chg >= 0 ? 'pos' : 'neg') + '" dir="ltr">' + (chg >= 0 ? '+' : '−') + upc(Math.abs(chg)) + '٪</b></span>';
      }
      const svg = sparkSvg(state.uaTicks);
      if (svg) pinfo += ' <span title="روند قیمت مبنا در این نشست">' + svg + '</span>';
    }
    if (execOn) {
      const noBid = rows.filter((r) => !(r.__exec && r.__exec.optBid > 0)).length;
      pinfo += '<span class="tsext-pi-sep"></span><span class="tsext-pm-badge exec">قیمت قابل‌اجرا</span>'
        + helpBtn('محاسبه با قیمت‌های واقعاً قابل‌معامله از دفتر سفارش:\nخرید سهم/قرارداد = بهترین فروش · فروش قرارداد/سهم = بهترین خرید.\nحجم قابل‌معامله = کمترین حجم صف پاهای معامله. قراردادی که صف مقابل ندارد کنار گذاشته می‌شود.'
         )
        + (noBid ? ' <span class="tsext-vol-tag" title="قراردادهایی که هنوز صفشان دریافت نشده یا صف خرید ندارند">' + num(noBid) + ' قرارداد بدون صف</span>' : '');
    }
    priceInfoEl().innerHTML = pinfo;
    // فلاش سبز/قرمز تغییر قیمت مبنا
    if (inp.strategy !== 'jamp') {
      const firstB = priceInfoEl().querySelector('b');
      if (typeof basePrice === 'number' && state.prevBaseShown != null && basePrice !== state.prevBaseShown && firstB) {
        const fc = basePrice > state.prevBaseShown ? 'tsext-flash-up' : 'tsext-flash-down';
        firstB.classList.remove('tsext-flash-up', 'tsext-flash-down');
        void firstB.offsetWidth; // ری‌استارت انیمیشن
        firstB.classList.add(fc);
        setTimeout(() => { try { firstB.classList.remove(fc); } catch (e) {} }, 950);
      }
      state.prevBaseShown = basePrice;
    }

    if (inp.strategy === 'jamp') renderJamp(term, rows, livePrice, inp.minProfit, inp.sort, jampComm, jampManual, state.jampMode || 'yield');
    else if (inp.strategy === 'combo') renderCombo(term, rows, basePrice, livePrice, inp.minProfit, inp.sort, effComm, (inp.manual !== null && inp.manual > 0));
    else renderPosPanj(term, rows, livePrice, basePrice, inp.minProfit, inp.sort, effComm, livePriceIsLive, (inp.manual !== null && inp.manual > 0));
    // اگر پنل جزئیات یک ردیف باز است، همین‌جا هم اعداد محاسباتی‌اش را با ورودی‌های تازه (کارمزد،
    // حداقل سود، قیمت دستی، آستانه‌های تیک و ...) هم‌تراز کن — قبلاً فقط بعد از رفرش خودکار شبکه
    // این‌کار انجام می‌شد، پس با تغییر دستی یک عدد در صفحهٔ اصلی، پنل باز به‌روز نمی‌شد تا بسته و
    // دوباره باز می‌شد. renderActive تنها نقطهٔ مشترک همهٔ این تغییرات دستی است.
    refreshOpenDetailCalc();
    try { applyHaltFlags(); } catch (e) {}
  }

  // خواندن ورودی دستی جامپ — بسته به زیرحالت انتخاب‌شده (state.jampMode):
  // yield: فقط قرارداد جاری از کشویی (زنده) — فیلدهای دستی حذف شدند v1.27
  // downshift (کاهش اعمال و سرمایه درگیر — v1.26): قرارداد جاری + پرمیوم دریافتی؛ فقط اعمال کمتر
  // upshift (افزایش اعمال و سود — v1.27): قرارداد جاری + پرمیوم دریافتی؛ فقط اعمال بالاتر — منطق دقیقاً مثل downshift
  // challenge: قرارداد جاری + پرمیوم دریافتی
  function readJampManual(host) {
    const mode = state.jampMode || 'yield';
    if (mode === 'downshift') {
      const sel = $id(host, 'tsext-jamp-old-downshift');
      const code = sel ? (sel.value || '').trim() : '';
      if (!code) return null;
      const label = sel && sel.selectedOptions && sel.selectedOptions[0] ? sel.selectedOptions[0].textContent : '';
      const rpEl = $id(host, 'tsext-jamp-recv-premium-d');
      const rpV = rpEl ? (rpEl.value || '').trim() : '';
      let recvPremium = null;
      if (rpV !== '') { const v = parseUserNumber(rpV); if (!isNaN(v) && v >= 0) recvPremium = v; }
      return { mode: 'downshift', oldInsCode: code, oldLabel: label, recvPremium };
    }
    if (mode === 'upshift') {
      const sel = $id(host, 'tsext-jamp-old-upshift');
      const code = sel ? (sel.value || '').trim() : '';
      if (!code) return null;
      const label = sel && sel.selectedOptions && sel.selectedOptions[0] ? sel.selectedOptions[0].textContent : '';
      const rpEl = $id(host, 'tsext-jamp-recv-premium-u');
      const rpV = rpEl ? (rpEl.value || '').trim() : '';
      let recvPremium = null;
      if (rpV !== '') { const v = parseUserNumber(rpV); if (!isNaN(v) && v >= 0) recvPremium = v; }
      return { mode: 'upshift', oldInsCode: code, oldLabel: label, recvPremium };
    }
    if (mode === 'challenge') {
      const sel = $id(host, 'tsext-jamp-old-challenge');
      const code = sel ? (sel.value || '').trim() : '';
      if (!code) return null;
      const label = sel && sel.selectedOptions && sel.selectedOptions[0] ? sel.selectedOptions[0].textContent : '';
      const rpEl = $id(host, 'tsext-jamp-recv-premium');
      const rpV = rpEl ? (rpEl.value || '').trim() : '';
      let recvPremium = null;
      if (rpV !== '') { const v = parseUserNumber(rpV); if (!isNaN(v) && v >= 0) recvPremium = v; }
      return { mode: 'challenge', oldInsCode: code, oldLabel: label, recvPremium };
    }
    // yield — فقط حالت زنده (فیلدهای دستی حذف شدند v1.27)
    const liveSel = $id(host, 'tsext-jamp-old-yield');
    const liveCode = liveSel ? (liveSel.value || '').trim() : '';
    if (!liveCode) return null;
    const label = liveSel && liveSel.selectedOptions && liveSel.selectedOptions[0] ? liveSel.selectedOptions[0].textContent : '';
    return { mode: 'yield', live: true, oldInsCode: liveCode, oldLabel: label };
  }

  // گروه‌بندی بر سررسید
  function groupByExpiry(rows) {
    const m = {};
    for (const r of rows) { const d = Number(r.remainedDay) || 0; (m[d] = m[d] || []).push(r); }
    return Object.keys(m).sort((a, b) => a - b).map((d) => ({ days: Number(d), rows: m[d] }));
  }

  // اسپارک‌لاین کوچک SVG از تیک‌های قیمت مبنا در این نشست
  function sparkSvg(ticks) {
    if (!Array.isArray(ticks) || ticks.length < 2) return '';
    const w = 96, h = 26, pad = 2;
    const ps = ticks.map((x) => Number(x.p)).filter((p) => p > 0);
    if (ps.length < 2) return '';
    let mn = Math.min.apply(null, ps), mx = Math.max.apply(null, ps);
    if (mx - mn < 1e-9) { mx += 1; mn -= 1; }
    const pts = ps.map((p, i) => {
      const x = pad + (i / (ps.length - 1)) * (w - 2 * pad);
      const y = h - pad - ((p - mn) / (mx - mn)) * (h - 2 * pad);
      return x.toFixed(1) + ',' + y.toFixed(1);
    }).join(' ');
    const col = ps[ps.length - 1] >= ps[0] ? 'var(--tsext-green)' : 'var(--tsext-red)';
    return '<svg class="tsext-spark" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">'
      + '<polyline points="' + pts + '" fill="none" stroke="' + col + '" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/></svg>';
  }

  // سرستون‌های مرتب‌سازی لیست — عرض ستون‌ها با سلول‌های نوار هم‌راستا است
  function colsHtml(sort, profitLabel) {
    // کلاس‌های هدر جدا از سلول داده (دیگر tsext-bar-profit روی هدر نیست تا رنگ/اندازه نشت نکند)
    const profitTip = 'سود ماهانه ≈ (بازده کل تا سررسید ÷ روزمانده) × ۳۰ — مرتب‌سازی با کلیک؛ تغییر عرض از لبهٔ ستون';
    const mk = (key, label, cls, resizeKey, titleExtra) => {
      const isOn = sort === key;
      const tip = titleExtra || ('مرتب‌سازی بر اساس این ستون — برای تغییر عرض، لبهٔ ستون را بکشید');
      const arrow = isOn ? '<span class="tsext-sort-arrow" aria-hidden="true">▼</span>' : '';
      return '<span class="tsext-col ' + cls + (isOn ? ' on' : '') + '" role="columnheader" aria-sort="'
        + (isOn ? 'descending' : 'none') + '" tabindex="0" data-sort="' + key + '" data-resize="'
        + (resizeKey || key) + '" title="' + tip + '"><i class="tsext-col-grip" aria-hidden="true"></i>'
        + label + arrow + '</span>';
    };
    return '<div class="tsext-cols" role="row">'
      + '<span class="tsext-cols-strip" aria-hidden="true"></span>'
      + mk('class', 'کلاس', 'tsext-cols-class', 'class')
      + mk('name', 'نماد', 'tsext-col-name', 'name')
      + mk('strike', 'اعمال', 'tsext-col-strike', 'strike')
      + mk('days', 'روزمانده', 'tsext-col-days', 'days')
      + mk('date', 'سررسید', 'tsext-col-date', 'date')
      + mk('class', 'ریسک', 'tsext-col-risk', 'risk')
      + mk('profit', profitLabel || 'سود ماهانه', 'tsext-col-profit', 'profit', profitTip)
      + '<span class="tsext-col tsext-cols-actions" role="columnheader" data-resize="actions" title="تغییر عرض ستون جزئیات — لبهٔ ستون را بکشید"><i class="tsext-col-grip" aria-hidden="true"></i>جزئیات</span>'
      + '</div>';
  }

  function chipHtml(dataC, label, toggleable) {
    const col = classColor(dataC);
    const off = toggleable && !state.classFilter.has(dataC);
    const on = !off;
    return '<button type="button" class="tsext-chip tsext-class-tog' + (off ? ' off' : ' on') + '" data-c="' + dataC
      + '" style="--chip:' + col + ';" title="' + (label || dataC) + '" aria-pressed="' + (on ? 'true' : 'false') + '">'
      + '<span class="tsext-chip-mark" aria-hidden="true">' + (on ? '✓' : '–') + '</span>'
      + '<span class="tsext-chip-lab">' + (label || dataC) + '</span></button>';
  }
  function legendHtml() {
    // دکمه‌های سگمنت: روشن = پررنگ با ✓ ، خاموش = خط‌دار کم‌رنگ با –
    const titles = {
      A: 'A — خیلی پایین‌تر از سهم (خیلی کم‌ریسک) — کلیک برای نمایش/مخفی',
      B: 'B — کمی پایین‌تر از سهم (کم‌ریسک) — کلیک برای نمایش/مخفی',
      X: 'X — نزدیک سهم پایه (متعادل) — کلیک برای نمایش/مخفی',
      '−B': '−B — کمی بالاتر از سهم (پرریسک) — کلیک برای نمایش/مخفی',
      '−A': '−A — خیلی بالاتر از سهم (خیلی پرریسک) — کلیک برای نمایش/مخفی',
    };
    const chips = ALL_CLASSES.map((c) => {
      const col = classColor(c);
      const off = !state.classFilter.has(c);
      const on = !off;
      const tip = titles[c] || c;
      return '<button type="button" class="tsext-chip tsext-class-tog' + (off ? ' off' : ' on') + '" data-c="' + c
        + '" style="--chip:' + col + ';" title="' + tip + '" aria-pressed="' + (on ? 'true' : 'false') + '">'
        + '<span class="tsext-chip-mark" aria-hidden="true">' + (on ? '✓' : '–') + '</span>'
        + '<span class="tsext-chip-lab">' + c + '</span></button>';
    }).join('');
    const html = '<div class="tsext-legend tsext-class-seg" role="group" aria-label="فیلتر کلاس‌بندی">'
      + '<span class="tsext-class-seg-lbl">کلاس</span>' + chips + '</div>';
    try {
      const host = panelHost && panelHost.querySelector('#tsext-class-filter-host');
      if (host) { host.innerHTML = html; return ''; }
    } catch (e) {}
    return html;
  }

  // ----- from src/07b-render-pospanj.js -----
  // ------------------------------------------------ مثبت‌پنج
  function renderPosPanj(term, rows, livePrice, basePrice, minProfit, sort, commission, livePriceIsLive, baseIsManual) {
    const expiryGroups = groupByExpiry(rows);
    const all = [];
    const classPrice = livePrice > 0 ? livePrice : basePrice;
    for (const g of expiryGroups) {
      assignClasses(g.rows, classPrice);
      for (const row of g.rows) {
        const r = analyzeCoveredCallRow(row, basePrice, commission, baseIsManual);
        if (r.error) continue;
        r.class = row.class || 'X';
        r.settlePrice = classPrice;
        all.push(r);
      }
    }
    // همه اعمال با داده معتبر — بدون حذف خودکار؛ فقط پیشنهاد و برچسب
    // (نکته: قبلاً اینجا اعمال بدون حجم/موقعیت‌باز امروز کلاً حذف می‌شدند که با همین کامنت در
    // تضاد بود و باعث می‌شد قراردادهای واقعی و دارای قیمت معتبر از لیست غایب باشند — حالا فقط
    // برچسب کم‌نقدشوندگی می‌خورند، نه حذف)
    const valid = all.filter((r) => r.strike > 0 && r.premium >= 0 && isContractActive(r));
    const aboveCount = valid.filter((r) => r.strike >= basePrice).length;
    applySort(valid, sort, 'pospanj');
    const filtered = valid.filter((r) => r.profitMonth >= minProfit && state.classFilter.has(r.class) && passesMonthFilter(r));

    let softItems = filtered.map((r) => {
      const risk = riskLabel(r.class || 'X');
      const key = r.insCode ? ('i:' + r.insCode) : ('k:' + (r.ticker || '') + '|' + r.strike + '|' + fmtDate(r.expiry));
      const badges = [];
      const spec = {
        key,
        cls: r.class || 'X',
        name: esc(r.ticker || ''),
        strike: num(r.strike),
        daysText: num(r.days),
        dateText: fmtDate(r.expiry),
        profitPct: r.profitMonth,
        detailRows: withExecRows(posPanjRows(r), r),
        insCode: r.insCode,
        uaInsCode: r.uaInsCode,
        riskText: risk.text,
        badge: badges.join(' · '),
        volume: r.volume,
        openInterest: r.openInterest,
        days: r.days,
      };
      return {
        key, cls: spec.cls, profitPct: spec.profitPct,
        profitTitle: 'سود ماهانه ≈ (بازده کل تا سررسید ÷ روزمانده) × ۳۰ · ورودی: پرمیوم، اعمال، روزمانده، سهم پایه' + (state.priceMode === 'exec' ? '، صف ask/bid' : '، آخرین معامله'),
        strike: spec.strike, daysText: spec.daysText, dateText: spec.dateText,
        riskText: risk.text, spec,
      };
    });
    const liveLabel = livePriceIsLive ? 'قیمت زنده' : 'قیمت پایانی (بدون معامله امروز)';
    // همیشه وضعیت کارمزد نشان داده شود، حتی وقتی صفر/واردنشده است — تا کاربر هیچ‌وقت بی‌اطلاع
    // از یک فرضِ بی‌صدا سودش را بیشتر از واقعی نبیند
    const commNote = (commission > 0) ? (' · کارمزد ' + commission + '٪') : ' · کارمزد: صفر (واردنشده)';
    const hdrHtml = `
      <div class="tsext-hdr">
        <span title="نماد پایه">${esc(term)}</span>
        — <span>مثبت‌پنج</span>
        · <span title="قیمت مبنا">مبنا <b>${num(basePrice)}</b></span>
        · <span title="${livePriceIsLive ? 'آخرین معامله امروز' : 'قیمت پایانی'}">${livePriceIsLive ? 'زنده' : 'پایانی'} <b>${num(livePrice)}</b></span>
        ${commNote}
      </div>
      ${legendHtml()}${colsHtml(sort)}`;
    const statusTxt = term + ' · ' + valid.length + ' اعمال · ' + filtered.length + ' فرصت · ' + aboveCount + ' بالای قیمت (نمایش‌داده‌شده)';
    try {
      let best = 0;
      for (const r of filtered) { const p = Number(r.profitMonth); if (isFinite(p) && p > best) best = p; }
      if (typeof window.__prSetChipScore === 'function') window.__prSetChipScore(term, best);
    } catch (e) {}

    if (filtered.length && applyListUpdate(softItems, 'pospanj', hdrHtml, sort, statusTxt)) return;

    const ctx = beginListRender();
    setListHeader(hdrHtml);
    const el = listEl(); el.setAttribute('data-strategy', 'pospanj');
    if (!filtered.length) {
      el.innerHTML = `<div class="tsext-empty">فرصتی نیست (${valid.length} اعمال بررسی شد). فیلتر کلاس را هم چک کنید.</div>`;
      setStatus(statusTxt);
      endListRender(ctx);
      return;
    }
    appendLimitedBars(el, softItems);
    setStatus(statusTxt);
    endListRender(ctx);
  }

  function posPanjRows(r) {
    const priceTag = r.priceLive
      ? '<span class="tsext-tag-live">زنده</span>'
      : '<span class="tsext-tag-close">پایانی</span>';
    const risk = riskLabel(r.class || 'X');
    const cls = r.class || 'X';
    const classNames = {
      A: 'A — خیلی پایین‌تر از سهم (ITM عمیق)',
      B: 'B — کمی پایین‌تر از سهم (ITM نزدیک)',
      X: 'X — نزدیک سهم پایه (ATM)',
      '−B': '−B — کمی بالاتر از سهم (OTM نزدیک)',
      '−A': '−A — خیلی بالاتر از سهم (OTM دور)',
    };
    const share = Number(r.shareBuy || r.settlePrice) || 0;
    const strike = Number(r.strike) || 0;
    const intrinsic = share - strike;
    let intrinsicCell, intrinsicCls;
    if (!(share > 0) || !(strike > 0)) {
      intrinsicCell = '–';
      intrinsicCls = '';
    } else if (intrinsic <= 0) {
      intrinsicCell = 'ارزش ذاتی ندارد';
      intrinsicCls = 'neg';
    } else {
      intrinsicCell = num(intrinsic) + ' ریال';
      intrinsicCls = 'pos';
    }
    return [
      ['__hero__', [
        ['سود ماهانه', upc(r.profitMonth) + ' ٪', 'main ' + percol(r.profitMonth)],
      ]],
      ['__sect__', 'معامله'],
      ['کلاس اعمال', classNames[cls] || cls, ''],
      ['سطح ریسک', risk.text + warnChipsHtml(r.volume, r.openInterest, r.days, r.class || risk.cls), riskValClass(risk)],
      ['قیمت اعمال (ریال)', num(strike), ''],
      ['پرمیوم (ریال)', num(r.premium) + ' ' + priceTag, ''],
      ['قیمت سهم پایه (ریال)', num(share) + ' ' + (r.baseIsManual
        ? '<span class="tsext-tag-close">دستی</span>'
        : '<span class="tsext-tag-live">زنده</span>'), ''],
      ['ارزش ذاتی', intrinsicCell, intrinsicCls],
      ['روزمانده / سررسید', num(r.days) + ' روز — ' + fmtDate(r.expiry) + (exerciseWarn(r.days) ? ' <span class="tsext-exer-warn" title="' + esc(exerciseWarn(r.days).title) + '">⏱ ' + esc(exerciseWarn(r.days).short) + '</span>' : ''), ''],
      ['__sect__', 'بازده'],
      ['سود به ریال', num(r.profitTotal), percol(r.profitTotal)],
      ['سرمایه درگیر', num(r.invested), ''],
      ['سود به درصد', upc(r.profitPct) + ' ٪', percol(r.profitPct)],
      ['بدون اعمال', upc(r.noExProfitPct) + ' ٪', percol(r.noExProfitPct)],
      ['دریافتی', num(r.received), ''],
      ['پرداختی', num(r.paid), ''],
      ['__sect__', 'مرجع'],
      ['اندازه قرارداد', num(r.contractSize || r.size), ''],
      ['حجم امروز / موقعیت باز', num(r.volume || 0) + ' / ' + num(r.openInterest || 0)
        + (liquidityWarn(r.volume, r.openInterest)
          ? ' <span class="tsext-liq-warn" title="' + esc(liquidityWarn(r.volume, r.openInterest).title) + '">⚠ ' + esc(liquidityWarn(r.volume, r.openInterest).short) + '</span>'
          : ''),
        liquidityWarn(r.volume, r.openInterest) ? 'warn' : ''],
    ];
  }

  // ----- from src/07c-render-jump.js -----
  // ------------------------------------------------ جامپ
  function renderJamp(term, rows, livePrice, minProfit, sort, commission, manual, mode) {
    // طبقه‌بندی A/B/X/−B/−A فقط جنبهٔ نمایشی دارد (نه بخشی از فرمول سود) و همچنان از قیمت زنده
    // استفاده می‌کند تا وضعیت فعلی هر اعمال نسبت به بازار نشان داده شود؛ خودِ محاسبهٔ سود پایین‌تر
    // هرگز به این قیمت زنده برنمی‌گردد.
    assignClasses(rows, livePrice || 0);
    // دراپ‌داون‌های انتخاب قرارداد فعلی (بازدهی زنده / کاهش اعمال / افزایش اعمال / چالشی)
    populateJampOldSelect(rows, 'tsext-jamp-old-yield');
    populateJampOldSelect(rows, 'tsext-jamp-old-downshift');
    populateJampOldSelect(rows, 'tsext-jamp-old-upshift');
    populateJampOldSelect(rows, 'tsext-jamp-old-challenge');
    mode = mode || (manual && manual.mode) || 'yield';

    const ctx = beginListRender();
    setListHeader('');
    const el = listEl();

    if (mode === 'downshift') { renderJampDownshift(term, rows, minProfit, sort, manual, el, ctx); return; }
    if (mode === 'upshift') { renderJampUpshift(term, rows, minProfit, sort, manual, el, ctx); return; }
    if (mode === 'challenge') { renderJampChallenge(term, rows, minProfit, sort, manual, el, ctx); return; }

    // بازدهی — فقط حالت زنده (v1.27): قرارداد جاری از کشویی انتخاب می‌شود، پرمیوم آفست و روزمانده از قیمت زنده
    if (!manual || !manual.oldInsCode) {
      setListHeader(`
        <div class="tsext-hdr">
          <span title="نماد پایه">${esc(term)}</span>
          — <span title="مقایسه با قرارداد فعلی شما">جامپ بازدهی</span>
        </div>`);
      el.innerHTML = `<div class="tsext-empty">قرارداد فعلی‌تان را از فهرست بالا انتخاب کنید تا پرمیوم آفست و روزمانده از قیمت لحظه‌ای بازار بیاید.<br>سهم پایهٔ جدید = اعمال فعلی + پرمیوم آفست زنده · محاسبه دقیقاً مثل مثبت‌پنج (کارمزد صفر).</div>`;
      setStatus(term + ' · جامپ بازدهی · در انتظار انتخاب قرارداد جاری');
      endListRender(ctx);
      return;
    }
    const myRow = (rows || []).find((r) => r && String(r.insCode_C) === String(manual.oldInsCode));
    if (!myRow) {
      setListHeader(`
        <div class="tsext-hdr">
          <span title="نماد پایه">${esc(term)}</span>
          — <span title="مقایسه با قرارداد فعلی شما">جامپ بازدهی · زنده</span>
        </div>`);
      el.innerHTML = `<div class="tsext-empty">قرارداد انتخاب‌شده در زنجیره فعلی یافت نشد — نماد را دوباره جست‌وجو کنید یا قرارداد دیگری برگزینید.</div>`;
      setStatus(term + ' · جامپ بازدهی · قرارداد زنده یافت نشد');
      endListRender(ctx);
      return;
    }
    const xMy = execOf(myRow); // قابل‌اجرا: بازخرید قرارداد فعلی = بهترین فروش
    const livePrem = xMy ? asNum(xMy.optAsk, 0) : (asNum(myRow.pDrCotVal_C, 0) || asNum(myRow.pClosing_C, 0));
    const liveStrike = asNum(myRow.strikePrice, 0);
    const liveDays = asNum(myRow.remainedDay, 0);
    if (!(liveStrike > 0) || !(livePrem >= 0) || !(liveDays > 0)) {
      setListHeader(`
        <div class="tsext-hdr">
          <span title="نماد پایه">${esc(term)}</span>
          — <span>جامپ بازدهی · زنده</span>
        </div>`);
      el.innerHTML = `<div class="tsext-empty">قیمت زندهٔ قرارداد انتخاب‌شده هنوز در دسترس نیست (شاید معامله نشده). چند لحظه صبر کنید.</div>`;
      setStatus(term + ' · جامپ بازدهی · در انتظار قیمت زنده قرارداد شما');
      endListRender(ctx);
      return;
    }
    manual = {
      mode: 'yield',
      live: true,
      oldInsCode: manual.oldInsCode,
      oldLabel: manual.oldLabel,
      oldStrike: liveStrike,
      offsetPremium: livePrem,
      days: liveDays,
      priceLive: xMy ? livePrem > 0 : asNum(myRow.pDrCotVal_C, 0) > 0,
      oldAskQ: xMy ? asNum(xMy.optAskQ, 0) : null,
      ticker: myRow.lVal18AFC_C || myRow.lVal30_C || '',
    };

    const candidates = [];
    const skipCode = manual.oldInsCode ? String(manual.oldInsCode) : '';
    for (const row of rows) {
      if (skipCode && String(row.insCode_C) === skipCode) continue;
      const c = buildJampCandidate(row, manual, commission);
      if (c) candidates.push(c);
    }
    applySort(candidates, sort, 'jamp');
    const filtered = candidates.filter((o) =>
      o.profitMonth >= minProfit &&
      state.classFilter.has(o.class || 'X') &&
      passesMonthFilter(o) &&
      isContractActive(o)
    );

    const liveTag = ' · <span title="آفست از قیمت زنده" style="color:var(--tsext-green)">⚡زنده' + (manual.ticker ? (' ' + esc(manual.ticker)) : '') + '</span>';
    const hdrHtml = `
      <div class="tsext-hdr">
        <span title="نماد پایه">${esc(term)}</span>
        — <span title="مقایسه با قرارداد فعلی">جامپ بازدهی</span>${liveTag}
        · اعمال <b>${num(manual.oldStrike)}</b>
        · آفست <b>${num(manual.offsetPremium)}</b>
        · پایه جدید <b>${num(manual.oldStrike + manual.offsetPremium)}</b>
        · ${num(manual.days)}روز
      </div>
      ${legendHtml()}${colsHtml(sort)}`;
    const statusTxt = term + ' · جامپ بازدهی · زنده · ' + filtered.length + ' فرصت از ' + candidates.length + ' قرارداد بررسی‌شده';

    if (!candidates.length) {
      setListHeader(hdrHtml);
      el.innerHTML = `<div class="tsext-empty">هیچ قراردادی در زنجیرهٔ «${esc(term)}» روز ماندهٔ بیشتری از قرارداد شما ندارد.</div>`;
      setStatus(term + ' · جامپ بازدهی · قراردادی برای مقایسه یافت نشد');
      endListRender(ctx);
      return;
    }
    if (!filtered.length) {
      setListHeader(hdrHtml);
      el.innerHTML = `<div class="tsext-empty">فرصتی نیافتم (${candidates.length} قرارداد بررسی شد). فیلتر کلاس را هم چک کنید.</div>`;
      setStatus(term + ' · جامپ بازدهی · ' + candidates.length + ' بررسی‌شده · فرصتی نیست');
      endListRender(ctx);
      return;
    }

    let softItems = filtered.map((o) => {
      const risk = riskLabel(o.class || 'X');
      // اگر کد قرارداد فعلی (آفست) موجود باشد، جفت خرید/فروش می‌سازیم تا هر دو صف سفارشات + سهم پایه نشان داده شود
      const hasPair = !!(o.oldInsCode && o.insCode && String(o.oldInsCode) !== String(o.insCode));
      const key = hasPair
        ? ('c:' + o.oldInsCode + '>' + o.insCode)
        : (o.insCode ? ('i:' + o.insCode) : ('k:' + (o.ticker || '') + '|' + o.strike + '|' + fmtDate(o.expiry)));
      const spec = {
        key,
        cls: o.class || 'X',
        name: esc(o.ticker || ''),
        strike: num(o.strike),
        daysText: num(o.days),
        dateText: fmtDate(o.expiry),
        profitPct: o.profitMonth,
        detailRows: withExecRows(jampCandidateRows(o), o),
        insCode: o.insCode,
        // آفست = خرید (بازخرید قرارداد فعلی) · فروش = قرارداد جدید
        insCodeBuy: hasPair ? o.oldInsCode : undefined,
        insCodeSell: hasPair ? o.insCode : undefined,
        obBuyLabel: hasPair ? 'سفارشات قرارداد آفست (بازخرید)' : undefined,
        obSellLabel: hasPair ? 'سفارشات قرارداد جدید (فروش)' : undefined,
        uaInsCode: o.uaInsCode,
        volume: o.volume,
        openInterest: o.openInterest,
        days: o.days,
        riskText: risk.text,
      };
      return { key, cls: spec.cls, profitPct: spec.profitPct, strike: spec.strike, daysText: spec.daysText, dateText: spec.dateText, riskText: risk.text, spec };
    });
    if (applyListUpdate(softItems, 'jamp:yield', hdrHtml, sort, statusTxt)) { endListRender(ctx); return; }

    setListHeader(hdrHtml);
        el.setAttribute('data-strategy', 'jamp:yield');
    appendLimitedBars(el, softItems);
    setStatus(statusTxt);
    endListRender(ctx);
  }

  // زیرحالت «کاهش اعمال» (v1.26) — فقط اعمال کمتر از قرارداد جاری، منطق قیمت پایه مثل چالشی
  function renderJampDownshift(term, rows, minProfit, sort, manual, el, ctx) {
    const hdrBase = (extra) => `
      <div class="tsext-hdr">
        <span title="نماد پایه">${esc(term)}</span>
        — <span title="جامپ (کاهش اعمال و سرمایه درگیر): فقط اعمال پایین‌تر از جاری">کاهش اعمال و سرمایه درگیر</span>${extra || ''}
      </div>`;
    if (!manual) {
      setListHeader(hdrBase(''));
      el.innerHTML = `<div class="tsext-empty">قرارداد جاری خود (که می‌خواهید به اعمال پایین‌تر بروید) را از فهرست بالا انتخاب کنید و «پرمیوم دریافتی قرارداد جاری» را وارد کنید. فقط قراردادهای با اعمال کمتر از جاری بررسی می‌شوند.</div>`;
      setStatus(term + ' · کاهش اعمال و سرمایه درگیر · در انتظار انتخاب قرارداد جاری');
      endListRender(ctx);
      return;
    }
    const oldRow = rows.find((r) => String(r.insCode_C) === String(manual.oldInsCode));
    if (!oldRow) {
      setListHeader(hdrBase(''));
      el.innerHTML = `<div class="tsext-empty">قرارداد انتخابی دیگر در زنجیرهٔ زنده نیست — از فهرست دوباره انتخاب کنید.</div>`;
      setStatus(term + ' · کاهش اعمال و سرمایه درگیر · قرارداد انتخابی یافت نشد');
      endListRender(ctx);
      return;
    }
    const oldTicker = oldRow.lVal18AFC_C || oldRow.lVal30_C || '';
    const b = challengeBasePrice(oldRow, manual.recvPremium);
    const buyTag = b.buybackLive ? '<span class="tsext-tag-live">زنده</span>' : '<span class="tsext-tag-close">پایانی</span>';
    const curInfo = ` · <span title="قرارداد جاری شما">جاری: <b>${esc(oldTicker)} · اعمال ${num(b.oldStrike)}</b></span>`
      + ` · <span title="پرمیوم بازخرید زندهٔ قرارداد جاری (پرداختی)">بازخرید: <b>${num(b.buyback)}</b> ${buyTag}</span>`;
    if (manual.recvPremium == null) {
      setListHeader(hdrBase(curInfo));
      el.innerHTML = `<div class="tsext-empty">«پرمیوم دریافتی قرارداد جاری» را (به ریال، هر سهم) وارد کنید تا قیمت سهم پایه ساخته شود:<br>قیمت سهم پایه = اعمال جاری ${num(b.oldStrike)} + (بازخرید ${num(b.buyback)} − پرمیوم دریافتی)</div>`;
      setStatus(term + ' · کاهش اعمال و سرمایه درگیر · در انتظار پرمیوم دریافتی قرارداد جاری');
      endListRender(ctx);
      return;
    }
    const basisInfo = curInfo
      + ` · <span title="پرمیوم دریافتی قرارداد جاری (دستی)">دریافتی: <b>${num(b.recvPremium)}</b></span>`
      + ` · <span title="اعمال جاری + (بازخرید − دریافتی)">سهم پایه: <b>${num(b.basePrice)}</b></span>`;
    if (!(b.basePrice > 0)) {
      setListHeader(hdrBase(basisInfo));
      el.innerHTML = `<div class="tsext-empty">قیمت سهم پایهٔ محاسبه‌شده (${num(b.basePrice)}) معتبر نیست — بازخرید زنده از اعمال جاری + پرمیوم دریافتی بزرگ‌تر است. اعداد را بازبینی کنید.</div>`;
      setStatus(term + ' · کاهش اعمال و سرمایه درگیر · قیمت پایهٔ نامعتبر');
      endListRender(ctx);
      return;
    }
    const candidates = [];
    for (const row of rows) {
      if (!row) continue;
      const cnd = buildJampDownshiftCandidate(oldRow, row, manual.recvPremium);
      if (cnd) candidates.push(cnd);
    }
    applySort(candidates, sort, 'jamp');
    const filtered = candidates.filter((o) =>
      o.profitMonth >= minProfit && state.classFilter.has(o.class || 'X') && passesMonthFilter(o) && isContractActive(o)
    );
    const hdrHtml = hdrBase(basisInfo) + `
      <div class="tsext-price-basis" title="مبنای محاسبه">قیمت سهم پایه = اعمال جاری + (بازخرید − دریافتی) = ${num(b.basePrice)} · فقط اعمال < جاری · هر قرارداد: پرمیوم زندهٔ خودش، اعمال و روزماندهٔ خودش · بدون کارمزد · حتی با سود صفر سرمایه آزاد می‌شود · واحد: ریال</div>
      ${legendHtml()}${colsHtml(sort, 'سود ماهانه')}`;
    const statusTxt = term + ' · کاهش اعمال · سهم پایه ' + num(b.basePrice) + ' · ' + filtered.length + ' فرصت از ' + candidates.length + ' قرارداد با اعمال کمتر';

    if (!candidates.length) {
      setListHeader(hdrHtml);
      el.innerHTML = `<div class="tsext-empty">هیچ قراردادی با اعمال کمتر از ${num(b.oldStrike)} در زنجیرهٔ «${esc(term)}» نیست.</div>`;
      setStatus(term + ' · کاهش اعمال · اعمال پایین‌تری یافت نشد');
      endListRender(ctx);
      return;
    }
    if (!filtered.length) {
      setListHeader(hdrHtml);
      el.innerHTML = `<div class="tsext-empty">فرصتی نیافتم (${candidates.length} قرارداد با اعمال کمتر بررسی شد). حداقل سود ماهانه، فیلتر کلاس و ماه سررسید را هم چک کنید.</div>`;
      setStatus(term + ' · کاهش اعمال · ' + candidates.length + ' بررسی‌شده · فرصتی نیست');
      endListRender(ctx);
      return;
    }

    let softItems = filtered.map((o) => {
      const risk = riskLabel(o.class || 'X');
      const key = (o.insCodeBuy && o.insCodeSell) ? ('c:' + o.insCodeBuy + '>' + o.insCodeSell) : (o.insCode ? ('i:' + o.insCode) : ('k:' + o.strike + '|' + fmtDate(o.expiry)));
      const spec = {
        key,
        cls: o.class || 'X',
        name: esc(o.ticker || ''),
        strike: num(o.strike),
        daysText: num(o.days),
        dateText: fmtDate(o.expiry),
        profitPct: o.profitMonth,
        profitTitle: 'سود ماهانه با قیمت سهم پایهٔ محاسبه‌شده (' + num(b.basePrice) + ') — حتی سود صفر = آزادسازی سرمایه',
        detailRows: withExecRows(jampDownshiftRows(o), o),
        insCode: o.insCode,
        insCodeBuy: o.insCodeBuy,
        insCodeSell: o.insCodeSell,
        obBuyLabel: 'سفارشات قرارداد جاری (بازخرید)',
        obSellLabel: 'سفارشات قرارداد جدید (فروش، اعمال پایین‌تر)',
        uaInsCode: o.uaInsCode,
        volume: o.volume,
        openInterest: o.openInterest,
        days: o.days,
        riskText: risk.text,
      };
      return { key, cls: spec.cls, profitPct: spec.profitPct, strike: spec.strike, daysText: spec.daysText, dateText: spec.dateText, riskText: risk.text, spec };
    });
    if (applyListUpdate(softItems, 'jamp:downshift', hdrHtml, sort, statusTxt)) { endListRender(ctx); return; }
    setListHeader(hdrHtml);
        el.setAttribute('data-strategy', 'jamp:downshift');
    appendLimitedBars(el, softItems);
    setStatus(statusTxt);
    endListRender(ctx);
  }

  // زیرحالت «افزایش اعمال و سود» (v1.27) — فقط اعمال بالاتر از قرارداد جاری، منطق قیمت پایه مثل چالشی/کاهش اعمال
  function renderJampUpshift(term, rows, minProfit, sort, manual, el, ctx) {
    const hdrBase = (extra) => `
      <div class="tsext-hdr">
        <span title="نماد پایه">${esc(term)}</span>
        — <span title="جامپ (افزایش اعمال و سود): فقط اعمال بالاتر از جاری">افزایش اعمال و سود</span>${extra || ''}
      </div>`;
    if (!manual) {
      setListHeader(hdrBase(''));
      el.innerHTML = `<div class="tsext-empty">قرارداد جاری خود (که می‌خواهید به اعمال بالاتر بروید) را از فهرست بالا انتخاب کنید و «پرمیوم دریافتی قرارداد جاری» را وارد کنید. فقط قراردادهای با اعمال بالاتر از جاری بررسی می‌شوند.</div>`;
      setStatus(term + ' · افزایش اعمال و سود · در انتظار انتخاب قرارداد جاری');
      endListRender(ctx);
      return;
    }
    const oldRow = rows.find((r) => String(r.insCode_C) === String(manual.oldInsCode));
    if (!oldRow) {
      setListHeader(hdrBase(''));
      el.innerHTML = `<div class="tsext-empty">قرارداد انتخابی دیگر در زنجیرهٔ زنده نیست — از فهرست دوباره انتخاب کنید.</div>`;
      setStatus(term + ' · افزایش اعمال و سود · قرارداد انتخابی یافت نشد');
      endListRender(ctx);
      return;
    }
    const oldTicker = oldRow.lVal18AFC_C || oldRow.lVal30_C || '';
    const b = challengeBasePrice(oldRow, manual.recvPremium);
    const buyTag = b.buybackLive ? '<span class="tsext-tag-live">زنده</span>' : '<span class="tsext-tag-close">پایانی</span>';
    const curInfo = ` · <span title="قرارداد جاری شما">جاری: <b>${esc(oldTicker)} · اعمال ${num(b.oldStrike)}</b></span>`
      + ` · <span title="پرمیوم بازخرید زندهٔ قرارداد جاری (پرداختی)">بازخرید: <b>${num(b.buyback)}</b> ${buyTag}</span>`;
    if (manual.recvPremium == null) {
      setListHeader(hdrBase(curInfo));
      el.innerHTML = `<div class="tsext-empty">«پرمیوم دریافتی قرارداد جاری» را (به ریال، هر سهم) وارد کنید تا قیمت سهم پایه ساخته شود:<br>قیمت سهم پایه = اعمال جاری ${num(b.oldStrike)} + (بازخرید ${num(b.buyback)} − پرمیوم دریافتی)</div>`;
      setStatus(term + ' · افزایش اعمال و سود · در انتظار پرمیوم دریافتی قرارداد جاری');
      endListRender(ctx);
      return;
    }
    const basisInfo = curInfo
      + ` · <span title="پرمیوم دریافتی قرارداد جاری (دستی)">دریافتی: <b>${num(b.recvPremium)}</b></span>`
      + ` · <span title="اعمال جاری + (بازخرید − دریافتی)">سهم پایه: <b>${num(b.basePrice)}</b></span>`;
    if (!(b.basePrice > 0)) {
      setListHeader(hdrBase(basisInfo));
      el.innerHTML = `<div class="tsext-empty">قیمت سهم پایهٔ محاسبه‌شده (${num(b.basePrice)}) معتبر نیست — بازخرید زنده از اعمال جاری + پرمیوم دریافتی بزرگ‌تر است. اعداد را بازبینی کنید.</div>`;
      setStatus(term + ' · افزایش اعمال و سود · قیمت پایهٔ نامعتبر');
      endListRender(ctx);
      return;
    }
    const candidates = [];
    for (const row of rows) {
      if (!row) continue;
      const cnd = buildJampUpshiftCandidate(oldRow, row, manual.recvPremium);
      if (cnd) candidates.push(cnd);
    }
    applySort(candidates, sort, 'jamp');
    const filtered = candidates.filter((o) =>
      o.profitMonth >= minProfit && state.classFilter.has(o.class || 'X') && passesMonthFilter(o) && isContractActive(o)
    );
    const hdrHtml = hdrBase(basisInfo) + `
      <div class="tsext-price-basis" title="مبنای محاسبه">قیمت سهم پایه = اعمال جاری + (بازخرید − دریافتی) = ${num(b.basePrice)} · فقط اعمال > جاری · هر قرارداد: پرمیوم زندهٔ خودش، اعمال و روزماندهٔ خودش · بدون کارمزد · واحد: ریال</div>
      ${legendHtml()}${colsHtml(sort, 'سود ماهانه')}`;
    const statusTxt = term + ' · افزایش اعمال و سود · سهم پایه ' + num(b.basePrice) + ' · ' + filtered.length + ' فرصت از ' + candidates.length + ' قرارداد با اعمال بالاتر';

    if (!candidates.length) {
      setListHeader(hdrHtml);
      el.innerHTML = `<div class="tsext-empty">هیچ قراردادی با اعمال بالاتر از ${num(b.oldStrike)} در زنجیرهٔ «${esc(term)}» نیست.</div>`;
      setStatus(term + ' · افزایش اعمال و سود · اعمال بالاتری یافت نشد');
      endListRender(ctx);
      return;
    }
    if (!filtered.length) {
      setListHeader(hdrHtml);
      el.innerHTML = `<div class="tsext-empty">فرصتی نیافتم (${candidates.length} قرارداد با اعمال بالاتر بررسی شد). حداقل سود ماهانه، فیلتر کلاس و ماه سررسید را هم چک کنید.</div>`;
      setStatus(term + ' · افزایش اعمال و سود · ' + candidates.length + ' بررسی‌شده · فرصتی نیست');
      endListRender(ctx);
      return;
    }

    let softItems = filtered.map((o) => {
      const risk = riskLabel(o.class || 'X');
      const key = (o.insCodeBuy && o.insCodeSell) ? ('c:' + o.insCodeBuy + '>' + o.insCodeSell) : (o.insCode ? ('i:' + o.insCode) : ('k:' + o.strike + '|' + fmtDate(o.expiry)));
      const spec = {
        key,
        cls: o.class || 'X',
        name: esc(o.ticker || ''),
        strike: num(o.strike),
        daysText: num(o.days),
        dateText: fmtDate(o.expiry),
        profitPct: o.profitMonth,
        profitTitle: 'سود ماهانه با قیمت سهم پایهٔ محاسبه‌شده (' + num(b.basePrice) + ') — اعمال بالاتر، سود بیشتر',
        detailRows: withExecRows(jampUpshiftRows(o), o),
        insCode: o.insCode,
        insCodeBuy: o.insCodeBuy,
        insCodeSell: o.insCodeSell,
        obBuyLabel: 'سفارشات قرارداد جاری (بازخرید)',
        obSellLabel: 'سفارشات قرارداد جدید (فروش، اعمال بالاتر)',
        uaInsCode: o.uaInsCode,
        volume: o.volume,
        openInterest: o.openInterest,
        days: o.days,
        riskText: risk.text,
      };
      return { key, cls: spec.cls, profitPct: spec.profitPct, strike: spec.strike, daysText: spec.daysText, dateText: spec.dateText, riskText: risk.text, spec };
    });
    if (applyListUpdate(softItems, 'jamp:upshift', hdrHtml, sort, statusTxt)) { endListRender(ctx); return; }
    setListHeader(hdrHtml);
        el.setAttribute('data-strategy', 'jamp:upshift');
    appendLimitedBars(el, softItems);
    setStatus(statusTxt);
    endListRender(ctx);
  }

  // زیرحالت «چالشی» — منطق v1.25: قیمت سهم پایه از قرارداد جاری ساخته می‌شود
  // (اعمال جاری + (بازخرید − پرمیوم دریافتی)) و همهٔ قراردادهای زنجیره (هر اعمال/سررسید) با پرمیوم
  // زندهٔ خودشان مثل مثبت‌پنج و بدون کارمزد روی همین قیمت ارزیابی می‌شوند.
  function renderJampChallenge(term, rows, minProfit, sort, manual, el, ctx) {
    const hdrBase = (extra) => `
      <div class="tsext-hdr">
        <span title="نماد پایه">${esc(term)}</span>
        — <span title="جامپ چالشی: فقط اعمال کمتر از جاری · قیمت پایه از قرارداد جاری">چالشی</span>${extra || ''}
      </div>`;
    if (!manual) {
      setListHeader(hdrBase(''));
      el.innerHTML = `<div class="tsext-empty">قرارداد جاری خود (که در چالش است) را از فهرست بالا انتخاب کنید و «پرمیوم دریافتی قرارداد جاری» را وارد کنید.</div>`;
      setStatus(term + ' · چالشی · در انتظار انتخاب قرارداد جاری');
      endListRender(ctx);
      return;
    }
    const oldRow = rows.find((r) => String(r.insCode_C) === String(manual.oldInsCode));
    if (!oldRow) {
      setListHeader(hdrBase(''));
      el.innerHTML = `<div class="tsext-empty">قرارداد انتخابی دیگر در زنجیرهٔ زنده نیست — از فهرست دوباره انتخاب کنید.</div>`;
      setStatus(term + ' · چالشی · قرارداد انتخابی یافت نشد');
      endListRender(ctx);
      return;
    }
    const oldTicker = oldRow.lVal18AFC_C || oldRow.lVal30_C || '';
    const b = challengeBasePrice(oldRow, manual.recvPremium);
    const buyTag = b.buybackLive ? '<span class="tsext-tag-live">زنده</span>' : '<span class="tsext-tag-close">پایانی</span>';
    const curInfo = ` · <span title="قرارداد جاری شما">جاری: <b>${esc(oldTicker)} · اعمال ${num(b.oldStrike)}</b></span>`
      + ` · <span title="پرمیوم بازخرید زندهٔ قرارداد جاری (پرداختی)">بازخرید: <b>${num(b.buyback)}</b> ${buyTag}</span>`;
    if (manual.recvPremium == null) {
      setListHeader(hdrBase(curInfo));
      el.innerHTML = `<div class="tsext-empty">«پرمیوم دریافتی قرارداد جاری» را (به ریال، هر سهم) وارد کنید تا قیمت سهم پایه ساخته شود:<br>قیمت سهم پایه = اعمال جاری ${num(b.oldStrike)} + (بازخرید ${num(b.buyback)} − پرمیوم دریافتی)</div>`;
      setStatus(term + ' · چالشی · در انتظار پرمیوم دریافتی قرارداد جاری');
      endListRender(ctx);
      return;
    }
    const basisInfo = curInfo
      + ` · <span title="پرمیوم دریافتی قرارداد جاری (دستی)">دریافتی: <b>${num(b.recvPremium)}</b></span>`
      + ` · <span title="اعمال جاری + (بازخرید − دریافتی)">سهم پایه: <b>${num(b.basePrice)}</b></span>`;
    if (!(b.basePrice > 0)) {
      setListHeader(hdrBase(basisInfo));
      el.innerHTML = `<div class="tsext-empty">قیمت سهم پایهٔ محاسبه‌شده (${num(b.basePrice)}) معتبر نیست — بازخرید زنده از اعمال جاری + پرمیوم دریافتی بزرگ‌تر است. اعداد را بازبینی کنید.</div>`;
      setStatus(term + ' · چالشی · قیمت پایهٔ نامعتبر');
      endListRender(ctx);
      return;
    }
    const candidates = [];
    for (const row of rows) {
      if (!row) continue;
      const cnd = buildJampChallengeCandidate(oldRow, row, manual.recvPremium);
      if (cnd) candidates.push(cnd);
    }
    applySort(candidates, sort, 'jamp');
    const filtered = candidates.filter((o) =>
      o.profitMonth >= minProfit && state.classFilter.has(o.class || 'X') && passesMonthFilter(o) && isContractActive(o)
    );
    const hdrHtml = hdrBase(basisInfo) + `
      <div class="tsext-price-basis" title="مبنای محاسبه">قیمت سهم پایه = اعمال جاری + (بازخرید − دریافتی) = ${num(b.basePrice)} · فقط اعمال کمتر از جاری · پرمیوم زنده/پایانی هر قرارداد · بدون کارمزد · واحد: ریال</div>
      ${legendHtml()}${colsHtml(sort, 'سود ماهانه')}`;
    const statusTxt = term + ' · چالشی · سهم پایه ' + num(b.basePrice) + ' · ' + filtered.length + ' فرصت از ' + candidates.length + ' قرارداد با اعمال کمتر';

    if (!candidates.length) {
      setListHeader(hdrHtml);
      el.innerHTML = `<div class="tsext-empty">اعمال پایین‌تری از قرارداد انتخابی در زنجیره نیست.</div>`;
      setStatus(term + ' · چالشی · اعمال پایین‌تری یافت نشد');
      endListRender(ctx);
      return;
    }
    if (!filtered.length) {
      setListHeader(hdrHtml);
      el.innerHTML = `<div class="tsext-empty">فرصتی نیافتم (${candidates.length} قرارداد بررسی شد). حداقل سود ماهانه، فیلتر کلاس و ماه سررسید را هم چک کنید.</div>`;
      setStatus(term + ' · چالشی · ' + candidates.length + ' بررسی‌شده · فرصتی نیست');
      endListRender(ctx);
      return;
    }

    let softItems = filtered.map((o) => {
      const risk = riskLabel(o.class || 'X');
      const key = (o.insCodeBuy && o.insCodeSell) ? ('c:' + o.insCodeBuy + '>' + o.insCodeSell) : (o.insCode ? ('i:' + o.insCode) : ('k:' + o.strike + '|' + fmtDate(o.expiry)));
      const spec = {
        key,
        cls: o.class || 'X',
        name: esc(o.ticker || ''),
        strike: num(o.strike),
        daysText: num(o.days),
        dateText: fmtDate(o.expiry),
        profitPct: o.profitMonth,
        profitTitle: 'سود ماهانه با قیمت سهم پایهٔ محاسبه‌شده (' + num(b.basePrice) + ')',
        detailRows: withExecRows(jampChallengeRows(o), o),
        insCode: o.insCode,
        insCodeBuy: o.insCodeBuy,
        insCodeSell: o.insCodeSell,
        obBuyLabel: 'سفارشات قرارداد جاری (بازخرید)',
        obSellLabel: 'سفارشات قرارداد جدید (فروش)',
        uaInsCode: o.uaInsCode,
        volume: o.volume,
        openInterest: o.openInterest,
        days: o.days,
        riskText: risk.text,
      };
      return { key, cls: spec.cls, profitPct: spec.profitPct, strike: spec.strike, daysText: spec.daysText, dateText: spec.dateText, riskText: risk.text, spec };
    });
    if (applyListUpdate(softItems, 'jamp:challenge', hdrHtml, sort, statusTxt)) { endListRender(ctx); return; }
    setListHeader(hdrHtml);
        el.setAttribute('data-strategy', 'jamp:challenge');
    appendLimitedBars(el, softItems);
    setStatus(statusTxt);
    endListRender(ctx);
  }


  function jampCandidateRows(o) {
    const cls = o.class || 'X';
    const risk = riskLabel(cls);
    const priceTag = o.priceLive
      ? '<span class="tsext-tag-live">زنده</span>'
      : '<span class="tsext-tag-close">پایانی</span>';
    const share = Number(o.shareBuy) || 0;
    const strike = Number(o.strike) || 0;
    const intrinsic = share - strike;
    const intrinsicCell = (!(share > 0) || !(strike > 0))
      ? '–'
      : (intrinsic <= 0 ? 'ندارد' : (num(intrinsic) + ' ریال'));
    const intrinsicCls = intrinsic > 0 ? 'pos' : (intrinsic < 0 ? 'neg' : '');
    // سود ماهانه تنها کارت هیرو — بزرگ و جلو چشم
    return [
      ['__hero__', [
        ['سود ماهانه', upc(o.profitMonth) + ' ٪', 'main ' + percol(o.profitMonth)],
      ]],
      ['__sect__', 'معامله'],
      ['نوع', 'جامپ بازدهی', ''],
      ['کلاس / ریسک', (cls || 'X') + ' · ' + risk.text, riskValClass(risk)],
      ['اعمال جدید', num(strike), ''],
      ['پرمیوم فروش', num(o.premium) + ' ' + priceTag, ''],
      ['اعمال فعلی (آفست)', num(o.oldStrike), ''],
      ['پرمیوم آفست', num(o.offsetPremium), ''],
      ['سهم پایهٔ جدید', num(o.shareBuy), ''],
      ['ارزش ذاتی', intrinsicCell, intrinsicCls],
      ['__sect__', 'بازده'],
      ['سود٪', upc(o.profitPct) + ' ٪', percol(o.profitPct)],
      ['بدون اعمال', upc(o.noExProfitPct) + ' ٪', percol(o.noExProfitPct)],
      ['سود هر سهم', num(o.profitPerShare), percol(o.profitPerShare)],
      ['سود کل قرارداد', num(o.profitTotal), percol(o.profitTotal)],
      ['سرمایه درگیر', num(o.invested), ''],
      ['دریافتی', num(o.received), ''],
      ['پرداختی', num(o.paid), ''],
      ['__sect__', 'روزها'],
      ['روز جدید / فعلی', num(o.targetDays) + ' / ' + num(o.myDays), ''],
      ['روز درگیری', num(o.days) + ' — ' + fmtDate(o.expiry), ''],
      ['__sect__', 'مرجع'],
      ['اندازه · حجم / باز', num(o.size) + ' · ' + num(o.volume || 0) + ' / ' + num(o.openInterest || 0), ''],
    ];
  }

  function jampDownshiftRows(o) {
    const cls = o.class || 'X';
    const risk = riskLabel(cls);
    const buyTag = o.buybackLive ? '<span class="tsext-tag-live">زنده</span>' : '<span class="tsext-tag-close">پایانی</span>';
    const sellTag = o.priceLive ? '<span class="tsext-tag-live">زنده</span>' : '<span class="tsext-tag-close">پایانی</span>';
    const base = Number(o.basePrice) || 0;
    const strike = Number(o.strike) || 0;
    const intrinsic = base - strike;
    const intrinsicCell = (!(base > 0) || !(strike > 0)) ? '–' : (intrinsic <= 0 ? 'ارزش ذاتی ندارد' : (num(intrinsic) + ' ریال'));
    const intrinsicCls = intrinsic > 0 ? 'pos' : (intrinsic < 0 ? 'neg' : '');
    return [
      ['__hero__', [
        ['سود ماهانه', upc(o.profitMonth) + ' ٪', 'main ' + percol(o.profitMonth)],
      ]],
      ['__verdict__', o.ok
        ? 'جامپ به‌صرفه است — حتی با سود صفر، سرمایه درگیر کم می‌شود و پول آزاد می‌شود'
        : '⚠ ضرر بالقوه — اعمال + پرمیوم جدید کمتر از قیمت سهم پایهٔ محاسبه‌شده است، ولی سرمایه درگیر باز هم کم می‌شود', o.ok ? 'pos' : 'neg'],
      ['__sect__', 'قیمت سهم پایه (از قرارداد جاری)'],
      ['اعمال جاری (انتخابی)', num(o.oldStrike), ''],
      ['پرمیوم بازخرید قرارداد جاری (پرداختی)', num(o.buyback) + ' ' + buyTag, ''],
      ['پرمیوم دریافتی قرارداد جاری (دستی)', num(o.recvPremium), ''],
      ['خالص بستن = بازخرید − دریافتی', num(o.netPaid), percol(-o.netPaid)],
      ['سود/زیان بستن جاری (دریافتی − بازخرید)', num(o.closePnL != null ? o.closePnL : -o.netPaid), percol(o.closePnL != null ? o.closePnL : -o.netPaid)],
      ['قیمت سهم پایه = اعمال جاری + خالص بستن', num(o.basePrice), ''],
      ['__sect__', 'قرارداد جدید (اعمال پایین‌تر)'],
      ['کلاس اعمال', cls, ''],
      ['سطح ریسک', risk.text + warnChipsHtml(o.volume, o.openInterest, o.days, o.class || risk.cls), riskValClass(risk)],
      ['قیمت اعمال (ریال)', num(o.strike) + ' <small>(' + num(o.strikeDrop) + ' پایین‌تر از جاری)</small>', ''],
      ['پرمیوم فروش (ریال)', num(o.premium) + ' ' + sellTag, ''],
      ['ارزش ذاتی نسبت به قیمت پایه', intrinsicCell, intrinsicCls],
      ['روزمانده / سررسید', num(o.days) + ' روز — ' + fmtDate(o.expiry) + (o.sameExpiry ? ' <small>(هم‌سررسید با جاری)</small>' : '') + (exerciseWarn(o.days) ? ' <span class="tsext-exer-warn" title="' + esc(exerciseWarn(o.days).title) + '">⏱ ' + esc(exerciseWarn(o.days).text) + '</span>' : ''), ''],
      ['__sect__', 'بازده (بدون کارمزد)'],
      ['سود هر سهم (ریال)', num(o.profitPerShare), percol(o.profitPerShare)],
      ['سود کل (ریال)', num(o.profitTotal), percol(o.profitTotal)],
      ['سرمایه درگیر (ریال)', num(o.invested), ''],
      ['کاهش اعمال', num(o.strikeDrop) + ' ریال — حتی با سود صفر، این مقدار از سرمایه آزاد می‌شود', 'pos'],
      ['سود٪', upc(o.profitPct) + ' ٪', percol(o.profitPct)],
      ['بدون اعمال', upc(o.noExProfitPct) + ' ٪', percol(o.noExProfitPct)],
      ['دریافتی (ریال)', num(o.received), ''],
      ['پرداختی (ریال)', num(o.paid), ''],
      ['__sect__', 'مرجع'],
      ['اندازه قرارداد', num(o.contractSize || o.size), ''],
      ['حجم امروز / موقعیت باز', num(o.volume || 0) + ' / ' + num(o.openInterest || 0), ''],
    ];
  }

  function jampUpshiftRows(o) {
    const cls = o.class || 'X';
    const risk = riskLabel(cls);
    const buyTag = o.buybackLive ? '<span class="tsext-tag-live">زنده</span>' : '<span class="tsext-tag-close">پایانی</span>';
    const sellTag = o.priceLive ? '<span class="tsext-tag-live">زنده</span>' : '<span class="tsext-tag-close">پایانی</span>';
    const base = Number(o.basePrice) || 0;
    const strike = Number(o.strike) || 0;
    const intrinsic = base - strike;
    const intrinsicCell = (!(base > 0) || !(strike > 0)) ? '–' : (intrinsic <= 0 ? 'ارزش ذاتی ندارد' : (num(intrinsic) + ' ریال'));
    const intrinsicCls = intrinsic > 0 ? 'pos' : (intrinsic < 0 ? 'neg' : '');
    return [
      ['__hero__', [
        ['سود ماهانه', upc(o.profitMonth) + ' ٪', 'main ' + percol(o.profitMonth)],
      ]],
      ['__verdict__', o.ok
        ? 'جامپ به‌صرفه است — اعمال بالاتر با سود بیشتر'
        : '⚠ ضرر بالقوه — اعمال + پرمیوم جدید کمتر از قیمت سهم پایهٔ محاسبه‌شده است', o.ok ? 'pos' : 'neg'],
      ['__sect__', 'قیمت سهم پایه (از قرارداد جاری)'],
      ['اعمال جاری (انتخابی)', num(o.oldStrike), ''],
      ['پرمیوم بازخرید قرارداد جاری (پرداختی)', num(o.buyback) + ' ' + buyTag, ''],
      ['پرمیوم دریافتی قرارداد جاری (دستی)', num(o.recvPremium), ''],
      ['خالص بستن = بازخرید − دریافتی', num(o.netPaid), percol(-o.netPaid)],
      ['سود/زیان بستن جاری (دریافتی − بازخرید)', num(o.closePnL != null ? o.closePnL : -o.netPaid), percol(o.closePnL != null ? o.closePnL : -o.netPaid)],
      ['قیمت سهم پایه = اعمال جاری + خالص بستن', num(o.basePrice), ''],
      ['__sect__', 'قرارداد جدید (اعمال بالاتر)'],
      ['کلاس اعمال', cls, ''],
      ['سطح ریسک', risk.text + warnChipsHtml(o.volume, o.openInterest, o.days, o.class || risk.cls), riskValClass(risk)],
      ['قیمت اعمال (ریال)', num(o.strike) + ' <small>(' + num(o.strikeDiff) + ' بالاتر از جاری)</small>', ''],
      ['پرمیوم فروش (ریال)', num(o.premium) + ' ' + sellTag, ''],
      ['ارزش ذاتی نسبت به قیمت پایه', intrinsicCell, intrinsicCls],
      ['روزمانده / سررسید', num(o.days) + ' روز — ' + fmtDate(o.expiry) + (o.sameExpiry ? ' <small>(هم‌سررسید با جاری)</small>' : '') + (exerciseWarn(o.days) ? ' <span class="tsext-exer-warn" title="' + esc(exerciseWarn(o.days).title) + '">⏱ ' + esc(exerciseWarn(o.days).text) + '</span>' : ''), ''],
      ['__sect__', 'بازده (بدون کارمزد)'],
      ['سود هر سهم (ریال)', num(o.profitPerShare), percol(o.profitPerShare)],
      ['سود کل (ریال)', num(o.profitTotal), percol(o.profitTotal)],
      ['سرمایه درگیر (ریال)', num(o.invested), ''],
      ['افزایش اعمال', num(o.strikeDiff) + ' ریال — سود بیشتر با ریسک بالاتر', 'pos'],
      ['سود٪', upc(o.profitPct) + ' ٪', percol(o.profitPct)],
      ['بدون اعمال', upc(o.noExProfitPct) + ' ٪', percol(o.noExProfitPct)],
      ['دریافتی (ریال)', num(o.received), ''],
      ['پرداختی (ریال)', num(o.paid), ''],
      ['__sect__', 'مرجع'],
      ['اندازه قرارداد', num(o.contractSize || o.size), ''],
      ['حجم امروز / موقعیت باز', num(o.volume || 0) + ' / ' + num(o.openInterest || 0), ''],
    ];
  }

  function jampChallengeRows(o) {
    const cls = o.class || 'X';
    const risk = riskLabel(cls);
    const buyTag = o.buybackLive ? '<span class="tsext-tag-live">زنده</span>' : '<span class="tsext-tag-close">پایانی</span>';
    const sellTag = o.priceLive ? '<span class="tsext-tag-live">زنده</span>' : '<span class="tsext-tag-close">پایانی</span>';
    const base = Number(o.basePrice) || 0;
    const strike = Number(o.strike) || 0;
    const intrinsic = base - strike;
    const intrinsicCell = (!(base > 0) || !(strike > 0)) ? '–' : (intrinsic <= 0 ? 'ارزش ذاتی ندارد' : (num(intrinsic) + ' ریال'));
    const intrinsicCls = intrinsic > 0 ? 'pos' : (intrinsic < 0 ? 'neg' : '');
    return [
      ['__hero__', [
        ['سود ماهانه', upc(o.profitMonth) + ' ٪', 'main ' + percol(o.profitMonth)],
      ]],
      ['__verdict__', o.ok
        ? 'جامپ به‌صرفه است — اعمال + پرمیوم قرارداد جدید ≥ قیمت سهم پایهٔ محاسبه‌شده'
        : '⚠ ضرر بالقوه — اعمال + پرمیوم قرارداد جدید کمتر از قیمت سهم پایهٔ محاسبه‌شده است', o.ok ? 'pos' : 'neg'],
      ['__sect__', 'قیمت سهم پایه (از قرارداد جاری)'],
      ['اعمال جاری (انتخابی)', num(o.oldStrike), ''],
      ['پرمیوم بازخرید قرارداد جاری (پرداختی)', num(o.buyback) + ' ' + buyTag, ''],
      ['پرمیوم دریافتی قرارداد جاری (دستی)', num(o.recvPremium), ''],
      ['خالص بستن = بازخرید − دریافتی', num(o.netPaid), percol(-o.netPaid)],
      ['سود/زیان بستن جاری (دریافتی − بازخرید)', num(o.closePnL != null ? o.closePnL : -o.netPaid), percol(o.closePnL != null ? o.closePnL : -o.netPaid)],
      ['قیمت سهم پایه = اعمال جاری + خالص بستن', num(o.basePrice), ''],
      ['__sect__', 'قرارداد جدید'],
      ['کلاس اعمال', cls, ''],
      ['سطح ریسک', risk.text + warnChipsHtml(o.volume, o.openInterest, o.days, o.class || risk.cls), riskValClass(risk)],
      ['قیمت اعمال (ریال)', num(o.strike) + (o.strikeDrop > 0 ? ' <small>(' + num(o.strikeDrop) + ' پایین‌تر از جاری)</small>' : (o.strikeDrop < 0 ? ' <small>(' + num(-o.strikeDrop) + ' بالاتر از جاری)</small>' : ' <small>(هم‌اعمال با جاری)</small>')), ''],
      ['پرمیوم فروش (ریال)', num(o.premium) + ' ' + sellTag, ''],
      ['ارزش ذاتی نسبت به قیمت پایه', intrinsicCell, intrinsicCls],
      ['روزمانده / سررسید', num(o.days) + ' روز — ' + fmtDate(o.expiry) + (o.sameExpiry ? ' <small>(هم‌سررسید با جاری)</small>' : '') + (exerciseWarn(o.days) ? ' <span class="tsext-exer-warn" title="' + esc(exerciseWarn(o.days).title) + '">⏱ ' + esc(exerciseWarn(o.days).text) + '</span>' : ''), ''],
      ['__sect__', 'بازده (بدون کارمزد)'],
      ['سود هر سهم (ریال)', num(o.profitPerShare), percol(o.profitPerShare)],
      ['سود کل (ریال)', num(o.profitTotal), percol(o.profitTotal)],
      ['سرمایه درگیر (ریال)', num(o.invested), ''],
      ['سود٪', upc(o.profitPct) + ' ٪', percol(o.profitPct)],
      ['بدون اعمال', upc(o.noExProfitPct) + ' ٪', percol(o.noExProfitPct)],
      ['دریافتی (ریال)', num(o.received), ''],
      ['پرداختی (ریال)', num(o.paid), ''],
      ['__sect__', 'مرجع'],
      ['اندازه قرارداد', num(o.contractSize || o.size), ''],
      ['حجم امروز / موقعیت باز', num(o.volume || 0) + ' / ' + num(o.openInterest || 0), ''],
    ];
  }

  // ----- from src/07e-render-combo.js -----
  // ------------------------------------------------ معاملات ترکیبی
  // خرید کال اعمال پایین‌تر (جایگزین خرید مستقیم سهم) + فروش کال اعمال بالاتر
  // فقط جفت‌هایی با سررسید یکسان و اعمال خرید < اعمال فروش بررسی می‌شوند.
  // پر کردن لیست انتخاب قرارداد خرید — فقط سررسید کمتر از ۱۰ روز
  // امضای فهرست نامزدها — فقط چیزهایی که واقعاً روی گزینه‌های دراپ‌داون اثر می‌گذارند (کد، روزمانده، اعمال)
  // نه قیمت زنده؛ چون قیمت هر تیک (هر ۵۰۰ میلی‌ثانیه) عوض می‌شود ولی نباید باعث بازسازی/بسته‌شدن لیست شود.
  function comboBuySignature(candidates) {
    return candidates.map((r) => String(r.insCode_C || '') + ':' + asNum(r.remainedDay, 0) + ':' + (Number(r.strikePrice) || 0)).join('|');
  }
  function populateComboBuySelect(rows) {
    const sel = panelHost && $id(panelHost, 'tsext-combo-buy');
    if (!sel) return null;
    const prev = sel.value || '';
    const candidates = (rows || []).slice()
      .filter((r) => {
        if (!r || !(Number(r.strikePrice) > 0)) return false;
        const d = asNum(r.remainedDay, 0);
        return d > 0 && d < 10;
      })
      .sort((a, b) => {
        const da = asNum(a.remainedDay, 9999), db = asNum(b.remainedDay, 9999);
        if (da !== db) return da - db;
        return (Number(a.strikePrice) || 0) - (Number(b.strikePrice) || 0);
      });
    if (!candidates.length) {
      if (sel.getAttribute('data-sig') !== '') {
        sel.innerHTML = '<option value="">فعلا قراردادی وجود ندارد</option>';
        sel.value = '';
        sel.setAttribute('data-sig', '');
      }
      return null;
    }
    const sig = comboBuySignature(candidates);
    // اگر مجموعهٔ نامزدها (کد/روزمانده/اعمال) نسبت به آخرین بار عوض نشده، دراپ‌داون دست‌نخورده می‌ماند
    // تا اگر کاربر همین الان روی آن باز/در حال انتخاب است، رفرش‌های زنده (هر نیم‌ثانیه) آن را نبندد
    if (sel.getAttribute('data-sig') === sig) {
      return sel.value || null;
    }
    const opts = ['<option value="">— قرارداد خرید را انتخاب کنید —</option>'];
    candidates.forEach((r) => {
      const code = String(r.insCode_C || '');
      if (!code) return;
      const days = asNum(r.remainedDay, 0);
      const live = asNum(r.pDrCotVal_C, 0) || asNum(r.pClosing_C, 0);
      const ticker = r.lVal18AFC_C || r.lVal30_C || code;
      const label = ticker + ' · اعمال ' + num(r.strikePrice) + ' · ' + num(days) + ' روز · قیمت ' + num(live);
      opts.push('<option value="' + esc(code) + '">' + esc(label) + '</option>');
    });
    sel.innerHTML = opts.join('');
    sel.setAttribute('data-sig', sig);
    if (prev && candidates.some((r) => String(r.insCode_C) === prev)) {
      sel.value = prev;
    } else if (candidates.length === 1) {
      sel.value = String(candidates[0].insCode_C || '');
    }
    return sel.value || null;
  }

  // مثل «قرارداد خرید» ترکیبی، ولی بدون محدودیت ۱۰ روز — چون قرارداد فعلی کاربر در جامپ افزایش
  // اعمال می‌تواند هر سررسیدی داشته باشد؛ فقط قرارداد بعدی/بالاترش باید در همان سررسید باشد
  function jampOldSignature(candidates) {
    return candidates.map((r) => String(r.insCode_C || '') + ':' + asNum(r.remainedDay, 0) + ':' + (Number(r.strikePrice) || 0)).join('|');
  }
  function populateJampOldSelect(rows, selId) {
    const sel = panelHost && $id(panelHost, selId || 'tsext-jamp-old-upshift');
    if (!sel) return null;
    const prev = sel.value || '';
    const candidates = (rows || []).slice()
      .filter((r) => r && Number(r.strikePrice) > 0 && asNum(r.remainedDay, -1) >= 0)
      .sort((a, b) => {
        const da = asNum(a.remainedDay, 9999), db = asNum(b.remainedDay, 9999);
        if (da !== db) return da - db;
        return (Number(a.strikePrice) || 0) - (Number(b.strikePrice) || 0);
      });
    if (!candidates.length) {
      if (sel.getAttribute('data-sig') !== '') {
        sel.innerHTML = '<option value="">فعلا قراردادی وجود ندارد</option>';
        sel.value = '';
        sel.setAttribute('data-sig', '');
      }
      return null;
    }
    const sig = jampOldSignature(candidates);
    if (sel.getAttribute('data-sig') === sig) {
      return sel.value || null;
    }
    const opts = ['<option value="">— قرارداد فعلی خود را انتخاب کنید —</option>'];
    candidates.forEach((r) => {
      const code = String(r.insCode_C || '');
      if (!code) return;
      const days = asNum(r.remainedDay, 0);
      const live = asNum(r.pDrCotVal_C, 0) || asNum(r.pClosing_C, 0);
      const ticker = r.lVal18AFC_C || r.lVal30_C || code;
      const label = ticker + ' · اعمال ' + num(r.strikePrice) + ' · ' + num(days) + ' روز · قیمت ' + num(live);
      opts.push('<option value="' + esc(code) + '">' + esc(label) + '</option>');
    });
    sel.innerHTML = opts.join('');
    sel.setAttribute('data-sig', sig);
    if (prev && candidates.some((r) => String(r.insCode_C) === prev)) {
      sel.value = prev;
    }
    return sel.value || null;
  }

  function renderCombo(term, rows, basePrice, livePrice, minProfit, sort, commission, baseIsManual) {
    assignClasses(rows, livePrice > 0 ? livePrice : basePrice);
    const selectedBuyCode = populateComboBuySelect(rows);
    const buyRow = selectedBuyCode
      ? rows.find((r) => String(r.insCode_C) === String(selectedBuyCode))
      : null;

    const ctx = beginListRender();
    const el = listEl(); el.innerHTML = '';

    if (!buyRow) {
      const hasNear = (rows || []).some((r) => {
        const d = asNum(r && r.remainedDay, 0);
        return d > 0 && d < 10;
      });
      setListHeader(`
        <div class="tsext-hdr">
          <span title="نماد پایه">${esc(term)}</span>
          — <span title="خرید نزدیک‌سررسید + فروش بقیهٔ زنجیره">معاملات ترکیبی</span>
        </div>`);
      el.innerHTML = `<div class="tsext-empty">${hasNear
        ? 'از فهرست «قرارداد خرید» یک قرارداد انتخاب کنید.'
        : 'فعلا قراردادی با سررسید کمتر از ۱۰ روز وجود ندارد.'}</div>`;
      setStatus(term + ' · ترکیبی · ' + (hasNear ? 'در انتظار انتخاب قرارداد خرید' : 'قرارداد نزدیک‌سررسید نیست'));
      endListRender(ctx);
      return;
    }

    const buyDays = asNum(buyRow.remainedDay, 0);
    const buyStrike = asNum(buyRow.strikePrice, 0);
    const buyTicker = buyRow.lVal18AFC_C || buyRow.lVal30_C || '';
    const opportunities = [];
    for (const row of rows) {
      if (!row || String(row.insCode_C) === String(buyRow.insCode_C)) continue;
      // فقط قراردادهایی که روزماندهٔ بیشتری از قرارداد خرید دارند
      const sellDays = asNum(row.remainedDay, 0);
      if (!(sellDays > buyDays)) continue;
      const res = calcCombo(buyRow, row, commission);
      if (res.error) continue;
      res.class = row.class || 'X';
      opportunities.push(res);
    }
    applySort(opportunities, sort, 'combo');
    const filtered = opportunities.filter((o) =>
      o.profitMonth >= minProfit && state.classFilter.has(o.class || 'X') && passesMonthFilter(o)
    );

    const hdrHtml = `
      <div class="tsext-hdr">
        <span title="نماد پایه">${esc(term)}</span>
        — <span title="خرید نزدیک‌سررسید + فروش سررسید بلندتر">ترکیبی</span>
        · <span title="قرارداد خرید">خرید <b>${esc(buyTicker || num(buyStrike))}</b> · اعمال ${num(buyStrike)} · ${num(buyDays)}روز</span>
        ${(commission > 0) ? (' · کارمزد ' + commission + '٪') : ''}
      </div>
      ${legendHtml()}${colsHtml(sort)}`;
    const statusTxt = term + ' · ترکیبی · ' + filtered.length + ' فرصت از ' + opportunities.length + ' · خرید ' + num(buyDays) + 'روز';

    if (!opportunities.length) {
      setListHeader(hdrHtml);
      el.innerHTML = `<div class="tsext-empty">قراردادی با روزماندهٔ بیشتر از ${num(buyDays)} روز برای مقایسه یافت نشد.</div>`;
      setStatus(term + ' · ترکیبی · فروش با سررسید بلندتر یافت نشد');
      endListRender(ctx);
      return;
    }
    if (!filtered.length) {
      setListHeader(hdrHtml);
      el.innerHTML = `<div class="tsext-empty">فرصت نیافتم (${opportunities.length} قرارداد بررسی شد). فیلتر کلاس را چک کنید.</div>`;
      setStatus(term + ' · ترکیبی · ' + opportunities.length + ' بررسی‌شده · فرصتی نیست');
      endListRender(ctx);
      return;
    }

    let softItems = filtered.map((o) => {
      const key = (o.insCodeBuy && o.insCodeSell)
        ? ('combo:' + o.insCodeBuy + '>' + o.insCodeSell)
        : (o.insCodeSell ? ('i:' + o.insCodeSell) : ('c:' + (o.insCodeBuy || '') + '>' + (o.strikeSell || '')));
      const spec = comboSpec(o);
      spec.key = key;
      return {
        key, cls: spec.cls, profitPct: spec.profitPct,
        profitTitle: 'سود ماهانه ترکیبی ≈ (بازده جفت تا سررسید ÷ روزمانده فروش) × ۳۰ · خرید نزدیک + فروش دورتر',
        strike: spec.strike, daysText: spec.daysText, dateText: spec.dateText,
        riskText: spec.riskText, spec,
      };
    });
    if (applyListUpdate(softItems, 'combo', hdrHtml, sort, statusTxt)) { endListRender(ctx); return; }
    setListHeader(hdrHtml);
        el.setAttribute('data-strategy', 'combo');
    appendLimitedBars(el, softItems);
    setStatus(statusTxt);
    endListRender(ctx);
  }

  function comboSpec(o) {
    const risk = riskLabel(o.class || 'X');
    const badges = [];
    if (o.nearBuy) badges.push('خرید نزدیک‌سررسید');
    if (o.execMode) badges.push('قابل‌اجرا');
    const priceTagBuy = o.buyPriceLive
      ? '<span class="tsext-tag-live">زنده</span>'
      : '<span class="tsext-tag-close">پایانی</span>';
    const priceTagSell = o.sellPriceLive
      ? '<span class="tsext-tag-live">زنده</span>'
      : '<span class="tsext-tag-close">پایانی</span>';
    const unitInv = o.excel ? o.excel.E6 : (o.invested / (o.shares || o.size || 1000));
    const unitProfit = o.excel ? o.excel.E4 : o.profitPerShare;
    const commUsed = o.commissionPctUsed != null ? o.commissionPctUsed : 0;
    return {
      cls: o.class || 'X',
      name: (() => {
        const sellT = o.tickerSell || '';
        const buyT = o.tickerBuy || '';
        if (sellT && buyT) {
          const label = 'فروش ' + sellT + '→خرید ' + buyT;
          return `<span title="${esc(label)} · اعمال فروش ${num(o.strikeSell)} / اعمال خرید ${num(o.strikeBuy)}">${esc(label)}</span>`;
        }
        if (sellT) return esc(sellT);
        if (buyT) return esc(buyT);
        return esc('فروش ' + num(o.strikeSell) + '→خرید ' + num(o.strikeBuy));
      })(),
      strike: num(o.strikeSell),
      daysText: num(o.days),
      dateText: fmtDate(o.expiry),
      profitPct: o.profitMonth,
      detailRows: withExecRows([
        ['__hero__', [
          ['سود ماهانه', upc(o.profitMonth) + ' ٪', 'main ' + percol(o.profitMonth)],
          ['سود واحد', num(unitProfit) + ' ریال', percol(unitProfit)],
        ]],
        ['__sect__', 'ورودی‌ها'],
        ['پرمیوم فروش', num(o.premSell) + ' ' + priceTagSell + (o.execMode ? ' · بهترین خرید' : ''), '', 'پرمیومی که از فروش قرارداد می‌گیرید'],
        ['اعمال فروش', num(o.strikeSell), '', 'قیمت اعمال قرارداد فروخته‌شده'],
        ['معادل سهم پایه', num(o.shareBase), '', 'اعمال خرید + پرمیوم خرید — جایگزین قیمت سهم در معامله آنی'],
        ['پرمیوم خرید', num(o.premBuy) + ' ' + priceTagBuy + (o.execMode ? ' · بهترین فروش' : ''), '', 'پرمیومی که برای خرید قرارداد جایگزین سهم می‌پردازید'],
        ['اعمال خرید', num(o.strikeBuy), '', 'قیمت اعمال قرارداد خریداری‌شده'],
        ['روزمانده فروش', num(o.days) + ' (خرید: ' + num(o.buyDays) + ')', o.nearBuy ? 'warn' : '', 'روز مانده تا سررسید قرارداد فروش (و خرید)'],
        ['کارمزد', upc(commUsed) + ' ٪' + (commUsed <= 0 ? ' (اعمال‌نشده)' : ''), '', 'درصد کارمزد روی معادل سهم پایه؛ صفر یعنی بدون کارمزد'],
        ['__sect__', 'محاسبه (هر سهم)'],
        ['دریافتی', num(o.excel ? o.excel.B4 : (o.strikeSell + o.premSell)), '', 'اعمال فروش + پرمیوم فروش'],
        ['پرداختی', num(o.excel ? o.excel.C4 : o.commShare), '', 'معادل سهم پایه با احتساب کارمزد'],
        ['سود به ریال', num(unitProfit), percol(unitProfit), 'دریافتی منهای پرداختی'],
        ['سرمایه درگیر', num(unitInv), '', 'پرداختی منهای پرمیوم فروش'],
        ['سود به درصد', upc(o.profitPct) + ' ٪', percol(o.profitPct), 'سود به ریال تقسیم بر سرمایه درگیر'],
        ['سود به ماه', upc(o.profitMonth) + ' ٪', percol(o.profitMonth), 'سود به درصد تقسیم بر روزمانده × ۳۰'],
        ['بدون اعمال', upc(o.noExProfitPct) + ' ٪', percol(o.noExProfitPct), 'پرمیوم فروش تقسیم بر سرمایه درگیر — اگر اعمال نشود'],
        ['__sect__', 'کل موقعیت (۱ قرارداد)'],
        ['سود کل', num(o.profitTotal), percol(o.profitTotal), 'سود به ریال × اندازه قرارداد'],
        ['سرمایه درگیر کل', num(o.invested), '', 'سرمایه درگیر واحد × اندازه قرارداد'],
        ['اندازه قرارداد', num(o.size || o.contractSize), '', 'تعداد سهم به‌ازای هر قرارداد'],
        ['تاریخ سررسید فروش', fmtDate(o.expiry), '', 'سررسید قرارداد فروخته‌شده'],
      ], o),
      insCode: o.insCodeSell,
      insCodeBuy: o.insCodeBuy,
      insCodeSell: o.insCodeSell,
      obBuyLabel: 'سفارشات قرارداد خرید',
      obSellLabel: 'سفارشات قرارداد فروش',
      uaInsCode: o.uaInsCode,
      riskText: risk.text,
      badge: badges.join(' · '),
    };
  }

  // ----- from src/07f-detail-panel.js -----
  // ---------- v1.29: افشای تدریجی — عدد/رنگ در دید، توضیح پشت «؟» ----------
  function helpBtn(text) {
    return '<button type="button" class="tsext-help" aria-label="راهنما" data-help="' + esc(String(text || '')) + '">؟</button>';
  }
  // کادرهای توضیحیِ همیشه‌باز → فقط عنوان کوتاه + «؟» (متن کامل از title کادر برداشته می‌شود)
  function upgradeNotesToHelp(root) {
    if (!root) return;
    root.querySelectorAll('.tsext-tickmode-note').forEach((n) => {
      if (n.getAttribute('data-help-done')) return;
      const full = n.getAttribute('title') || '';
      const b = n.querySelector('b');
      if (!full || !b) return;
      n.setAttribute('data-help-done', '1');
      n.removeAttribute('title');
      n.innerHTML = '<span>◈</span><span><b>' + esc(b.textContent.replace(/\s*[:：]\s*$/, '')) + '</b></span>' + helpBtn(full);
    });
  }
  let helpPop = null;
  function hideHelpPop() { if (helpPop) { try { helpPop.remove(); } catch (e) {} helpPop = null; } }
  function showHelpPop(el) {
    hideHelpPop();
    const t = el.getAttribute('data-help');
    if (!t || !panelHost) return;
    const cs = getComputedStyle(panelHost);
    const pop = document.createElement('div');
    pop.className = 'tsext-help-pop';
    pop.setAttribute('role', 'tooltip');
    pop.dir = 'rtl';
    pop.textContent = t;
    // توکن‌های تم از #tsext-host خوانده می‌شوند (--tsext-text وجود ندارد؛ از --tsext-fg/--tsext-bright استفاده می‌شود)
    const v = (n, d) => (cs.getPropertyValue(n) || '').trim() || d;
    const fg = v('--tsext-fg', '#dbe4ee');
    const panel = v('--tsext-panel', '#111827');
    const border = v('--tsext-border', '#243044');
    pop.style.cssText = 'position:fixed;z-index:2147483647;max-width:min(340px,86vw);padding:8px 10px;border-radius:6px;font:600 12px/1.7 inherit;white-space:pre-line;pointer-events:none;'
      + 'box-shadow:0 6px 20px rgba(0,0,0,.45);border:1px solid ' + border + ';background:' + panel + ';color:' + fg + ';font-family:' + cs.fontFamily;
    pop.style.left = '0px'; pop.style.top = '0px'; pop.style.visibility = 'hidden';
    document.body.appendChild(pop);
    const r = el.getBoundingClientRect();
    const pw = pop.offsetWidth, ph = pop.offsetHeight;
    let x = Math.min(Math.max(8, r.left + r.width / 2 - pw / 2), window.innerWidth - pw - 8);
    let y = r.bottom + 6;
    if (y + ph > window.innerHeight - 8) y = Math.max(8, r.top - ph - 6);
    pop.style.left = x + 'px'; pop.style.top = y + 'px'; pop.style.visibility = 'visible';
    helpPop = pop;
  }
  function initHelpPopovers(host) {
    if (!host || host.__helpInit) return;
    host.__helpInit = true;
    const isH = (e) => (e.target && e.target.closest) ? e.target.closest('.tsext-help') : null;
    host.addEventListener('mouseover', (e) => { const h = isH(e); if (h) showHelpPop(h); });
    host.addEventListener('mouseout', (e) => { if (isH(e)) hideHelpPop(); });
    host.addEventListener('focusin', (e) => { const h = isH(e); if (h) showHelpPop(h); });
    host.addEventListener('focusout', (e) => { if (isH(e)) hideHelpPop(); });
    host.addEventListener('click', (e) => { const h = isH(e); if (h) { e.stopPropagation(); helpPop ? hideHelpPop() : showHelpPop(h); } });
    // کلیک روی نقطهٔ سلامت داده = پنل تشخیصی محلی (جایگزین میان‌بر قبلی؛ فقط برای گزارش مشکل)
    host.addEventListener('click', (e) => { if (e.target && e.target.closest && e.target.closest('.tsext-health-dot')) { try { toggleDiagPanel(); } catch (er) {} } });
  }

  // ------------------------------------------------ نوار فشرده + پنل جزئیات کناری
  function rowKey(spec) {
    if (spec && spec.key) return String(spec.key);
    if (spec && spec.insCodeSell && spec.insCodeBuy) return 'combo:' + spec.insCodeBuy + '>' + spec.insCodeSell;
    if (spec && spec.insCode) return 'i:' + spec.insCode;
    return 'k:' + String((spec && spec.name) || '') + '|' + String((spec && spec.strike) || '') + '|' + String((spec && spec.dateText) || '');
  }
  // helper: ticker from cache by insCode — for orderbook titles (v1.28)
  function tickerByInsCode(code) {
    const c = String(code || '').trim();
    if (!c) return '';
    try {
      const rows = (state.cache && state.cache.rows) || [];
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        if (!r) continue;
        if (String(r.insCode_C) === c) return String(r.lVal18AFC_C || r.lVal30_C || c);
        if (String(r.uaInsCode) === c) return String(r.lVal18AFC_UA || r.lVal30_UA || c);
      }
    } catch (e) {}
    return c;
  }
  function barRow(spec) {
    const b = document.createElement('div');
    b.className = 'tsext-bar';
    b.__tsextSpec = spec; // مرجع زنده — با soft-update به‌روز می‌شود
    const cls = String(spec.cls || 'X');
    const key = rowKey(spec);
    b.setAttribute('data-c', cls);
    b.setAttribute('data-key', key);
    const col = classColor(cls);
    const pcls = percol(spec.profitPct);
    const plvl = profitLevelClass(spec.profitPct);
    if (plvl) b.classList.add(plvl);
    if (spec.incomplete || spec.noExec || spec.partialExec) b.classList.add('tsext-incomplete');
    const classTitles = {
      A: 'کلاس A — خیلی پایین‌تر از سهم پایه (خیلی کم‌ریسک)',
      B: 'کلاس B — کمی پایین‌تر از سهم / زیر X (کم‌ریسک)',
      X: 'کلاس X — نزدیک سهم پایه حدود ۱–۲ پله پایین یا بالا (متعادل)',
      '−B': 'کلاس −B — مقداری بالاتر از سهم / بالای X (پرریسک)',
      '−A': 'کلاس −A — خیلی بالاتر از سهم پایه (خیلی پرریسک)',
    };
    const badge = ''; // برچسب‌های لیست حذف شدند تا شلوغ نباشد (جزئیات در پنل باز می‌ماند)
    const _rl = riskLabel(cls);
    // هشدار نقدشوندگی / اعمال نزدیک روی لیست (اگر داده موجود باشد)
    const _vol = (spec.volume != null) ? spec.volume : (spec.spec && spec.spec.volume);
    const _oi = (spec.openInterest != null) ? spec.openInterest : (spec.spec && spec.spec.openInterest);
    const _daysNum = (spec.days != null) ? spec.days : (spec.spec && spec.spec.days);
    const _warns = warnChipsHtml(_vol, _oi, _daysNum, (spec && (spec.class || spec.cls)) || "");
    // رنگ نوشتهٔ ریسک دقیقاً همان رنگ کلاس ردیف (مثلاً پرریسک = −B)
    const risk = `<span class="tsext-bar-risk tsext-risk-${_rl.level}" style="color:${col} !important;border-color:${col};background:color-mix(in srgb,${col} 22%,transparent);border-radius:999px !important;padding:3px 7px !important" title="${esc(_rl.text)}">${esc(_rl.short)}${_warns}</span>`;
    const daysTxt = (spec.daysText != null && spec.daysText !== '') ? spec.daysText : '–';
    b.innerHTML = `
      <div class="tsext-bar-main" role="row" title="برای دیدن جزئیات و سفارشات کلیک کنید">
        <span class="tsext-bar-strip" style="background:${col}" title="کلاس ${esc(cls)}"></span>
        <span class="tsext-bar-class" style="color:${col};border-color:${col}" title="${esc(classTitles[cls] || ('کلاس ' + cls))}">${esc(cls)}</span>
        <span class="tsext-bar-cell tsext-bar-name" title="نام قرارداد اختیار"><button type="button" class="tsext-bar-fav${isFavorite(key) ? ' on' : ''}" data-fav-key="${esc(key)}" title="${isFavorite(key) ? 'حذف از موردعلاقه' : 'افزودن به موردعلاقه'}" aria-label="${isFavorite(key) ? 'حذف از موردعلاقه' : 'افزودن به موردعلاقه'}" aria-pressed="${isFavorite(key) ? 'true' : 'false'}">${isFavorite(key) ? '★' : '☆'}</button><span class="tsext-bar-name-text">${spec.name}${badge}</span></span>
        <span class="tsext-bar-cell tsext-bar-strike" title="قیمت اعمال">${spec.strike}</span>
        <span class="tsext-bar-cell tsext-bar-days" title="روز مانده تا سررسید">${daysTxt}</span>
        <span class="tsext-bar-cell tsext-bar-date" title="تاریخ سررسید (شمسی)">${spec.dateText}</span>
        ${risk}
        <span class="tsext-bar-cell tsext-bar-profit ${pcls}" title="${esc(spec.profitTitle || (spec.profitUnit === ' ریال' ? 'تیک خالص (ریال)' : 'سود ماهانه درصد'))}">${spec.profitDisplay != null ? spec.profitDisplay : (upc(spec.profitPct) + (spec.profitUnit || '٪'))}</span>
        <span class="tsext-bar-actions"></span>
      </div>`;
    const main = b.querySelector('.tsext-bar-main');
    const actions = b.querySelector('.tsext-bar-actions');
    const openDetail = (e) => {
      if (e && e.target && (e.target.closest('.tsext-bar-open') || e.target.closest('.tsext-bar-obbtn') || e.target.closest('.tsext-bar-fav') || e.target.closest('.tsext-bar-cmp'))) return;
      showDetailPanel(b.__tsextSpec || spec, b);
    };
    main.addEventListener('click', openDetail);

    // دکمهٔ موردعلاقه داخل ستون نماد (قبل از اسم)
    const favBtn = b.querySelector('.tsext-bar-fav');
    if (favBtn) {
      favBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const k = rowKey(b.__tsextSpec || spec);
        const on = toggleFavorite(k);
        favBtn.classList.toggle('on', on);
        favBtn.textContent = on ? '★' : '☆';
        favBtn.title = on ? 'حذف از موردعلاقه' : 'افزودن به موردعلاقه';
        favBtn.setAttribute('aria-label', favBtn.title);
        favBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
        // همیشه شمارنده/برچسب بالای صفحه را فوری به‌روز کن
        try { updateFavFilterBtn(); } catch (err) {}
        // در حالت «فقط موردعلاقه» لیست را هم فوری بازسازی کن
        if (state.favOnly) {
          state.forceReorder = true;
          try { if (state.cache) renderActive(); } catch (err) {}
          try { updateFavFilterBtn(); } catch (err) {}
        }
      });
    }

    const detBtn = document.createElement('button');
    detBtn.type = 'button';
    detBtn.className = 'tsext-bar-obbtn';
    detBtn.title = 'جزئیات و سفارشات';
    detBtn.setAttribute('aria-label', 'جزئیات و سفارشات');
    detBtn.innerHTML = '<span class="tsext-obbtn-lbl">جزئیات</span>';
    detBtn.addEventListener('click', (e) => { e.stopPropagation(); showDetailPanel(b.__tsextSpec || spec, b); });
    actions.appendChild(detBtn);

    // دکمهٔ مقایسه: قرارداد فعلی را با جزئیات باز کنار هم می‌گذارد
    const cmpBtn = document.createElement('button');
    cmpBtn.type = 'button';
    cmpBtn.className = 'tsext-bar-cmp';
    cmpBtn.title = 'مقایسه با جزئیات باز (یا پین به‌عنوان پایهٔ مقایسه)';
    cmpBtn.setAttribute('aria-label', 'مقایسه با جزئیات باز');
    cmpBtn.innerHTML = '<span class="tsext-obbtn-ico" aria-hidden="true">⇄</span>';
    cmpBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const live = b.__tsextSpec || spec;
      if (state.obKey && panelHost && panelHost.classList.contains('tsext-with-ob')) {
        // جزئیات باز است → این ردیف را به‌عنوان طرف دوم مقایسه کن
        state.compareSpec = live;
        showDetailPanel(panelHost.querySelector('.tsext-bar.active-ob') && panelHost.querySelector('.tsext-bar.active-ob').__tsextSpec || live, panelHost.querySelector('.tsext-bar.active-ob') || b);
      } else {
        // هنوز جزئیات باز نیست → این را باز کن و برای مقایسه پین کن
        state.compareSpec = null;
        showDetailPanel(live, b);
      }
    });
    actions.appendChild(cmpBtn);
    return b;
  }

  function placeOrderBookPanel() {
    const ob = panelHost && panelHost.querySelector('#tsext-obpanel');
    if (!panelHost || !ob) return;
    const rect = panelHost.getBoundingClientRect();
    const gap = 8;
    const vw = window.innerWidth, vh = window.innerHeight;
    const manual = state.obManualSize;

    // عرض/ارتفاع جزئیات نسبت به صفحهٔ اصلی — در همهٔ تب‌ها یکسان
    // (مثبت‌۵ / ترکیبی / جامپ)
    const mainW = Math.max(320, rect.width || 400);
    const mainH = Math.max(360, rect.height || 480);
    const idealW = Math.floor(mainW * 0.88);
    const idealH = Math.min(mainH, vh - 16);
    // فقط اگر کاربر در همین نشست دستی تغییر اندازه داده، همان را نگه دار
    const manualOk = !!(manual && state.obSizedThisSession
      && manual.width >= 300 && manual.width <= 900
      && manual.height >= 300 && manual.height <= vh);
    const obW = manualOk ? Math.min(manual.width, vw - 12) : Math.min(idealW, vw - 12);
    const obH = manualOk ? Math.min(manual.height, vh - 12) : Math.min(idealH, vh - 12);

    if (state.obUserMoved && state.obManualPos) {
      let left = state.obManualPos.left;
      let top = state.obManualPos.top;
      if (left + obW > vw - 4) left = Math.max(4, vw - obW - 4);
      if (top + obH > vh - 4) top = Math.max(4, vh - obH - 4);
      if (left < 4) left = 4;
      if (top < 4) top = 4;
      ob.style.left = left + 'px';
      ob.style.top = top + 'px';
      ob.style.height = obH + 'px';
      ob.style.width = obW + 'px';
      return;
    }

    const spaceRight = vw - rect.right - gap;
    const spaceLeft = rect.left - gap;
    const onLeft = spaceRight < obW && spaceLeft > spaceRight;
    panelHost.classList.toggle('tsext-ob-left', onLeft);
    let left = onLeft ? (rect.left - gap - obW) : (rect.right + gap);
    let top = Math.min(Math.max(4, rect.top), vh - obH - 4);
    if (left < 4) left = 4;
    if (left + obW > vw - 4) left = Math.max(4, vw - obW - 4);
    if (top < 4) top = 4;
    if (top + obH > vh - 4) top = Math.max(4, vh - obH - 4);
    ob.style.left = left + 'px';
    ob.style.top = top + 'px';
    ob.style.height = obH + 'px';
    ob.style.width = obW + 'px';
  }


  // پنل کناری: جزئیات محاسبات + سفارشات (خرید/فروش در ترکیبی + سهم پایه)
  async function showDetailPanel(spec, barEl) {
    if (!panelHost) return;
    const insCode = spec && spec.insCode;
    const insBuy = spec && spec.insCodeBuy;
    const insSell = (spec && spec.insCodeSell) || insCode;
    // کلید یکسان با data-key نوار تا در همهٔ تب‌ها (مثبت‌پنج / ترکیبی / جامپ / تیک) هایلایت درست بماند
    const key = (spec && spec.key)
      ? String(spec.key)
      : ((insBuy && insSell) ? ('combo:' + insBuy + '>' + insSell)
        : (insCode ? ('i:' + insCode) : rowKey(spec)));
    // اگر همین جزئیات کمتر از ۱۰ ثانیه پیش بارگذاری شده، درخواست تکراری نزن — فقط پنل را جلوی چشم بیاور
    // اگر فقط طرف مقایسه عوض شده، از early-return رد شو تا calc دوباره ساخته شود
    const cmpChanging = !!(state.compareSpec && rowKey(state.compareSpec) !== key);
    if (!cmpChanging && state.obKey === key && state.obLoadedAt && (Date.now() - state.obLoadedAt) < 10000 && panelHost.classList.contains('tsext-with-ob')) {
      panelHost.querySelectorAll('.tsext-bar.active-ob').forEach((el) => el.classList.remove('active-ob'));
      if (barEl) barEl.classList.add('active-ob');
      placeOrderBookPanel();
      return;
    }
    state.obKey = key;
    state.obLoadedAt = 0;
    state.obInsCode = key;
    // حفظ اسکرول لیست قبل از تغییر layout (باز شدن ستون جزئیات)
    const _listEl = listEl();
    const _savedScroll = _listEl ? _listEl.scrollTop : 0;
    panelHost.classList.add('tsext-with-ob');
    placeOrderBookPanel();
    const _restoreListScroll = () => {
      try {
        const el = listEl();
        if (el) el.scrollTop = _savedScroll;
      } catch (e) {}
    };
    _restoreListScroll();
    requestAnimationFrame(() => { _restoreListScroll(); requestAnimationFrame(_restoreListScroll); });
    setTimeout(_restoreListScroll, 40);
    setTimeout(_restoreListScroll, 120);
    setTimeout(_restoreListScroll, 280);
    const titleEl = panelHost.querySelector('#tsext-obpanel-title');
    const body = panelHost.querySelector('#tsext-obpanel-body');
    // با باز شدن جزئیات جدید، موقعیت دستی قبلی رها می‌شود تا کنار قرارداد قرار بگیرد
    state.obUserMoved = false;
    state.obManualPos = null;
    const rawTitle = (spec.name || spec.ticker || '').toString().replace(/<[^>]+>/g, '');
    const strikeHint = (spec.strike != null && spec.strike !== '') ? (' · اعمال ' + String(spec.strike)) : '';
    const daysHint = (spec.daysText != null && spec.daysText !== '' && spec.daysText !== '–') ? (' · ' + String(spec.daysText) + ' روز') : '';
    if (titleEl) {
      titleEl.textContent = '';
      const main = document.createElement('span');
      main.style.cssText = 'font-weight:900;color:var(--tsext-bright);';
      main.textContent = rawTitle ? rawTitle : 'جزئیات';
      titleEl.appendChild(main);
      if (spec.cls) {
        const clsTag = document.createElement('span');
        clsTag.className = 'tsext-ob-active-tag';
        clsTag.style.background = 'transparent';
        clsTag.style.color = classColor(spec.cls);
        clsTag.style.border = '1px solid currentColor';
        clsTag.textContent = String(spec.cls);
        titleEl.appendChild(clsTag);
      }
      const tag = document.createElement('span');
      tag.className = 'tsext-ob-active-tag';
      tag.textContent = 'فعال';
      titleEl.appendChild(tag);
      // وضعیت نماد (اگر از تیک حیاتی داریم و غیر از «مجاز» است) — v1.23
      try {
        const cc = state.closingCache && insCode && state.closingCache[String(insCode)];
        const stt = cc && cc.info && cc.info.status;
        if (statusIsAbnormal(stt)) {
          const stEl = document.createElement('span');
          stEl.className = 'tsext-ob-status-tag';
          stEl.title = 'وضعیت نماد از tsetmc';
          stEl.textContent = String(stt);
          titleEl.appendChild(stEl);
        }
      } catch (e) {}
      if (strikeHint || daysHint) {
        const sub = document.createElement('span');
        sub.style.cssText = 'display:block;font-size:var(--tsext-fs-xs);font-weight:700;color:var(--tsext-muted);margin-top:2px';
        sub.textContent = (strikeHint + daysHint).replace(/^ · /, '');
        titleEl.appendChild(sub);
      }
    }
    panelHost.querySelectorAll('.tsext-bar.active-ob').forEach((el) => el.classList.remove('active-ob'));
    if (barEl) barEl.classList.add('active-ob');

    const uaIns = spec && spec.uaInsCode;
    const isComboPair = !!(insBuy && insSell && String(insBuy) !== String(insSell));
    const singleOpt = !isComboPair && !!insCode;
    // base labels
    const buyLblBase = (spec && spec.obBuyLabel) || 'سفارشات قرارداد خرید';
    const sellLblBase = (spec && spec.obSellLabel) || 'سفارشات قرارداد فروش';
    // tickers for titles (v1.28 — نام قرارداد و سهم پایه بالای جدول سفارشات)
    const buyTicker = isComboPair ? tickerByInsCode(insBuy) : '';
    const sellTicker = isComboPair ? tickerByInsCode(insSell) : (singleOpt ? tickerByInsCode(insCode) : '');
    const uaTerm = (state.cache && state.cache.term) ? String(state.cache.term).trim() : '';
    const uaTicker = uaTerm || (uaIns ? tickerByInsCode(uaIns) : '');
    const buyLbl = buyTicker ? (buyLblBase + ': ' + buyTicker) : buyLblBase;
    const sellLbl = sellTicker ? (sellLblBase + ': ' + sellTicker) : sellLblBase;
    const optLbl = sellTicker ? ('سفارشات اختیار: ' + sellTicker) : (rawTitle ? ('سفارشات اختیار: ' + rawTitle) : 'سفارشات اختیار');
    const uaLbl = uaTicker ? ('سفارشات سهم پایه: ' + uaTicker) : 'سفارشات سهم پایه';
    const hasBooks = !!(isComboPair || singleOpt || uaIns);
    let bookSlots = 0;
    if (isComboPair) bookSlots += 2;
    if (singleOpt) bookSlots += 1;
    if (uaIns) bookSlots += 1;

    // info header above orderbooks — always shows contract + underlying names (all extension)
    let obInfoHtml = '';
    if (hasBooks) {
      const parts = [];
      if (isComboPair) {
        if (buyTicker) parts.push('خرید: ' + buyTicker);
        if (sellTicker) parts.push('فروش: ' + sellTicker);
      } else if (singleOpt) {
        if (sellTicker) parts.push('قرارداد: ' + sellTicker);
      }
      if (uaTicker) parts.push('سهم پایه: ' + uaTicker);
      if (parts.length) {
        obInfoHtml = '<div class="tsext-ob-info" title="نام قراردادها و سهم پایه">' + parts.map(p => '<span>' + esc(p) + '</span>').join(' · ') + '</div>';
      }
    }

    // ساختار دو ستونه: ستون محاسبات + ستون سفارشات (هم‌زمان قابل‌مشاهده)
    let calcHtml = '';
    const cmp = state.compareSpec;
    const cmpKey = cmp ? rowKey(cmp) : '';
    const thisKey = rowKey(spec);
    const showCompare = !!(cmp && cmpKey && cmpKey !== thisKey && cmp.detailRows && cmp.detailRows.length);
    if (showCompare) {
      const aTitle = (spec.name || spec.ticker || 'قرارداد ۱').toString().replace(/<[^>]+>/g, '');
      const bTitle = (cmp.name || cmp.ticker || 'قرارداد ۲').toString().replace(/<[^>]+>/g, '');
      calcHtml += '<div class="tsext-compare-wrap">';
      calcHtml += '<div class="tsext-compare-col"><div class="tsext-compare-h">' + esc(aTitle) + '</div>' + grid(spec.detailRows || []) + '</div>';
      calcHtml += '<div class="tsext-compare-col"><div class="tsext-compare-h">' + esc(bTitle) + '</div>' + grid(cmp.detailRows || []) + '</div>';
      calcHtml += '</div>';
      calcHtml += '<div class="tsext-price-basis">مقایسهٔ کنارهم · ' + (state.priceMode === 'exec' ? 'قیمت‌ها: بهترین صف قابل‌اجرا' : 'قیمت‌ها: آخرین معامله') + ' · واحد: ریال'
        + ' · <button type="button" id="tsext-clear-compare" class="tsext-linkbtn">حذف مقایسه</button></div>';
    } else if (spec.detailRows && spec.detailRows.length) {
      calcHtml += grid(spec.detailRows);
      calcHtml += '<div class="tsext-price-basis">' + (state.priceMode === 'exec' ? 'قیمت‌ها: بهترین صف قابل‌اجرا' : 'قیمت‌ها: آخرین معامله') + ' · واحد: ریال · تاریخ: شمسی</div>';
    } else {
      calcHtml += '<div class="tsext-ob-empty">جزئیات محاسبات موجود نیست</div>';
    }

    let booksHtml = '';
    if (hasBooks) {
      booksHtml += obInfoHtml;
      if (isComboPair) {
        booksHtml += obSkeletonHtml('tsext-ob-buy-slot', buyLbl);
        booksHtml += obSkeletonHtml('tsext-ob-sell-slot', sellLbl);
      }
      if (singleOpt) {
        booksHtml += obSkeletonHtml('tsext-ob-orders-slot', optLbl);
      }
      if (uaIns) {
        booksHtml += obSkeletonHtml('tsext-ob-ua-slot', uaLbl);
      }
    }

    if (body) {
      body.className = hasBooks ? 'tsext-ob-split' : 'tsext-ob-split tsext-ob-solo';
      body.innerHTML =
        '<div id="tsext-ob-calc">' + calcHtml + '</div>' +
        '<div id="tsext-ob-books" class="tsext-ob-books-' + bookSlots + '">' + (booksHtml || '') + '</div>';
      const clr = body.querySelector('#tsext-clear-compare');
      if (clr) {
        clr.addEventListener('click', (e) => {
          e.preventDefault();
          state.compareSpec = null;
          showDetailPanel(spec, barEl);
        });
      }
    }
    placeOrderBookPanel();

    // زمینهٔ این پنل جزئیات برای رفرش زندهٔ دوره‌ای صف سفارشات (بدون نیاز به کلیک دوبارهٔ کاربر) — v1.28 شامل نام قراردادها
    state.obCtx = { insBuy, insSell, insCode, uaIns, isComboPair, singleOpt, buyLbl, sellLbl, optLbl, uaLbl };
    ensureOrderBookLiveTimer();
    await loadOrderBookSlots(key, state.obCtx, /*isInitial*/ true);
  }
  // اسکلت بارگذاری اسلات صف سفارشات (به‌جای متن «در حال دریافت…») — v1.23
  function obSkeletonHtml(id, label) {
    let rows = '';
    for (let i = 0; i < OB_LEVELS; i++) {
      rows += '<div class="tsext-skel-row"><span class="tsext-skel-cell w1"></span><span class="tsext-skel-cell w2"></span><span class="tsext-skel-cell w3"></span>'
        + '<span class="tsext-skel-cell w3"></span><span class="tsext-skel-cell w2"></span><span class="tsext-skel-cell w1"></span></div>';
    }
    return '<div class="tsext-ob-slot tsext-ob-skel" id="' + id + '" aria-busy="true" aria-label="' + esc('در حال دریافت ' + label) + '">'
      + '<div class="tsext-ob-title">' + esc(label) + ' <span class="tsext-live-dot"></span></div>'
      + '<div class="tsext-skel-bar"><span class="tsext-skel-cell w4"></span><span class="tsext-skel-line"></span></div>'
      + '<div class="tsext-skel-head"><span class="tsext-skel-cell w5"></span><span class="tsext-skel-cell w5"></span></div>'
      + rows + '</div>';
  }
  // واکشی/به‌روزرسانیِ صف سفارشات (خرید/فروش/اختیار/سهم پایه) برای پنل جزئیات فعلی —
  // هم موقع باز کردن اولیه و هم به‌صورت دوره‌ای (زنده) فراخوانی می‌شود
  async function loadOrderBookSlots(key, ctx, isInitial) {
    if (!panelHost || !ctx) return;
    const { insBuy, insSell, insCode, uaIns, isComboPair, singleOpt } = ctx;
    const buyLbl = ctx.buyLbl || 'سفارشات قرارداد خرید';
    const sellLbl = ctx.sellLbl || 'سفارشات قرارداد فروش';
    const optLbl = ctx.optLbl || 'سفارشات اختیار';
    const uaLbl = ctx.uaLbl || 'سفارشات سهم پایه';
    const buyP = isComboPair ? fetchBestLimits(insBuy, undefined, { priority: 'high' }) : Promise.resolve(null);
    const sellP = isComboPair ? fetchBestLimits(insSell, undefined, { priority: 'high' }) : Promise.resolve(null);
    const optP = singleOpt ? fetchBestLimits(insCode, undefined, { priority: 'high' }) : Promise.resolve(null);
    const uaP = uaIns ? fetchBestLimits(uaIns, undefined, { priority: 'high' }) : Promise.resolve(null);
    // سقف/کف مجاز امروز هر نماد — برای کم‌رنگ کردن قیمت‌های صف که خارج از دامنهٔ نوسان امروزند
    // (معمولاً باقی‌مانده از صف روزهای قبل که سایت هنوز پاک نکرده). از کش می‌آید، پس تقریباً بی‌هزینه است.
    const buyThP = isComboPair ? getObThreshold(insBuy) : Promise.resolve(null);
    const sellThP = isComboPair ? getObThreshold(insSell) : Promise.resolve(null);
    const optThP = singleOpt ? getObThreshold(insCode) : Promise.resolve(null);
    const uaThP = uaIns ? getObThreshold(uaIns) : Promise.resolve(null);
    // نوار نوسان قیمت (ایزی‌تریدر): داده‌اش تقریباً همیشه از کش می‌آید (تیک حیاتی + obThresh) — بی‌هزینه
    //   قراردادها: نوار ۰ تا ۲×پایانی دیروز (صفر = پایانی دیروز) · سهم پایه: کف تا سقف مجاز روز
    const OPT_RG = { option: true };
    const buyRgP = isComboPair ? getObDayRange(insBuy, undefined, OPT_RG) : Promise.resolve(null);
    const sellRgP = isComboPair ? getObDayRange(insSell, undefined, OPT_RG) : Promise.resolve(null);
    const optRgP = singleOpt ? getObDayRange(insCode, undefined, OPT_RG) : Promise.resolve(null);
    const uaRgP = uaIns ? getObDayRange(uaIns) : Promise.resolve(null);
    let [buyRows, sellRows, optRows, uaRows, buyTh, sellTh, optTh, uaTh, buyRg, sellRg, optRg, uaRg] = await Promise.all([
      buyP, sellP, optP, uaP, buyThP, sellThP, optThP, uaThP, buyRgP, sellRgP, optRgP, uaRgP,
    ]);
    // اگر بدون صف نشد نوار را ساخت (اختیار بدون معامله و بدون دامنهٔ مجاز)، یک‌بار با خودِ صف دوباره بساز (از کش — بی‌هزینه)
    if (isComboPair && !buyRg && buyRows) buyRg = await getObDayRange(insBuy, buyRows, OPT_RG);
    if (isComboPair && !sellRg && sellRows) sellRg = await getObDayRange(insSell, sellRows, OPT_RG);
    if (singleOpt && !optRg && optRows) optRg = await getObDayRange(insCode, optRows, OPT_RG);
    if (uaIns && !uaRg && uaRows) uaRg = await getObDayRange(uaIns, uaRows);
    // تکمیل نوار با قیمت‌های صف (بهترین خرید/فروش) — مهم برای اختیارِ بدون معامله
    buyRg = refineRangeWithBook(buyRg, buyRows) || buyRg;
    sellRg = refineRangeWithBook(sellRg, sellRows) || sellRg;
    optRg = refineRangeWithBook(optRg, optRows) || optRg;
    uaRg = refineRangeWithBook(uaRg, uaRows) || uaRg;
    // تضمین محور اختیار برای هر دو طرف ترکیبی (و اختیار تکی)
    const forceOptAxis = (rg) => {
      if (!rg) return rg;
      if (rg.mode !== 'option') {
        const yRef = rg.y || rg.last || 0;
        if (yRef > 0) {
          rg = Object.assign({}, rg, { mode: 'option', limitLow: 0, limitHigh: 2 * yRef, y: rg.y || yRef });
        }
      } else if (!(rg.limitHigh > rg.limitLow) && (rg.y > 0)) {
        rg = Object.assign({}, rg, { limitLow: 0, limitHigh: 2 * rg.y });
      }
      return rg;
    };
    if (isComboPair) {
      buyRg = forceOptAxis(buyRg);
      sellRg = forceOptAxis(sellRg);
    }
    if (singleOpt) optRg = forceOptAxis(optRg);
    if (state.obKey !== key || !panelHost.classList.contains('tsext-with-ob')) return;
    state.obLoadedAt = Date.now();
    state.lastDataAt = Date.now();
    updateAgeLabel();
    // نکتهٔ مهم: هرگز outerHTML روی خودِ اسلات ننویس. نوار کندل (.tsext-rangebar) بعد از ساخت
    // اولیه هرگز از DOM حذف نمی‌شود — فقط patch می‌شود تا با رفرش نپرد/چشمک نزند.
    const applySlot = (id, titleHtml, rows, thresh, range, insForAxis) => {
      const slot = panelHost.querySelector('#' + id);
      if (!slot) return;
      slot.className = 'tsext-ob-slot';
      if (insForAxis) {
        try { slot.setAttribute('data-ob-ins', String(insForAxis)); } catch (e) {}
        if (range && !range.insCode) range.insCode = String(insForAxis);
      }
      // عنوان
      let titleEl = slot.querySelector('.tsext-ob-title');
      if (!titleEl) {
        const tmp = document.createElement('div');
        tmp.innerHTML = titleHtml;
        titleEl = tmp.firstChild;
        if (titleEl) slot.insertBefore(titleEl, slot.firstChild);
      } else {
        // فقط متن برچسب را همگام کن؛ نقطهٔ زنده را نشکن
        try {
          const tmp = document.createElement('div');
          tmp.innerHTML = titleHtml;
          const fresh = tmp.querySelector('.tsext-ob-title');
          if (fresh) {
            const want = fresh.childNodes[0] ? fresh.childNodes[0].textContent : '';
            const cur = titleEl.childNodes[0] ? titleEl.childNodes[0].textContent : '';
            if (want && want !== cur) titleEl.childNodes[0].textContent = want;
          }
        } catch (e) {}
      }
      if (rows === null) {
        if (isInitial && !slot.querySelector('.tsext-ob-table')) {
          const wrap = document.createElement('div');
          wrap.innerHTML = formatOrderBook([], thresh, null);
          while (wrap.firstChild) slot.appendChild(wrap.firstChild);
        }
        if (range) patchRangeBar(slot, range);
        return;
      }
      // رفرش زنده: فقط سلول‌ها + نوار
      if (patchOrderBook(slot, rows, thresh)) {
        if (range) patchRangeBar(slot, range);
        return;
      }
      // بازسازی فقط بلوک جدول — نوار کندل سر جایش می‌ماند
      const keepBar = slot.querySelector('.tsext-rangebar');
      const oldTable = slot.querySelector('.tsext-ob');
      const wrap = document.createElement('div');
      wrap.innerHTML = formatOrderBook(rows, thresh, null);
      // انیمیشن ورود فقط بار اول
      const freshOb = wrap.querySelector('.tsext-ob');
      if (freshOb && !isInitial) freshOb.classList.remove('tsext-ob-fresh');
      if (oldTable && freshOb) {
        oldTable.replaceWith(freshOb);
        // foot داخل .tsext-ob است
      } else {
        // جدول نبود — بعد از عنوان/نوار اضافه کن
        while (wrap.firstChild) {
          const n = wrap.firstChild;
          if (keepBar && n.classList && n.classList.contains('tsext-rangebar')) { wrap.removeChild(n); continue; }
          if (titleEl && titleEl.nextSibling) slot.insertBefore(n, titleEl.nextSibling);
          else slot.appendChild(n);
        }
      }
      // نوار را دقیقاً بعد از عنوان نگه دار
      if (keepBar && titleEl && keepBar.previousSibling !== titleEl) {
        if (titleEl.nextSibling) slot.insertBefore(keepBar, titleEl.nextSibling);
        else slot.appendChild(keepBar);
      }
      if (range) patchRangeBar(slot, range);
    };
    if (isComboPair) {
      applySlot('tsext-ob-buy-slot', '<div class="tsext-ob-title">' + esc(buyLbl) + ' <span class="tsext-live-dot"></span></div>', buyRows, buyTh, buyRg, insBuy);
      applySlot('tsext-ob-sell-slot', '<div class="tsext-ob-title">' + esc(sellLbl) + ' <span class="tsext-live-dot"></span></div>', sellRows, sellTh, sellRg, insSell);
    }
    if (singleOpt) {
      applySlot('tsext-ob-orders-slot', '<div class="tsext-ob-title">' + esc(optLbl) + ' <span class="tsext-live-dot"></span></div>', optRows, optTh, optRg, insCode);
    }
    if (uaIns) {
      applySlot('tsext-ob-ua-slot', '<div class="tsext-ob-title">' + esc(uaLbl) + ' <span class="tsext-live-dot"></span></div>', uaRows, uaTh, uaRg, uaIns);
    }
    if (isInitial) placeOrderBookPanel();
  }
  // تایمر رفرش زندهٔ صف سفارشات: مستقل از رفرش لیست اصلی، تا وقتی پنل جزئیات باز است هر چند ثانیه به‌روزرسانی می‌شود
  function ensureOrderBookLiveTimer() {
    // v1.23: از زمان‌بند واحد استفاده می‌کند (schedTick) — رفتار قبلی حفظ شده: مستقل از Space، هر OB_REFRESH_MS
    sched.obOn = true;
    sched.lastOb = Date.now(); // اولین رفرش بعد از یک فاصلهٔ کامل (بار اولیه را خود showDetailPanel انجام می‌دهد)
    state.obTimer = true;
    schedEnsure();
  }
  function stopOrderBookLiveTimer() {
    sched.obOn = false;
    state.obTimer = null;
    schedMaybeStop();
  }
  // سازگاری با نام قبلی
  async function showOrderBookPanel(insCode, title, barEl) {
    return showDetailPanel({ insCode, name: title, detailRows: [] }, barEl);
  }
  function closeOrderBookPanel() {
    if (!panelHost) return;
    state.obInsCode = null;
    state.obKey = null;
    state.obCtx = null;
    state.compareSpec = null;
    state.obLoadedAt = 0;
    try { state.obRangeSticky = Object.create(null); } catch (e) {}
    state.obUserMoved = false;
    state.obManualPos = null;
    stopOrderBookLiveTimer();
    panelHost.classList.remove('tsext-with-ob');
    panelHost.classList.remove('tsext-ob-left');
    panelHost.querySelectorAll('.tsext-bar.active-ob').forEach((el) => el.classList.remove('active-ob'));
    const body = panelHost.querySelector('#tsext-obpanel-body');
    if (body) {
      body.className = '';
      body.innerHTML = '<div class="tsext-ob-empty">روی «جزئیات» هر قرارداد کلیک کنید</div>';
    }
  }

  // ----- from src/10-cleanup-init.js -----
  // ========== MODULE [10] cleanup ===========================================
  function stopAllTimers() {
    stopAutoRefreshTimers();
    stopOrderBookLiveTimer();
    if (state.visObs) {
      try { state.visObs.disconnect(); } catch (e) {}
      state.visObs = null;
    }
  }
  function resetSessionData() {
    stopAllTimers();
    closeOrderBookPanel();
    clearCache();
    state.candidates = null;
    state.openKeys = new Set();
    state.lastListSig = '';
    state.symbolCache = null;
    state.fetchInFlight = false;
    state.critFetchInFlight = false;
    state.visFetchInFlight = false;
    state.obFetchInFlight = false;
    state.obThresh = {};
    state.obDayRange = null;
    state.closingCache = null;
    state.uaInfo = null;
    state.uaTicks = [];
    state.prevBaseShown = null;
    state.lastDataAt = 0;
    state.lastChainAt = 0;
    state.visibleKeys = new Set();
    state.prevProfitByKey = {};
    state.fetchSeq = 0;
    state.netFailCount = 0;
    state.lastNetError = null;
    state.netBackoffUntil = 0;
    state.classFilter = new Set(ALL_CLASSES);
    state.strategy = 'pospanj';
    state.jampMode = 'yield';
    if (panelHost) {
      panelHost.querySelectorAll('input[type="text"], input[type="number"], input:not([type]), textarea').forEach((el) => {
        try { el.value = ''; } catch (e) {}
      });
      panelHost.querySelectorAll('select').forEach((el) => {
        try {
          if (el.options && el.options.length) el.selectedIndex = 0;
          else el.value = '';
        } catch (e) {}
      });
      try {
        const listBody = listEl(); if (listBody) listBody.innerHTML = '';
        const listHdr = listHdrEl(); if (listHdr) listHdr.innerHTML = '';
        const priceInfo = priceInfoEl(); if (priceInfo) priceInfo.innerHTML = '';
        setStatus('');
      } catch (e) {}
      // همگام‌سازی تب/پنل با state — بدون این، UI روی تب قبلی می‌ماند و کلیک دوباره روی
      // مثبت‌پنج بی‌اثر می‌شود (چون state از قبل pospanj است)
      try { updateActiveTab(); } catch (e) {}
      try { updateJampModeUI(); } catch (e) {}
    }
    lsClearAll();
  }
  function closePanelAndReset() {
    // محصول تمام‌صفحه: مخفی‌کردن host معمولاً لازم نیست؛ فقط دادهٔ نشست پاک می‌شود
    try { resetSessionData(); } catch (e) {}
  }
  function cleanupAll() {
    resetSessionData();
  }

  // ------------------------------------------------ helpers
  // ردیف‌های ویژهٔ grid:
  //   ['__hero__', [[label, valHtml, cls], ...]]  → کارت‌های برجستهٔ شاخص‌های کلیدی (بالای همه)
  //   ['__sect__', 'عنوان']                       → عنوان گروه (جایگزین خط جداگر ساده)
  //   ['__verdict__', متن, cls]                   → یک‌نمای برتر (حفظ سود / ضرر بالقوه)
  function grid(rows) {
    // راهنمای فارسی ردیف‌های جزئیات (تولتیپ) — بدون کد سلول اکسل
    const DETAIL_TIPS = {
      'دریافتی': 'اعمال فروش به‌اضافهٔ پرمیوم فروش',
      'پرداختی': 'بهای تمام‌شده با احتساب کارمزد',
      'سود به ریال': 'دریافتی منهای پرداختی',
      'سود (ریال)': 'دریافتی منهای پرداختی برای کل موقعیت',
      'سود واحد': 'سود به‌ازای هر سهم',
      'سود هر سهم': 'سود به‌ازای هر سهم',
      'سود هر سهم (ریال)': 'سود به‌ازای هر سهم',
      'سود کل': 'سود واحد ضربدر اندازه قرارداد',
      'سود کل (ریال)': 'سود واحد ضربدر اندازه قرارداد',
      'سود کل قرارداد': 'سود واحد ضربدر اندازه قرارداد',
      'سرمایه درگیر': 'پرداختی منهای پرمیوم دریافتی',
      'سرمایه درگیر (ریال)': 'پرداختی منهای پرمیوم دریافتی',
      'سرمایه درگیر کل': 'سرمایه درگیر واحد ضربدر اندازه قرارداد',
      'سود به درصد': 'سود به ریال تقسیم بر سرمایه درگیر',
      'سود٪': 'سود به ریال تقسیم بر سرمایه درگیر',
      'سود به ماه': 'سود درصد تقسیم بر روزمانده ضربدر ۳۰',
      'سود ماهانه': 'سود درصد تقسیم بر روزمانده ضربدر ۳۰',
      'سود ماهانه تقریبی': 'برآورد ماهانه از روی تیک و روزمانده',
      'بدون اعمال': 'پرمیوم فروش تقسیم بر سرمایه درگیر — اگر قرارداد اعمال نشود',
      'پرمیوم': 'قیمت قرارداد اختیار',
      'پرمیوم (ریال)': 'قیمت قرارداد اختیار',
      'پرمیوم فروش': 'پرمیومی که از فروش قرارداد می‌گیرید',
      'پرمیوم خرید': 'پرمیومی که برای خرید قرارداد می‌پردازید',
      'پرمیوم آفست': 'هزینه بازخرید قرارداد فعلی',
      'پرمیوم نزدیک': 'پرمیوم قرارداد سررسید نزدیک‌تر',
      'پرمیوم دور': 'پرمیوم قرارداد سررسید دورتر',
      'قیمت اعمال': 'قیمت اعمال قرارداد',
      'قیمت اعمال (ریال)': 'قیمت اعمال قرارداد',
      'اعمال فروش': 'قیمت اعمال قرارداد فروخته‌شده',
      'اعمال خرید': 'قیمت اعمال قرارداد خریداری‌شده',
      'اعمال (یکسان)': 'هر دو پا باید همین اعمال را داشته باشند',
      'اعمال جدید': 'قیمت اعمال قرارداد مقصد جامپ',
      'اعمال فعلی (آفست)': 'اعمال قراردادی که الان دارید و بازخرید می‌کنید',
      'اعمال جاری (انتخابی)': 'قرارداد فعلی انتخاب‌شده از کشویی',
      'معادل سهم پایه': 'اعمال خرید به‌اضافهٔ پرمیوم خرید — جایگزین خرید مستقیم سهم',
      'قیمت سهم پایه': 'قیمت مبنا برای محاسبه',
      'قیمت سهم پایه (ریال)': 'قیمت مبنا برای محاسبه',
      'سهم پایهٔ جدید': 'قیمت سهم پایه پس از جامپ',
      'ارزش ذاتی': 'حداکثرِ صفر و اختلاف سهم با اعمال',
      'روزمانده': 'روز باقی‌مانده تا سررسید',
      'روزمانده فروش': 'روز باقی‌مانده تا سررسید قرارداد فروش',
      'روزمانده / سررسید': 'روز باقی‌مانده و تاریخ سررسید',
      'روز نزدیک / دور': 'روزمانده سررسید نزدیک و دور',
      'کارمزد': 'درصد کارمزد اعمال‌شده روی پرداختی',
      'اندازه قرارداد': 'تعداد سهم به‌ازای هر قرارداد',
      'شکاف فعلی (دور − نزدیک)': 'پرمیوم دور منهای پرمیوم نزدیک',
      'نقطه تعادل': 'شکاف طبیعی که با رصد خودتان تعیین می‌کنید؛ صفر یعنی هدف تساوی پرمیوم‌ها',
      'تیک بالقوه': 'اختلاف شکاف با نقطه تعادل — سود تقریبی تا همگرایی',
      'تیک بالقوه تا تعادل': 'اختلاف شکاف با نقطه تعادل',
      'جهت': 'کدام پا را بخرید و کدام را بفروشید',
      'پای خرید': 'پایی که باید بخرید و پرمیوم پرداختی آن',
      'پای فروش': 'پایی که باید بفروشید و پرمیوم دریافتی آن',
      'اعتبار ورود (فروش−خرید)': 'خالص دریافتی یا پرداختی در لحظه ورود',
      'هزینه فرصت وجه تضمین': 'برآورد سود ازدست‌رفته روی وجه بلوکه (حدود ۵٪ ماهانه)',
      'هزینه فرصت وجه تضمین (برآورد تا سررسید نزدیک)': 'برآورد سود ازدست‌رفته روی وجه بلوکه تا سررسید نزدیک',
      'سطح ریسک': 'ریسک نسبی کلاس اعمال',
      'کلاس اعمال': 'رده اعمال نسبت به قیمت سهم',
      'خالص پرداختی = بازخرید − دریافتی': 'آنچه عملاً برای بستن قرارداد جاری می‌پردازید',
      'قیمت سهم پایه = اعمال جاری + خالص بستن': 'قیمت پایهٔ محاسبه‌شده برای ارزیابی قرارداد جدید (زیان بستن پایه را بالا می‌برد، سود بستن پایه را پایین می‌آورد)',
      'پرمیوم بازخرید قرارداد جاری (پرداختی)': 'هزینه زنده یا پایانی بازخرید قرارداد فعلی',
      'پرمیوم دریافتی قرارداد جاری (دستی)': 'پرمیومی که هنگام فروش اولیه گرفته‌اید',
    };
    function tipFor(label, explicit) {
      if (explicit) return String(explicit);
      const k = String(label || '').trim();
      // فقط تطبیق دقیق — تطبیق نرم باعث راهنمای اشتباه/نامفهوم می‌شد
      return DETAIL_TIPS[k] || '';
    }
    // رنگ/پس‌زمینه سطح ریسک دقیقاً از پالت کلاس (A/B/X/−B/−A)
    function riskInlineStyle(cls) {
      if (!cls || String(cls).indexOf('tsext-risk-') < 0) return '';
      const map = {
        'tsext-risk-vlow': 'A',
        'tsext-risk-low': 'B',
        'tsext-risk-mid': 'X',
        'tsext-risk-high': '−B',
        'tsext-risk-vhigh': '−A',
      };
      let key = null;
      for (const k of Object.keys(map)) {
        if (String(cls).indexOf(k) >= 0) { key = map[k]; break; }
      }
      if (!key) return '';
      const col = classColor(key);
      return ' style="color:' + col + ' !important;background:color-mix(in srgb,' + col + ' 22%,transparent) !important;border:1px solid color-mix(in srgb,' + col + ' 42%,transparent) !important;border-radius:6px;padding:2px 8px;display:inline-block;font-weight:800"';
    }
    return '<div class="tsext-grid">' + rows.map((row) => {
      const l = row[0], v = row[1], cls = row[2], tip = row[3];
      if (l === '__hero__') {
        const cards = (Array.isArray(v) ? v : []).map((it) =>
          '<div class="tsext-hero-card' + (it[2] ? ' ' + it[2] : '') + '"><span class="h-lbl">' + it[0] + '</span><span class="h-val">' + it[1] + '</span></div>'
        ).join('');
        return '<div class="tsext-hero">' + cards + '</div>';
      }
      if (l === '__sect__') return '<div class="tsext-sec">' + v + '</div>';
      if (l === '__verdict__') return '<div class="tsext-verdict ' + (cls || '') + '">' + v + '</div>';
      if (l === '__hr__') return '<div class="tsext-grid-divider"></div>';
      const riskStyle = riskInlineStyle(cls);
      const plainV = esc(String(v == null ? '' : v).replace(/<[^>]+>/g, ''));
      const guide = tipFor(l, tip);
      const title = guide
        ? esc(guide)
        : (esc(l) + (plainV ? (': ' + plainV) : ''));
      return '<div class="tsext-cell" title="' + title + '"><span class="lbl">' + l + '</span><span class="val ' + (cls || '') + '"' + riskStyle + '>' + v + '</span></div>';
    }).join('') + '</div>';
  }
  function percol(v) { if (v === null || v === undefined || isNaN(v)) return ''; return v >= 0 ? 'pos' : 'neg'; }
  function profitLevelClass(v) {
    const n = Number(v);
    if (isNaN(n)) return '';
    if (n < 0) return 'tsext-plvl-neg';
    if (n >= 10) return 'tsext-plvl-hi';
    if (n >= 5) return 'tsext-plvl-mid';
    return 'tsext-plvl-lo';
  }

  // حالت ارقام: 'fa' | 'en' — از localStorage (pr-prefs) یا رویداد tsext-digits خوانده می‌شود
  function getDigitMode() {
    try {
      const p = JSON.parse(localStorage.getItem('pr-prefs') || '{}');
      if (p && p.digits === 'en') return 'en';
    } catch (e) {}
    try {
      if (document.documentElement.getAttribute('data-tsext-digits') === 'en') return 'en';
      const host = document.getElementById('tsext-host');
      if (host && host.getAttribute('data-digits') === 'en') return 'en';
    } catch (e) {}
    return 'fa';
  }
  function toDisplayDigits(s) {
    const str = String(s == null ? '' : s);
    if (getDigitMode() === 'en') {
      return str.replace(/[۰-۹]/g, (ch) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(ch)))
                .replace(/[٠-٩]/g, (ch) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(ch)));
    }
    return str.replace(/[0-9]/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[+d]);
  }
  function upc(v) {
    const raw = Number(v).toFixed(2).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
    return toDisplayDigits(raw);
  }
  function num(v) {
    if (v === null || v === undefined || isNaN(v)) return '–';
    const loc = getDigitMode() === 'en' ? 'en-US' : 'fa-IR';
    try { return Number(v).toLocaleString(loc); } catch (e) { return toDisplayDigits(String(Number(v))); }
  }
  function fmtDate(d) {
    if (!d || isNaN(d.getTime())) return '–';
    try {
      const loc = getDigitMode() === 'en' ? 'en-US' : 'fa-IR';
      return d.toLocaleDateString(loc, { year: 'numeric', month: '2-digit', day: '2-digit' });
    } catch (e) {
      const y = d.getFullYear(); const m = String(d.getMonth() + 1).padStart(2, '0'); const da = String(d.getDate()).padStart(2, '0');
      return toDisplayDigits(y + '/' + m + '/' + da);
    }
  }
  function esc(s) { return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])); }
  // پارس ورودی: همیشه به ارقام لاتین تبدیل می‌کند
  function faDigits(s) {
    return String(s == null ? '' : s).replace(/[۰-۹٠-٩]/g, (ch) => {
      const fa = '۰۱۲۳۴۵۶۷۸۹'.indexOf(ch);
      if (fa > -1) return String(fa);
      const ar = '٠١٢٣٤٥٦٧٨٩'.indexOf(ch);
      return ar > -1 ? String(ar) : ch;
    });
  }
  // با تغییر سوییچ ارقام، لیست را از کش دوباره بکش تا num()/upc() با حالت جدید رندر شوند
  try {
    window.addEventListener('tsext-digits', () => {
      try { if (state && state.cache) renderActive(); } catch (e) {}
    });
  } catch (e) {}

  // ---------------------------------------------------------------- init
  // اگر هر یک از پنل یا دکمهٔ شناور به هر دلیلی (تغییر صفحهٔ سایت، بازسازی DOM و ...) حذف شد، دوباره تزریق شود
  function missingUI() { return !document.getElementById('tsext-host'); }
  function boot() { if (document.body && missingUI()) ensureSidebar(); }
  if (document.body) boot(); else document.addEventListener('DOMContentLoaded', boot);

  // ابزار کوچک debounce: چون tsetmc قیمت‌ها را مدام در DOM به‌روزرسانی می‌کند، MutationObserver سراسری
  // بدون debounce برای هر جهش کوچک DOM اجرا می‌شود؛ اینجا چند جهش پیاپی در یک بازهٔ کوتاه، فقط یک بار پردازش می‌شوند.
  function debounce(fn, waitMs) {
    let timer = null;
    return function () {
      clearTimeout(timer);
      timer = setTimeout(fn, waitMs);
    };
  }

  const checkUI = debounce(() => { if (document.body && missingUI()) ensureSidebar(); }, 250);
  const mo = new MutationObserver(checkUI);
  try { mo.observe(document.documentElement || document.body, { childList: true, subtree: true }); } catch (e) {}
  // (بررسی دوره‌ای ۱.۵ ثانیه‌ای حذف شد — MutationObserver فوق همین کار را می‌کند و نیازی به دو مکانیزم
  // موازی نبود؛ این setInterval فقط CPU را در پس‌زمینه می‌سوزاند.)
  // همگام‌سازی «فقط بسته‌شدن» پنل بین تب‌های مختلف همان سایت — اگر تب دیگری پنل را ببندد، اینجا
  // هم بسته شود (بی‌ضرر و مفید)؛ اما دیگر تب دیگر را خودکار باز نمی‌کنیم، چون باز شدن باید همیشه
  // فقط نتیجهٔ کلیک صریح خودِ کاربر روی دکمهٔ همان تب باشد، نه اثر جانبی یک تب دیگر
  try {
    window.addEventListener('beforeunload', () => { try { cleanupAll(); } catch (e) {} });
    window.addEventListener('pagehide', () => { try { cleanupAll(); } catch (e) {} });
  } catch (e) {}

  // مکث تایمرها وقتی تب مخفی است (صرفهٔ باتری/CPU و کاهش فشار بیهوده روی سرور) — با بازگشت، از سر گرفته می‌شوند
  try {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        stopAutoRefreshTimers();
        stopOrderBookLiveTimer();
      } else if (panelHost && panelHost.style.display !== 'none') {
        if (state.autoRefresh) {
          setupAutoRefresh();
          // بازگشت به تب: فقط تیک قیمت؛ fetch کامل فقط اگر کش نداریم یا خیلی کهنه است
          try { criticalPriceTick(); } catch (e2) {}
          try {
            const inp = (typeof readInputs === 'function') ? readInputs() : null;
            const cacheAge = state.lastChainAt ? (Date.now() - state.lastChainAt) : 1e12;
            if (inp && inp.term && (!state.cache || state.cache.term !== inp.term || cacheAge > 60000)) {
              fetchAndRender(true);
            } else if (state.cache) {
              try { renderActive(); } catch (e3) {}
            }
          } catch (e2) {}
        }
        if (state.obKey && state.obCtx && panelHost.classList.contains('tsext-with-ob')) ensureOrderBookLiveTimer();
      }
    });
  } catch (e) {}

  // هم‌تراز ماندن پنل سفارشات با تغییر اندازهٔ میزبان/صفحه. قبلاً یک MutationObserver روی کل سند
  // (childList + subtree) نصب شده بود که روی صفحهٔ شلوغی مثل tsetmc با هر تغییر DOM بی‌وقفه شلیک
  // می‌کرد و CPU را در پس‌زمینه می‌سوزاند (منبع اصلی کندی عمومی). جابه‌جایی/تغییر اندازهٔ پنل از
  // قبل با ResizeObserver خودِ پنل + پایانِ کشیدن/تغییر اندازه + همین resize پنجره پوشش داده می‌شود،
  // و چون هر دو پنل position:fixed هستند، ری‌فلو صفحهٔ میزبان جای آن‌ها را عوض نمی‌کند.
  try {
    let obPlaceQueued = false;
    const queuePlaceOrderBookPanel = () => {
      if (obPlaceQueued || !state.obInsCode) return;
      obPlaceQueued = true;
      requestAnimationFrame(() => { obPlaceQueued = false; if (state.obInsCode) placeOrderBookPanel(); });
    };
    window.addEventListener('resize', queuePlaceOrderBookPanel);
  } catch (e) {}
  // هوک فقط-برای-تست: فرمول‌های خالص را برای تست واحد (بدون DOM) در دسترس می‌گذارد.
  // در استفادهٔ واقعی هیچ اثری ندارد.
  // API عمومی برای pro.js / دیدبان چندنمادی — سوییچ سریع نماد بدون اتکا به رویداد مصنوعی
  function loadSymbol(term, opts) {
    term = String(term || '').trim();
    if (!term) return;
    ensureSidebar();
    try { closeOrderBookPanel(); } catch (e) {}
    const prevTerm = state.cache && state.cache.term;
    const same = prevTerm && prevTerm === term;
    try {
      // پیش‌فرض: فقط تب فعلی — تا هر استراتژی آخرین نماد خودش را نگه دارد
      // opts.syncAll=true (دیدبان) همه تب‌ها را هم‌تراز می‌کند
      if (opts && opts.syncAll) {
        STRATS.forEach((s) => {
          const inp = $id(panelHost, 'tsext-underlying-' + s);
          if (inp) inp.value = term;
        });
      } else {
        const cur = state.strategy || 'pospanj';
        const inp = $id(panelHost, 'tsext-underlying-' + cur);
        if (inp) inp.value = term;
      }
      try { saveSettings(); } catch (e2) {}
    } catch (e) {}
    // کش کوتاه‌مدت سوییچ — فوری رندر، بعد در پس‌زمینه تازه کن
    const cached = (!(opts && opts.force) || (opts && opts.preferCache)) ? getChainCache(term) : null;
    if (cached) {
      state.cache = {
        term: cached.term,
        rows: cached.rows,
        livePrice: cached.livePrice,
        livePriceIsLive: cached.livePriceIsLive,
      };
      state.symbolCache = state.symbolCache && state.symbolCache.term === term ? state.symbolCache : null;
      if (!same) {
        state.forceReorder = true;
        state.listTerm = null;
      }
      try { updateFavFilterBtn(); } catch (e) {}
      try { renderActive(); setStatus('از کش · در حال تأیید…'); } catch (e) {}
      // تازه‌سازی پس‌زمینه بدون خالی کردن لیست
      try {
        state.fetchInFlight = false;
        fetchAndRender(true);
      } catch (e) {}
      return;
    }
    if (same && state.cache && !(opts && opts.force)) {
      // همان نماد — اسکلتون نساز، فقط رفرش
      try { renderActive(); } catch (e) {}
      try { state.fetchInFlight = false; fetchAndRender(true); } catch (e) {}
      return;
    }
    if (!same) {
      clearCache();
      state.symbolCache = null;
      state.candidates = null;
      state.openKeys = new Set();
      state.uaTicks = [];
      state.prevBaseShown = null;
      state.uaInfo = null;
      state.obThresh = {};
      state.obDayRange = null;
      state.closingCache = null;
      state.listTerm = null;       // لیست قبلی دیگر معتبر نیست
      state.forceReorder = true;  // soft-update حق نگه داشتن DOM قبلی را ندارد
      try {
        const el = listEl();
        // همیشه اسکلتون نماد جدید — ماندن قراردادهای نماد قبلی گمراه‌کننده است
        if (el) {
          el.innerHTML = skeletonListHtml(term);
          el.removeAttribute('data-list-term');
          el.removeAttribute('data-strategy');
        }
        setListHeader('');
        setStatus('بارگذاری «' + term + '»…');
      } catch (e) {}
      try { updateFavFilterBtn(); } catch (e) {}
    }
    try {
      state.fetchInFlight = false;
      fetchAndRender(false);
    } catch (e) {}
  }
  // پیش‌بارگذاری خاموش برای دیدبان (اولویت پایین)
  function prefetchSymbol(term) {
    term = String(term || '').trim();
    if (!term || getChainCache(term)) return;
    if (state.cache && state.cache.term === term) return;
    // فقط اگر صفحه فعال است
    try { if (typeof document !== 'undefined' && document.hidden) return; } catch (e) {}
    (async () => {
      try {
        const cj = await apiGet('/GetInstrumentOptionMarketWatch/0', 2, 1, { priority: 'low' });
        const chainRaw = cj && (cj.instrumentOptMarketWatch || cj.InstrumentOptMarketWatch);
        if (!Array.isArray(chainRaw) || !chainRaw.length) return;
        // جستجوی ساده در زنجیره
        const norm = (s) => String(s || '').replace(/\s+/g, '').replace(/ي/g, 'ی').replace(/ك/g, 'ک');
        const tn = norm(term);
        let uaIns = null;
        for (const r of chainRaw) {
          for (const n of [r.lVal18AFC_UA, r.lVal30_UA, r.lVal18AFC_C, r.lVal30_C]) {
            if (norm(n) === tn || norm(n).includes(tn)) { uaIns = Number(r.uaInsCode); break; }
          }
          if (uaIns) break;
        }
        if (!uaIns) return;
        const rows = chainRaw.filter((r) => Number(r.uaInsCode) === uaIns);
        if (!rows.length) return;
        const ua = rows[0];
        const rawUaLive = asNum(ua && ua.pDrCotVal_UA, 0);
        const livePrice = rawUaLive || asNum(ua && ua.pClosing_UA, 0);
        putChainCache({ term, rows, livePrice, livePriceIsLive: rawUaLive > 0 });
      } catch (e) {}
    })();
  }
  // اعتبارسنجی نماد برای دیدبان: فقط نمادهای دارای اختیار + فقط تطبیق دقیق نام
  // خروجی: { ok:true, name, insCode } | { ok:false, reason:'not_found'|'no_options'|'error', name? }
  async function resolveOptionUnderlying(term) {
    term = String(term || '').trim();
    if (!term) return { ok: false, reason: 'not_found' };
    const tn = normSym(term);
    try {
      let cat = await ensureUaCatalog(false);
      if (!cat || !cat.length) {
        try {
          const cj = await apiGet('/GetInstrumentOptionMarketWatch/0', 2, 1, { priority: 'low' });
          const chainRaw = cj && (cj.instrumentOptMarketWatch || cj.InstrumentOptMarketWatch || cj.optionMarketWatch || cj.instrumentOptionMarketWatch);
          if (Array.isArray(chainRaw) && chainRaw.length) cat = buildUaCatalogFromChain(chainRaw);
        } catch (e) {}
      }
      const codeSet = Object.create(null);
      (cat || []).forEach((e) => { codeSet[String(e.insCode)] = e; });

      // ۱) تطبیق دقیق نام در کاتالوگ اختیار
      for (const e of (cat || [])) {
        const names = (e.names && e.names.length) ? e.names : [e.name];
        for (const n of names) {
          if (normSym(n) === tn) return { ok: true, name: e.name || n, insCode: e.insCode };
        }
      }

      // ۲) جستجوی tsetmc — فقط تطبیق دقیق
      const sj = await apiGet('/GetInstrumentSearch/' + encodeURIComponent(term), 2, 0, { priority: 'low' });
      if (!sj) return { ok: false, reason: 'error' };
      const results = sj.instrumentSearch || [];
      const hits = results.filter((x) => x && (x.lVal18AFC || x.lVal30) && (x.flow === 1 || x.flow === 2));
      const exactHits = hits.filter((x) => normSym(x.lVal18AFC) === tn || normSym(x.lVal30) === tn);
      if (!exactHits.length) return { ok: false, reason: 'not_found' };

      const withOpt = [];
      let anyStock = null;
      for (const h of exactHits) {
        const code = String(h.insCode || '');
        if (!code) continue;
        const nm = h.lVal18AFC || h.lVal30 || term;
        if (!anyStock) anyStock = { name: nm, insCode: h.insCode };
        if (codeSet[code]) withOpt.push({ name: nm, insCode: h.insCode });
      }
      if (withOpt.length) return { ok: true, name: withOpt[0].name, insCode: withOpt[0].insCode };
      if (anyStock) return { ok: false, reason: 'no_options', name: anyStock.name };
      return { ok: false, reason: 'not_found' };
    } catch (e) {
      return { ok: false, reason: 'error' };
    }
  }

  try {
    if (typeof window !== 'undefined') {
      window.__tsetmcInternals = {
        resolveContractSize, expiryWithFlag,
        calcPosPanj, calcCombo, buildJampCandidate, buildJampDownshiftCandidate,
        buildJampUpshiftCandidate, buildJampChallengeCandidate, classifyStrikes, riskLabel,
        // v1.25: جامپ چالشی (قیمت پایه از قرارداد جاری) + ذخیرهٔ فیلدهای دستی جامپ
        challengeBasePrice, readJampManual, updateJampModeUI, renderJamp, collectStrategySettings, restoreSettingsToDom, saveSettings, JAMP_MANUAL_FIELDS,
        loadSymbol, closeOrderBookPanel, showDetailPanel, fetchAndRender, renderActive,
        bindUaAutocomplete, ensureUaCatalog, hideUaSuggest, resolveOptionUnderlying,
        // نوار نوسان قیمت + جدول سفارشات (برای تست/پیش‌نمایش بدون شبکه)
        formatOrderBook, formatRangeBar, patchRangeBar, rangeBarGeom, rangeIsUp, rangeBarHoverMove, rangeBarHoverHide, refineRangeWithBook, getObDayRange, loadOrderBookSlots,
        marketPhase, marketPhaseByClock, marketFactor, forceLiveNow, getCritIntervalMs, getVisIntervalMs, getChainIntervalMs, getObIntervalMs,
        netDedup, diag, sched, toggleDiagPanel, fmtHEven, statusIsAbnormal, obSkeletonHtml,
        // v1.24: تعطیلات، دفترچهٔ خطا، سلامت داده، پشتیبان
        marketPhaseInfo, holidayToday, tradedToday, isHolidayClosed, tehranClock, marketStatusFa, MARKET_HOLIDAYS, MARKET_HOLIDAY_DATES, gregorianToJalali,
        noteError, errLogText, tsextErr, renderDiagPanel, diagText,
        checkDataShape, healthSummary, renderHealthBanner, dataHealth, DATA_SHAPE, fetchClosingInfo,
        backupCollect, backupValidate, backupApply, backupDownload, toggleBackupMenu, BACKUP_PREFIXES,
        // v1.29: قیمت قابل‌اجرا، پرچم توقف، راهنمای «؟»
        withExecPrices, parseBestLevel, setPriceMode, bookSweepTick, applyHaltFlags, isHaltedStatus, helpBtn, upgradeNotesToHelp,
        analyzeCoveredCallRow, calcCombo, _state: state,
        // v1.0.x: پایداری race + شکل API
        clearCache, currentCacheGen, applyClosingResults, patchRowFromClosing, patchUaFromClosing,
        lastApiShapeKeys: () => state.lastApiShapeKeys,
      };
      window.__tsextLoadSymbol = loadSymbol;
      window.__tsextCloseDetail = closeOrderBookPanel;
      window.__tsextPrefetchSymbol = prefetchSymbol;
      window.__tsextResolveOptionUnderlying = resolveOptionUnderlying;
    }
  } catch (e) {}
  try { console.log('[smart-option-assistant] v1.0.0 clean+ob-names+disclaimer'); } catch (e) {}
})();



/* ===== from src/09-product-shell.js (product UI shell) ===== */
/* ==========================================================================
   src/09-product-shell.js — پوستهٔ محصول (دیدبان تمام‌صفحه)
   --------------------------------------------------------------------------
   منبع حقیقت UI محصول برای panel.html:
   نوار بالا، جستجوی یکپارچه، دیدبان چندنمادی، splitter، سلب‌مسئولیت بالا.
   با assemble بعد از IIFE موتور به انتهای content.js چسبانده می‌شود.
   فایل ریشه pro.js فقط کپی همگام برای سازگاری است — ویرایش را اینجا انجام دهید.
   ========================================================================== */
(function () {
  'use strict';
  // v1.30: override نهایی چیدمان/تب/وضعیت دیگر این‌جا با JS تزریق نمی‌شود —
  // به یک <style id="tsext-pro-override-final"> استاتیک در panel.html منتقل شده
  // (همان محتوا، همان جایگاه بعد از تگ content.js، همان اولویت !important).

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function mk(tag, cls, text) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    return el;
  }
  function prClamp(v, a, b){ return Math.max(a, Math.min(b, v)); }
  function prFaConv(t){ return String(t).replace(/[0-9]/g, function(d){ return '۰۱۲۳۴۵۶۷۸۹'[+d]; }); }
  function prEnConv(t){ return String(t).replace(/[۰-۹]/g, function(d){ return String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)); }).replace(/[٠-٩]/g, function(d){ return String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)); }); }
  try { window.__pr = { faConv: prFaConv, clamp: prClamp }; } catch(e){}

  // اجرای بی‌خطر + فقط وقتی تب قابل مشاهده است (صرفه‌جویی CPU در پس‌زمینه)
  function bgSafe(fn){ return function(){ if (document.hidden) return; try { fn(); } catch(e){} }; }
  function faDigits(s) {
    return String(s == null ? '' : s).replace(/[۰-۹٠-٩]/g, function (ch) {
      var fa = '۰۱۲۳۴۵۶۷۸۹'.indexOf(ch);
      if (fa > -1) return String(fa);
      var ar = '٠١٢٣٤٥٦٧٨٩'.indexOf(ch);
      return ar > -1 ? String(ar) : ch;
    });
  }
  function toFaNum(n) {
    if (n == null || isNaN(n)) return '—';
    try { return faDigits(Number(n).toLocaleString('en-US')); } catch(e){ return faDigits(String(n)); }
  }
  function formatHuge(v) {
    // 45213 -> 45.2 همت
    if (v == null || isNaN(v)) return '—';
    var num = Number(v);
    if (num >= 1e12) return faDigits((num/1e12).toFixed(1)) + ' همت';
    if (num >= 1e9) return faDigits((num/1e9).toFixed(1)) + ' میلیارد';
    if (num >= 1e6) return faDigits((num/1e6).toFixed(1)) + ' میلیون';
    return toFaNum(Math.round(num));
  }

  /* ---------- پالت نیکی-سبک ---------- */
  var NIKI = {
    dark: {
      bg: '#0d1424', panel: '#121b30', panel2: '#17233c',
      fg: '#dbe6f7', bright: '#f4f8ff', muted: '#8ea0bf',
      border: '#24345a', inputBg: '#0f1830',
      accent: '#4cc2ff', green: '#3ddc84', red: '#ff6b6b', orange: '#ffb454',
      swA: '#3ddc84', swB: '#7ee8b2', swX: '#4cc2ff', swmB: '#ffb454', swmA: '#ff6b6b',
    },
    light: {
      bg: '#eef2f7', panel: '#ffffff', panel2: '#f5f7fa',
      fg: '#1e293b', bright: '#0f172a', muted: '#64748b',
      border: '#d9e2ec', inputBg: '#ffffff',
      accent: '#1d4ed8', green: '#15803d', red: '#dc2626', orange: '#b45309',
      swA: '#15803d', swB: '#16a34a', swX: '#0891b2', swmB: '#b45309', swmA: '#dc2626',
    },
    contrast: {
      bg: '#000000', panel: '#090909', panel2: '#101010',
      fg: '#f2f2f2', bright: '#ffffff', muted: '#d9d9d9',
      border: '#6a6a6a', inputBg: '#151515',
      accent: '#2adcc8', green: '#2ecc7f', red: '#ff6363', orange: '#f7a928',
      swA: '#2ecc7f', swB: '#7ee8b2', swX: '#2adcc8', swmB: '#f7a928', swmA: '#ff6363',
    },
  };

  function applyNikiTheme(hostEl) {
    if (!hostEl) return;
    var key = hostEl.getAttribute('data-tsext-theme') || 'dark';
    var p = NIKI[key] || NIKI.dark;
    var set = function (k, v) { try { hostEl.style.setProperty('--tsext-' + k, v); } catch (e) {} };
    set('bg', p.bg); set('panel', p.panel); set('panel2', p.panel2);
    set('fg', p.fg); set('bright', p.bright); set('muted', p.muted);
    set('border', p.border); set('input', p.inputBg);
    set('accent', p.accent); set('green', p.green); set('red', p.red); set('orange', p.orange);
    set('sw-A', p.swA); set('sw-B', p.swB); set('sw-X', p.swX);
    set('sw-mB', p.swmB); set('sw-mA', p.swmA);
  }

  // تعطیلات — فقط تاریخ؛ نام مناسبت نمایش داده نمی‌شود
  var PR_HOLIDAY_DATES_FALLBACK = [
    '2026-02-11','2026-03-20','2026-03-21','2026-03-22','2026-03-23','2026-03-24',
    '2026-04-01','2026-04-02','2026-04-14','2026-05-27','2026-06-04','2026-06-05',
    '2026-06-24','2026-06-25','2026-08-04','2026-08-12','2026-08-13','2026-08-21',
    '2026-08-30','2026-11-13','2026-12-23','2027-01-06','2027-01-24','2027-02-11',
    '2027-02-28','2027-03-10','2027-03-11','2027-03-20'
  ];
  function prHolidayDates() {
    try {
      if (window.__tsextHolidays && window.__tsextHolidays.length) return window.__tsextHolidays;
    } catch (e) {}
    return PR_HOLIDAY_DATES_FALLBACK;
  }
  var PR_HOLIDAYS = prHolidayDates();
  try { window.__prHolidays = PR_HOLIDAYS; } catch (e) {}
  function prTehranDateStr() {
    try {
      var parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
      var map = {};
      parts.forEach(function (p) { map[p.type] = p.value; });
      return (map.year || '') + '-' + (map.month || '') + '-' + (map.day || '');
    } catch (e) { return ''; }
  }
  function prHolidayToday() {
    try {
      var I = window.__tsetmcInternals;
      if (I && typeof I.holidayToday === 'function') {
        var h = I.holidayToday();
        return h ? 'تعطیل رسمی' : '';
      }
    } catch (e) {}
    var d = prTehranDateStr();
    return PR_HOLIDAYS.indexOf(d) >= 0 ? 'تعطیل رسمی' : '';
  }
  try {
    if (window.__pr) {
      window.__pr.holidayToday = prHolidayToday;
      window.__pr.tehranDate = prTehranDateStr;
    }
  } catch (e) {}

  function marketPhase() {
    try {
      var I = window.__tsetmcInternals;
      if (I && typeof I.marketPhaseInfo === 'function') {
        var mi = I.marketPhaseInfo();
        if (mi && mi.phase) return { phase: mi.phase, label: mi.label || '', tip: mi.tip || '', holiday: mi.holiday || '' };
      }
    } catch (e) {}
    try {
      var hol = '';
      try { hol = prHolidayToday() || ''; } catch (e) {}
      if (hol) return { phase: 'holiday', label: 'تعطیل رسمی', tip: 'امروز تعطیل رسمی است · بازار بسته' };
      var parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Tehran', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
      }).formatToParts(new Date());
      var map = {};
      parts.forEach(function (p) { map[p.type] = p.value; });
      var mins = (parseInt(map.hour, 10) || 0) * 60 + (parseInt(map.minute, 10) || 0);
      var wd = map.weekday || '';
      var isWd = (wd === 'Sat' || wd === 'Sun' || wd === 'Mon' || wd === 'Tue' || wd === 'Wed');
      if (!isWd) return { phase: 'closed', label: 'بازار بسته', tip: 'روز غیرکاری · بازار بسته است' };
      // پیش‌گشایش تقریبی بورس: ۸:۴۵ تا ۹:۰۰
      if (mins >= (8 * 60 + 45) && mins < (9 * 60))
        return { phase: 'preopen', label: 'پیش‌گشایش', tip: 'پیش‌گشایش · شروع معاملات از ۹:۰۰' };
      if (mins >= (9 * 60) && mins < (12 * 60 + 30))
        return { phase: 'open', label: 'بازار باز', tip: 'ساعات معاملات: ۹:۰۰ تا ۱۲:۳۰ به وقت تهران' };
      return { phase: 'closed', label: 'بازار بسته', tip: 'خارج از ساعت معاملات · ۹:۰۰ تا ۱۲:۳۰ تهران' };
    } catch (e) {
      return { phase: 'closed', label: 'بازار بسته', tip: '' };
    }
  }


  /* ---------- میزبان ---------- */
  var host = null;
  function waitForEngine(triesLeft) {
    host = document.getElementById('tsext-host');
    var maincol = document.getElementById('tsext-maincol');
    if (host && maincol) { openPanel(); return; }
    if (triesLeft > 0) setTimeout(function () { waitForEngine(triesLeft - 1); }, 100);
  }

  function openPanel() {
    forceDarkIfNeeded(function () {
      try { host.style.display = 'flex'; } catch (e) {}
      applyNikiTheme(host);
      buildShell();
      hookThemeReapply();
      setupSplitters();
      unifySearch();
      disableObDragInPro();
      setupScrollSync();
      setupWatchlist();
      setupProPolish();
      setupFaDigits();
      setupNoResizeNoZoom();
      setupErrorToast();
      setupFetchRetry();
      setupListHealth();
      buildPrefs();
      setupScrollGuard();
      setupWatchPrefetch();
      // مخفی نگه‌داشتن تاخیری اگر موتور دوباره آن را ساخت/نمایش داد
            var bodyObs = new MutationObserver(function(muts){
        var needRebuild = false;
        for (var i=0;i<muts.length;i++){
          var m=muts[i];
          if (m.addedNodes) {
            for (var j=0;j<m.addedNodes.length;j++){
              var n=m.addedNodes[j];
                            if(n && n.id === 'tsext-host') needRebuild = true;
              if(n && n.querySelector && n.querySelector('#tsext-host')) needRebuild = true;
            }
          }
          // حالت attributes دیگر رصد نمی‌کنیم تا حلقه بی‌نهایت نشود
        }
        // فقط وقتی واقعاً host جدید آمده یا topbar گم شده
        if (needRebuild) {
          try {
            var newHost = document.getElementById('tsext-host');
            if (newHost && newHost !== host) {
              host = newHost;
              applyNikiTheme(host);
            }
                        buildShell();
            setupSplitters();
            unifySearch();
            disableObDragInPro();
          } catch(e){}
        } else if (!document.getElementById('pr-topbar')) {
          // اگر topbar گم شده ولی host عوض نشده، فقط یکبار سعی کن بسازی (با debounce)
          if (!bodyObs._rebuildTimer) {
            bodyObs._rebuildTimer = setTimeout(function(){
              bodyObs._rebuildTimer=null;
              try{
                if (!document.getElementById('pr-topbar')) {
                   buildShell(); setupSplitters(); unifySearch(); disableObDragInPro();
                }
              }catch(e){}
            }, 200);
          }
        }
      });
      bodyObs.observe(document.body, {childList:true, subtree:true});
      // v1.24: نگهبان دوره‌ای ۸۰۰ms حذف شد — همین MutationObserver هر جایگزینی host/toggle را می‌بیند
      // و دکمهٔ شناور با قانون CSS (!important) در panel.html همیشه پنهان است.
      // بازگردانی پشتیبان (موتور رویداد می‌فرستد و خودش صفحه را بازخوانی می‌کند) — اینجا فقط دیدبان را تازه می‌کنیم
      window.addEventListener('tsext-backup-imported', function(){
        try { PR_PREFS_CACHE = null; } catch(e){}
        try { renderWatchlist(); } catch(e){}
      });
    });
  }

  // پیش‌فرض جدید: تم روشن
  function forceDarkIfNeeded(done) {
    var guard = 0;
    (function step() {
      var cur = host.getAttribute('data-tsext-theme');
      if (cur === 'light' || guard++ >= 4) { done(); return; }
      var cyc = document.getElementById('tsext-theme-cycle');
      if (cyc) { try { cyc.click(); } catch (e) {} }
      setTimeout(step, 35);
    })();
  }

  function hookThemeReapply() {
    var scheduled = false;
    var reapply = function () {
      if (scheduled) return;
      scheduled = true;
      setTimeout(function () { scheduled = false; applyNikiTheme(host); }, 0);
    };
    var cyc = document.getElementById('tsext-theme-cycle');
    if (cyc) cyc.addEventListener('click', reapply);
    host.addEventListener('click', function (e) {
      var t = e.target;
      if (t && t.closest && t.closest('.tsext-tab')) reapply();
    });
  }

  function disableObDragInPro() {
    try {
      var head = host.querySelector('.tsext-obpanel-head');
      if (!head) return;
      head.style.cursor = 'default';
      // جلوگیری از درگ پنل در حالت داک‌شده بدون حذف لیسنرهای زوم/بستن
      // با capture، قبل از makeDraggable موتور جلوی mousedown را می‌گیریم
      if (!head.__prDragBlocked) {
        head.__prDragBlocked = true;
        head.addEventListener('mousedown', function(e){
          if (e.target.closest && e.target.closest('button')) return;
          e.stopPropagation();
        }, true);
        head.addEventListener('touchstart', function(e){
          if (e.target.closest && e.target.closest('button')) return;
          e.stopPropagation();
        }, {capture:true, passive:false});
      }
      // اطمینان از اینکه دکمه‌های زوم هنوز کار می‌کنند (اگر قبلا کلون شده بودند، دوباره بایند کن)
      // در صورتی که قبلا کلون شده باشند، لیسنرهای اصلی از بین رفته‌اند — حالا دوباره متصل می‌کنیم
      try {
        var dec = host.querySelector('#tsext-ob-zoom-dec');
        var inc = host.querySelector('#tsext-ob-zoom-inc');
        if (dec && !dec.__prZoomBound) {
          dec.__prZoomBound = true;
          dec.addEventListener('click', function(){
            try {
              var v = Number(localStorage.getItem('tsext-ob-zoom') || '1');
              v = Math.max(0.6, Math.min(3, v - 0.2));
              localStorage.setItem('tsext-ob-zoom', String(Math.round(v*100)/100));
              var body = host.querySelector('#tsext-obpanel-body');
              if (body) body.style.zoom = String(Math.round(v*100)/100);
            } catch(e){}
          });
        }
        if (inc && !inc.__prZoomBound) {
          inc.__prZoomBound = true;
          inc.addEventListener('click', function(){
            try {
              var v = Number(localStorage.getItem('tsext-ob-zoom') || '1');
              v = Math.max(0.6, Math.min(3, v + 0.2));
              localStorage.setItem('tsext-ob-zoom', String(Math.round(v*100)/100));
              var body = host.querySelector('#tsext-obpanel-body');
              if (body) body.style.zoom = String(Math.round(v*100)/100);
            } catch(e){}
          });
        }
        // اعمال زوم ذخیره‌شده
        try {
          var curZ = Number(localStorage.getItem('tsext-ob-zoom') || '1');
          if (curZ && curZ>=0.6 && curZ<=3) {
            var obBody = host.querySelector('#tsext-obpanel-body');
            if (obBody) obBody.style.zoom = String(curZ);
          }
        } catch(e){}
      } catch(e){}
    } catch(e){}
  }

  function updateDetailVisibility(){
    // در حالت pro، نمایش obpanel با کلاس tsext-with-ob کنترل می‌شود و در CSS position:static است
    // چیزی لازم نیست، فقط اطمینان
  }

  /* ---------- اسپلِیترها ---------- */
  function setupSplitters(){
    if (!host) return;
    if (document.getElementById('pr-split-1')) return;
    // مقادیر پیش‌فرض بهینه‌شده: سایدبار 320، جزئیات 540 (کمتر از قبل 410 نبود، بلکه بزرگتر)
    var defSide = '300px', defDetail = '600px';
    try {
      var sSide = localStorage.getItem('pr-side-w-v4');
      var sDetail = localStorage.getItem('pr-detail-w-v4');
      if (sSide && /^\d+px$/.test(sSide)) defSide = sSide;
      if (sDetail && /^\d+px$/.test(sDetail)) defDetail = sDetail;
    } catch(e){}
    host.style.setProperty('--pr-side-w', defSide);
    host.style.setProperty('--pr-detail-w', defDetail);

    var s1 = mk('div'); s1.id='pr-split-1'; s1.className='pr-split pr-split-v';
    s1.title='بکشید تا عرض سایدبار تغییر کند';
    s1.innerHTML='<span class="pr-split-handle"></span>';
    var s2 = mk('div'); s2.id='pr-split-2'; s2.className='pr-split pr-split-v';
    s2.title='بکشید تا عرض پنل جزئیات تغییر کند';
    s2.innerHTML='<span class="pr-split-handle"></span>';
    host.appendChild(s1);
    host.appendChild(s2);

    // در حالت RTL جهت درگ برعکس است — تشخیص خودکار
    var isRTL = false;
    try { isRTL = getComputedStyle(host).direction === 'rtl'; } catch(e){}
    makeSplitterDrag(s1, function(dx){
      var cur = parseInt((host.style.getPropertyValue('--pr-side-w')|| defSide).replace('px',''),10) || 300;
      var eff = isRTL ? -dx : dx;
      var nw = cur + eff;
      nw = Math.max(220, Math.min(480, nw));
      host.style.setProperty('--pr-side-w', nw+'px');
      try{ localStorage.setItem('pr-side-w-v4', nw+'px'); }catch(e){}
    });
    makeSplitterDrag(s2, function(dx){
      var cur = parseInt((host.style.getPropertyValue('--pr-detail-w')|| defDetail).replace('px',''),10) || 480;
      var eff = isRTL ? -dx : dx;
      // s2 برعکس s1 عمل می‌کند (detail در سمت مخالف sidebar است)
      var nw = cur - eff;
      nw = Math.max(360, Math.min(900, nw));
      host.style.setProperty('--pr-detail-w', nw+'px');
      try{ localStorage.setItem('pr-detail-w-v4', nw+'px'); }catch(e){}
    });

    // دوبل‌کلیک برای ریست
    s1.addEventListener('dblclick', function(){
      host.style.setProperty('--pr-side-w','300px');
      try{ localStorage.removeItem('pr-side-w-v4'); }catch(e){}
    });
    s2.addEventListener('dblclick', function(){
      host.style.setProperty('--pr-detail-w','600px');
      try{ localStorage.removeItem('pr-detail-w-v4'); }catch(e){}
    });
  }

  function makeSplitterDrag(el, onMove){
    var startX=0, prevX=0, dragging=false, rafId=0, lastX=0;
    el.addEventListener('mousedown', function(e){
      e.preventDefault();
      startX = e.clientX;
      prevX = e.clientX;
      dragging = true;
      lastX = e.clientX;
      el.classList.add('dragging');
      document.body.classList.add('pr-col-resizing');
      document.body.style.userSelect='none';
      document.body.style.cursor='col-resize';
      // برای روانی بیشتر، will-change
      try{ host.style.willChange='grid-template-columns'; }catch(e){}
      function flush(){
        rafId=0;
        if(!dragging) return;
        // دلتای افزاینده از رویداد قبلی (نه تجمعی از نقطهٔ شروع) تا حرکت دقیق و دوطرفه باشد
        var d = lastX - prevX;
        prevX = lastX;
        if (d) onMove(d);
      }
      function onMm(ev){
        if(!dragging) return;
        lastX = ev.clientX;
        if(!rafId) rafId = requestAnimationFrame(flush);
      }
      function onMu(){
        if(rafId) { cancelAnimationFrame(rafId); rafId=0; }
        // آخرین دلتا را اعمال کن
        var d = lastX - prevX; prevX = lastX;
        if (d) onMove(d);
        dragging=false;
        el.classList.remove('dragging');
        document.body.classList.remove('pr-col-resizing');
        document.body.style.userSelect='';
        document.body.style.cursor='';
        try{ host.style.willChange='auto'; }catch(e){}
        window.removeEventListener('mousemove', onMm);
        window.removeEventListener('mouseup', onMu);
      }
      window.addEventListener('mousemove', onMm, {passive:true});
      window.addEventListener('mouseup', onMu);
    });
    // تاچ — روان با RAF
    el.addEventListener('touchstart', function(e){
      if(!e.touches || !e.touches[0]) return;
      startX = e.touches[0].clientX;
      dragging=true; lastDx=0;
      el.classList.add('dragging');
      try{ host.style.willChange='grid-template-columns'; }catch(e2){}
      var tRaf=0, tDx=0;
      function tFlush(){ tRaf=0; if(dragging) onMove(tDx); }
      function onTm(ev){
        if(!dragging) return;
        tDx = ev.touches[0].clientX - startX;
        if(!tRaf) tRaf = requestAnimationFrame(tFlush);
        // جلوگیری از اسکرول صفحه هنگام درگ
        if(Math.abs(tDx)>4) ev.preventDefault();
      }
      function onTe(){
        if(tRaf) { cancelAnimationFrame(tRaf); tRaf=0; }
        onMove(tDx);
        dragging=false; el.classList.remove('dragging');
        try{ host.style.willChange='auto'; }catch(e2){}
        window.removeEventListener('touchmove', onTm);
        window.removeEventListener('touchend', onTe);
      }
      window.addEventListener('touchmove', onTm, {passive:false});
      window.addEventListener('touchend', onTe);
    }, {passive:true});
  }

  /* ---------- هم‌ترازی سرستون‌ها (scroll sync) ---------- */
  function setupScrollSync(){
    try{
      var hdr = document.getElementById('tsext-list-hdr');
      var body = document.getElementById('tsext-list-body');
      if(!hdr || !body || hdr.__prSync) return;
      hdr.__prSync = true;
      var ticking = false;
      body.addEventListener('scroll', function(){
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(function(){
          ticking = false;
          try{ hdr.scrollLeft = body.scrollLeft; }catch(e){}
        });
      }, {passive:true});
      hdr.addEventListener('scroll', function(){
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(function(){
          ticking = false;
          try{ body.scrollLeft = hdr.scrollLeft; }catch(e){}
        });
      }, {passive:true});
      // با تغییر ستون‌ها، عرض را دوباره هم‌تراز کن
      var ro = new MutationObserver(function(){ try{ hdr.scrollLeft = body.scrollLeft; }catch(e){} });
      ro.observe(body, {childList:true, subtree:true});
      // درگ ستون‌ها نیز باید sync را حفظ کند
      window.addEventListener('resize', function(){ try{ hdr.scrollLeft = body.scrollLeft; }catch(e){} });
    }catch(e){}
  }

  /* ---------- دیدبان چندنمادی (watchlist) ---------- */
  var WATCH_KEY = 'pr-watchlist-v2';
  var WATCH_ACTIVE_KEY = 'pr-watchlist-active';
  var WATCH_SETTINGS_KEY = 'pr-watchlist-settings-v2';
  var _activeWatchTerm = null;
  // ماندگاری: localStorage + chrome.storage.local (تا پاک‌شدن دادهٔ مرورگر/اکستنشن)
  var _watchlistCache = null;
  var _watchSettingsCache = null;
  function _chromeStorageSet(obj) {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set(obj, function () {});
      }
    } catch (e) {}
  }
  function loadWatchlist(){
    if (Array.isArray(_watchlistCache)) return _watchlistCache.slice();
    try{
      var raw = localStorage.getItem(WATCH_KEY);
      if(!raw) return [];
      var arr = JSON.parse(raw);
      var list = Array.isArray(arr) ? arr.filter(function(x){ return typeof x==='string' && x.trim(); }).map(function(x){ return x.trim(); }) : [];
      _watchlistCache = list;
      return list.slice();
    }catch(e){ return []; }
  }
  function saveWatchlist(list){
    var clean = Array.isArray(list) ? list.filter(function(x){ return typeof x==='string' && x.trim(); }).map(function(x){ return x.trim(); }) : [];
    _watchlistCache = clean;
    try{ localStorage.setItem(WATCH_KEY, JSON.stringify(clean)); }catch(e){}
    var o = {}; o[WATCH_KEY] = clean; _chromeStorageSet(o);
  }
  function loadWatchSettingsMap(){
    if (_watchSettingsCache && typeof _watchSettingsCache === 'object') return Object.assign({}, _watchSettingsCache);
    try{
      var raw = localStorage.getItem(WATCH_SETTINGS_KEY);
      var map = raw ? JSON.parse(raw) : {};
      if (!map || typeof map !== 'object') map = {};
      _watchSettingsCache = map;
      return Object.assign({}, map);
    }catch(e){ return {}; }
  }
  function saveWatchSettingsMap(map){
    var m = map && typeof map === 'object' ? map : {};
    _watchSettingsCache = m;
    try{ localStorage.setItem(WATCH_SETTINGS_KEY, JSON.stringify(m)); }catch(e){}
    var o = {}; o[WATCH_SETTINGS_KEY] = m; _chromeStorageSet(o);
  }
  /** بازیابی دیدبان از chrome.storage (اگر localStorage خالی بود) — یک‌بار در راه‌اندازی */
  function hydrateWatchlistFromChrome(done) {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
        if (done) done();
        return;
      }
      chrome.storage.local.get([WATCH_KEY, WATCH_SETTINGS_KEY, WATCH_ACTIVE_KEY], function (res) {
        try {
          if (res && Array.isArray(res[WATCH_KEY]) && res[WATCH_KEY].length) {
            var cur = loadWatchlist();
            if (!cur.length) {
              saveWatchlist(res[WATCH_KEY]);
            }
          }
          if (res && res[WATCH_SETTINGS_KEY] && typeof res[WATCH_SETTINGS_KEY] === 'object') {
            var sm = loadWatchSettingsMap();
            if (!Object.keys(sm).length) saveWatchSettingsMap(res[WATCH_SETTINGS_KEY]);
          }
          if (res && res[WATCH_ACTIVE_KEY] && !localStorage.getItem(WATCH_ACTIVE_KEY)) {
            try { localStorage.setItem(WATCH_ACTIVE_KEY, String(res[WATCH_ACTIVE_KEY])); } catch (e2) {}
          }
        } catch (e3) {}
        if (done) done();
      });
    } catch (e) { if (done) done(); }
  }
  function collectCurrentSettingsSnapshot(){
    try{
      var snap = { ts: Date.now(), inputs:{} , activeStrategy:null };
      var activeTab = host && host.querySelector && host.querySelector('#tsext-tabs .tsext-tab.active');
      snap.activeStrategy = activeTab ? activeTab.getAttribute('data-s') : null;
      // تمام input/select های داخل پنل استراتژی
      var nodes = host ? host.querySelectorAll('#tsext-head input, #tsext-head select') : [];
      for(var i=0;i<nodes.length;i++){
        var el = nodes[i];
        if(!el.id) continue;
        // underlying را جداگانه مدیریت می‌کنیم
        if(/^tsext-underlying-/.test(el.id)) continue;
        snap.inputs[el.id] = el.value;
        if(el.type==='checkbox') snap.inputs[el.id] = el.checked ? '1':'0';
      }
      // حالت‌های خاص jamp/tick
      try{
        var jampMode = host.querySelector('.tsext-jamp-mode.active, .tsext-jamp-tab.active');
        if(jampMode) snap.jampMode = jampMode.getAttribute('data-jamp') || jampMode.getAttribute('data-mode') || null;
      }catch(e){}
      return snap;
    }catch(e){ return null; }
  }
  function applySettingsSnapshot(snap){
    if(!snap || !snap.inputs) return;
    try{
      Object.keys(snap.inputs).forEach(function(id){
        var el = document.getElementById(id);
        if(!el) return;
        var v = snap.inputs[id];
        if(el.type==='checkbox') el.checked = v==='1';
        else el.value = v;
        try{ el.dispatchEvent(new Event('input', {bubbles:true})); }catch(e){}
        try{ el.dispatchEvent(new Event('change', {bubbles:true})); }catch(e){}
      });
      if(snap.activeStrategy){
        var tab = host.querySelector('#tsext-tabs .tsext-tab[data-s="'+snap.activeStrategy+'"]');
        if(tab && !tab.classList.contains('active')){
          try{ tab.click(); }catch(e){}
        }
      }
    }catch(e){}
  }
  function saveCurrentWatchSettings(){
    if(!_activeWatchTerm) return;
    try{
      var map = loadWatchSettingsMap();
      var snap = collectCurrentSettingsSnapshot();
      if(snap) {
        map[_activeWatchTerm] = snap;
        saveWatchSettingsMap(map);
      }
    }catch(e){}
  }
  function debounceSaveCurrentWatchSettings(){
    clearTimeout(saveCurrentWatchSettings._t);
    saveCurrentWatchSettings._t = setTimeout(saveCurrentWatchSettings, 400);
  }
  // امتیاز فرصت هر نماد (برای رنگ نقطهٔ چیپ) — توسط موتور هنگام رندر لیست پر می‌شود
  var _chipScores = Object.create(null);
  function setChipScore(term, score) {
    term = String(term || '').trim();
    if (!term) return;
    _chipScores[term] = (typeof score === 'number' && isFinite(score)) ? score : 0;
    try {
      var chip = document.querySelector('#pr-wl-chips .pr-wl-chip[data-term="' + term.replace(/"/g, '') + '"]');
      if (chip) {
        var dot = chip.querySelector('.pr-wl-dot');
        if (dot) {
          chip.classList.toggle('has-opp', score > 0);
          chip.classList.toggle('no-opp', !(score > 0));
          dot.title = score > 0 ? ('بهترین فرصت ≈ ' + (Math.round(score * 10) / 10) + '٪') : 'فرصت برجسته‌ای نیست';
        }
      }
    } catch (e) {}
  }
  try { window.__prSetChipScore = setChipScore; } catch (e) {}
  function renderWatchlist(){
    var wrap = document.getElementById('pr-wl-chips');
    if(!wrap) return;
    var list = loadWatchlist();
    wrap.innerHTML = '';
    // دکمه پاک‌کردن دیدبان
    try {
      var head = document.querySelector('#pr-watchlist .pr-wl-head');
      if (head) {
        var clr = head.querySelector('#pr-wl-clear');
        if (!clr) {
          clr = mk('button');
          clr.id = 'pr-wl-clear';
          clr.type = 'button';
          clr.className = 'pr-wl-clear';
          clr.textContent = 'پاک کردن';
          clr.title = 'حذف همهٔ نمادهای دیدبان';
          clr.addEventListener('click', function(e){
            e.preventDefault(); e.stopPropagation();
            if (!loadWatchlist().length) return;
            if (!confirm('همهٔ نمادهای دیدبان پاک شوند؟')) return;
            try { localStorage.setItem(WATCH_KEY, '[]'); } catch (e2) {}
            try { localStorage.removeItem(WATCH_ACTIVE_KEY); } catch (e2) {}
            try { _watchlistCache = []; var _cl={}; _cl[WATCH_KEY]=[]; _cl[WATCH_ACTIVE_KEY]=''; _chromeStorageSet(_cl); } catch (e2) {}
            _activeWatchTerm = null;
            _chipScores = Object.create(null);
            renderWatchlist();
            try {
              var body = document.getElementById('tsext-list-body');
              if (body) body.innerHTML = '<div class="tsext-empty tsext-empty-guide"><div class="tsext-empty-title">دیدبان خالی شد</div></div>';
              var st = document.getElementById('tsext-status');
              if (st) st.textContent = 'دیدبان خالی — نماد اضافه کنید';
            } catch (e3) {}
          });
          head.appendChild(clr);
        }
        clr.style.display = list.length ? '' : 'none';
      }
    } catch (e) {}
    if(!list.length){
      var empty = mk('span'); empty.className='pr-wl-empty'; empty.textContent='هنوز نمادی اضافه نکرده‌اید — نام نماد پایه را بنویسید و Enter بزنید';
      wrap.appendChild(empty);
      return;
    }
    list.forEach(function(term, idx){
      var score = _chipScores[term];
      var chip = mk('div');
      chip.className = 'pr-wl-chip' + (term===_activeWatchTerm ? ' is-active':'') + (score > 0 ? ' has-opp' : ' no-opp');
      chip.setAttribute('data-term', term);
      chip.setAttribute('draggable', 'true');
      chip.setAttribute('data-idx', String(idx));
      var dot = mk('span'); dot.className='pr-wl-dot';
      if (score > 0) dot.title = 'بهترین فرصت ≈ ' + (Math.round(score * 10) / 10) + '٪';
      else dot.title = 'فرصت برجسته‌ای ثبت نشده';
      var label = mk('span'); label.className='pr-wl-chip-label'; label.textContent = term;
      var close = mk('button'); close.className='pr-wl-chip-close'; close.type='button'; close.textContent='✕'; close.title='حذف';
      close.addEventListener('click', function(e){
        e.stopPropagation();
        removeWatchSymbol(term);
      });
      chip.appendChild(dot); chip.appendChild(label); chip.appendChild(close);
      chip.addEventListener('click', function(){ switchWatchSymbol(term); });
      // drag reorder
      chip.addEventListener('dragstart', function(e){
        try {
          e.dataTransfer.setData('text/plain', term);
          e.dataTransfer.effectAllowed = 'move';
          chip.classList.add('is-dragging');
        } catch (e2) {}
      });
      chip.addEventListener('dragend', function(){ chip.classList.remove('is-dragging'); });
      chip.addEventListener('dragover', function(e){ e.preventDefault(); chip.classList.add('drag-over'); });
      chip.addEventListener('dragleave', function(){ chip.classList.remove('drag-over'); });
      chip.addEventListener('drop', function(e){
        e.preventDefault();
        chip.classList.remove('drag-over');
        var from = '';
        try { from = e.dataTransfer.getData('text/plain'); } catch (e2) {}
        if (!from || from === term) return;
        var cur = loadWatchlist();
        var fi = cur.indexOf(from);
        var ti = cur.indexOf(term);
        if (fi < 0 || ti < 0) return;
        cur.splice(fi, 1);
        cur.splice(ti, 0, from);
        saveWatchlist(cur);
        renderWatchlist();
      });
      wrap.appendChild(chip);
    });
  }
  function showWatchMsg(msg){
    msg = String(msg || '').trim();
    if (!msg) return;
    try {
      // ۱) نوار وضعیت
      var st = document.getElementById('tsext-status');
      if (st) st.textContent = msg;
      // ۲) ناحیهٔ لیست — همیشه پیام را نشان بده (حتی اگر نماد قبلی باز باشد)
      var body = document.getElementById('tsext-list-body');
      if (body) {
        // v1.24 (بازبینی امنیتی): متن پیام با textContent — حتی اگر روزی msg از داده بیاید، HTML تفسیر نمی‌شود
        body.innerHTML = '';
        var box = mk('div'); box.className = 'tsext-empty';
        box.style.cssText = 'padding:18px 12px;text-align:center;font-weight:800;line-height:1.9';
        box.textContent = msg;
        body.appendChild(box);
      }
      var hdr = document.getElementById('tsext-list-hdr');
      if (hdr) hdr.innerHTML = '';
      // ۳) پیام کنار ورودی دیدبان
      var addWrap = document.querySelector('#pr-watchlist .pr-wl-add') || document.getElementById('pr-watchlist');
      if (addWrap) {
        var tip = document.getElementById('pr-wl-msg');
        if (!tip) {
          tip = document.createElement('div');
          tip.id = 'pr-wl-msg';
          tip.setAttribute('role', 'alert');
          tip.style.cssText = 'width:100%;margin-top:6px;padding:6px 10px;border-radius:8px;font-size:12px;font-weight:800;line-height:1.6;text-align:center;background:color-mix(in srgb,#ef4444 12%,transparent);color:#b91c1c;border:1px solid color-mix(in srgb,#ef4444 35%,transparent);';
          addWrap.appendChild(tip);
        }
        tip.textContent = msg;
        tip.style.display = 'block';
        clearTimeout(tip._hideT);
        tip._hideT = setTimeout(function(){ try { tip.style.display = 'none'; } catch(e){} }, 5000);
      }
    } catch (e) {}
  }
  function clearWatchMsg(){
    try {
      var tip = document.getElementById('pr-wl-msg');
      if (tip) tip.style.display = 'none';
    } catch (e) {}
  }
  function resolveUnderlying(term){
    return new Promise(function(resolve){
      var tries = 0;
      function attempt(){
        try {
          var fn = null;
          if (typeof window.__tsextResolveOptionUnderlying === 'function') fn = window.__tsextResolveOptionUnderlying;
          else if (window.__tsetmcInternals && typeof window.__tsetmcInternals.resolveOptionUnderlying === 'function')
            fn = window.__tsetmcInternals.resolveOptionUnderlying;
          if (!fn) {
            if (tries++ < 15) { setTimeout(attempt, 200); return; }
            resolve({ ok: false, reason: 'error' });
            return;
          }
          Promise.resolve(fn(term)).then(resolve).catch(function(){ resolve({ ok: false, reason: 'error' }); });
        } catch (e) { resolve({ ok: false, reason: 'error' }); }
      }
      attempt();
    });
  }
  // فقط نمادهای دارای اختیار به دیدبان اضافه می‌شوند
  function addWatchSymbol(term, opts){
    term = (term||'').trim();
    if(!term) return Promise.resolve(false);
    opts = opts || {};
    var list = loadWatchlist();
    var exists = list.some(function(x){ return x===term; });
    if(exists){
      if(!opts.silent) { clearWatchMsg(); switchWatchSymbol(term); }
      return Promise.resolve(false);
    }
    // اعتبارسنجی: نماد باید اختیار معامله داشته باشد
    return resolveUnderlying(term).then(function(res){
      if (!res || !res.ok) {
        if (!opts.silent) {
          if (res && res.reason === 'no_options')
            showWatchMsg('قرارداد اختیار معامله برای این نماد یافت نشد');
          else if (res && res.reason === 'not_found')
            showWatchMsg('نمادی با این نام وجود ندارد');
          else
            showWatchMsg('نمادی با این نام وجود ندارد');
        }
        return false;
      }
      var finalName = (res.name || term).trim();
      // اگر با نام استاندارد از قبل در لیست باشد
      if (list.some(function(x){ return x === finalName; })) {
        if (!opts.silent) { clearWatchMsg(); switchWatchSymbol(finalName); }
        return false;
      }
      clearWatchMsg();
      saveCurrentWatchSettings();
      list.push(finalName);
      saveWatchlist(list);
      _activeWatchTerm = finalName;
      try{ localStorage.setItem(WATCH_ACTIVE_KEY, finalName); }catch(e){}
      try{ var _ao={}; _ao[WATCH_ACTIVE_KEY]=finalName; _chromeStorageSet(_ao); }catch(e){}
      renderWatchlist();
      var gs = document.getElementById('pr-search');
      if(gs) gs.value = finalName;
      forwardSearch(finalName);
      return true;
    });
  }
  function removeWatchSymbol(term){
    var list = loadWatchlist();
    var idx = list.indexOf(term);
    if(idx===-1) return;
    list.splice(idx,1);
    saveWatchlist(list);
    var map = loadWatchSettingsMap();
    if(map[term]) { delete map[term]; saveWatchSettingsMap(map); }
    if(_activeWatchTerm===term){
      _activeWatchTerm = list[0] || null;
      try{ if(_activeWatchTerm) localStorage.setItem(WATCH_ACTIVE_KEY, _activeWatchTerm); else localStorage.removeItem(WATCH_ACTIVE_KEY); }catch(e){}
      try{ var _ao2={}; if(_activeWatchTerm) _ao2[WATCH_ACTIVE_KEY]=_activeWatchTerm; else _ao2[WATCH_ACTIVE_KEY]=''; _chromeStorageSet(_ao2); }catch(e){}
      if(_activeWatchTerm){
        renderWatchlist();
        var gs = document.getElementById('pr-search');
        if(gs) gs.value = _activeWatchTerm;
        var snap = loadWatchSettingsMap()[_activeWatchTerm];
        if(snap) applySettingsSnapshot(snap);
        forwardSearch(_activeWatchTerm);
      } else {
        renderWatchlist();
        var gs2 = document.getElementById('pr-search');
        if(gs2) gs2.value = '';
        // نمایش راهنما
        try{
          var body = document.getElementById('tsext-list-body');
          if(body) body.innerHTML = '<div class=\"tsext-empty tsext-empty-guide\"><div class=\"tsext-empty-title\">دیدبان چندنمادی</div><div style=\"font-size:11px;color:var(--tsext-muted);text-align:center;line-height:1.8\">نمادی انتخاب کنید یا از بالا جستجو کنید — هر نماد صفحه و تنظیمات جداگانه دارد.</div></div>';
          var hdr = document.getElementById('tsext-list-hdr'); if(hdr) hdr.innerHTML='';
          var st = document.getElementById('tsext-status'); if(st) st.textContent = 'دیدبان خالی — نماد اضافه کنید';
        }catch(e){}
      }
    } else {
      renderWatchlist();
    }
  }
  function switchWatchSymbol(term, opts){
    term = (term||'').trim();
    if(!term) return;
    var same = (term === _activeWatchTerm);
    // ذخیره تنظیمات قبلی (فقط وقتی واقعاً عوض می‌شود)
    if(!same) {
      try { saveCurrentWatchSettings(); } catch(e){}
      // بستن فوری جزئیات نماد قبلی
      try {
        if (typeof window.__tsextCloseDetail === 'function') window.__tsextCloseDetail();
        else if (window.__tsetmcInternals && typeof window.__tsetmcInternals.closeOrderBookPanel === 'function')
          window.__tsetmcInternals.closeOrderBookPanel();
      } catch(e){}
    }
    _activeWatchTerm = term;
    try{ localStorage.setItem(WATCH_ACTIVE_KEY, term); }catch(e){}
    try{ var _ao3={}; _ao3[WATCH_ACTIVE_KEY]=term; _chromeStorageSet(_ao3); }catch(e){}
    // UI چیپ‌ها فوری
    renderWatchlist();
    var gs = document.getElementById('pr-search');
    if(gs) gs.value = term;
    // تنظیمات ذخیره‌شده — بدون طوفان event (فقط value)
    var map = loadWatchSettingsMap();
    var snap = map[term];
    if(snap && snap.inputs) {
      try {
        Object.keys(snap.inputs).forEach(function(id){
          var el = document.getElementById(id);
          if(!el) return;
          if(/^tsext-underlying-/.test(id)) return;
          var v = snap.inputs[id];
          if(el.type==='checkbox') el.checked = v==='1';
          else el.value = v;
        });
        if(snap.activeStrategy) {
          var tab = document.querySelector('#tsext-tabs .tsext-tab[data-s="'+snap.activeStrategy+'"]');
          if(tab && !tab.classList.contains('active')) try{ tab.click(); }catch(e){}
        }
      } catch(e){}
    }
    ['pospanj','combo','jamp','tick'].forEach(function(s){
      var inp = document.getElementById('tsext-underlying-'+s);
      if(inp) inp.value = term;
    });
    // بارگذاری سریع از API موتور
    loadSymbolFast(term, { force: !same || (opts && opts.force) });
  }
  function loadSymbolFast(term, opts){
    term = (term||'').trim();
    if(!term) return;
    try {
      if (typeof window.__tsextLoadSymbol === 'function') {
        window.__tsextLoadSymbol(term, opts || { force: true });
        return;
      }
      if (window.__tsetmcInternals && typeof window.__tsetmcInternals.loadSymbol === 'function') {
        window.__tsetmcInternals.loadSymbol(term, Object.assign({ force: true, syncAll: true }, opts || {}));
        return;
      }
    } catch(e){}
    // fallback قدیمی
    try { forwardSearch(term); } catch(e){}
  }
  // اطمینان از بارگذاری دادهٔ نماد فعال (بعد از بازگشت/ریلود)
  function ensureActiveSymbolData(term){
    term = (term || _activeWatchTerm || '').trim();
    if(!term) return;
    ['pospanj','combo','jamp','tick'].forEach(function(s){
      var inp = document.getElementById('tsext-underlying-'+s);
      if(inp) inp.value = term;
    });
    var gs = document.getElementById('pr-search');
    if(gs) gs.value = term;
    loadSymbolFast(term, { force: true });
    // یک retry کوتاه اگر هنوز خالی است
    setTimeout(function(){
      try {
        var body = document.getElementById('tsext-list-body');
        var empty = !body || !body.querySelector('.tsext-bar');
        if(empty) loadSymbolFast(term, { force: true });
      } catch(e){}
    }, 400);
    setTimeout(function(){
      try {
        var body = document.getElementById('tsext-list-body');
        var empty = !body || !body.querySelector('.tsext-bar');
        if(empty) loadSymbolFast(term, { force: true });
      } catch(e){}
    }, 1000);
  }
  function setupWatchlist(){
    if(document.getElementById('pr-watchlist')) return;
    // بازیابی از chrome.storage اگر localStorage خالی باشد
    hydrateWatchlistFromChrome(function(){ try{ renderWatchlist(); }catch(e){} });
    // بار را بعد از topbar و قبل از wlbar بساز
    var wlbar = document.getElementById('pr-wlbar');
    var bar = mk('div'); bar.id='pr-watchlist';
    bar.innerHTML = '<div class=\"pr-wl-head\" title=\"دیدبان چندنمادی — هر نماد صفحه و تنظیمات جداگانه\">'
      + '<span class=\"pr-wl-title\">دیدبان</span>'
      + '<span id=\"pr-wl-mkt\" class=\"pr-wl-mkt\" title=\"وضعیت بازار\">—</span>'
      + '</div>'
      + '<div class=\"pr-wl-add\"><input id=\"pr-wl-input\" placeholder=\"نماد پایه\" autocomplete=\"off\" spellcheck=\"false\"><button id=\"pr-wl-add-btn\" type=\"button\" title=\"افزودن نماد پایه به دیدبان\">＋ افزودن</button></div>'
      + '<div class=\"pr-wl-chips\" id=\"pr-wl-chips\"></div>';
    var tb = document.getElementById('pr-topbar');
    if(tb && tb.parentNode){
      tb.parentNode.insertBefore(bar, tb.nextSibling);
    } else if(wlbar && wlbar.parentNode){
      wlbar.parentNode.insertBefore(bar, wlbar);
    } else {
      host.appendChild(bar);
    }
    var input = document.getElementById('pr-wl-input');
    var btn = document.getElementById('pr-wl-add-btn');
    // تضمین کنتراست دکمه افزودن در همه تم‌ها
    if (btn) {
      try {
        btn.style.setProperty('color', '#ffffff', 'important');
        btn.style.setProperty('-webkit-text-fill-color', '#ffffff', 'important');
        btn.style.setProperty('background', '#1d4ed8', 'important');
        btn.style.setProperty('opacity', '1', 'important');
        btn.style.setProperty('font-weight', '900', 'important');
      } catch (e) {}
    }
    function doAdd(){
      var v = (input.value||'').trim();
      if(!v) return;
      var inp = input;
      if (inp) { inp.disabled = true; inp.classList.add('is-busy'); }
      addWatchSymbol(v).then(function(ok){
        if (inp) {
          inp.disabled = false;
          inp.classList.remove('is-busy');
          if (ok) inp.value = '';
          try { inp.focus(); } catch (e) {}
        }
      }).catch(function(){
        if (inp) { inp.disabled = false; inp.classList.remove('is-busy'); }
      });
    }
    if(input){
      // پیشنهاد خودکار نمادهای دارای اختیار روی ورودی دیدبان
      var tryBindWl = function(){
        try {
          if (window.__tsetmcInternals && typeof window.__tsetmcInternals.bindUaAutocomplete === 'function') {
            window.__tsetmcInternals.bindUaAutocomplete(input);
            return true;
          }
        } catch (e) {}
        return false;
      };
      if (!tryBindWl()) {
        var tries = 0;
        var tmr = setInterval(function(){
          tries++;
          if (tryBindWl() || tries > 25) clearInterval(tmr);
        }, 200);
      }
      input.addEventListener('focus', function(){ tryBindWl(); });
      input.addEventListener('tsext-ua-picked', function(ev){
        var name = (ev && ev.detail && ev.detail.name) || (input.value || '').trim();
        if (!name) return;
        addWatchSymbol(name).then(function(ok){
          if (ok) input.value = '';
        }).catch(function(){});
      });
      input.addEventListener('keydown', function(e){
        if(e.key==='Enter'){
          // اگر لیست پیشنهاد باز است، انتخاب پیشنهاد اولویت دارد
          var box = document.getElementById('tsext-ua-suggest');
          if (box && box.style.display !== 'none' && box._items && box._items.length) {
            // bindUaAutocomplete خودش pick می‌کند؛ فقط از doAdd جلوگیری کن
            e.preventDefault();
            return;
          }
          e.preventDefault();
          doAdd();
        }
      });
    }
    if(btn) btn.addEventListener('click', doAdd);
    // مقدار فعال قبلی را بازیابی کن
    try{
      var savedActive = localStorage.getItem(WATCH_ACTIVE_KEY);
      var list = loadWatchlist();
      if(savedActive && list.indexOf(savedActive)!==-1){
        _activeWatchTerm = savedActive;
      } else if(list.length){
        _activeWatchTerm = list[0];
      }
      // اگر سرچ سراسری پر است و watchlist خالی، آن را اضافه کن
      var gsVal = (document.getElementById('pr-search')?.value||'').trim();
      if(!list.length && gsVal){
        addWatchSymbol(gsVal, {silent:true});
        _activeWatchTerm = gsVal;
      } else if(_activeWatchTerm){
        var gs2 = document.getElementById('pr-search');
        if(gs2 && !_activeWatchTerm) {} // no
      }
    }catch(e){}
    renderWatchlist();
    if(_activeWatchTerm){
      var gs3 = document.getElementById('pr-search');
      if(gs3) gs3.value = _activeWatchTerm;
      ['pospanj','combo','jamp','tick'].forEach(function(s){
        var inp = document.getElementById('tsext-underlying-'+s);
        if(inp) inp.value = _activeWatchTerm;
      });
      // فوری + یک retry
      ensureActiveSymbolData(_activeWatchTerm);
      setTimeout(function(){ ensureActiveSymbolData(_activeWatchTerm); }, 350);
    }
    // ذخیره خودکار تنظیمات هنگام تغییر ورودی‌ها
    try{
      var head = document.getElementById('tsext-head');
      if(head && !head.__prWatchHook){
        head.__prWatchHook = true;
        head.addEventListener('input', debounceSaveCurrentWatchSettings);
        head.addEventListener('change', debounceSaveCurrentWatchSettings);
        // کلیک تب نیز
        var tabs = host.querySelector('#tsext-tabs');
        if(tabs) tabs.addEventListener('click', function(){
          setTimeout(debounceSaveCurrentWatchSettings, 100);
        });
      }
    }catch(e){}
    // همگام‌سازی با سرچ سراسری: وقتی کاربر در سرچ Enter زد، به واچ‌لیست اضافه کن
    try{
      var gsGlobal = document.getElementById('pr-search');
      if(gsGlobal && !gsGlobal.__prWatchSync){
        gsGlobal.__prWatchSync = true;
        gsGlobal.addEventListener('keydown', function(e){
          if(e.key==='Enter'){
            var v = (gsGlobal.value||'').trim();
            if(v){
              var list2 = loadWatchlist();
              if(list2.indexOf(v)===-1){
                // ذخیره فعلی
                saveCurrentWatchSettings();
                // اضافه بدون fetch دوباره (چون forwardSearch خودش می‌ره)
                list2.push(v);
                saveWatchlist(list2);
                _activeWatchTerm = v;
                try{ localStorage.setItem(WATCH_ACTIVE_KEY, v); }catch(e){}
                renderWatchlist();
              } else {
                // اگر وجود داشت، فقط فعال کن
                if(v!==_activeWatchTerm){
                  saveCurrentWatchSettings();
                  _activeWatchTerm = v;
                  try{ localStorage.setItem(WATCH_ACTIVE_KEY, v); }catch(e){}
                  renderWatchlist();
                }
              }
            }
          }
        });
      }
    }catch(e){}
  }

  /* ---------- یکپارچه‌سازی سرچ ---------- */
  function unifySearch(){
    // ورودی‌های تکراری را مقداردهی و از نظر بصری مخفی نگه می‌داریم (CSS display:none)
    // اما منطق موتور را با sync کردن حفظ می‌کنیم.
    var globalSearch = document.getElementById('pr-search');
    if (!globalSearch) return;

    // اگر کاربر در موتور تب عوض کرد، مقدار global را به آن تب هم sync کن
    var syncAll = function(term){
      if (term==null) return;
      ['pospanj','combo','jamp','tick'].forEach(function(s){
        var inp = document.getElementById('tsext-underlying-'+s);
        if (inp) inp.value = term;
      });
    };
    // مقدار اولیه: اگر یکی از ورودی‌های موتور پر است، آن را به global منتقل کن
    try{
      var existing = '';
      ['pospanj','combo','jamp','tick'].forEach(function(s){
        var inp=document.getElementById('tsext-underlying-'+s);
        if(inp && inp.value && !existing) existing = inp.value.trim();
      });
      if(existing) globalSearch.value = existing;
    }catch(e){}

    // با تایپ در global، همه را آپدیت کن (بدون درخواست تا Enter)
    globalSearch.addEventListener('input', function(){
      syncAll(globalSearch.value);
      // برای تجربه نرم‌تر، حین تایپ border را آپدیت نکنیم
    });
    // برای سازگاری تاریخچه مرورگر
    globalSearch.addEventListener('change', function(){ syncAll(globalSearch.value); });
    // پیشنهاد خودکار نمادهای دارای اختیار (مثل گوگل)
    var tryBindSuggest = function(){
      try {
        if (window.__tsetmcInternals && typeof window.__tsetmcInternals.bindUaAutocomplete === 'function') {
          window.__tsetmcInternals.bindUaAutocomplete(globalSearch);
          return true;
        }
      } catch (e) {}
      return false;
    };
    if (!tryBindSuggest()) {
      var tries = 0;
      var tmr = setInterval(function(){
        tries++;
        if (tryBindSuggest() || tries > 20) clearInterval(tmr);
      }, 250);
    }
    globalSearch.addEventListener('focus', function(){ tryBindSuggest(); });
  }

  /* ---------- اسکلت جدید ---------- */
  function buildShell() {
    if (document.getElementById('pr-topbar')) return;

    var topbar = mk('div'); topbar.id = 'pr-topbar';

    var brand = $('.tsext-brand', host);
    if (brand) topbar.appendChild(brand);
    else {
      var b = mk('div'); b.className='tsext-brand';
      var logo = mk('div'); logo.className='tsext-logo'; logo.textContent='◈';
      var tt = mk('div');
      var t1 = mk('div'); t1.className='tsext-title'; t1.textContent='دستیار هوشمند آپشن';
      var t2 = mk('div'); t2.className='tsext-subtitle'; t2.textContent='نسخه حرفه‌ای';
      tt.appendChild(t1); tt.appendChild(t2);
      b.appendChild(logo); b.appendChild(tt);
      topbar.appendChild(b);
    }

    var search = mk('input'); search.id = 'pr-search';
    search.placeholder = 'جستجوی نماد پایه (مثلاً خساپا) ↵';
    search.setAttribute('type', 'text');
    search.setAttribute('autocomplete', 'off');
    search.setAttribute('dir', 'rtl');
    search.setAttribute('spellcheck','false');
    topbar.appendChild(search);

    // کپسول بازار در topbar (مینی) — حذف شد؛ اطلاعات کامل شاخص‌ها/بازار به‌صورت چیپ‌ها در همان نوار بالا می‌نشیند
    var rightGroup = mk('div'); rightGroup.id='pr-top-right';
    var market = mk('span'); market.id = 'pr-market';
    market.textContent='—';
    rightGroup.appendChild(market);

    var clockWrap = mk('div'); clockWrap.id = 'pr-clock-wrap';
    var clock = mk('span'); clock.id = 'pr-clock';
    var clockSub = mk('span'); clockSub.id = 'pr-clock-sub'; clockSub.textContent = 'تهران';
    clockWrap.appendChild(clock); clockWrap.appendChild(clockSub);
    rightGroup.appendChild(clockWrap);

    var tools = mk('div'); tools.id = 'pr-tools';
    ['tsext-theme-cycle', 'tsext-backup-btn'].forEach(function (id) {
      var b = document.getElementById(id);
      if (b) tools.appendChild(b);
    });
    rightGroup.appendChild(tools);

    var closeBtn = mk('button'); closeBtn.id = 'pr-close'; closeBtn.type = 'button';
    closeBtn.title = 'بستن تب'; closeBtn.textContent = '✕';
    var closeNote = mk('span'); closeNote.id = 'pr-close-note';
    closeNote.textContent = 'می‌توانید این تب را ببندید';
    closeBtn.addEventListener('click', function () {
      try { window.close(); } catch (e) {}
      setTimeout(function () { closeNote.style.display = 'inline'; }, 500);
    });
    rightGroup.appendChild(closeBtn);
    topbar.appendChild(rightGroup);
    topbar.appendChild(closeNote);

    // نوار سلب‌مسئولیت — بالاترین ردیف، همیشه ثابت و دیده
    var disc = document.getElementById('pr-disclaimer-bar');
    if (!disc) {
      disc = mk('div');
      disc.id = 'pr-disclaimer-bar';
      disc.setAttribute('role', 'note');
      disc.setAttribute('aria-live', 'polite');
      disc.title = 'این افزونه صرفاً محاسباتی و اطلاعاتی است و توصیهٔ خرید یا فروش نیست. تصمیم معاملاتی با شماست.';
      disc.innerHTML = '<span class="pr-disc-icon" aria-hidden="true">⚠</span><span class="pr-disc-text">سلب مسئولیت: ابزار محاسباتی است · توصیهٔ معاملاتی / خرید و فروش نیست · تصمیم با شماست</span>';
    }
    host.insertBefore(topbar, host.firstChild);
    host.insertBefore(disc, host.firstChild);

    // ---------- چیپ تاریخ واقعی (تقویم محلی کاربر) ----------
    var dateChip = mk('span'); dateChip.id = 'pr-date-chip';
    try {
      dateChip.textContent = (function(d){
        try {
          var parts = new Intl.DateTimeFormat('fa-IR-u-ca-persian', { timeZone:'Asia/Tehran', weekday:'long', day:'numeric', month:'long', year:'numeric' }).formatToParts(d);
          var map = {};
          parts.forEach(function(p){ if(p.type!=='literal') map[p.type]=p.value; });
          return (map.weekday||'') + ' · ' + (map.day||'') + ' ' + (map.month||'') + ' ' + (map.year||'');
        } catch(e2) {
          return d.toLocaleDateString('fa-IR');
        }
      })(new Date());
    } catch(e) { dateChip.textContent = ''; }
    dateChip.title = 'روز هفته و تاریخ شمسی (تهران)';
    rightGroup.insertBefore(dateChip, rightGroup.firstChild);

    var wlbar = mk('div'); wlbar.id = 'pr-wlbar';
    var wlTitle = mk('span'); wlTitle.id = 'pr-wl-title'; wlTitle.textContent = 'دیدبان فرصت‌ها';
    var count = mk('span'); count.id = 'pr-count'; count.textContent = '—';
    var hint = mk('span'); hint.id = 'pr-wl-hint';
    // جاسازی کنار دیدبان — متن کامل کاربر: دیدبان فرصت‌ها—برای جزئیات هر قرارداد روی «جزئیات» کلیک کنید — داده‌ها زنده به‌روز می‌شوند
    hint.textContent = '— برای جزئیات روی «جزئیات» بزنید';
    hint.title = 'برای جزئیات هر قرارداد روی دکمهٔ جزئیات کلیک کنید — داده‌ها زنده به‌روز می‌شوند';
    wlbar.appendChild(wlTitle); wlbar.appendChild(count); wlbar.appendChild(hint);
    var head = document.getElementById('tsext-head');
    if (head && head.parentNode) head.parentNode.insertBefore(wlbar, head.nextSibling);
    else host.appendChild(wlbar);

    // عنوان کناری «استراتژی‌های معاملاتی» + وضعیت بازار از v1.29 در خود قالب (src/06b) ساخته می‌شود؛ pro.js دیگر DOM را جابه‌جا نمی‌کند.

    // فوتر نوار پایین — با حفظ status اصلی موتور
    var status = document.getElementById('tsext-status');
    if (status && !document.getElementById('pr-foot-extra')) {
      // ساختار جدید: یک span برای متن وضعیت موتور + یک span برای توضیح فوتر
      var existingText = (status.textContent || '').trim();
      // پاکسازی و بازسازی
      status.textContent = '';
      status.style.display = 'flex';
      status.style.alignItems = 'center';
      status.style.gap = '12px';
      status.style.justifyContent = 'space-between';
      var txt = mk('span'); txt.id='pr-status-text';
      txt.textContent = existingText || 'آماده';
      txt.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:1;font-weight:700;font-size:12px;color:inherit;';
      var extra = mk('span'); extra.id='pr-foot-extra';
      extra.textContent = '';
      extra.style.display = 'none';
      status.appendChild(txt);
      status.appendChild(extra);
      // hijack کردن textContent تا setStatus موتور متن داخل txt را عوض کند نه کل status
      try{
        var origDesc = Object.getOwnPropertyDescriptor(Node.prototype, 'textContent');
        Object.defineProperty(status, 'textContent', {
          get: function(){ return txt.textContent; },
          set: function(v){ txt.textContent = v || ''; },
          configurable:true
        });
        // innerText هم
        Object.defineProperty(status, 'innerText', {
          get: function(){ return txt.innerText || txt.textContent; },
          set: function(v){ txt.textContent = v || ''; },
          configurable:true
        });
      }catch(e){
        // fallback: MutationObserver برای بازیابی extra اگر پاک شد
        try{
          new MutationObserver(function(){
            if (!document.getElementById('pr-foot-extra') && document.getElementById('pr-status-text')) {
              status.appendChild(extra);
            }
            if (!document.getElementById('pr-status-text')) {
              var rec = mk('span'); rec.id='pr-status-text'; rec.textContent = status.textContent || ''; rec.style.flex='1'; status.textContent=''; status.appendChild(rec); status.appendChild(extra);
            }
          }).observe(status, {childList:true, characterData:true, subtree:false});
        }catch(e2){}
      }
    }

    search.addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      var term = search.value.trim();
      if(!term) return;
      // ویژوال فیدبک
      search.classList.add('is-busy');
      setTimeout(function(){ search.classList.remove('is-busy'); }, 500);
      forwardSearch(term);
    });

    // ساعت پیشرفته: زمان تهران + شمسی + شمارش معکوس بازار
    function getTehranParts(d){
      try{
        var fmt = new Intl.DateTimeFormat('en-GB', {timeZone:'Asia/Tehran', weekday:'short', hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false, year:'numeric', month:'numeric', day:'numeric'});
        var parts = fmt.formatToParts(d);
        var m={}; parts.forEach(function(p){ m[p.type]=p.value; });
        return m;
      }catch(e){ return null; }
    }
    function marketCountdown(now){
      try{
        // محاسبه زمان تا باز/بسته شدن بعدی در تهران
        var wdMap = {Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6, Sun:0};
        var p = getTehranParts(now);
        if(!p) return null;
        var mins = parseInt(p.hour,10)*60 + parseInt(p.minute,10);
        var isOpen = marketOpen();
        var sec = parseInt(p.second,10);
        // اگر باز است: تا 12:30
        if(isOpen){
          var remain = (12*60+30)*60 - (mins*60+sec);
          if(remain<0) remain=0;
          var h = Math.floor(remain/3600), m = Math.floor((remain%3600)/60), s = remain%60;
          return {isOpen:true, label:'تا پایان بازار', h:h, m:m, s:s, total:remain};
        } else {
          // تا 09:00 روز کاری بعد
          var cur = new Date(now.toLocaleString('en-US', {timeZone:'Asia/Tehran'}));
          // برای سادگی: اگر امروز کاری و قبل 9، تا 9 امروز؛ وگرنه روز کاری بعدی 9
          var wdShort = p.weekday; // Mon etc
          var openToday = (wdShort==='Sat'||wdShort==='Sun'||wdShort==='Mon'||wdShort==='Tue'||wdShort==='Wed') && mins < 9*60;
          var target = new Date(cur);
          if(openToday){
            target.setHours(9,0,0,0);
          } else {
            // برو روز بعد تا روز کاری
            var tries=0;
            target.setDate(target.getDate()+1);
            target.setHours(9,0,0,0);
            while(tries++<7){
              var wd = target.toLocaleDateString('en-US', {timeZone:'Asia/Tehran', weekday:'short'});
              if(wd==='Sat'||wd==='Sun'||wd==='Mon'||wd==='Tue'||wd==='Wed') break;
              target.setDate(target.getDate()+1);
            }
          }
          // اختلاف به ثانیه
          var diffMs = target.getTime() - cur.getTime();
          var diff = Math.max(0, Math.floor(diffMs/1000));
          var hh = Math.floor(diff/3600), mm = Math.floor((diff%3600)/60), ss = diff%60;
          // اگر بیشتر از 24 ساعت، روز هم نشان بده
          var days = Math.floor(diff/86400);
          return {isOpen:false, label: days>0 ? 'تا بازشدن ('+faDigits(days)+' روز)' : 'تا بازشدن', h:hh%24, m:mm, s:ss, total:diff, days:days};
        }
      }catch(e){ return null; }
    }
    function pad2(n){ return (n<10?'0':'')+n; }
    function tickClock() {
      try {
        var now = new Date();
        clock.textContent = new Intl.DateTimeFormat('en-GB', {
          timeZone: 'Asia/Tehran', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
        }).format(now);
        // زیر ساعت: شمارش معکوس + تهران
        var cd = marketCountdown(now);
        if(cd){
          if(cd.isOpen){
            clockSub.textContent = '⏱ ' + cd.label + ' ' + faDigits(pad2(cd.h)+':'+pad2(cd.m)+':'+pad2(cd.s));
            clockSub.className = 'is-open';
            clockSub.title = 'بازار باز — تا ۱۲:۳۰';
          } else {
            if(cd.days && cd.days>0){
              clockSub.textContent = '⏰ ' + cd.label + ' ' + faDigits(cd.days+' روز و '+pad2(cd.h)+':'+pad2(cd.m)+':'+pad2(cd.s));
            } else {
              clockSub.textContent = '⏰ ' + cd.label + ' ' + faDigits(pad2(cd.h)+':'+pad2(cd.m)+':'+pad2(cd.s));
            }
            clockSub.className = 'is-closed';
            clockSub.title = 'بازار بسته';
          }
        } else {
          clockSub.textContent = 'تهران';
          clockSub.className = '';
        }
        // تاریخ شمسی برای نوار بازار
        var dEl = document.getElementById('pr-date-chip');
        if (dEl) {
          try{
            var parts = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {timeZone:'Asia/Tehran', weekday:'long', day:'numeric', month:'long', year:'numeric'}).formatToParts(now);
            var map = {};
            parts.forEach(function(p){ if(p.type!=='literal') map[p.type]=p.value; });
            dEl.textContent = (map.weekday||'') + '، ' + (map.day||'') + ' ' + (map.month||'') + ' ' + (map.year||'');
          }catch(e){ dEl.textContent = now.toLocaleDateString('fa-IR'); }
        }
      } catch (e) { try{ clock.textContent=''; }catch(e2){} }
    }
    tickClock(); setInterval(bgSafe(tickClock), 1000);

    function tickMarket() {
      var ph = { phase: 'closed', label: 'بازار بسته', tip: '' };
      try { ph = marketPhase(); } catch(e){}
      var clsOpen = ph.phase === 'open';
      var clsPre = ph.phase === 'preopen';
      var clsHol = ph.phase === 'holiday';
      var clsClosed = ph.phase === 'closed' || clsHol;
      var glyph = clsOpen ? '● ' : (clsPre ? '◐ ' : (clsHol ? '◼ ' : '○ '));
      var label = glyph + ph.label;
      // آخرین به‌روزرسانی داده
      var ageTxt = '';
      try {
        var st = window.__tsetmcInternals && window.__tsetmcInternals._state;
        var at = st && st.lastDataAt;
        if (at) {
          var sec = Math.max(0, Math.round((Date.now() - at) / 1000));
          if (sec < 3) ageTxt = ' · اکنون';
          else if (sec < 60) ageTxt = ' · ' + faDigits(String(sec)) + 'ث پیش';
          else ageTxt = ' · ' + faDigits(String(Math.round(sec/60))) + 'د پیش';
        }
      } catch(e){}
      market.textContent = label + ageTxt;
      market.classList.toggle('is-open', clsOpen);
      market.classList.toggle('is-preopen', clsPre);
      market.classList.toggle('is-closed', clsClosed);
      market.classList.toggle('is-holiday', clsHol);
      var tip = ph.tip || 'ساعات معاملات: ۹:۰۰ تا ۱۲:۳۰ به وقت تهران';
      if (ageTxt) tip += ' · آخرین داده' + ageTxt.replace(' · ',' ');
      market.title = tip;
      // نشانگر کنار دیدبان
      try {
        var wlMkt = document.getElementById('pr-wl-mkt');
        if (wlMkt) {
          wlMkt.textContent = label;
          wlMkt.className = 'pr-wl-mkt' + (clsOpen ? ' is-open' : '') + (clsPre ? ' is-preopen' : '') + (clsClosed ? ' is-closed' : '') + (clsHol ? ' is-holiday' : '');
          wlMkt.title = tip;
        }
      } catch(e){}
    }
    tickMarket(); setInterval(bgSafe(tickMarket), 5000);
    document.addEventListener('visibilitychange', function(){ if(!document.hidden){ try{ tickClock(); tickMarket(); }catch(e){} } });

    function updateCount() {
      try {
        var body = document.getElementById('tsext-list-body');
        if (!body) { count.textContent = '—'; return; }
        var n = body.querySelectorAll('.tsext-bar').length;
        var more = body.querySelector('.tsext-show-more');
        count.textContent = n ? (faDigits(String(n)) + ' مورد' + (more ? ' +' : '')) : '—';
      } catch (e) {}
    }
    var listBody = document.getElementById('tsext-list-body');
    if (listBody && typeof MutationObserver !== 'undefined') {
      new MutationObserver(updateCount).observe(listBody, { childList: true, subtree: true });
    }
    updateCount();

    // افقی‌اسکرول همگام برای جدول؟ اضافه کردن دکمه‌های جابجایی سریع
  }


  /* ---------- ارجاع جستجو به همه استراتژی‌ها ---------- */
  function forwardSearch(term) {
    if (!term || !host) return;
    term = String(term).trim();
    if (!term) return;
    // مسیر سریع: API موتور
    try {
      if (typeof window.__tsextLoadSymbol === 'function') {
        window.__tsextLoadSymbol(term, { force: true });
        return;
      }
    } catch (e) {}
    try {
      ['pospanj','combo','jamp','tick'].forEach(function(s){
        var inp = document.getElementById('tsext-underlying-'+s);
        if(inp){ inp.value = term; }
      });
      var activeTab = $('#tsext-tabs .tsext-tab.active', host) || $('#tsext-tabs .tsext-tab', host);
      var s = activeTab ? activeTab.getAttribute('data-s') : 'pospanj';
      var inp = document.getElementById('tsext-underlying-' + s);
      if (!inp) return;
      inp.value = term;
      try {
        var ke = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true });
        inp.dispatchEvent(ke);
      } catch (e) {}
      try { inp.dispatchEvent(new Event('change', { bubbles: true })); } catch (e) {}
      var btn = document.getElementById('tsext-search-'+s);
      if (btn) try{ btn.click(); }catch(e){}
    } catch (e) {}
  }

  /* ---------- نوار بازار: داده زنده با fallback ---------- */
  // نگهبان هم‌زمانی اسکرول افقی هدر/بدنه (جلوگیری از لغزش مبدأ RTL)
  // هم‌راستا نگه‌داشتن اسکرول افقی سرستون با بدنهٔ لیست — v1.24: رویداد scroll (capture) به‌جای تایمر ۴۰۰ms.
  // با capture روی document، عوض‌شدن/بازسازی خودِ عنصر لیست هم نیازی به bind دوباره ندارد.
  function setupScrollGuard(){
    var pending = false;
    function sync(){
      pending = false;
      var h = document.getElementById('tsext-list-hdr');
      var b = document.getElementById('tsext-list-body');
      if (h && b && Math.abs(h.scrollLeft - b.scrollLeft) > 0.5) h.scrollLeft = b.scrollLeft;
    }
    document.addEventListener('scroll', function(e){
      var t = e.target;
      if (!t || t.id !== 'tsext-list-body') return;
      if (pending) return;
      pending = true;
      requestAnimationFrame(sync);
    }, true);
  }

  // ---------- حذف ریسایز ستون‌ها و زوم پنل جزئیات ----------
  function setupNoResizeNoZoom(){
    // فقط زوم قدیمی را پاک کن — ریسایز ستون‌ها و اسپلیترها باید کار کنند
    try { localStorage.removeItem('tsext-ob-zoom'); } catch(e){}
    try { localStorage.removeItem('tsext-zoom'); } catch(e){}
    function clearZoom(){
      var b = document.getElementById('tsext-obpanel-body');
      if (b && b.style.zoom) b.style.zoom = '';
      var l = document.getElementById('tsext-list');
      if (l && l.style.zoom) l.style.zoom = '';
    }
    clearZoom();
    var hint = document.getElementById('pr-wl-hint');
    if (hint) hint.textContent = '— برای جزئیات روی «جزئیات» بزنید · لبهٔ ستون‌ها را بکشید';
  }

  // ---------- توست غیرمزاحم خطای داده — حذف شد (کاربر: پیام اتصال روی اعصاب است) ----------
  function setupErrorToast(){
    try { var b=document.getElementById('pr-toasts'); if(b) b.remove(); } catch(e){}
    window.__prToast = function(){};
    window.__prNetErr = function(){};
    window.__prNetOk = function(){};
  }

  // ---------- retry با backoff برای fetchهای موتور ----------
  function setupFetchRetry(){
    if (window.__prFetchWrapped) return;
    window.__prFetchWrapped = true;
    var orig = window.fetch ? window.fetch.bind(window) : null;
    if (!orig) return;
    window.fetch = function(input, init){
      function attempt(left){
        return orig(input, init).then(function(r){
          try { if (window.__prNetOk) window.__prNetOk(); } catch(e){}
          return r;
        }).catch(function(err){
          if (left <= 0) {
            try { if (err && err.name !== 'AbortError' && window.__prNetErr) window.__prNetErr(); } catch(e){}
            throw err;
          }
          return new Promise(function(res){ setTimeout(res, left === 2 ? 500 : 1500); })
            .then(function(){ return attempt(left - 1); });
        });
      }
      return attempt(2);
    };
  }

  // ---------- سلامت لیست — حذف شد (کاربر: پیام اتصال/قطع روی اعصاب است + کش innerHTML باعث ازکارافتادن کلیک جزئیات) ----------
  function prUnderlyingKey(){
    try {
      var vals = [];
      ['pospanj','combo','jamp','tick'].forEach(function(k){
        var inp = document.getElementById('tsext-underlying-' + k);
        if (inp && inp.value) vals.push(k + ':' + inp.value);
      });
      return vals.join('|') || 'default';
    } catch(e){ return 'default'; }
  }
  function setupListHealth(){
    try {
      var chip = document.getElementById('pr-list-age');
      if (chip) chip.remove();
      var box = document.getElementById('pr-toasts');
      if (box) box.remove();
    } catch(e){}
    // عمداً هیچ چیپ «به‌روز/قطع اتصال/کش» ساخته نمی‌شود و هیچ innerHTML کشی بازیابی نمی‌شود
    // تا لیسنرهای جزئیات موتور دست‌نخورده بمانند
  }

  // ---------- سوییچ سادهٔ ارقام فارسی/انگلیسی (جایگزین popover «نمایش») ----------
  var PR_PREFS_CACHE = null;
  function prPrefs(){
    if (PR_PREFS_CACHE) return PR_PREFS_CACHE;
    try { PR_PREFS_CACHE = JSON.parse(localStorage.getItem('pr-prefs') || '{}') || {}; } catch(e){ PR_PREFS_CACHE = {}; }
    if (!PR_PREFS_CACHE.digits) PR_PREFS_CACHE.digits = 'fa';
    return PR_PREFS_CACHE;
  }
  function prSavePrefs(o){ PR_PREFS_CACHE = o; try { localStorage.setItem('pr-prefs', JSON.stringify(o)); } catch(e){} }

  function setupWatchPrefetch(){
    function run(){
      try {
        if (document.hidden) return;
        var raw = localStorage.getItem('pr-watchlist-v2');
        var list = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(list)) return;
        var active = localStorage.getItem('pr-watchlist-active') || '';
        var others = list.filter(function(t){ return t && t !== active; }).slice(0, 4);
        var i = 0;
        function next(){
          if (i >= others.length) return;
          var term = others[i++];
          try {
            if (typeof window.__tsextPrefetchSymbol === 'function') window.__tsextPrefetchSymbol(term);
          } catch(e){}
          setTimeout(next, 2500);
        }
        setTimeout(next, 2000);
      } catch(e){}
    }
    setTimeout(run, 3000);
    setInterval(bgSafe(run), 60000);
  }

  function buildPrefs(){
    var prefs = prPrefs();
    var tools = document.getElementById('pr-tools');
    if (!tools) return;
    // --- ارقام ---
    if (!document.getElementById('pr-digits-btn')) {
      var btn = mk('button');
      btn.id = 'pr-digits-btn';
      btn.type = 'button';
      btn.title = 'سوییچ ارقام فارسی / انگلیسی';
      function label(){ return (prefs.digits === 'en') ? '123' : '۱۲۳'; }
      btn.textContent = label();
      function applyDigits(){
        var host = document.getElementById('tsext-host');
        if (host) {
          host.setAttribute('data-digits', prefs.digits === 'en' ? 'en' : 'fa');
          try { document.documentElement.setAttribute('data-tsext-digits', prefs.digits === 'en' ? 'en' : 'fa'); } catch(e){}
        }
        try { window.dispatchEvent(new CustomEvent('tsext-digits', { detail: { digits: prefs.digits } })); } catch(e){}
        try { if (typeof window.__tsextReflowDigits === 'function') window.__tsextReflowDigits(); } catch(e){}
      }
      btn.addEventListener('click', function(e){
        e.stopPropagation();
        prefs.digits = (prefs.digits === 'en') ? 'fa' : 'en';
        prSavePrefs(prefs);
        btn.textContent = label();
        applyDigits();
      });
      tools.insertBefore(btn, tools.firstChild);
      applyDigits();
    }
  }

  // ---------- یک‌دست‌سازی ارقام نمایشی (فارسی یا انگلیسی طبق ترجیح) ----------
  function setupFaDigits(){
    function skipEl(el){ return el && el.closest && el.closest('input,textarea,select,.pr-age'); }
    function fixNode(n){
      if (!n || n.nodeType !== 3) return;
      var dig = (prPrefs().digits === 'en') ? 'en' : 'fa';
      if (dig === 'fa') {
        if (/[0-9]/.test(n.data)) n.data = prFaConv(n.data);
      } else {
        if (/[۰-۹٠-٩]/.test(n.data)) n.data = prEnConv(n.data);
      }
    }
    function fixTree(root){
      if (!root || root.nodeType !== 1 || skipEl(root)) return;
      var w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
      var n; while ((n = w.nextNode())) { if (!skipEl(n.parentElement)) fixNode(n); }
    }
    var mo = new MutationObserver(function(muts){
      for (var i=0;i<muts.length;i++){
        var m = muts[i];
        if (m.type === 'characterData') { if (!skipEl(m.target.parentElement)) fixNode(m.target); }
        else if (m.addedNodes) {
          for (var j=0;j<m.addedNodes.length;j++){
            var nd = m.addedNodes[j];
            if (nd.nodeType === 3) { if (!skipEl(nd.parentElement)) fixNode(nd); }
            else if (nd.nodeType === 1) fixTree(nd);
          }
        }
      }
    });
    try { mo.observe(document.documentElement, {childList:true, subtree:true, characterData:true}); } catch(e){}
    fixTree(document.body);
    try {
      window.__tsextReflowDigits = function(){
        // کل درخت را دوباره با حالت فعلی ارقام هم‌تراز کن
        fixTree(document.getElementById('tsext-host') || document.body);
      };
    } catch(e){}
  }

  // ---------- جلا: سن دادهٔ جدول‌های سفارشات ----------
  function setupProPolish(){
    var mo = new MutationObserver(function(muts){
      for (var i=0;i<muts.length;i++){
        var m = muts[i];
        var t = m.target;
        var el = t && t.nodeType === 1 ? t : (t && t.parentElement ? t.parentElement : null);
        if (el && el.closest && el.closest('.pr-age')) continue;
        var nodes = (m.addedNodes && m.addedNodes.length ? m.addedNodes : m.removedNodes) || [];
        var allAge = nodes.length ? true : false;
        for (var n=0;n<nodes.length;n++){
          var nd = nodes[n];
          if (!(nd.nodeType===1 && nd.classList && nd.classList.contains('pr-age'))) { allAge = false; break; }
        }
        if (allAge) continue;
        var act = el && el.closest ? el.closest('.tsext-cols-actions') : null;
        if (!act && m.addedNodes) {
          for (var q=0;q<m.addedNodes.length;q++){
            var an2 = m.addedNodes[q];
            if (an2.nodeType===1 && an2.querySelector && an2.querySelector('.tsext-cols-actions')) { act = an2.querySelector('.tsext-cols-actions'); break; }
          }
        }
        if (act) {
          var full = act.querySelector('.tsext-actions-full');
          if (full && /tsetmc/.test(full.textContent)) full.textContent = 'جزئیات';
        }
        var slot = el && el.closest ? el.closest('.tsext-ob-slot') : null;
        if (slot) { slot.__tup = Date.now(); continue; }
        // اگر خودِ slot تازه ساخته/جایگزین شده (مثلاً رندر مجدد موتور)، همان لحظه را ثبت کن
        for (var a=0;a<nodes.length;a++){
          var an = nodes[a];
          if (an.nodeType !== 1) continue;
          var ns = an.classList && an.classList.contains('tsext-ob-slot') ? an : (an.querySelector ? an.querySelector('.tsext-ob-slot') : null);
          if (ns) ns.__tup = Date.now();
        }
      }
    });
    // v1.24: رصد روی body (نیاکان همیشگی) — اگر موتور کل host را هم بازسازی کند، نیازی به attach دوباره نیست
    try { mo.observe(document.body, {childList:true, subtree:true, characterData:true}); } catch(e){}
    // برچسب سن جدول سفارشات: تایمر ۱ ثانیه‌ای فقط وقتی جدولی باز است (شروع با observer، توقف خودکار)
    var ageTimer = null;
    function paintAges(){
      var slots = document.querySelectorAll('#tsext-ob-books .tsext-ob-slot');
      if (!slots.length) { if (ageTimer) { clearInterval(ageTimer); ageTimer = null; } return; }
      for (var i=0;i<slots.length;i++){
        var sl = slots[i];
        var age = sl.querySelector('.pr-age');
        if (!age){ age = mk('span'); age.className = 'pr-age'; sl.insertBefore(age, sl.firstChild); }
        var up = sl.__tup;
        if (!up){ age.textContent = ''; continue; }
        var sec = Math.max(0, Math.round((Date.now()-up)/1000));
        age.textContent = sec < 3 ? 'زنده' : faDigits(String(sec)) + ' ث پیش';
        age.classList.toggle('is-fresh', sec < 6);
      }
    }
    function ensureAgeTimer(){
      if (ageTimer) return;
      if (!document.querySelector('#tsext-ob-books .tsext-ob-slot')) return;
      paintAges();
      ageTimer = setInterval(bgSafe(paintAges), 1000);
    }
    try { window.__prEnsureAgeTimer = ensureAgeTimer; window.__prAgeTimerActive = function(){ return !!ageTimer; }; } catch(e){}
    var agesObs = new MutationObserver(function(){ ensureAgeTimer(); });
    try { agesObs.observe(document.body, {childList:true, subtree:true}); } catch(e){}
    ensureAgeTimer();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { waitForEngine(80); });
  } else {
    waitForEngine(80);
  }
})();
