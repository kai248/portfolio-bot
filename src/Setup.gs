/**
 * Run setup() once from the Apps Script editor. Safe to run again: it never
 * deletes your Transactions, Settings or History - it only (re)creates what's missing
 * and refreshes formatting, charts and triggers.
 */
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.setSpreadsheetTimeZone(TZ);
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', ss.getId());

  var dash = ensureSheet_(ss, SHEETS.DASH, 0);
  var hold = ensureSheet_(ss, SHEETS.HOLD, 1);
  var tx = ensureSheet_(ss, SHEETS.TX, 2);
  var log = ensureSheet_(ss, SHEETS.LOG, 3);
  var set = ensureSheet_(ss, SHEETS.SET, 4);
  var hist = ensureSheet_(ss, SHEETS.HIST, 5);
  var prices = ensureSheet_(ss, SHEETS.PRICES, 6);
  var cats = ensureSheet_(ss, SHEETS.CATS, 3);
  var quote = ensureSheet_(ss, SHEETS.QUOTE, 8);

  // Remove the blank default tab if it's still there
  ['Sheet1', 'Hoja 1', 'Feuille 1'].forEach(function (n) {
    var s = ss.getSheetByName(n);
    if (s && s.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(s);
  });

  setupTransactions_(tx);
  setupLog_(log);
  setupSettings_(set);
  setupHistory_(hist);
  setupPrices_(prices);
  setupCategories_(cats);
  quote.hideSheet();

  setupDashboard_(dash);
  // Look up categories for anything you already hold (also rebuilds Holdings, which fills the Dashboard)
  try { categoriseAll(); } catch (err) { console.warn('Categorising skipped: ' + err); rebuildHoldings_(); }
  setupTriggers_();

  ss.setActiveSheet(dash);
  console.log('Setup done. Next: add TELEGRAM_TOKEN in Project Settings > Script properties, deploy as Web app, run connectTelegram().');
}

function ensureSheet_(ss, name, index) {
  var sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name, index);
  return sh;
}

function setupTransactions_(sh) {
  migrateTransactions_(sh);
  sh.getRange(1, 1, 1, TX_HEADERS.length).setValues([TX_HEADERS])
    .setFontWeight('bold').setBackground('#e8eaed').setWrap(true);
  sh.setFrozenRows(1);
  var n = sh.getMaxRows() - 1;
  sh.getRange(2, TX.DATE, n, 1).setNumberFormat(FMT.DATE);
  sh.getRange(2, TX.QTY, n, 1).setNumberFormat(FMT.QTY);
  sh.getRange(2, TX.PRICE, n, 4).setNumberFormat('#,##0.00##');
  sh.getRange(2, TX.CASH, n, 1).setNumberFormat('+#,##0.00;-#,##0.00;0.00');
  // Dropdowns keep hand edits valid
  var list = function (values) {
    return SpreadsheetApp.newDataValidation().requireValueInList(values, true).setAllowInvalid(false).build();
  };
  sh.getRange(2, TX.ACTION, n, 1).setDataValidation(list(ACTIONS));
  sh.getRange(2, TX.TYPE, n, 1).setDataValidation(list(TYPES));
  sh.getRange(2, TX.CCY, n, 1).setDataValidation(list(Object.keys(CURRENCIES)));
  sh.getRange(2, TX.TICKER, n, 1).clearDataValidations();
  var widths = [95, 80, 70, 70, 75, 80, 90, 75, 90, 100, 260, 140, 80];
  widths.forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  sh.getRange(1, TX.CASH).setNote('In the row\'s currency. Money out of your account is negative. ' +
    'Calculated from the row - don\'t type here.');
  sh.getRange(1, TX.AMOUNT).setNote('Only for FEE and DIVIDEND rows.');
  sh.getRange(1, TX.CCY).setNote('USD for US stocks, SGD for SGX stocks. Price, Fee and Amount are in this currency.');
  sh.getRange(1, TX.TICKER).setNote('Plain ticker: AAPL, not AAPLn (IBKR\'s CFD name). SGX codes like D05, BUOU.');
  // Fill the cash-flow formula (and currency formats) for rows typed in by hand
  var last = sh.getLastRow();
  if (last >= 2) {
    sh.getRange(2, TX.CASH, last - 1, 1).setFormulaR1C1(CASH_FLOW_R1C1);
    formatTxRows_(sh, 2, last - 1);
  }
}

