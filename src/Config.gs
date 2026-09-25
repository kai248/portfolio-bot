/** Shared names and layout. Change sheet names here if you ever rename tabs. */
var TZ = 'Asia/Kuala_Lumpur';

var SHEETS = {
  DASH: 'Dashboard',
  HOLD: 'Holdings',
  TX: 'Transactions',
  LOG: 'Bot Log',
  SET: 'Settings',
  HIST: 'History',
  PRICES: 'Prices',
  CATS: 'Categories',
  QUOTE: '_Quote'
};

/**
 * Currencies you can hold. `yahoo` is the Yahoo Finance suffix used to price
 * non-US stocks (Google Finance doesn't cover SGX). US stocks use GOOGLEFINANCE.
 * `autoDetect` markets are tried (in order) when a ticker's currency isn't given.
 */
var CURRENCIES = {
  USD: { symbol: '$', yahoo: '', autoDetect: true },
  SGD: { symbol: 'S$', yahoo: '.SI', autoDetect: true },
  HKD: { symbol: 'HK$', yahoo: '.HK' },
  MYR: { symbol: 'RM', yahoo: '.KL' },
  AUD: { symbol: 'A$', yahoo: '.AX' },
  GBP: { symbol: '£', yahoo: '.L' }
};
var BASE_CCY = 'USD';  // combined totals are in this currency
var HOME_CCY = 'MYR';  // ...and also shown in this one

// Transactions tab columns (1-based). Prices, fees and amounts are in the row's Currency.
var TX = { DATE: 1, ACTION: 2, TYPE: 3, TICKER: 4, CCY: 5, QTY: 6, PRICE: 7, FEE: 8, AMOUNT: 9,
  CASH: 10, NOTES: 11, LOGGED: 12, ID: 13 };
var TX_HEADERS = ['Date', 'Action', 'Type', 'Ticker', 'Currency', 'Quantity', 'Price', 'Fee',
  'Amount', 'Cash flow', 'Notes / original message', 'Logged at', 'ID'];

var PRICE_HEADERS = ['Yahoo symbol', 'Price', 'Previous close', 'Change', 'Currency', 'Name', 'Updated'];

var HOLD_HEADERS = ['Counter', 'Current unit price', 'Volume', 'Avg purchase price',
  'Total purchase cost', '% allocated', 'Total worth now', '% of total portfolio',
  'Profit/loss', 'P/L %', 'Today', 'Realised P/L', 'Dividends', 'Fees & financing', 'Net P/L',
  'Asset type', 'Sector'];

var CCY_TABLE_HEADERS = ['Currency', 'Total purchase cost', 'Total worth now', 'Profit/loss',
  'P/L %', 'Today', 'Realised + dividends − fees', 'Net P/L', 'Rate → USD', 'Worth (USD)', '% of portfolio'];

var HIST_HEADERS =['Date', 'Total worth (USD)', 'Total cost (USD)', 'Net P/L (USD)', 'USD/MYR', 'Total worth (MYR)'];
var LOG_HEADERS = ['Time', 'Direction', 'Text', 'Details'];

// Settings tab cells
var SET_CELLS = { CHAT_ID: 'B3', PLATFORM: 'B4', WARN: 'B5' };
var ALIAS_FIRST_ROW = 9;

var ACTIONS = ['BUY', 'SELL', 'FEE', 'DIVIDEND'];
var TYPES = ['SHARES', 'CFD'];   // how you hold it

// What it is, and which business it's in (Categories tab)
var ASSET_TYPES = ['Company', 'ETF', 'REIT'];
/** The 11 GICS sectors. [full name, short button label] */
var SECTORS = [
  ['Information Technology', 'Info Tech'], ['Communication Services', 'Comm Services'],
  ['Consumer Discretionary', 'Consumer Disc.'], ['Consumer Staples', 'Consumer Staples'],
  ['Financials', 'Financials'], ['Health Care', 'Health Care'], ['Industrials', 'Industrials'],
  ['Energy', 'Energy'], ['Materials', 'Materials'], ['Utilities', 'Utilities'], ['Real Estate', 'Real Estate']
];
/** Yahoo's sector names -> GICS names. */
var YAHOO_SECTORS = {
  'Technology': 'Information Technology', 'Financial Services': 'Financials',
  'Consumer Cyclical': 'Consumer Discretionary', 'Consumer Defensive': 'Consumer Staples',
  'Healthcare': 'Health Care', 'Basic Materials': 'Materials', 'Communication Services': 'Communication Services',
  'Industrials': 'Industrials', 'Energy': 'Energy', 'Utilities': 'Utilities', 'Real Estate': 'Real Estate'
};
var CAT_HEADERS = ['Ticker', 'Name', 'Asset type', 'Sector', 'Industry', 'Set by'];
var UNCATEGORISED = 'Uncategorised';

/** Sheets number format for an amount in `ccy`, e.g. "S$"#,##0.00 (signed: +/-) */
function moneyFmt_(ccy, signed) {
  var sym = (CURRENCIES[ccy] || {}).symbol || ccy;
  if (/^[A-Z]{2,}$/.test(sym)) sym += ' '; // "RM 5,000", not "RM5,000"
  var n = '"' + sym + '"#,##0.00';
  return signed ? '+' + n + ';-' + n + ';' + n : n;
}
/** Same, for per-share prices: SGX prices like 0.885 keep their extra decimals. */
function priceFmt_(ccy) { return moneyFmt_(ccy).replace('#,##0.00', '#,##0.00##'); }

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
