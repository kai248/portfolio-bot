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
    var ticker = String(r[TX.TICKER - 1] || '').trim().toUpperCase();
    if (ACTIONS.indexOf(action) < 0 || !ticker) return;
    var type = String(r[TX.TYPE - 1] || '').trim().toUpperCase();
    out.push({
      row: i + 2,
      date: toIso_(r[TX.DATE - 1]),
      action: action,
      type: TYPES.indexOf(type) >= 0 ? type : 'STOCK',
      ticker: ticker,
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
    t.date, t.action, t.type, t.ticker,
    isTrade ? t.qty : '', isTrade ? t.price : '', isTrade ? (t.fee || 0) : '',
    isTrade ? '' : t.amount,
    '', t.notes || '', Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss'), id
  ];
  var r = sh.getLastRow() + 1;
  sh.getRange(r, 1, 1, row.length).setValues([row]);
  sh.getRange(r, TX.CASH).setFormulaR1C1(CASH_FLOW_R1C1);
  return id;
}

/** Cash flow per row: money out of your account is negative. Recalculates if you edit a row. */
var CASH_FLOW_R1C1 = '=IF(RC2="BUY",-(RC5*RC6+RC7),IF(RC2="SELL",RC5*RC6-RC7,' +
  'IF(RC2="DIVIDEND",RC8,IF(RC2="FEE",-RC8,""))))';

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
 * Average-cost method.
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
    var key = t.type + '|' + t.ticker;
    if (!map[key]) {
      map[key] = { key: key, type: t.type, ticker: t.ticker, qty: 0, cost: 0, realised: 0, dividends: 0, fees: 0 };
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

function getPosition_(type, ticker) {
  var ps = computePositions(readTransactions_());
  for (var i = 0; i < ps.length; i++) if (ps[i].type === type && ps[i].ticker === ticker) return ps[i];
  return null;
}

// ---------------------------------------------------------------------------
// Holdings tab
// ---------------------------------------------------------------------------

var HOLD_FIRST_SECTION_ROW = 6;

function rebuildHoldings_() {
  var sh = sheet_(SHEETS.HOLD);
  var positions = computePositions(readTransactions_()).filter(function (p) {
    return p.qty > 1e-9 || Math.abs(p.realised) > 1e-9 || p.dividends || p.fees;
  });
  function bySize(a, b) {
    var ao = a.qty > 1e-9 ? 0 : 1, bo = b.qty > 1e-9 ? 0 : 1;
    return ao !== bo ? ao - bo : b.cost - a.cost;
  }
  var stocks = positions.filter(function (p) { return p.type === 'STOCK'; }).sort(bySize);
  var cfds = positions.filter(function (p) { return p.type === 'CFD'; }).sort(bySize);

  sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).breakApart();
  sh.clear();
  sh.setConditionalFormatRules([]);
  var W = HOLD_HEADERS.length;

  var r = HOLD_FIRST_SECTION_ROW;
  var stockSec = writeSection_(sh, r, 'STOCKS', stocks);
  r = stockSec.subtotalRow + 2;
  var cfdSec = writeSection_(sh, r, 'CFDs (full position size)', cfds);
  var sS = stockSec.subtotalRow, sC = cfdSec.subtotalRow;

  // Title + summary
  sh.getRange('A1').setValue('Holdings').setFontSize(16).setFontWeight('bold');
  sh.getRange('A2').setValue('Rebuilt automatically from the Transactions tab · ' +
    Utilities.formatDate(new Date(), TZ, 'd MMM yyyy, HH:mm')).setFontColor('#80868b').setFontSize(9);
  var labels = ['Total purchase cost', 'Total worth now', 'Unrealised P/L', 'P/L %', 'Today',
    'Realised + dividends − fees', 'Net P/L', 'USD/MYR', 'Total worth (MYR)'];
  var f = [
    '=E' + sS + '+E' + sC,
    '=G' + sS + '+G' + sC,
    '=B4-A4',
    '=IF(A4>0,C4/A4,0)',
    '=K' + sS + '+K' + sC,
    '=L' + sS + '+L' + sC + '+M' + sS + '+M' + sC + '-N' + sS + '-N' + sC,
    '=C4+F4',
    '=IFERROR(GOOGLEFINANCE("CURRENCY:USDMYR"),"")',
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
  sh.getRange('I4').setNumberFormat(FMT.MYR);
  sh.getRange(3, 1, 2, labels.length).setBackground('#f8f9fa');

  // Green / red for gains and losses
  var plRanges = [sh.getRange('C4:G4'), sh.getRange('I6:L500'), sh.getRange('O6:O500')];
  sh.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenNumberGreaterThan(0).setFontColor(GREEN).setRanges(plRanges).build(),
    SpreadsheetApp.newConditionalFormatRule().whenNumberLessThan(0).setFontColor(RED).setRanges(plRanges).build()
  ]);

  sh.setFrozenRows(0);
  sh.setColumnWidth(1, 110);
  for (var c = 2; c <= W; c++) sh.setColumnWidth(c, 112);

  PropertiesService.getScriptProperties().setProperty('HOLD_LAYOUT', JSON.stringify({
    stock: stockSec, cfd: cfdSec
  }));
  writeDashboardChartData_(stockSec, cfdSec);
}