/** Older sheets had no Currency column: insert it after Ticker and mark existing rows USD. */
function migrateTransactions_(sh) {
  migrateStockToShares_(sh);
  if (sh.getLastColumn() < 5) return;
  var head = sh.getRange(1, 1, 1, 5).getValues()[0];
  if (String(head[3]) !== 'Ticker' || String(head[4]) === 'Currency') return;
  sh.insertColumnAfter(TX.TICKER);
  sh.getRange(1, TX.CCY).setValue('Currency');
  var last = sh.getLastRow();
  if (last >= 2) {
    var tickers = sh.getRange(2, TX.TICKER, last - 1, 1).getValues();
    sh.getRange(2, TX.CCY, last - 1, 1).setValues(tickers.map(function (t) { return [t[0] ? 'USD' : '']; }));
  }
  console.log('Transactions: added a Currency column (existing rows set to USD).');
}

/** The Type column used to say STOCK; it now says SHARES (vs CFD). */
function migrateStockToShares_(sh) {
  var last = sh.getLastRow();
  if (last < 2) return;
  var r = sh.getRange(2, TX.TYPE, last - 1, 1);
  var vals = r.getValues(), changed = false;
  vals.forEach(function (v) { if (String(v[0]).toUpperCase() === 'STOCK') { v[0] = 'SHARES'; changed = true; } });
  if (changed) { r.clearDataValidations(); r.setValues(vals); console.log('Transactions: STOCK renamed to SHARES.'); }
}

function setupCategories_(sh) {
  sh.getRange(1, 1, 1, CAT_HEADERS.length).setValues([CAT_HEADERS]).setFontWeight('bold').setBackground('#e8eaed');
  sh.setFrozenRows(1);
  var n = sh.getMaxRows() - 1;
  sh.getRange(2, 3, n, 1).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(ASSET_TYPES, true).setAllowInvalid(false).build());
  sh.getRange(2, 4, n, 1).setDataValidation(SpreadsheetApp.newDataValidation()
    .requireValueInList(SECTORS.map(function (x) { return x[0]; }), true).setAllowInvalid(false).build());
  [80, 260, 100, 190, 220, 70].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  sh.getRange('H1').setValue('One row per ticker. auto = looked up on Yahoo, you = set by you. ' +
    'Edit anything here and Holdings updates. ETFs do not need a sector.').setFontColor('#80868b');
}

/** Shows each row's money columns with its own currency symbol. */
function formatTxRows_(sh, firstRow, count) {
  var ccys = sh.getRange(firstRow, TX.CCY, count, 1).getValues();
  ccys.forEach(function (c, i) {
    var ccy = CURRENCIES[String(c[0]).toUpperCase()] ? String(c[0]).toUpperCase() : null;
    if (!ccy) return;
    sh.getRange(firstRow + i, TX.PRICE).setNumberFormat(priceFmt_(ccy));
    sh.getRange(firstRow + i, TX.FEE, 1, 2).setNumberFormat(moneyFmt_(ccy));
    sh.getRange(firstRow + i, TX.CASH).setNumberFormat(moneyFmt_(ccy, true));
  });
}

