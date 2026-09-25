/**
 * Everything that reads or writes the spreadsheet: settings, transactions,
 * the Holdings rebuild, live quotes, the bot log and daily snapshots.
 */

function ss_() {
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!id) throw new Error('Run setup() once from the Apps Script editor first.');
  return SpreadsheetApp.openById(id);
}
function sheet_(name) { return ss_().getSheetByName(name); }
function todayIso_() { return Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd'); }
function toIso_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, ss_().getSpreadsheetTimeZone() || TZ, 'yyyy-MM-dd');
  return String(v || '').slice(0, 10);
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

function getSettings_() {
  var sh = sheet_(SHEETS.SET);
  var chat = String(sh.getRange(SET_CELLS.CHAT_ID).getValue() || '').trim();
  var platform = String(sh.getRange(SET_CELLS.PLATFORM).getValue() || 'IBKR').trim();
  var warn = Number(sh.getRange(SET_CELLS.WARN).getValue());
  if (!isFinite(warn) || warn <= 0) warn = 0.3;
  var aliases = {};
  var last = sh.getLastRow();
  if (last >= ALIAS_FIRST_ROW) {
    sh.getRange(ALIAS_FIRST_ROW, 1, last - ALIAS_FIRST_ROW + 1, 2).getValues().forEach(function (r) {
      var k = String(r[0] || '').trim().toLowerCase(), v = String(r[1] || '').trim().toUpperCase();
      if (k && v) aliases[k] = v;
    });
  }
  return { chatId: chat, platform: platform, warn: warn, aliases: aliases };
}

function saveAlias_(alias, ticker) {
  var sh = sheet_(SHEETS.SET);
  var last = Math.max(sh.getLastRow(), ALIAS_FIRST_ROW - 1);
  if (last >= ALIAS_FIRST_ROW) {
    var vals = sh.getRange(ALIAS_FIRST_ROW, 1, last - ALIAS_FIRST_ROW + 1, 1).getValues();
    for (var i = 0; i < vals.length; i++) {
      if (String(vals[i][0]).trim().toLowerCase() === alias) {
        sh.getRange(ALIAS_FIRST_ROW + i, 2).setValue(ticker);
        return;
      }
    }
  }
  sh.getRange(last + 1, 1, 1, 2).setValues([[alias, ticker]]);
}

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

function readTransactions_() {
  var sh = sheet_(SHEETS.TX);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var rows = sh.getRange(2, 1, last - 1, TX_HEADERS.length).getValues();
  var out = [];
  rows.forEach(function (r, i) {
    var action = String(r[TX.ACTION - 1] || '').trim().toUpperCase();
    var rawTicker = String(r[TX.TICKER - 1] || '').trim();
    if (ACTIONS.indexOf(action) < 0 || !rawTicker) return;
    var type = String(r[TX.TYPE - 1] || '').trim().toUpperCase();
    type = type === 'STOCK' ? 'SHARES' : TYPES.indexOf(type) >= 0 ? type : 'SHARES';
    // IBKR names share CFDs "AAPLn" - the underlying ticker is AAPL
    if (type === 'CFD' && /[A-Z0-9]n$/.test(rawTicker)) rawTicker = rawTicker.slice(0, -1);
    var ccy = String(r[TX.CCY - 1] || '').trim().toUpperCase();
    out.push({
      row: i + 2,
      date: toIso_(r[TX.DATE - 1]),
      action: action,
      type: type,
      ticker: rawTicker.toUpperCase(),
      currency: CURRENCIES[ccy] ? ccy : 'USD',
      qty: Number(r[TX.QTY - 1]) || 0,
      price: Number(r[TX.PRICE - 1]) || 0,
      fee: Number(r[TX.FEE - 1]) || 0,
      amount: Number(r[TX.AMOUNT - 1]) || 0,
      id: String(r[TX.ID - 1] || '')
    });
  });
  return out;
}

function appendTransaction_(t) {
  var sh = sheet_(SHEETS.TX);
  var id = Utilities.getUuid().slice(0, 8);
  var isTrade = t.action === 'BUY' || t.action === 'SELL';
  var row = [
    t.date, t.action, t.type, t.ticker, t.currency || 'USD',
    isTrade ? t.qty : '', isTrade ? t.price : '', isTrade ? (t.fee || 0) : '',
    isTrade ? '' : t.amount,
    '', t.notes || '', Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss'), id
  ];
  var r = sh.getLastRow() + 1;
  sh.getRange(r, 1, 1, row.length).setValues([row]);
  sh.getRange(r, TX.CASH).setFormulaR1C1(CASH_FLOW_R1C1);
  sh.getRange(r, TX.PRICE).setNumberFormat(priceFmt_(t.currency || 'USD'));
  sh.getRange(r, TX.FEE, 1, 2).setNumberFormat(moneyFmt_(t.currency || 'USD'));
  sh.getRange(r, TX.CASH).setNumberFormat(moneyFmt_(t.currency || 'USD', true));
  return id;
}

/** Cash flow per row, in the row's currency: money out of your account is negative. */
var CASH_FLOW_R1C1 = '=IF(RC2="BUY",-(RC6*RC7+RC8),IF(RC2="SELL",RC6*RC7-RC8,' +
  'IF(RC2="DIVIDEND",RC9,IF(RC2="FEE",-RC9,""))))';

function findTransaction_(id) {
  var list = readTransactions_();
  for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
  return null;
}

function lastTransaction_() {
  var list = readTransactions_();
  return list.length ? list[list.length - 1] : null;
}

