const assert = require('assert');
const load = require('./load');
const g = load(['Tickers.gs', 'Parser.gs']);
const ctx = { today: '2026-09-25', aliases: { palantr: 'PLTR' } }; // 2026-09-25 is a Friday

let pass = 0, fail = 0;
function t(msg, expect, c) {
  const p = g.parseMessage(msg, c || ctx);
  const errs = [];
  Object.keys(expect).forEach(k => {
    const a = JSON.stringify(p[k]), e = JSON.stringify(expect[k]);
    if (a !== e) errs.push(`${k}: got ${a}, want ${e}`);
  });
  if (errs.length) { fail++; console.log(`FAIL  "${msg}"\n      ${errs.join('\n      ')}`); }
  else pass++;
}

// Happy paths
t('i bought 3 meta at 500', { action: 'BUY', ticker: 'META', qty: 3, price: 500, type: null });
t('bougth 3 meta 500', { action: 'BUY', ticker: 'META', qty: 3, price: 500 });
t('1meta today', { action: null, ticker: 'META', qty: 1, price: null, date: '2026-09-25' });
t('bought 3 meta cfd at 500 fee 1.2', { action: 'BUY', type: 'CFD', qty: 3, price: 500, fee: 1.2 });
t('sold 2 aapl 230 on moomoo', { action: 'SELL', ticker: 'AAPL', qty: 2, price: 230, leftovers: [] });
t('Bought 10 shares of nvidia @ $121.50', { action: 'BUY', ticker: 'NVDA', qty: 10, price: 121.5 });
t('bought 0.5 meta', { action: 'BUY', qty: 0.5, price: null });
t('got 3x tsla for 250 yesterday', { action: 'BUY', ticker: 'TSLA', qty: 3, price: 250, date: '2026-09-24' });
t('bought 2 palo alto 180', { ticker: 'PANW', qty: 2, price: 180 });
t('bought 5 $ON 70', { ticker: 'ON', qty: 5, price: 70 });
t('bought 5 ON at 70', { ticker: 'ON', qty: 5, price: 70 });
t('i bought it today', { ticker: null, action: 'BUY' });
t('bought 3 meta total 1500', { qty: 3, price: 500 });
t('bought 2 meta 500 on 22 sep', { qty: 2, price: 500, date: '2026-09-22' });
t('bought 2 meta 500 22/9', { qty: 2, price: 500, date: '2026-09-22' });
t('bought 2 meta 500 on monday', { qty: 2, price: 500, date: '2026-09-21' });
t('bought 2 meta 500 30 dec', { date: '2025-12-30' });
t('bought 1,000 sofi at 9.5', { ticker: 'SOFI', qty: 1000, price: 9.5 });
t('bought 3 meta lah 500', { ticker: 'META', qty: 3, price: 500, leftovers: [] });
t('BOUGHT 3 META AT 500', { action: 'BUY', ticker: 'META', qty: 3, price: 500 });
t('bought 4 brk.b 480', { ticker: 'BRK.B', qty: 4, price: 480 });

// Things the bot must ask about
t('bought meta at 500', { qty: null, price: 500 });
t('bought meta 500', { qty: null, price: null, ambiguousNumber: 500 });
t('3 meta 500', { action: null, qty: 3, price: 500 });
t('bought 3 palantir', { ticker: 'PLTR' });
t('bought 3 palantr', { ticker: 'PLTR' });  // from user alias
t('bought 3 palntir', { ticker: null, tickerChoices: ['PLTR'], tickerFromFuzzy: true, tickerToken: 'palntir' },
  { today: '2026-09-25', aliases: {} });
t('bought 3 nvdia', { tickerChoices: ['NVDA'], tickerFromFuzzy: true });
t('bought 3 google', { ticker: null, tickerChoices: ['GOOGL', 'GOOG'] });
t('bought 3 hims 40', { ticker: 'HIMS' });
t('bought 3 nbis 40', { ticker: 'NBIS', tickerSource: 'guess' });
t('shorted 2 tsla', { short: true, action: null });
t('bought and sold meta', { actionConflict: true, action: null });

// Fees & dividends
t('cfd fee meta 2.30', { action: 'FEE', type: 'CFD', ticker: 'META', amount: 2.3 });
t('fee 2.3 meta', { action: 'FEE', amount: 2.3 });
t('overnight financing nvda 0.85', { action: 'FEE', ticker: 'NVDA', amount: 0.85 });
t('dividend aapl 3.20', { action: 'DIVIDEND', ticker: 'AAPL', amount: 3.2 });
t('got dividend from msft 5', { action: 'BUY', ticker: 'MSFT' }); // buy word wins; bot shows confirm so user sees it

// SGX / currencies
t('bought 1300 buou 0.88', { ticker: 'BUOU', qty: 1300, price: 0.88, currency: 'SGD', currencyExplicit: false });
t('bought 100 d05 77.5', { ticker: 'D05', qty: 100, price: 77.5, currency: 'SGD' });
t('bought 500 c38u @ 2.30', { ticker: 'C38U', qty: 500, price: 2.3 });
t('bought 200 ME8U 2.4', { ticker: 'ME8U', qty: 200, price: 2.4 });
t('bought 100 9ci 3.2', { ticker: '9CI', qty: 100, price: 3.2 });
t('bought 100 ocbc 16', { ticker: 'O39', currency: 'SGD' });
t('bought 10 d05 s$78', { ticker: 'D05', price: 78, currency: 'SGD', currencyExplicit: true });
t('bought 10 kgxr sgx 1.2', { ticker: 'KGXR', currency: 'SGD', currencyExplicit: true });
t('bought 3 meta usd 500', { ticker: 'META', currency: 'USD', price: 500, qty: 3 });
t('bought 3 meta', { currency: null });
t('bought 2 amd5', { ticker: 'AMD', qty: 2, price: 5 }); // "amd5" still splits: AMD is a US ticker
t('x3 meta 500', { qty: 3, price: 500 });
t('bought 2 meta 500 22nd sep', { date: '2026-09-22' });

// Commands
function c(msg, expect) {
  const r = g.parseCommand(msg, ctx);
  const a = JSON.stringify(r), e = JSON.stringify(expect);
  if (a !== e) { fail++; console.log(`FAIL  cmd "${msg}": got ${a}, want ${e}`); } else pass++;
}
c('help', { command: 'help' });
c('/start', { command: 'start' === 'start' ? 'help' : '' });
c('portfolio', { command: 'portfolio' });
c('/undo', { command: 'undo' });
c('meta', { command: 'position', ticker: 'META' });
c('how\'s nvda', { command: 'position', ticker: 'NVDA' });
c('bought 3 meta', null);
c('hi', null);

// Reply helpers
assert.strictEqual(g.parseNumberReply('$712.40'), 712.4); pass++;
assert.strictEqual(g.parseNumberReply('3'), 3); pass++;
assert.strictEqual(g.parseNumberReply('abc'), null); pass++;
assert.strictEqual(g.parseDateReply('yesterday', '2026-09-25'), '2026-09-24'); pass++;
assert.strictEqual(g.looksLikeNewEntry('sold 2 aapl', ctx), true); pass++;
assert.strictEqual(g.looksLikeNewEntry('3', ctx), false); pass++;

console.log(`\nparser: ${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