function setupPrices_(sh) {
  sh.getRange(1, 1, 1, PRICE_HEADERS.length).setValues([PRICE_HEADERS])
    .setFontWeight('bold').setBackground('#e8eaed');
  sh.setFrozenRows(1);
  sh.getRange('H1').setValue('Prices for non-US stocks (SGX…) from Yahoo Finance. Refreshed every 15 min ' +
    'during market hours and whenever holdings change. US stocks use Google Finance directly.')
    .setFontColor('#80868b');
  sh.getRange(2, 2, sh.getMaxRows() - 1, 3).setNumberFormat('#,##0.00##');
  [130, 90, 110, 80, 80, 260, 130].forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
}

function setupLog_(sh) {
  sh.getRange(1, 1, 1, LOG_HEADERS.length).setValues([LOG_HEADERS])
    .setFontWeight('bold').setBackground('#e8eaed');
  sh.setFrozenRows(1);
  sh.setColumnWidth(1, 140); sh.setColumnWidth(2, 80); sh.setColumnWidth(3, 320); sh.setColumnWidth(4, 520);
  sh.getRange('A:D').setWrap(false);
}

function setupSettings_(sh) {
  sh.getRange('A1').setValue('Settings').setFontSize(16).setFontWeight('bold');
  var labels = [['Telegram chat ID'], ['Platform (shown on confirmations)'], ['Warn if price is off from live by more than']];
  sh.getRange('A3:A5').setValues(labels).setFontWeight('bold');
  if (!sh.getRange(SET_CELLS.PLATFORM).getValue()) sh.getRange(SET_CELLS.PLATFORM).setValue('IBKR');
  if (!sh.getRange(SET_CELLS.WARN).getValue()) sh.getRange(SET_CELLS.WARN).setValue(0.3);
  sh.getRange(SET_CELLS.WARN).setNumberFormat('0%');
  sh.getRange(SET_CELLS.CHAT_ID).setNumberFormat('@');
  sh.getRange('C3').setValue('← message your bot once and it will tell you this number').setFontColor('#80868b');
  sh.getRange('C5').setValue('← e.g. 30%: "bought meta at 50" when it\'s $700 gets flagged').setFontColor('#80868b');
  sh.getRange('A7').setValue('Ticker aliases').setFontSize(12).setFontWeight('bold');
  sh.getRange('C7').setValue('What you type → the ticker it means. The bot adds rows here when you tap 💾 Save.')
    .setFontColor('#80868b');
  sh.getRange('A8:B8').setValues([['You type', 'Ticker']]).setFontWeight('bold').setBackground('#e8eaed');
  sh.setColumnWidth(1, 300); sh.setColumnWidth(2, 140);
}

function setupHistory_(sh) {
  sh.getRange(1, 1, 1, HIST_HEADERS.length).setValues([HIST_HEADERS])
    .setFontWeight('bold').setBackground('#e8eaed');
  sh.setFrozenRows(1);
  var n = sh.getMaxRows() - 1;
  sh.getRange(2, 1, n, 1).setNumberFormat(FMT.DATE);
  sh.getRange(2, 2, n, 2).setNumberFormat(FMT.USD);
  sh.getRange(2, 4, n, 1).setNumberFormat(FMT.USD_SIGNED);
  sh.getRange(2, 5, n, 1).setNumberFormat(FMT.FX);
  sh.getRange(2, 6, n, 1).setNumberFormat(FMT.MYR);
  for (var c = 1; c <= HIST_HEADERS.length; c++) sh.setColumnWidth(c, 130);
}

