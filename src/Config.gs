/** Shared names and layout. Change sheet names here if you ever rename tabs. */
var TZ = 'Asia/Kuala_Lumpur';

var SHEETS = {
  DASH: 'Dashboard',
  HOLD: 'Holdings',
  TX: 'Transactions',
  LOG: 'Bot Log',
  SET: 'Settings',
  HIST: 'History',
  QUOTE: '_Quote'
};

// Transactions tab columns (1-based)
var TX = { DATE: 1, ACTION: 2, TYPE: 3, TICKER: 4, QTY: 5, PRICE: 6, FEE: 7, AMOUNT: 8, CASH: 9, NOTES: 10, LOGGED: 11, ID: 12 };
var TX_HEADERS = ['Date', 'Action', 'Type', 'Ticker', 'Quantity', 'Price (USD)', 'Fee (USD)',
  'Amount (USD)', 'Cash flow (USD)', 'Notes / original message', 'Logged at', 'ID'];

var HOLD_HEADERS = ['Counter', 'Current unit price', 'Volume', 'Avg purchase price',
  'Total purchase cost', '% allocated', 'Total worth now', '% of total portfolio',
  'Profit/loss', 'P/L %', 'Today', 'Realised P/L', 'Dividends', 'Fees & financing', 'Net P/L'];

var HIST_HEADERS = ['Date', 'Total worth (USD)', 'Total cost (USD)', 'Net P/L (USD)', 'USD/MYR', 'Total worth (MYR)'];
var LOG_HEADERS = ['Time', 'Direction', 'Text', 'Details'];

// Settings tab cells
var SET_CELLS = { CHAT_ID: 'B3', PLATFORM: 'B4', WARN: 'B5' };
var ALIAS_FIRST_ROW = 9;

var ACTIONS = ['BUY', 'SELL', 'FEE', 'DIVIDEND'];
var TYPES = ['STOCK', 'CFD'];

var FMT = {
  USD: '$#,##0.00',
  USD_SIGNED: '+$#,##0.00;-$#,##0.00;$0.00',
  PCT: '0.0%',
  PCT_SIGNED: '+0.0%;-0.0%;0.0%',
  QTY: '#,##0.####',
  MYR: '"RM "#,##0.00',
  FX: '0.0000',
  DATE: 'yyyy-mm-dd'
};
var GREEN = '#137333';
var RED = '#c5221f';
