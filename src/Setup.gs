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
  var quote = ensureSheet_(ss, SHEETS.QUOTE, 6);

  // Remove the blank default tab if it's still there
  ['Sheet1', 'Hoja 1', 'Feuille 1'].forEach(function (n) {
    var s = ss.getSheetByName(n);
    if (s && s.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(s);
  });

  setupTransactions_(tx);
  setupLog_(log);
  setupSettings_(set);
  setupHistory_(hist);
  quote.hideSheet();

  rebuildHoldings_();
  setupDashboard_(dash);
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
  sh.getRange(1, 1, 1, TX_HEADERS.length).setValues([TX_HEADERS])
    .setFontWeight('bold').setBackground('#e8eaed').setWrap(true);
  sh.setFrozenRows(1);
  var n = sh.getMaxRows() - 1;
  sh.getRange(2, TX.DATE, n, 1).setNumberFormat(FMT.DATE);
  sh.getRange(2, TX.QTY, n, 1).setNumberFormat(FMT.QTY);
  sh.getRange(2, TX.PRICE, n, 4).setNumberFormat(FMT.USD);
  sh.getRange(2, TX.CASH, n, 1).setNumberFormat(FMT.USD_SIGNED);
  // Dropdowns keep hand edits valid
  sh.getRange(2, TX.ACTION, n, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(ACTIONS, true).setAllowInvalid(false).build());
  sh.getRange(2, TX.TYPE, n, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(TYPES, true).setAllowInvalid(false).build());
  var widths = [95, 80, 70, 70, 80, 95, 80, 95, 110, 260, 140, 80];
  widths.forEach(function (w, i) { sh.setColumnWidth(i + 1, w); });
  sh.getRange(1, TX.CASH).setNote('Money out of your account is negative. Calculated from the row - don\'t type here.');
  sh.getRange(1, TX.AMOUNT).setNote('Only for FEE and DIVIDEND rows.');
  // Fill the cash-flow formula for any rows typed in by hand
  var last = sh.getLastRow();
  if (last >= 2) sh.getRange(2, TX.CASH, last - 1, 1).setFormulaR1C1(CASH_FLOW_R1C1);
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
  sh.getRange('A1:I30').breakApart();
  sh.getRange('A1:I5').clear();

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
  sh.setRowHeight(5, 38);
  var pl = sh.getRange('C5:F5');
  sh.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule().whenNumberGreaterThan(0).setFontColor(GREEN).setRanges([pl]).build(),
    SpreadsheetApp.newConditionalFormatRule().whenNumberLessThan(0).setFontColor(RED).setRanges([pl]).build()
  ]);

  // Chart data blocks (filled by rebuildHoldings_)
  sh.getRange('K3:L3').setValues([['Position', 'Worth (USD)']]).setFontWeight('bold');
  sh.getRange('N3:O3').setValues([['Type', 'Worth (USD)']]).setFontWeight('bold');
  sh.getRange('K2').setValue('Chart data - filled automatically').setFontColor('#80868b').setFontSize(9);

  sh.insertChart(sh.newChart().setChartType(Charts.ChartType.PIE)
    .addRange(sh.getRange('K3:L200'))
    .setOption('title', 'Allocation by position')
    .setOption('pieHole', 0.45)
    .setOption('legend', { position: 'right' })
    .setOption('width', 520).setOption('height', 320)
    .setPosition(7, 1, 0, 0).build());

  sh.insertChart(sh.newChart().setChartType(Charts.ChartType.PIE)
    .addRange(sh.getRange('N3:O5'))
    .setOption('title', 'Stocks vs CFDs (full size)')
    .setOption('pieHole', 0.45)
    .setOption('colors', ['#1a73e8', '#f29900'])
    .setOption('width', 420).setOption('height', 320)
    .setPosition(7, 5, 60, 0).build());

  var hist = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEETS.HIST);
  sh.insertChart(sh.newChart().setChartType(Charts.ChartType.LINE)
    .addRange(hist.getRange('A1:B'))
    .addRange(hist.getRange('C1:C'))
    .setOption('title', 'Portfolio value over time (daily snapshots)')
    .setOption('legend', { position: 'bottom' })
    .setOption('series', { 0: { color: '#1a73e8' }, 1: { color: '#9aa0a6', lineDashStyle: [4, 4] } })
    .setOption('width', 960).setOption('height', 320)
    .setPosition(24, 1, 0, 0).build());

  sh.setFrozenRows(0);
}

function setupTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var fn = t.getHandlerFunction();
    if (fn === 'snapshot' || fn === 'onTransactionsEdit') ScriptApp.deleteTrigger(t);
  });
  // ~7am Malaysia time: after the US market has closed
  ScriptApp.newTrigger('snapshot').timeBased().everyDays(1).atHour(7).inTimezone(TZ).create();
  ScriptApp.newTrigger('onTransactionsEdit').forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet()).onEdit().create();
}

/** Keeps Holdings in sync when you edit the Transactions tab by hand. */
function onTransactionsEdit(e) {
  if (!e || !e.range || e.range.getSheet().getName() !== SHEETS.TX || e.range.getRow() < 2) return;
  var sh = e.range.getSheet();
  var r = e.range.getRow(), n = e.range.getNumRows();
  // Make sure hand-typed rows get the cash-flow formula too
  sh.getRange(r, TX.CASH, n, 1).setFormulaR1C1(CASH_FLOW_R1C1);
  rebuildHoldings_();
}

// ---------------------------------------------------------------------------
// Menu
// ---------------------------------------------------------------------------

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Portfolio')
    .addItem('Rebuild holdings', 'menuRebuild')
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