function setupDashboard_(sh) {
  sh.getCharts().forEach(function (c) { sh.removeChart(c); });
  sh.getRange('A1:I80').breakApart();
  sh.getRange('A1:I31').clear();

  sh.getRange('A1').setValue('Portfolio').setFontSize(20).setFontWeight('bold');
  sh.getRange('A2').setFormula('="Live prices via Google Finance (up to ~20 min delayed) · USD/MYR "&TEXT(Holdings!H4,"0.0000")')
    .setFontColor('#80868b');

  var kpis = [
    ['Total worth (USD)', '=Holdings!B4', FMT.USD],
    ['Total worth (MYR)', '=Holdings!I4', FMT.MYR],
    ['Unrealised P/L', '=Holdings!C4', FMT.USD_SIGNED],
    ['P/L %', '=Holdings!D4', FMT.PCT_SIGNED],
    ['Today', '=Holdings!E4', FMT.USD_SIGNED],
    ['Net P/L (incl. realised, dividends, fees)', '=Holdings!G4', FMT.USD_SIGNED],
    ['Total cost', '=Holdings!A4', FMT.USD]
  ];
  kpis.forEach(function (k, i) {
    var col = i + 1;
    sh.getRange(4, col).setValue(k[0]).setFontColor('#5f6368').setFontSize(9).setWrap(true).setVerticalAlignment('bottom');
    sh.getRange(5, col).setFormula(k[1]).setNumberFormat(k[2]).setFontSize(16).setFontWeight('bold');
    sh.setColumnWidth(col, 150);
  });
  sh.getRange(4, 1, 2, kpis.length).setBackground('#f8f9fa');

  // By-currency block (rows 9-14 are filled by rebuildHoldings_)
  sh.getRange('A7').setValue('By currency').setFontSize(12).setFontWeight('bold');
  sh.getRange('A8:G8').setValues([['Currency', 'Worth', 'P/L', 'P/L %', 'Today', 'Worth (USD)', '% of portfolio']])
    .setFontWeight('bold').setBackground('#e8eaed');
  sh.setRowHeight(5, 38);
  var pl = sh.getRange('C5:F5');
  sh.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenNumberGreaterThan(0).setFontColor(GREEN).setRanges([pl]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenNumberLessThan(0).setFontColor(RED).setRanges([pl]).build()
  ]);

  // By sector / by asset type tables (rows 18+ are filled by rebuildHoldings_)
  sh.getRange('A16').setValue('By sector').setFontSize(12).setFontWeight('bold');
  sh.getRange('A17:C17').setValues([['Sector', 'Worth (USD)', '% of portfolio']]).setFontWeight('bold').setBackground('#e8eaed');
  sh.getRange('E16').setValue('By asset type').setFontSize(12).setFontWeight('bold');
  sh.getRange('E17:G17').setValues([['Asset type', 'Worth (USD)', '% of portfolio']]).setFontWeight('bold').setBackground('#e8eaed');
  sh.getRange('E23').setValue('ETFs have their own slice in the sector view. Fix any category on the Categories tab.')
    .setFontColor('#80868b').setFontSize(9);

  // Chart data blocks (filled by rebuildHoldings_)
  sh.getRange('K2').setValue('Chart data - filled automatically').setFontColor('#80868b').setFontSize(9);
  sh.getRange('K3:N3').setValues([['Position', 'Worth (USD)', 'Sector', 'Asset type']]).setFontWeight('bold');
  sh.getRange('P3:Q3').setValues([['Held as', 'Worth (USD)']]).setFontWeight('bold');
  sh.getRange('S3:T3').setValues([['Currency', 'Worth (USD)']]).setFontWeight('bold');

  var pie = function (range, title, row, col, offX, width, extra) {
    var b = sh.newChart().setChartType(Charts.ChartType.PIE).addRange(range)
      .setOption('title', title).setOption('pieHole', 0.45)
      .setOption('width', width).setOption('height', 300).setPosition(row, col, offX, 0);
    Object.keys(extra || {}).forEach(function (k) { b = b.setOption(k, extra[k]); });
    sh.insertChart(b.build());
  };
  pie(sh.getRange('A17:B31'), 'By sector', 33, 1, 0, 450, { legend: { position: 'right' } });
  pie(sh.getRange('K3:L300'), 'By position', 33, 4, 10, 450, { legend: { position: 'right' } });
  pie(sh.getRange('E17:F21'), 'By asset type', 50, 1, 0, 300);
  pie(sh.getRange('S3:T20'), 'By currency', 50, 3, 10, 300);
  pie(sh.getRange('P3:Q5'), 'Shares vs CFDs (full size)', 50, 5, 20, 300, { colors: ['#1a73e8', '#f29900'] });

  var hist = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.HIST);
  sh.insertChart(sh.newChart().setChartType(Charts.ChartType.LINE)
    .addRange(hist.getRange('A1:B'))
    .addRange(hist.getRange('C1:C'))
    .setOption('title', 'Portfolio value over time (daily snapshots)')
    .setOption('legend', { position: 'bottom' })
    .setOption('series', { 0: { color: '#1a73e8' }, 1: { color: '#9aa0a6', lineDashStyle: [4, 4] } })
    .setOption('width', 960).setOption('height', 320)
    .setPosition(67, 1, 0, 0).build());

  sh.setFrozenRows(0);
}

function setupTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var fn = t.getHandlerFunction();
    if (fn === 'snapshot' || fn === 'onTransactionsEdit' || fn === 'refreshPrices') ScriptApp.deleteTrigger(t);
  });
  // ~7am Malaysia time: after the US market has closed
  ScriptApp.newTrigger('snapshot').timeBased().everyDays(1).atHour(7).inTimezone(TZ).create();
  // Non-US (SGX) prices from Yahoo; the function itself skips outside market hours
  ScriptApp.newTrigger('refreshPrices').timeBased().everyMinutes(15).create();
  ScriptApp.newTrigger('onTransactionsEdit').forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet()).onEdit().create();
}

/** Keeps Holdings in sync when you edit the Transactions tab by hand. */
function onTransactionsEdit(e) {
  if (!e || !e.range || e.range.getRow() < 2) return;
  var sh = e.range.getSheet();
  if (sh.getName() === SHEETS.CATS) return rebuildHoldings_();
  if (sh.getName() !== SHEETS.TX) return;
  var r = e.range.getRow(), n = e.range.getNumRows();
  // Make sure hand-typed rows get the cash-flow formula too
  sh.getRange(r, TX.CASH, n, 1).setFormulaR1C1(CASH_FLOW_R1C1);
  formatTxRows_(sh, r, n);
  rebuildHoldings_();
}

// ---------------------------------------------------------------------------
// Menu
// ---------------------------------------------------------------------------

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Portfolio')
    .addItem('Rebuild holdings', 'menuRebuild')
    .addItem('Refresh SGX / non-US prices', 'menuRefreshPrices')
    .addItem('Categorise all tickers', 'categoriseAll')
    .addItem('Take snapshot now', 'snapshot')
    .addItem('Test a message (no saving)', 'menuTestMessage')
    .addSeparator()
    .addItem('Connect Telegram', 'menuConnect')
    .addItem('Check Telegram connection', 'menuCheck')
    .addToUi();
}

function menuRebuild() { rebuildHoldings_(); SpreadsheetApp.getActive().toast('Holdings rebuilt'); }

function menuTestMessage() {
  var ui = SpreadsheetApp.getUi();
  var r = ui.prompt('Test the parser', 'Type a message as you would to the bot:', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var s = getSettings_();
  var ctx = { today: todayIso_(), aliases: s.aliases };
  var text = r.getResponseText();
  var out = { command: parseCommand(text, ctx), parsed: parseMessage(text, ctx) };
  ui.alert('Parser result', JSON.stringify(out, null, 2), ui.ButtonSet.OK);
}

function menuConnect() {
  SpreadsheetApp.getUi().alert('Telegram', connectTelegram(), SpreadsheetApp.getUi().ButtonSet.OK);
}

function menuCheck() {
  var info = checkTelegram();
  SpreadsheetApp.getUi().alert('Telegram webhook', JSON.stringify(info.result || info, null, 2), SpreadsheetApp.getUi().ButtonSet.OK);
}
