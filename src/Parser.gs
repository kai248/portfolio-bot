/**
 * Forgiving free-text parser.  Pure JavaScript - no Google services are used
 * here, so the same file is unit-tested locally with Node.
 *
 * parseMessage(text, ctx) turns "i bougth 3 meta @ 500 cfd" into
 *   { action:'BUY', type:'CFD', ticker:'META', qty:3, price:500, ... }
 * Anything it can't work out is left null so the bot can ask you.
 *
 * ctx = { today: 'yyyy-mm-dd', aliases: { 'you type': 'TICKER', ... } }
 */

var BUY_WORDS = ['buy', 'bought', 'buying', 'buys', 'purchase', 'purchased', 'purchasing',
  'got', 'get', 'added', 'add', 'adding', 'long', 'picked', 'grabbed', 'acquired', 'bt'];
var SELL_WORDS = ['sell', 'sold', 'selling', 'sells', 'dumped', 'dump', 'closed', 'close',
  'exit', 'exited', 'trimmed', 'trim', 'offloaded', 'unloaded'];
var FEE_WORDS = ['fee', 'fees', 'financing', 'interest', 'charge', 'charged', 'charges',
  'commission', 'commissions', 'comm', 'overnight'];
var DIV_WORDS = ['dividend', 'dividends', 'div', 'divs', 'dividen', 'divvy'];
var SHORT_WORDS = ['short', 'shorted', 'shorting', 'shorts'];
var CFD_WORDS = ['cfd', 'cfds'];
var STOCK_WORDS = ['stock', 'stocks', 'equity', 'equities'];

var PRICE_BEFORE = ['@', 'at', 'for', 'price', 'px', 'avg', 'average', 'cost', '$'];
var PRICE_AFTER = ['each', 'per', 'ea', 'apiece'];
var QTY_BEFORE = ['x', 'qty', 'quantity', 'vol', 'volume'];
var QTY_AFTER = ['shares', 'share', 'units', 'unit', 'x', 'pcs', 'sh'];
var TOTAL_BEFORE = ['total', 'totaling', 'totalling', 'altogether'];

var FILLER_WORDS = ['i', 'im', 'ive', 'id', 'just', 'jus', 'juz', 'some', 'more', 'of', 'the',
  'a', 'an', 'on', 'in', 'ibkr', 'usd', 'us', 'me', 'my', 'now', 'and', 'n', 'with', 'again',
  'another', 'few', 'around', 'about', 'approx', 'roughly', '~', 'to', 'from', 'u', 'r',
  'ur', 'ya', 'yeah', 'yes', 'ok', 'okay', 'pls', 'please', 'hey', 'hi', 'bro', 'lol',
  'earlier', 'this', 'morning', 'afternoon', 'tonight', 'night', 'already', 'its', 'it',
  'was', 'were', 'is', 'did', 'do', 'done', 'have', 'had', 'has', 'been', 'via', 'thru',
  'through', 'using', 'position', 'positions', 'into', 'worth', 'dollars', 'dollar', 'bucks',
  'shares', 'share', 'units', 'unit', 'x', 'each', 'per', 'ea', 'at', 'for', 'price', 'px',
  'avg', 'average', 'cost', 'total', 'totaling', 'totalling', 'altogether', 'qty',
  'quantity', 'vol', 'volume', 'apiece', 'pcs', 'sh', 'up', 'went', 'go', 'also', 'too',
  'order', 'filled', 'fill', 'market', 'limit', 'trade', 'traded', 'nd', 'st', 'rd', 'th',
  'moomoo', 'tiger', 'webull', 'robinhood app', 'stake', 'rm', 'myr', 'be', 'can', 'are', 'so',
  'all', 'more', 'most', 'kind', 'real', 'well', 'good', 'true', 'see', 'hear', 'you', 'we',
  'they', 'he', 'she', 'that', 'then', 'there', 'here', 'yesterday', 'today', 'last', 'on',
  'think', 'guess', 'maybe', 'like', 'about', 'lot', 'bit', 'lah', 'leh', 'lor', 'ah', 'eh',
  'mah', 'wor', 'hor', 'k', 'kk', '@', '$', '&', '/', 'hows', 'how', 'whats', 'what', 'check'];