function deleteTransaction_(id) {
  var t = findTransaction_(id);
  if (!t) return false;
  sheet_(SHEETS.TX).deleteRow(t.row);
  return true;
}

// ---------------------------------------------------------------------------
// Position maths (pure - unit tested)
// ---------------------------------------------------------------------------

/**
 * Average-cost method, one position per type + currency + ticker.
 *  BUY : cost += qty*price + fee
 *  SELL: realised += qty*price - fee - qty*avg ; cost -= qty*avg
 *  FEE : fees += amount        DIVIDEND: dividends += amount
 */
function computePositions(txs) {
  var sorted = txs.slice().sort(function (a, b) {
    return a.date < b.date ? -1 : a.date > b.date ? 1 : (a.row || 0) - (b.row || 0);
  });
  var map = {}, order = [];
  sorted.forEach(function (t) {
    var ccy = t.currency || 'USD';
    var key = t.type + '|' + ccy + '|' + t.ticker;
    if (!map[key]) {
      map[key] = { key: key, type: t.type, currency: ccy, ticker: t.ticker, qty: 0, cost: 0,
        realised: 0, dividends: 0, fees: 0 };
      order.push(key);
    }
    var p = map[key];
    if (t.action === 'BUY') {
      p.qty += t.qty;
      p.cost += t.qty * t.price + (t.fee || 0);
    } else if (t.action === 'SELL') {
      var avg = p.qty > 0 ? p.cost / p.qty : 0;
      var sellQty = Math.min(t.qty, Math.max(p.qty, 0));
      p.realised += t.qty * t.price - (t.fee || 0) - sellQty * avg;
      p.cost -= sellQty * avg;
      p.qty -= t.qty;
      if (Math.abs(p.qty) < 1e-9) { p.qty = 0; p.cost = 0; }
    } else if (t.action === 'FEE') {
      p.fees += t.amount;
    } else if (t.action === 'DIVIDEND') {
      p.dividends += t.amount;
    }
  });
  return order.map(function (k) {
    var p = map[k];
    p.avg = p.qty > 0 ? p.cost / p.qty : 0;
    return p;
  });
}

function getPosition_(type, currency, ticker) {
  var ps = computePositions(readTransactions_());
  for (var i = 0; i < ps.length; i++) {
    var p = ps[i];
    if (p.type === type && p.currency === currency && p.ticker === ticker) return p;
  }
  return null;
}

/** Currency you already hold `ticker` in (any type), or null. */
function heldCurrency_(ticker) {
  var ps = computePositions(readTransactions_());
  for (var i = 0; i < ps.length; i++) if (ps[i].ticker === ticker) return ps[i].currency;
  return null;
}

/** Groups positions into Holdings sections: [{type, currency, positions}], US dollars first. */
function groupSections(positions) {
  var ccyOrder = function (c) { return c === BASE_CCY ? '0' : '1' + c; };
  var groups = {};
  positions.forEach(function (p) {
    var k = p.type + '|' + p.currency;
    (groups[k] = groups[k] || { type: p.type, currency: p.currency, positions: [] }).positions.push(p);
  });
  var list = Object.keys(groups).map(function (k) { return groups[k]; });
  list.sort(function (a, b) {
    if (a.type !== b.type) return a.type === 'SHARES' ? -1 : 1;
    return ccyOrder(a.currency) < ccyOrder(b.currency) ? -1 : 1;
  });
  list.forEach(function (g) {
    g.positions.sort(function (a, b) {
      var ao = a.qty > 1e-9 ? 0 : 1, bo = b.qty > 1e-9 ? 0 : 1;
      return ao !== bo ? ao - bo : b.cost - a.cost;
    });
  });
  // Always show Shares · USD and CFDs · USD, even when empty, so the layout doesn't jump around
  var has = function (type) { return list.some(function (g) { return g.type === type; }); };
  if (!has('SHARES')) list.unshift({ type: 'SHARES', currency: BASE_CCY, positions: [] });
  if (!has('CFD')) list.push({ type: 'CFD', currency: BASE_CCY, positions: [] });
  return list;
}

// ---------------------------------------------------------------------------
// Holdings tab
// ---------------------------------------------------------------------------