/** Writes one section (header, rows, subtotal). Returns row numbers used. */
function writeSection_(sh, startRow, title, list) {
  var W = HOLD_HEADERS.length;
  sh.getRange(startRow, 1, 1, W).merge().setValue(title)
    .setBackground('#202124').setFontColor('#ffffff').setFontWeight('bold');
  sh.getRange(startRow + 1, 1, 1, W).setValues([HOLD_HEADERS])
    .setBackground('#e8eaed').setFontWeight('bold').setWrap(true).setVerticalAlignment('middle');

  var first = startRow + 2;
  var rows = [];
  list.forEach(function (p, i) {
    var r = first + i;
    rows.push([
      p.ticker,
      '=IFERROR(GOOGLEFINANCE(A' + r + ',"price"),"")',
      round_(p.qty, 6),
      '=IF(C' + r + '>0,E' + r + '/C' + r + ',"")',
      round_(p.cost, 6),
      '=IF($A$4>0,E' + r + '/$A$4,0)',
      '=IF(C' + r + '=0,0,IFERROR(B' + r + '*C' + r + ',""))',
      '=IFERROR(G' + r + '/$B$4,"")',
      '=IFERROR(G' + r + '-E' + r + ',"")',
      '=IFERROR(I' + r + '/E' + r + ',"")',
      '=IF(C' + r + '=0,0,IFERROR(GOOGLEFINANCE(A' + r + ',"change")*C' + r + ',0))',
      round_(p.realised, 6),
      round_(p.dividends, 6),
      round_(p.fees, 6),
      '=IFERROR(I' + r + ',0)+L' + r + '+M' + r + '-N' + r
    ]);
  });
  if (!rows.length) {
    var empty = ['(none yet)'];
    for (var k = 1; k < W; k++) empty.push('');
    rows.push(empty);
  }
  var last = first + rows.length - 1;
  sh.getRange(first, 1, rows.length, W).setValues(rows);
  if (list.length) {
    var closed = [];
    list.forEach(function (p, i) { if (p.qty <= 1e-9) closed.push(first + i); });
    closed.forEach(function (r) {
      sh.getRange(r, 1).setValue(sh.getRange(r, 1).getValue() + ' (closed)');
      sh.getRange(r, 1, 1, W).setFontColor('#9aa0a6');
    });
    // Closed rows' ticker cells now read "META (closed)" - point their formulas at the plain ticker.
    closed.forEach(function (r) {
      var tk = list[r - first].ticker;
      sh.getRange(r, 2).setFormula('=IFERROR(GOOGLEFINANCE("' + tk + '","price"),"")');
      sh.getRange(r, 11).setValue(0);
    });
  } else {
    sh.getRange(first, 1).setFontColor('#9aa0a6').setFontStyle('italic');
  }

  var sub = last + 1;
  var sum = function (col) { return '=SUM(' + col + first + ':' + col + last + ')'; };
  sh.getRange(sub, 1, 1, W).setValues([[
    'Subtotal', '', '', '', sum('E'), sum('F'), sum('G'), sum('H'), sum('I'),
    '=IFERROR(I' + sub + '/E' + sub + ',"")', sum('K'), sum('L'), sum('M'), sum('N'), sum('O')
  ]]).setFontWeight('bold').setBackground('#f1f3f4').setBorder(true, null, null, null, null, null);

  var n = sub - first + 1;
  sh.getRange(first, 2, n, 1).setNumberFormat(FMT.USD);
  sh.getRange(first, 3, n, 1).setNumberFormat(FMT.QTY);
  sh.getRange(first, 4, n, 2).setNumberFormat(FMT.USD);
  sh.getRange(first, 6, n, 1).setNumberFormat(FMT.PCT);
  sh.getRange(first, 7, n, 1).setNumberFormat(FMT.USD);
  sh.getRange(first, 8, n, 1).setNumberFormat(FMT.PCT);
  sh.getRange(first, 9, n, 1).setNumberFormat(FMT.USD_SIGNED);
  sh.getRange(first, 10, n, 1).setNumberFormat(FMT.PCT_SIGNED);
  sh.getRange(first, 11, n, 2).setNumberFormat(FMT.USD_SIGNED);
  sh.getRange(first, 13, n, 2).setNumberFormat(FMT.USD);
  sh.getRange(first, 15, n, 1).setNumberFormat(FMT.USD_SIGNED);

  return { first: first, last: last, subtotalRow: sub, count: list.length,
    tickers: list.map(function (p) { return p.ticker; }) };
}