var MONTHS = { jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9,
  september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12 };
var WEEKDAYS = { sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2,
  wed: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5,
  sat: 6, saturday: 6 };
var TODAY_WORDS = ['today', 'tdy', 'tday', 'now'];
var YESTERDAY_WORDS = ['yesterday', 'ytd', 'yday', 'ystd', 'ysd', 'yest', 'ystdy'];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Detects simple commands. Returns {command:'help'|'portfolio'|'undo'|'cancel'|'position', ticker?} or null. */
function parseCommand(text, ctx) {
  var t = String(text || '').trim().toLowerCase().replace(/@\w+$/, '');
  var bare = t.replace(/^\//, '');
  if (['help', 'start', 'commands', '?', 'menu'].indexOf(bare) >= 0) return { command: 'help' };
  if (['portfolio', 'p', 'port', 'pf', 'summary', 'holdings', 'overview', 'total'].indexOf(bare) >= 0) {
    return { command: 'portfolio' };
  }
  if (['undo', 'delete last', 'remove last', 'undo last'].indexOf(bare) >= 0) return { command: 'undo' };
  if (['cancel', 'stop', 'nvm', 'nevermind', 'never mind', 'forget it'].indexOf(bare) >= 0) {
    return { command: 'cancel' };
  }
  // A lone ticker / company name ("meta", "/nvda", "$aapl") -> position lookup
  if (!/\d/.test(bare) && bare.split(/\s+/).length <= 3) {
    var p = parseMessage(bare.replace(/^\//, ''), ctx);
    var noise = p.qty != null || p.price != null || p.amount != null || p.ambiguousNumber != null;
    if (!p.action && !p.short && !noise && p.ticker &&
        (p.tickerSource === 'known' || p.leftovers.length === 0)) {
      return { command: 'position', ticker: p.ticker };
    }
  }
  return null;
}

/** True when the text reads like a brand-new trade rather than an answer to a question. */
function looksLikeNewEntry(text, ctx) {
  var p = parseMessage(text, ctx);
  return !!((p.action || p.short) && (p.ticker || p.tickerChoices.length || p.qty != null ||
    p.price != null || p.amount != null));
}

function parseMessage(text, ctx) {
  ctx = ctx || {};
  var today = ctx.today || isoToday_();
  var aliases = buildAliasMap_(ctx.aliases);
  var known = buildKnownSet_();

  var toks = tokenize_(text);
  var out = {
    action: null, actionConflict: false, short: false, type: null,
    ticker: null, tickerSource: null, tickerChoices: [], tickerToken: null, tickerFromFuzzy: false,
    qty: null, price: null, fee: null, amount: null, total: null,
    ambiguousNumber: null, date: null, extraNumbers: [], leftovers: []
  };

  // 1) dates (consumes tokens like "22 sep", "22/9", "yesterday", "friday")
  out.date = extractDate_(toks, today);

  // 2) multi-word company names ("palo alto", "bank of america")
  var tickerHits = []; // {tickers:[..], idx, token, fuzzy}
  for (var n = 3; n >= 2; n--) {
    for (var i = 0; i + n <= toks.length; i++) {
      var seq = toks.slice(i, i + n);
      if (seq.some(function (t) { return t.used || t.isNum; })) continue;
      var phrase = seq.map(function (t) { return t.low; }).join(' ');
      var hit = aliases[phrase] || aliases[phrase.replace(/ /g, '')];
      if (hit) {
        seq.forEach(function (t) { t.used = true; });
        tickerHits.push({ tickers: asList_(hit), idx: i, token: phrase });
      }
    }
  }

  // 3) classify every remaining word
  var flags = { buy: false, sell: false, fee: false, div: false };
  var unknown = [];
  toks.forEach(function (t) {
    if (t.used || t.isNum) return;
    var low = t.low;
    var raw = t.raw;

    if (/^\$[a-z][a-z.]*$/i.test(raw)) { // "$ON"
      tickerHits.push({ tickers: [raw.slice(1).toUpperCase()], idx: t.idx, token: low.slice(1) });
      t.used = true; return;
    }
    if (inList_(BUY_WORDS, low)) { flags.buy = true; t.kw = true; return; }
    if (inList_(SELL_WORDS, low)) { flags.sell = true; t.kw = true; return; }
    if (inList_(SHORT_WORDS, low)) { out.short = true; t.kw = true; return; }
    if (inList_(FEE_WORDS, low)) { flags.fee = true; t.kw = true; t.feeMarker = true; return; }
    if (inList_(DIV_WORDS, low)) { flags.div = true; t.kw = true; return; }
    if (inList_(CFD_WORDS, low)) { out.type = 'CFD'; t.kw = true; return; }
    if (inList_(STOCK_WORDS, low)) { if (!out.type) out.type = 'STOCK'; t.kw = true; return; }

    var isCommonWord = inList_(COMMON_WORD_TICKERS, low) || inList_(FILLER_WORDS, low);
    if (isCommonWord) {
      var shouted = raw.length >= 1 && raw === raw.toUpperCase() && /[A-Z]/.test(raw) && raw !== 'I';
      var tickerish = inList_(COMMON_WORD_TICKERS, low) || known[raw.toUpperCase()];
      if ((shouted && tickerish) || (ctx.answerMode && tickerish)) {
        tickerHits.push({ tickers: [raw.toUpperCase()], idx: t.idx, token: low });
        t.used = true;
      }
      t.filler = true;
      return;
    }
    if (aliases[low]) { tickerHits.push({ tickers: asList_(aliases[low]), idx: t.idx, token: low }); t.used = true; return; }
    if (known[raw.toUpperCase()]) { tickerHits.push({ tickers: [raw.toUpperCase()], idx: t.idx, token: low }); t.used = true; return; }
    unknown.push(t);
  });

  // 4) unknown words: typo'd action words first, then typo'd ticker names
  var fuzzyCandidates = [];
  unknown.forEach(function (t) {
    var act = fuzzyAction_(t.low);
    if (act) { flags[act] = true; t.kw = true; return; }
    var sugg = fuzzyTicker_(t.low, aliases, known);
    var maybeTicker = /^[a-z]{1,5}(\.[a-z])?$/.test(t.low);
    if (sugg.length) fuzzyCandidates.push({ tok: t, sugg: sugg });
    else if (maybeTicker) fuzzyCandidates.push({ tok: t, sugg: [], maybe: true });
    else out.leftovers.push(t.raw);
  });

  // 5) decide the ticker
  var distinct = [];
  tickerHits.forEach(function (h) {
    h.tickers.forEach(function (tk) { if (distinct.indexOf(tk) < 0) distinct.push(tk); });
  });
  var tickerIdx = -1;
  if (distinct.length === 1) {
    out.ticker = distinct[0]; tickerIdx = tickerHits[0].idx; out.tickerToken = tickerHits[0].token;
    out.tickerSource = 'known';
  } else if (distinct.length > 1) {
    out.tickerChoices = distinct.slice(0, 4); tickerIdx = tickerHits[0].idx;
  } else if (fuzzyCandidates.length) {
    var withSugg = fuzzyCandidates.filter(function (c) { return c.sugg.length; })[0];
    var maybe = fuzzyCandidates.filter(function (c) { return c.maybe; })[0];
    if (withSugg) {
      out.tickerChoices = withSugg.sugg; out.tickerFromFuzzy = true;
      out.tickerToken = withSugg.tok.low; tickerIdx = withSugg.tok.idx;
    } else if (maybe) {
      // Not in our list but shaped like a ticker (e.g. "sofi"): bot verifies it on Google Finance.
      out.ticker = maybe.tok.raw.toUpperCase(); out.tickerToken = maybe.tok.low; tickerIdx = maybe.tok.idx;
      out.tickerSource = 'guess';
    }
    fuzzyCandidates.forEach(function (c) {
      if (c !== withSugg && c !== maybe) out.leftovers.push(c.tok.raw);
    });
  }
  if (out.ticker || out.tickerChoices.length) {
    fuzzyCandidates.forEach(function (c) {
      if (out.leftovers.indexOf(c.tok.raw) < 0 && c.tok.low !== out.tickerToken) out.leftovers.push(c.tok.raw);
    });
  }

  // 6) action
  if (out.short) {
    out.action = null;
  } else if (flags.buy && flags.sell) {
    out.actionConflict = true;
  } else if (flags.buy) {
    out.action = 'BUY';
  } else if (flags.sell) {
    out.action = 'SELL';
  } else if (flags.div && !flags.fee) {
    out.action = 'DIVIDEND';
  } else if (flags.fee && !flags.div) {
    out.action = 'FEE';
  } else if (flags.fee && flags.div) {
    out.actionConflict = true;
  }

  // 7) numbers
  assignNumbers_(toks, out, tickerIdx);

  return out;
}

/** Parses a reply to "How many shares?" / "What price?" -> number or null. */
function parseNumberReply(text) {
  var s = String(text || '').replace(/(\d),(\d{3})/g, '$1$2').replace(/usd|us\$|\$/gi, ' ');
  var m = s.match(/-?\d+(\.\d+)?/g);
  if (!m || m.length !== 1) return null;
  var n = parseFloat(m[0]);
  return isFinite(n) && n > 0 ? n : null;
}

/** Parses a reply to "Which date?" -> 'yyyy-mm-dd' or null. */
function parseDateReply(text, today) {
  return extractDate_(tokenize_(text), today || isoToday_());
}

/** Levenshtein distance allowing adjacent swaps ("bougth" -> "bought" = 1). */
function editDistance(a, b) {
  var d = [];
  for (var i = 0; i <= a.length; i++) { d[i] = [i]; }
  for (var j = 0; j <= b.length; j++) { d[0][j] = j; }
  for (i = 1; i <= a.length; i++) {
    for (j = 1; j <= b.length; j++) {
      var cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
  }
  return d[a.length][b.length];
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function tokenize_(text) {
  var s = String(text || '');
  s = s.replace(/[‘’']/g, '');
  s = s.replace(/(\d),(\d{3})/g, '$1$2');
  s = s.replace(/@/g, ' @ ');
  s = s.replace(/(\d)\$/g, '$1 ');            // "500$" -> "500"
  s = s.replace(/\$\s+(\d)/g, '$$$1');          // "$ 500" -> "$500"
  s = s.replace(/(\d)([a-zA-Z])/g, '$1 $2');  // "1meta" -> "1 meta"
  s = s.replace(/([a-zA-Z])(\d)/g, '$1 $2');  // "meta3" -> "meta 3"
  s = s.replace(/[,!?;:()"\[\]{}+=*]/g, ' ');
  var parts = s.split(/\s+/);
  var toks = [];
  parts.forEach(function (p) {
    p = p.replace(/^[.\-]+|[.\-]+$/g, '');
    if (!p) return;
    var num = p.match(/^\$?(\d+(\.\d+)?|\.\d+)$/);
    toks.push({
      raw: p, low: p.toLowerCase(), idx: toks.length,
      isNum: !!num, num: num ? parseFloat(p.replace('$', '')) : null,
      dollar: p.charAt(0) === '$' && !!num
    });
  });
  return toks;
}

function extractDate_(toks, todayIso) {
  var today = isoToDate_(todayIso);
  var found = null;
  for (var i = 0; i < toks.length && !found; i++) {
    var t = toks[i];
    if (t.used) continue;
    var low = t.low;
    if (inList_(TODAY_WORDS, low) && low !== 'now') { t.used = true; found = todayIso; break; }
    if (inList_(YESTERDAY_WORDS, low)) { t.used = true; found = dateToIso_(addDays_(today, -1)); break; }
    if (low === 'last' && toks[i + 1] && WEEKDAYS.hasOwnProperty(toks[i + 1].low)) { t.used = true; continue; }
    if (WEEKDAYS.hasOwnProperty(low) && low !== 'sat' && low !== 'sun' || (low === 'sat' || low === 'sun') && i > 0 && toks[i - 1].low === 'on') {
      var back = (today.getUTCDay() - WEEKDAYS[low] + 7) % 7;
      if (toks[i - 1] && toks[i - 1].low === 'last' && back === 0) back = 7;
      t.used = true; found = dateToIso_(addDays_(today, -back)); break;
    }
    var m = low.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/);
    if (m) { t.used = true; found = safeDate_(+m[1], +m[2], +m[3]); break; }
    m = low.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
    if (m) { // Malaysian style: day/month
      t.used = true;
      found = safeDate_(m[3] ? normYear_(+m[3]) : null, +m[2], +m[1], today); break;
    }
    // "22 sep", "22nd sep 2026", "sep 22"
    if (t.isNum && t.num >= 1 && t.num <= 31 && t.num === Math.floor(t.num)) {
      var j = i + 1;
      if (toks[j] && /^(st|nd|rd|th)$/.test(toks[j].low)) j++;
      if (toks[j] && MONTHS[toks[j].low]) {
        var yTok = toks[j + 1] && toks[j + 1].isNum && toks[j + 1].num >= 2000 && toks[j + 1].num <= 2100 ? toks[j + 1] : null;
        found = safeDate_(yTok ? yTok.num : null, MONTHS[toks[j].low], t.num, today);
        for (var k = i; k <= j; k++) toks[k].used = true;
        if (yTok) yTok.used = true;
        break;
      }
    }
    if (MONTHS[low] && toks[i + 1] && toks[i + 1].isNum && toks[i + 1].num >= 1 && toks[i + 1].num <= 31) {
      var y2 = toks[i + 2] && toks[i + 2].isNum && toks[i + 2].num >= 2000 && toks[i + 2].num <= 2100 ? toks[i + 2] : null;
      found = safeDate_(y2 ? y2.num : null, MONTHS[low], toks[i + 1].num, today);
      t.used = true; toks[i + 1].used = true; if (y2) y2.used = true;
      if (toks[i + 2] && /^(st|nd|rd|th)$/.test(toks[i + 2].low)) toks[i + 2].used = true;
      break;
    }
  }
  return found;
}

function assignNumbers_(toks, out, tickerIdx) {
  function prevWord(i) {
    for (var k = i - 1; k >= 0; k--) {
      if (toks[k].isNum) return null;
      if (toks[k].used && !toks[k].feeMarker) return null;
      var low = toks[k].low;
      if (['around', 'about', 'approx', 'roughly', '~', 'usd', 'us'].indexOf(low) >= 0) continue;
      return toks[k];
    }
    return null;
  }
  function nextWord(i) { return toks[i + 1] && !toks[i + 1].isNum ? toks[i + 1] : null; }

  var unmarked = [];
  toks.forEach(function (t, i) {
    if (!t.isNum || t.used) return;
    var pw = prevWord(i), nw = nextWord(i);
    var pl = pw ? pw.low : '', nl = nw ? nw.low : '';
    if (pw && pw.feeMarker) { setOnce_(out, 'fee', t.num); }
    else if (inList_(TOTAL_BEFORE, pl)) { setOnce_(out, 'total', t.num); }
    else if (t.dollar || inList_(PRICE_BEFORE, pl) || inList_(PRICE_AFTER, nl)) { setOnce_(out, 'price', t.num); }
    else if (inList_(QTY_BEFORE, pl) || inList_(QTY_AFTER, nl)) { setOnce_(out, 'qty', t.num); }
    else { unmarked.push({ num: t.num, idx: i }); }
  });

  if (out.action === 'FEE' || out.action === 'DIVIDEND') {
    // Only one money amount matters. "fee 2.3" was captured as `fee`.
    var amt = [out.fee, out.price, out.total].filter(function (v) { return v != null; })[0];
    if (amt == null && unmarked.length) amt = unmarked.shift().num;
    out.amount = amt != null ? amt : null;
    out.fee = null; out.price = null; out.total = null;
    unmarked.forEach(function (u) { out.extraNumbers.push(u.num); });
    return;
  }

  // Unmarked number right before the ticker is a quantity: "bought 3 meta"
  var rest = [];
  unmarked.forEach(function (u) {
    if (tickerIdx >= 0 && u.idx < tickerIdx && out.qty == null) out.qty = u.num;
    else rest.push(u);
  });
  rest.forEach(function (u) {
    if (out.qty == null && out.price == null && rest.length === 1) {
      // "bought meta 500": is 500 the shares or the price? Decimals are prices.
      if (u.num !== Math.floor(u.num)) out.price = u.num;
      else out.ambiguousNumber = u.num;
    } else if (out.qty == null) {
      out.qty = u.num;
    } else if (out.price == null) {
      out.price = u.num;
    } else {
      out.extraNumbers.push(u.num);
    }
  });
  if (out.total != null && out.qty && out.price == null) {
    out.price = round_(out.total / out.qty, 4);
  }
}

function fuzzyAction_(word) {
  if (word.length < 4) return null;
  var groups = { buy: BUY_WORDS, sell: SELL_WORDS, div: DIV_WORDS, fee: FEE_WORDS };
  var best = null, bestD = 99;
  Object.keys(groups).forEach(function (g) {
    groups[g].forEach(function (w) {
      if (w.length < 4) return;
      var d = editDistance(word, w);
      if (d < bestD) { bestD = d; best = g; }
    });
  });
  var limit = word.length >= 6 ? 2 : 1;
  return bestD <= limit ? best : null;
}

function fuzzyTicker_(word, aliases, known) {
  if (word.length < 3) return [];
  var limit = word.length >= 6 ? 2 : 1;
  var scored = [];
  Object.keys(aliases).forEach(function (name) {
    if (name.length < 3 || name.indexOf(' ') >= 0) return;
    var d = editDistance(word, name);
    if (d <= limit) asList_(aliases[name]).forEach(function (tk) { scored.push({ t: tk, d: d }); });
  });
  if (word.length <= 5) {
    Object.keys(known).forEach(function (tk) {
      if (tk.length < 3) return;
      var d = editDistance(word, tk.toLowerCase());
      if (d <= 1) scored.push({ t: tk, d: d });
    });
  }
  scored.sort(function (a, b) { return a.d - b.d; });
  var outList = [];
  scored.forEach(function (s) { if (outList.indexOf(s.t) < 0) outList.push(s.t); });
  return outList.slice(0, 3);
}

function buildAliasMap_(userAliases) {
  var m = {};
  Object.keys(NAME_ALIASES).forEach(function (k) { m[k] = NAME_ALIASES[k]; });
  Object.keys(userAliases || {}).forEach(function (k) {
    var key = String(k).trim().toLowerCase();
    var val = String(userAliases[k]).trim().toUpperCase();
    if (key && val) m[key] = val;
  });
  return m;
}

var KNOWN_CACHE_ = null;
function buildKnownSet_() {
  if (KNOWN_CACHE_) return KNOWN_CACHE_;
  var s = {};
  Object.keys(NAME_ALIASES).forEach(function (k) {
    asList_(NAME_ALIASES[k]).forEach(function (t) { s[t] = true; });
  });
  EXTRA_TICKERS.forEach(function (t) { s[t] = true; });
  KNOWN_CACHE_ = s;
  return s;
}

function setOnce_(obj, key, val) { if (obj[key] == null) obj[key] = val; else obj.extraNumbers.push(val); }
function asList_(v) { return Array.isArray(v) ? v : [v]; }
function inList_(list, v) { return list.indexOf(v) >= 0; }
function round_(n, dp) { var f = Math.pow(10, dp); return Math.round(n * f) / f; }

function isoToday_() { return dateToIso_(new Date()); }
function isoToDate_(iso) { var p = iso.split('-'); return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])); }
function dateToIso_(d) {
  return d.getUTCFullYear() + '-' + pad2_(d.getUTCMonth() + 1) + '-' + pad2_(d.getUTCDate());
}
function addDays_(d, n) { return new Date(d.getTime() + n * 86400000); }
function pad2_(n) { return (n < 10 ? '0' : '') + n; }
function normYear_(y) { return y < 100 ? 2000 + y : y; }
/** Builds a date; with no year given it picks the most recent past occurrence. */
function safeDate_(y, m, d, today) {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  var year = y || (today ? today.getUTCFullYear() : new Date().getUTCFullYear());
  var dt = new Date(Date.UTC(year, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  if (!y && today && dt.getTime() > today.getTime()) dt = new Date(Date.UTC(year - 1, m - 1, d));
  return dateToIso_(dt);
}

if (typeof module !== 'undefined') {
  module.exports = { parseMessage: parseMessage, parseCommand: parseCommand,
    parseNumberReply: parseNumberReply, parseDateReply: parseDateReply,
    looksLikeNewEntry: looksLikeNewEntry, editDistance: editDistance };
}