function rebuildHoldings_() {
  var sh = sheet_(SHEETS.HOLD);
  var positions = computePositions(readTransactions_()).filter(function (p) {
    return p.qty > 1e-9 || Math.abs(p.realised) > 1e-9 || p.dividends || p.fees;
  });
  ensurePrices_(positions);
  var cats = readCategories_();
  var sections = groupSections(positions);
  var currencies = [];
  sections.forEach(function (s) { if (currencies.indexOf(s.currency) < 0) currencies.push(s.currency); });

  sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).breakApart();
  sh.clear();
  sh.setConditionalFormatRules([]);
  var W = HOLD_HEADERS.length;

  // --- "By currency" table (rows fixed before sections so sections can reference its rates)
  var ccyHeader = 6, ccyFirst = 8, ccyLast = ccyFirst + currencies.length - 1;
  var ccyRow = {};
  currencies.forEach(function (c, i) { ccyRow[c] = ccyFirst + i; });

  // --- sections
  var r = ccyLast + 2;
  var written = [];
  sections.forEach(function (s) {
    var title = (s.type === 'SHARES' ? 'SHARES' : 'CFDs (full position size)') + ' · ' + s.currency;
    var sec = writeSection_(sh, r, title, s, ccyRow[s.currency], cats);
    written.push(sec);
    r = sec.subtotalRow + 2;
  });

  // --- fill the currency table now that subtotal rows are known
  sh.getRange(ccyHeader, 1, 1, CCY_TABLE_HEADERS.length).merge().setValue('BY CURRENCY')
    .setBackground('#202124').setFontColor('#ffffff').setFontWeight('bold');
  sh.getRange(ccyHeader + 1, 1, 1, CCY_TABLE_HEADERS.length).setValues([CCY_TABLE_HEADERS])
    .setBackground('#e8eaed').setFontWeight('bold').setWrap(true);
  var ccyRows = currencies.map(function (c) {
    var subs = written.filter(function (w) { return w.currency === c; }).map(function (w) { return w.subtotalRow; });
    var sumOf = function (col) { return subs.map(function (s) { return col + s; }).join('+'); };
    var row = ccyRow[c];
    return [
      c,
      '=' + sumOf('E'),
      '=' + sumOf('G'),
      '=C' + row + '-B' + row,
      '=IF(B' + row + '>0,D' + row + '/B' + row + ',0)',
      '=' + sumOf('K'),
      '=' + subs.map(function (s) { return 'L' + s + '+M' + s + '-N' + s; }).join('+'),
      '=D' + row + '+G' + row,
      c === BASE_CCY ? 1 : '=IFERROR(GOOGLEFINANCE("CURRENCY:' + c + BASE_CCY + '"),"")',
      '=IFERROR(C' + row + '*I' + row + ',"")',
      '=IFERROR(J' + row + '/$B$4,"")'
    ];
  });
  sh.getRange(ccyFirst, 1, ccyRows.length, CCY_TABLE_HEADERS.length).setValues(ccyRows);
  currencies.forEach(function (c) {
    var row = ccyRow[c];
    sh.getRange(row, 2, 1, 2).setNumberFormat(moneyFmt_(c));
    sh.getRange(row, 4).setNumberFormat(moneyFmt_(c, true));
    sh.getRange(row, 5).setNumberFormat(FMT.PCT_SIGNED);
    sh.getRange(row, 6, 1, 3).setNumberFormat(moneyFmt_(c, true));
    sh.getRange(row, 9).setNumberFormat(FMT.FX);
    sh.getRange(row, 10).setNumberFormat(FMT.USD);
    sh.getRange(row, 11).setNumberFormat(FMT.PCT);
  });

  // --- title + combined totals (always A4:I4 - the Dashboard and bot read these cells)
  sh.getRange('A1').setValue('Holdings').setFontSize(16).setFontWeight('bold');
  sh.getRange('A2').setValue('Rebuilt automatically from the Transactions tab · ' +
    Utilities.formatDate(new Date(), TZ, 'd MMM yyyy, HH:mm') + ' · combined totals in ' + BASE_CCY)
    .setFontColor('#80868b').setFontSize(9);
  var R = function (col) { return col + ccyFirst + ':' + col + ccyLast; };
  var labels = ['Total purchase cost (USD)', 'Total worth now (USD)', 'Unrealised P/L', 'P/L %', 'Today',
    'Realised + dividends − fees', 'Net P/L', 'USD/' + HOME_CCY, 'Total worth (' + HOME_CCY + ')'];
  var f = [
    '=SUMPRODUCT(' + R('B') + ',ARRAYFORMULA(IF(ISNUMBER(' + R('I') + '),' + R('I') + ',0)))',
    '=SUM(' + R('J') + ')',
    '=B4-A4',
    '=IF(A4>0,C4/A4,0)',
    '=SUMPRODUCT(' + R('F') + ',ARRAYFORMULA(IF(ISNUMBER(' + R('I') + '),' + R('I') + ',0)))',
    '=SUMPRODUCT(' + R('G') + ',ARRAYFORMULA(IF(ISNUMBER(' + R('I') + '),' + R('I') + ',0)))',
    '=C4+F4',
    '=IFERROR(GOOGLEFINANCE("CURRENCY:' + BASE_CCY + HOME_CCY + '"),"")',
    '=IFERROR(B4*H4,"")'
  ];
  sh.getRange(3, 1, 1, labels.length).setValues([labels])
    .setFontColor('#5f6368').setFontSize(9).setWrap(true).setVerticalAlignment('bottom');
  sh.getRange(4, 1, 1, f.length).setFormulas([f]).setFontSize(13).setFontWeight('bold');
  sh.getRange('A4:B4').setNumberFormat(FMT.USD);
  sh.getRange('C4').setNumberFormat(FMT.USD_SIGNED);
  sh.getRange('D4').setNumberFormat(FMT.PCT_SIGNED);
  sh.getRange('E4:G4').setNumberFormat(FMT.USD_SIGNED);
  sh.getRange('H4').setNumberFormat(FMT.FX);
  sh.getRange('I4').setNumberFormat(moneyFmt_(HOME_CCY));
  sh.getRange(3, 1, 2, labels.length).setBackground('#f8f9fa');

  // Green / red for gains and losses
  var plRanges = [sh.getRange('C4:G4'), sh.getRange(ccyFirst, 4, currencies.length, 5),
    sh.getRange(ccyLast + 2, 9, 500, 4), sh.getRange(ccyLast + 2, 15, 500, 1)];
  sh.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenNumberGreaterThan(0).setFontColor(GREEN).setRanges(plRanges).build(),
    SpreadsheetApp.newConditionalFormatRule().whenNumberLessThan(0).setFontColor(RED).setRanges(plRanges).build()
  ]);

  sh.setFrozenRows(0);
  sh.setColumnWidth(1, 120);
  for (var c = 2; c <= W; c++) sh.setColumnWidth(c, 112);
  sh.setColumnWidth(W, 170);

  var layout = {
    currencies: currencies.map(function (c) { return { ccy: c, row: ccyRow[c] }; }),
    sections: written
  };
  PropertiesService.getScriptProperties().setProperty('HOLD_LAYOUT', JSON.stringify(layout));
  writeDashboardData_(layout);
}