/** Feeds the Dashboard charts (allocation pie + stocks vs CFDs). */
function writeDashboardChartData_(stockSec, cfdSec) {
  var sh = sheet_(SHEETS.DASH);
  if (!sh) return;
  sh.getRange('K4:L200').clearContent();
  var rows = [];
  [[stockSec, ''], [cfdSec, ' (CFD)']].forEach(function (pair) {
    var sec = pair[0];
    sec.tickers.forEach(function (tk, i) {
      rows.push([tk + pair[1], '=IF(Holdings!C' + (sec.first + i) + '>0,Holdings!G' + (sec.first + i) + ',"")']);
    });
  });
  if (rows.length) sh.getRange(4, 11, rows.length, 2).setValues(rows);
  sh.getRange('N4:O5').setValues([
    ['Stocks', '=Holdings!G' + stockSec.subtotalRow],
    ['CFDs', '=Holdings!G' + cfdSec.subtotalRow]
  ]);
}

// ---------------------------------------------------------------------------
// Live data via GOOGLEFINANCE (scripts can't call it directly, so we use a
// scratch tab: write the formula, let Sheets calculate, read the result)
// ---------------------------------------------------------------------------

function quote_(ticker) {
  if (!/^[A-Z][A-Z0-9.\-:]{0,14}$/.test(ticker)) return null;
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

function fxRate_() {
  var sh = sheet_(SHEETS.QUOTE);
  sh.getRange('A2').setFormula('=GOOGLEFINANCE("CURRENCY:USDMYR")');
  for (var i = 0; i < 3; i++) {
    SpreadsheetApp.flush();
    var v = sh.getRange('A2').getValue();
    if (typeof v === 'number' && v > 0) return v;
    Utilities.sleep(500);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Portfolio summary for the bot (reads the calculated Holdings tab)
// ---------------------------------------------------------------------------

function readPortfolio_() {
  SpreadsheetApp.flush();
  var sh = sheet_(SHEETS.HOLD);
  var layout = JSON.parse(PropertiesService.getScriptProperties().getProperty('HOLD_LAYOUT') || 'null');
  if (!layout) { rebuildHoldings_(); return readPortfolio_(); }
  var s = sh.getRange('A4:I4').getValues()[0];
  var out = {
    cost: s[0], worth: s[1], unrealised: s[2], pct: s[3], today: s[4],
    other: s[5], net: s[6], fx: s[7], worthMyr: s[8], sections: []
  };
  [['Stocks', layout.stock], ['CFDs', layout.cfd]].forEach(function (pair) {
    var sec = pair[1], rows = [];
    if (sec.count) {
      sh.getRange(sec.first, 1, sec.count, 15).getValues().forEach(function (r) {
        if (Number(r[2]) > 0) rows.push({ ticker: r[0], qty: r[2], price: r[1], worth: r[6], weight: r[7], pl: r[8], plPct: r[9] });
      });
    }
    out.sections.push({ name: pair[0], rows: rows });
  });
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

if (typeof module !== 'undefined') module.exports = { computePositions: computePositions };