/** Writes one section (header, rows, subtotal). Returns row numbers used. */
function writeSection_(sh, startRow, title, sec, rateRow, cats) {
  var W = HOLD_HEADERS.length;
  var ccy = sec.currency, list = sec.positions;
  var rate = '$I$' + rateRow;
  sh.getRange(startRow, 1, 1, W).merge().setValue(title)
    .setBackground('#202124').setFontColor('#ffffff').setFontWeight('bold');
  sh.getRange(startRow + 1, 1, 1, W).setValues([HOLD_HEADERS])
    .setBackground('#e8eaed').setFontWeight('bold').setWrap(true).setVerticalAlignment('middle');

  var first = startRow + 2;
  var rows = [];
  list.forEach(function (p, i) {
    var r = first + i;
    var open = p.qty > 1e-9;
    rows.push([
      p.ticker + (open ? '' : ' (closed)'),
      priceFormula_(p.ticker, ccy, 'price'),
      round_(p.qty, 6),
      '=IF(C' + r + '>0,E' + r + '/C' + r + ',"")',
      round_(p.cost, 6),
      '=IFERROR(E' + r + '*' + rate + '/$A$4,0)',
      '=IF(C' + r + '=0,0,IFERROR(B' + r + '*C' + r + ',""))',
      '=IFERROR(G' + r + '*' + rate + '/$B$4,"")',
      '=IFERROR(G' + r + '-E' + r + ',"")',
      '=IFERROR(I' + r + '/E' + r + ',"")',
      open ? '=IFERROR(' + priceFormula_(p.ticker, ccy, 'change', true) + '*C' + r + ',0)' : 0,
      round_(p.realised, 6),
      round_(p.dividends, 6),
      round_(p.fees, 6),
      '=IFERROR(I' + r + ',0)+L' + r + '+M' + r + '-N' + r,
      (cats[p.ticker] && cats[p.ticker].assetType) || UNCATEGORISED,
      (cats[p.ticker] && cats[p.ticker].assetType === 'ETF') ? '—' : ((cats[p.ticker] && cats[p.ticker].sector) || UNCATEGORISED)
    ]);
  });
  if (!rows.length) {
    var empty = ['(none yet)'];
    for (var k = 1; k < W; k++) empty.push('');
    rows.push(empty);
  }
  var last = first + rows.length - 1;
  sh.getRange(first, 1, rows.length, W).setValues(rows);
  list.forEach(function (p, i) {
    if (p.qty <= 1e-9) sh.getRange(first + i, 1, 1, W).setFontColor('#9aa0a6');
  });
  if (!list.length) sh.getRange(first, 1).setFontColor('#9aa0a6').setFontStyle('italic');

  var sub = last + 1;
  var sum = function (col) { return '=SUM(' + col + first + ':' + col + last + ')'; };
  sh.getRange(sub, 1, 1, W).setValues([[
    'Subtotal (' + ccy + ')', '', '', '', sum('E'), sum('F'), sum('G'), sum('H'), sum('I'),
    '=IFERROR(I' + sub + '/E' + sub + ',"")', sum('K'), sum('L'), sum('M'), sum('N'), sum('O'), '', ''
  ]]).setFontWeight('bold').setBackground('#f1f3f4').setBorder(true, null, null, null, null, null);

  var n = sub - first + 1;
  var money = moneyFmt_(ccy), signed = moneyFmt_(ccy, true);
  sh.getRange(first, 2, n, 1).setNumberFormat(priceFmt_(ccy));
  sh.getRange(first, 3, n, 1).setNumberFormat(FMT.QTY);
  sh.getRange(first, 4, n, 1).setNumberFormat(priceFmt_(ccy));
  sh.getRange(first, 5, n, 1).setNumberFormat(money);
  sh.getRange(first, 6, n, 1).setNumberFormat(FMT.PCT);
  sh.getRange(first, 7, n, 1).setNumberFormat(money);
  sh.getRange(first, 8, n, 1).setNumberFormat(FMT.PCT);
  sh.getRange(first, 9, n, 1).setNumberFormat(signed);
  sh.getRange(first, 10, n, 1).setNumberFormat(FMT.PCT_SIGNED);
  sh.getRange(first, 11, n, 2).setNumberFormat(signed);
  sh.getRange(first, 13, n, 2).setNumberFormat(money);
  sh.getRange(first, 15, n, 1).setNumberFormat(signed);

  return { type: sec.type, currency: ccy, first: first, last: last, subtotalRow: sub, rateRow: rateRow,
    count: list.length, tickers: list.map(function (p) { return p.ticker; }),
    buckets: list.map(function (p) { return sectorBucket(cats[p.ticker]); }),
    assetTypes: list.map(function (p) { return (cats[p.ticker] && cats[p.ticker].assetType) || UNCATEGORISED; }),
    open: list.map(function (p) { return p.qty > 1e-9; }) };
}

/** Live price (or daily change) formula: Google Finance for USD, the Prices tab (Yahoo) otherwise. */
function priceFormula_(ticker, ccy, field, bare) {
  var f;
  if (ccy === 'USD') {
    f = 'GOOGLEFINANCE("' + ticker + '","' + field + '")';
  } else {
    f = 'VLOOKUP("' + yahooSymbol_(ticker, ccy) + '",' + SHEETS.PRICES + '!$A:$D,' + (field === 'price' ? 2 : 4) + ',FALSE)';
  }
  return bare ? f : '=IFERROR(' + f + ',"")';
}

function yahooSymbol_(ticker, ccy) {
  var suffix = (CURRENCIES[ccy] || {}).yahoo || '';
  return ticker.replace(/\./g, '-') + suffix;
}

/**
 * Feeds the Dashboard: currency, sector and asset-type tables + chart data.
 * Everything here is in USD so slices can be compared.
 *   K:N  one row per open position: label, worth (USD), sector bucket, asset type
 *   P:Q  Shares vs CFDs      S:T  by currency
 *   A18:C31 by sector        E18:G21 by asset type   (visible tables, also chart sources)
 */
function writeDashboardData_(layout) {
  var sh = sheet_(SHEETS.DASH);
  if (!sh) return;

  // By-currency table (A9:G14)
  sh.getRange('A9:G14').clearContent().setNumberFormat('General');
  var rows = layout.currencies.slice(0, 6).map(function (c) {
    var r = c.row;
    return [c.ccy, '=Holdings!C' + r, '=Holdings!D' + r, '=Holdings!E' + r, '=Holdings!F' + r,
      '=Holdings!J' + r, '=Holdings!K' + r];
  });
  if (rows.length) sh.getRange(9, 1, rows.length, 7).setValues(rows);
  layout.currencies.slice(0, 6).forEach(function (c, i) {
    var r = 9 + i;
    sh.getRange(r, 2).setNumberFormat(moneyFmt_(c.ccy));
    sh.getRange(r, 3).setNumberFormat(moneyFmt_(c.ccy, true));
    sh.getRange(r, 4).setNumberFormat(FMT.PCT_SIGNED);
    sh.getRange(r, 5).setNumberFormat(moneyFmt_(c.ccy, true));
    sh.getRange(r, 6).setNumberFormat(FMT.USD);
    sh.getRange(r, 7).setNumberFormat(FMT.PCT);
  });

  // One row per open position, in USD (K:N)
  sh.getRange('K4:N300').clearContent();
  var alloc = [], buckets = [], types = [];
  layout.sections.forEach(function (sec) {
    var label = (sec.type === 'CFD' ? ' (CFD)' : '') + (sec.currency !== BASE_CCY ? ' ' + sec.currency : '');
    sec.tickers.forEach(function (tk, i) {
      if (!sec.open[i]) return;
      var r = sec.first + i;
      alloc.push([tk + label, '=IFERROR(Holdings!G' + r + '*Holdings!$I$' + sec.rateRow + ',"")',
        sec.buckets[i], sec.assetTypes[i]]);
      if (buckets.indexOf(sec.buckets[i]) < 0) buckets.push(sec.buckets[i]);
      if (types.indexOf(sec.assetTypes[i]) < 0) types.push(sec.assetTypes[i]);
    });
  });
  if (alloc.length) sh.getRange(4, 11, alloc.length, 4).setValues(alloc);

  // Shares vs CFDs (P:Q)
  var part = function (type) {
    var terms = layout.sections.filter(function (s) { return s.type === type; })
      .map(function (s) { return 'N(Holdings!G' + s.subtotalRow + ')*N(Holdings!I' + s.rateRow + ')'; });
    return terms.length ? '=' + terms.join('+') : 0;
  };
  sh.getRange('P4:Q5').setValues([['Shares', part('SHARES')], ['CFDs', part('CFD')]]);

  // By currency (S:T)
  sh.getRange('S4:T20').clearContent();
  var byCcy = layout.currencies.map(function (c) { return [c.ccy, '=Holdings!J' + c.row]; });
  if (byCcy.length) sh.getRange(4, 19, byCcy.length, 2).setValues(byCcy);

  // By sector (A18:C31): GICS order, then ETFs, then Uncategorised
  var order = SECTORS.map(function (x) { return x[0]; }).concat(['ETFs', UNCATEGORISED]);
  buckets.sort(function (a, b) { return order.indexOf(a) - order.indexOf(b); });
  writeBreakdown_(sh, 18, 1, 14, buckets, 'M');
  // By asset type (E18:G21)
  types.sort(function (a, b) {
    return ASSET_TYPES.concat([UNCATEGORISED]).indexOf(a) - ASSET_TYPES.concat([UNCATEGORISED]).indexOf(b);
  });
  writeBreakdown_(sh, 18, 5, 4, types, 'N');
}

/** Small "label | worth (USD) | %" table summing the K:N position rows by one column. */
function writeBreakdown_(sh, row, col, maxRows, labels, byCol) {
  sh.getRange(row, col, maxRows, 3).clearContent();
  var rows = labels.slice(0, maxRows).map(function (lab, i) {
    var r = row + i, cell = sh.getRange(r, col).getA1Notation();
    return [lab, '=SUMIF($' + byCol + '$4:$' + byCol + '$300,' + cell + ',$L$4:$L$300)',
      '=IFERROR(' + sh.getRange(r, col + 1).getA1Notation() + '/Holdings!$B$4,"")'];
  });
  if (rows.length) sh.getRange(row, col, rows.length, 3).setValues(rows);
  sh.getRange(row, col + 1, maxRows, 1).setNumberFormat(FMT.USD);
  sh.getRange(row, col + 2, maxRows, 1).setNumberFormat(FMT.PCT);
}

// ---------------------------------------------------------------------------
// Live data
//  - US stocks + FX: GOOGLEFINANCE. Scripts can't call it directly, so we use a
//    scratch tab: write the formula, let Sheets calculate, read the result.
//  - Everything else (SGX...): Yahoo Finance, cached in the Prices tab.
// ---------------------------------------------------------------------------

function googleQuote_(ticker) {
  if (!/^[A-Z0-9][A-Z0-9.\-:]{0,14}$/.test(ticker)) return null;
  var sh = sheet_(SHEETS.QUOTE);
  sh.getRange('A1:B1').setFormulas([[
    '=GOOGLEFINANCE("' + ticker + '","price")',
    '=GOOGLEFINANCE("' + ticker + '","name")'
  ]]);
  for (var i = 0; i < 4; i++) {
    SpreadsheetApp.flush();
    var v = sh.getRange('A1:B1').getValues()[0];
    if (typeof v[0] === 'number' && v[0] > 0) return { price: v[0], name: String(v[1] || ticker) };
    if (String(v[0]).indexOf('#') === 0 && i >= 1) return null; // #N/A: not a real ticker
    Utilities.sleep(700);
  }
  return null;
}

/** Fetches one symbol from Yahoo Finance. Returns {price, prev, change, currency, name} or null. */
function yahooQuote_(symbol) {
  var hosts = ['query1', 'query2'];
  for (var i = 0; i < hosts.length; i++) {
    try {
      var res = UrlFetchApp.fetch('https://' + hosts[i] + '.finance.yahoo.com/v8/finance/chart/' +
        encodeURIComponent(symbol) + '?interval=1d&range=5d', {
        muteHttpExceptions: true, headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      if (res.getResponseCode() === 404) return null;
      if (res.getResponseCode() !== 200) continue;
      var result = JSON.parse(res.getContentText()).chart.result;
      if (!result || !result[0]) return null;
      var m = result[0].meta;
      var price = Number(m.regularMarketPrice);
      if (!(price > 0)) return null;
      var closes = ((result[0].indicators || {}).quote || [{}])[0].close || [];
      var prev = Number(m.previousClose) || round_(prevClose_(closes, result[0].timestamp, m.regularMarketTime) || 0, 6) ||
        Number(m.chartPreviousClose) || price;
      return { price: price, prev: prev, change: price - prev, currency: String(m.currency || '').toUpperCase(),
        name: m.longName || m.shortName || symbol };
    } catch (e) {
      log_('PRICE-ERROR', symbol, String(e));
    }
  }
  return null;
}

/** Yesterday's close from a 5-day chart (the last close before today's bar). */
function prevClose_(closes, stamps, marketTime) {
  if (!closes || !stamps) return null;
  for (var i = stamps.length - 1; i >= 0; i--) {
    if (stamps[i] < marketTime - 12 * 3600 && closes[i] > 0) return closes[i];
  }
  return null;
}

/**
 * Looks a ticker up. With `ccy`, only that market is tried; without it, each
 * autoDetect market in turn (US first, then SGX). Returns {price, name, currency} or null.
 */
function quote_(ticker, ccy) {
  var tries = ccy ? [ccy] : Object.keys(CURRENCIES).filter(function (c) { return CURRENCIES[c].autoDetect; });
  for (var i = 0; i < tries.length; i++) {
    var c = tries[i], q = null;
    if (c === 'USD') {
      q = googleQuote_(ticker);
      if (!q) {
        var y = yahooQuote_(yahooSymbol_(ticker, 'USD'));
        if (y && (!y.currency || y.currency === 'USD')) q = { price: y.price, name: y.name };
      }
    } else {
      var sym = yahooSymbol_(ticker, c);
      var yq = yahooQuote_(sym);
      if (yq) { savePrice_(sym, yq); q = { price: yq.price, name: yq.name }; }
    }
    if (q) return { price: q.price, name: q.name, currency: c };
  }
  return null;
}

/** Exchange rate from -> to via GOOGLEFINANCE (1 when they're the same). */
function fxRate_(from, to) {
  from = from || BASE_CCY; to = to || HOME_CCY;
  if (from === to) return 1;
  var sh = sheet_(SHEETS.QUOTE);
  sh.getRange('A2').setFormula('=GOOGLEFINANCE("CURRENCY:' + from + to + '")');
  for (var i = 0; i < 3; i++) {
    SpreadsheetApp.flush();
    var v = sh.getRange('A2').getValue();
    if (typeof v === 'number' && v > 0) return v;
    Utilities.sleep(500);
  }
  return null;
}

// --- Yahoo search: "rocket lab" -> RKLB, "mapletree" -> ME8U / M44U / N2IU ----

var US_EXCHANGES = ['NMS', 'NGM', 'NCM', 'NYQ', 'ASE', 'PCX', 'BTS', 'NAS', 'NYS'];

/**
 * Searches Yahoo for what you typed. If nothing matches, retries with a shorter
 * version (catches typos: "palantr" -> "palan" -> PLTR). US + SGX results only.
 */
function yahooSearch_(text) {
  var q = String(text || '').trim().toLowerCase();
  if (!q) return [];
  var tries = [q];
  if (q.length > 5) tries.push(q.slice(0, 5));
  if (q.length > 3) tries.push(q.slice(0, 3));
  for (var i = 0; i < tries.length; i++) {
    var quotes = yahooSearchRaw_(tries[i]);
    var picked = pickSearchResults(quotes);
    if (picked.length) return picked;
  }
  return [];
}

function yahooSearchRaw_(q) {
  try {
    var res = UrlFetchApp.fetch('https://query1.finance.yahoo.com/v1/finance/search?q=' + encodeURIComponent(q) +
      '&quotesCount=8&newsCount=0', { muteHttpExceptions: true, headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (res.getResponseCode() !== 200) return [];
    return JSON.parse(res.getContentText()).quotes || [];
  } catch (e) {
    log_('SEARCH-ERROR', q, String(e));
    return [];
  }
}

/** Keeps US and SGX stocks/ETFs from a Yahoo search result (pure - unit tested). */
function pickSearchResults(quotes) {
  var out = [], seen = {};
  (quotes || []).forEach(function (x) {
    if (!x || !x.symbol || (x.quoteType !== 'EQUITY' && x.quoteType !== 'ETF')) return;
    var sym = String(x.symbol), ticker, ccy;
    if (/\.SI$/.test(sym)) { ticker = sym.slice(0, -3); ccy = 'SGD'; }
    else if (US_EXCHANGES.indexOf(x.exchange) >= 0 && !/[.=^]/.test(sym)) { ticker = sym.replace(/-/g, '.'); ccy = 'USD'; }
    else return;
    if (seen[ticker]) return;
    seen[ticker] = true;
    var cat = categoryFromYahoo(x);
    out.push({ ticker: ticker, currency: ccy, name: x.longname || x.shortname || ticker,
      exchange: ccy === 'SGD' ? 'SGX' : (x.exchDisp || 'US'),
      assetType: cat.assetType, sector: cat.sector, industry: cat.industry });
  });
  return out.slice(0, 4);
}

/** Yahoo quote -> {assetType, sector, industry} in our terms (pure - unit tested). */
function categoryFromYahoo(x) {
  var industry = String(x.industry || x.industryDisp || '');
  var assetType = x.quoteType === 'ETF' ? 'ETF' : /^REIT/i.test(industry) ? 'REIT' : 'Company';
  var sector = assetType === 'ETF' ? '' : (YAHOO_SECTORS[x.sector] || YAHOO_SECTORS[x.sectorDisp] || '');
  if (assetType === 'REIT' && !sector) sector = 'Real Estate';
  return { assetType: assetType, sector: sector, industry: industry };
}

/** Category for one ticker via Yahoo search on its exact symbol, or null. */
function yahooProfile_(ticker, ccy) {
  var sym = yahooSymbol_(ticker, ccy);
  var quotes = yahooSearchRaw_(sym);
  for (var i = 0; i < quotes.length; i++) {
    if (String(quotes[i].symbol).toUpperCase() === sym.toUpperCase()) {
      var c = categoryFromYahoo(quotes[i]);
      if (c.assetType === 'Company' && !c.sector) return null; // not enough to go on
      c.name = quotes[i].longname || quotes[i].shortname || ticker;
      return c;
    }
  }
  return null;
}

// --- Categories tab ---------------------------------------------------------

function readCategories_() {
  var sh = sheet_(SHEETS.CATS), map = {};
  if (!sh) return map;
  var last = sh.getLastRow();
  if (last < 2) return map;
  sh.getRange(2, 1, last - 1, CAT_HEADERS.length).getValues().forEach(function (r, i) {
    var tk = String(r[0] || '').trim().toUpperCase();
    if (!tk) return;
    map[tk] = { row: i + 2, name: r[1], assetType: String(r[2] || '').trim(), sector: String(r[3] || '').trim(),
      industry: r[4], source: r[5] };
  });
  return map;
}

function saveCategory_(ticker, c, source) {
  var sh = sheet_(SHEETS.CATS);
  var existing = readCategories_()[ticker];
  var row = [ticker, c.name || (existing && existing.name) || '', c.assetType || '',
    c.assetType === 'ETF' ? '' : (c.sector || ''), c.industry || '', source];
  if (existing) sh.getRange(existing.row, 1, 1, row.length).setValues([row]);
  else sh.appendRow(row);
}

/** Where a holding goes in the sector breakdown: ETFs get their own slice. */
function sectorBucket(cat) {
  if (!cat || !cat.assetType) return UNCATEGORISED;
  if (cat.assetType === 'ETF') return 'ETFs';
  return cat.sector || UNCATEGORISED;
}

/** Menu: look up every held ticker that has no category yet. */
function categoriseAll() {
  var cats = readCategories_();
  var done = [], missing = [], seen = {};
  computePositions(readTransactions_()).forEach(function (p) {
    if (cats[p.ticker] || seen[p.ticker]) return;
    seen[p.ticker] = true;
    var c = yahooProfile_(p.ticker, p.currency);
    if (c) { saveCategory_(p.ticker, c, 'auto'); done.push(p.ticker); }
    else missing.push(p.ticker);
  });
  rebuildHoldings_();
  var msg = 'Categorised ' + done.length + ' ticker(s).' +
    (missing.length ? ' Not found - fill these in on the Categories tab: ' + missing.join(', ') : '');
  try { SpreadsheetApp.getActive().toast(msg, 'Categories', 10); } catch (e) {}
  console.log(msg);
  return msg;
}

// --- Prices tab (Yahoo cache) ----------------------------------------------

function readPrices_() {
  var sh = sheet_(SHEETS.PRICES);
  var last = sh.getLastRow(), map = {};
  if (last >= 2) {
    sh.getRange(2, 1, last - 1, PRICE_HEADERS.length).getValues().forEach(function (r) {
      if (r[0]) map[String(r[0])] = r;
    });
  }
  return map;
}

function writePrices_(map) {
  var sh = sheet_(SHEETS.PRICES);
  var keys = Object.keys(map).sort();
  var last = sh.getLastRow();
  if (last >= 2) sh.getRange(2, 1, last - 1, PRICE_HEADERS.length).clearContent();
  if (keys.length) {
    sh.getRange(2, 1, keys.length, PRICE_HEADERS.length).setValues(keys.map(function (k) { return map[k]; }));
  }
}

function priceRow_(sym, q) {
  return [sym, q.price, q.prev, q.change, q.currency, q.name,
    Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm')];
}

function savePrice_(sym, q) {
  var map = readPrices_();
  map[sym] = priceRow_(sym, q);
  writePrices_(map);
}

/** Yahoo symbols needed for the non-USD positions you still hold. */
function yahooSymbolsHeld_(positions) {
  var syms = [];
  positions.forEach(function (p) {
    if (p.currency === 'USD' || p.qty <= 1e-9) return;
    var s = yahooSymbol_(p.ticker, p.currency);
    if (syms.indexOf(s) < 0) syms.push(s);
  });
  return syms;
}

/** Fetches prices for any held non-USD symbol missing from the Prices tab. */
function ensurePrices_(positions) {
  var map = readPrices_();
  var missing = yahooSymbolsHeld_(positions).filter(function (s) { return !map[s]; });
  if (!missing.length) return;
  missing.forEach(function (s) { var q = yahooQuote_(s); if (q) map[s] = priceRow_(s, q); });
  writePrices_(map);
}

/** Refreshes every held non-USD price. Menu item + 15-minute trigger (during Asian market hours). */
function refreshPrices(force) {
  if (force !== true) {
    var now = new Date();
    var day = Number(Utilities.formatDate(now, TZ, 'u')); // 1=Mon..7=Sun
    var hm = Number(Utilities.formatDate(now, TZ, 'HHmm'));
    if (day > 5 || hm < 830 || hm > 1730) return;
  }
  var positions = computePositions(readTransactions_());
  var map = readPrices_();
  yahooSymbolsHeld_(positions).forEach(function (s) {
    var q = yahooQuote_(s);
    if (q) map[s] = priceRow_(s, q);
  });
  writePrices_(map);
}
function menuRefreshPrices() { refreshPrices(true); SpreadsheetApp.getActive().toast('Prices refreshed'); }

// ---------------------------------------------------------------------------
// Portfolio summary for the bot (reads the calculated Holdings tab)
// ---------------------------------------------------------------------------

function readPortfolio_() {
  SpreadsheetApp.flush();
  var sh = sheet_(SHEETS.HOLD);
  var layout = JSON.parse(PropertiesService.getScriptProperties().getProperty('HOLD_LAYOUT') || 'null');
  if (!layout || !layout.currencies) { rebuildHoldings_(); return readPortfolio_(); }
  var s = sh.getRange('A4:I4').getValues()[0];
  var out = {
    cost: s[0], worth: s[1], unrealised: s[2], pct: s[3], today: s[4],
    other: s[5], net: s[6], fx: s[7], worthHome: s[8], currencies: [], sections: []
  };
  layout.currencies.forEach(function (c) {
    var v = sh.getRange(c.row, 1, 1, CCY_TABLE_HEADERS.length).getValues()[0];
    out.currencies.push({ ccy: c.ccy, cost: v[1], worth: v[2], pl: v[3], pct: v[4], today: v[5],
      worthBase: v[9], weight: v[10] });
  });
  layout.sections.forEach(function (sec) {
    var rows = [];
    if (sec.count) {
      sh.getRange(sec.first, 1, sec.count, 15).getValues().forEach(function (r, i) {
        if (Number(r[2]) > 0) rows.push({ ticker: sec.tickers[i], qty: r[2], price: r[1], worth: r[6],
          weight: r[7], pl: r[8], plPct: r[9] });
      });
    }
    out.sections.push({ type: sec.type, currency: sec.currency, rows: rows });
  });
  out.sectors = [];
  var dash = sheet_(SHEETS.DASH);
  if (dash) {
    dash.getRange('A18:C31').getValues().forEach(function (r) {
      if (r[0] && typeof r[1] === 'number' && r[1] > 0) out.sectors.push({ name: r[0], worth: r[1], weight: r[2] });
    });
    out.sectors.sort(function (a, b) { return b.worth - a.worth; });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Bot log + daily history
// ---------------------------------------------------------------------------

function log_(direction, text, details) {
  try {
    var sh = sheet_(SHEETS.LOG);
    sh.appendRow([Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss'), direction,
      String(text || '').slice(0, 2000), typeof details === 'string' ? details : JSON.stringify(details || '')]);
    if (sh.getLastRow() > 3000) sh.deleteRows(2, 500); // keep the log from growing forever
  } catch (e) { console.error(e); }
}

/** Saves today's totals to History. Runs daily via a trigger; also in the Portfolio menu. */
function snapshot() {
  refreshPrices(true);
  SpreadsheetApp.flush();
  var v = sheet_(SHEETS.HOLD).getRange('A4:I4').getValues()[0];
  var worth = v[1];
  if (typeof worth !== 'number') { console.warn('Snapshot skipped: prices not loaded (' + worth + ')'); return; }
  var sh = sheet_(SHEETS.HIST);
  var today = todayIso_();
  var row = [today, worth, v[0], v[6], v[7], v[8]];
  var last = sh.getLastRow();
  if (last >= 2 && toIso_(sh.getRange(last, 1).getValue()) === today) {
    sh.getRange(last, 1, 1, row.length).setValues([row]);
  } else {
    sh.appendRow(row);
  }
}

if (typeof module !== 'undefined') {
  module.exports = { computePositions: computePositions, groupSections: groupSections,
    pickSearchResults: pickSearchResults, categoryFromYahoo: categoryFromYahoo, sectorBucket: sectorBucket };
}
