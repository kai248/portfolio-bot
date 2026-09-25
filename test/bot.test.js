// Simulates whole conversations with Google/Telegram services faked out.
const load = require('./load');

const props = {};
const g = load(['Config.gs', 'Tickers.gs', 'Parser.gs', 'Data.gs', 'Bot.gs'], {
  PropertiesService: { getScriptProperties: () => ({
    getProperty: k => (k in props ? props[k] : null),
    setProperty: (k, v) => { props[k] = String(v); },
    deleteProperty: k => { delete props[k]; }
  }) },
  Utilities: { getUuid: () => Math.random().toString(16).slice(2) + 'abcdef0123' }
});

// ---- fakes -----------------------------------------------------------------
const LIVE = {
  USD: { META: { price: 712.4, name: 'Meta Platforms Inc' }, AAPL: { price: 230, name: 'Apple Inc' },
    NVDA: { price: 121, name: 'NVIDIA Corp' }, PLTR: { price: 150, name: 'Palantir Technologies' },
    GOOGL: { price: 180, name: 'Alphabet Inc Class A' } },
  SGD: { BUOU: { price: 0.87, name: 'Frasers Logistics & Commercial Trust' }, D05: { price: 78, name: 'DBS Group' },
    C38U: { price: 2.3, name: 'CapitaLand Integrated Commercial Trust' } }
};
const quoteCalls = [];
let txs = [], sent = [], settings;
function reset() {
  txs = []; sent = []; quoteCalls.length = 0; Object.keys(props).forEach(k => delete props[k]);
  cats = {}; searches.length = 0;
  settings = { chatId: '1', platform: 'IBKR', warn: 0.3, aliases: {} };
}
g.getSettings_ = () => settings;
g.todayIso_ = () => '2026-09-25';
g.quote_ = (t, ccy) => {
  quoteCalls.push(t + ':' + (ccy || 'auto'));
  for (const c of ccy ? [ccy] : ['USD', 'SGD']) if (LIVE[c] && LIVE[c][t]) return Object.assign({ currency: c }, LIVE[c][t]);
  return null;
};
g.fxRate_ = (from, to) => ({ USDMYR: 4.2, SGDMYR: 3.3 })[from + to] || 1;
g.readTransactions_ = () => txs.map((t, i) => Object.assign({ row: i + 2 }, t));
g.appendTransaction_ = t => { const id = 'id' + txs.length; txs.push(Object.assign({ id }, t)); return id; };
g.deleteTransaction_ = id => { txs = txs.filter(t => t.id !== id); return true; };
g.rebuildHoldings_ = () => {};
// Yahoo search / categories fakes
let cats = {};
const SEARCH = {
  'mapletree': [
    { ticker: 'ME8U', currency: 'SGD', name: 'Mapletree Industrial Trust', exchange: 'SGX', assetType: 'REIT', sector: 'Real Estate', industry: 'REIT—Industrial' },
    { ticker: 'M44U', currency: 'SGD', name: 'Mapletree Logistics Trust', exchange: 'SGX', assetType: 'REIT', sector: 'Real Estate', industry: 'REIT—Industrial' }],
  'rocket lab': [{ ticker: 'RKLB', currency: 'USD', name: 'Rocket Lab USA, Inc.', exchange: 'NASDAQ', assetType: 'Company', sector: 'Industrials', industry: 'Aerospace & Defense' }]
};
const searches = [];
g.yahooSearch_ = q => { searches.push(q); return SEARCH[q] || []; };
LIVE.USD.RKLB = { price: 25, name: 'Rocket Lab USA, Inc.' };
LIVE.SGD.ME8U = { price: 2.4, name: 'Mapletree Industrial Trust' };
const PROFILES = { META: { assetType: 'Company', sector: 'Communication Services', industry: 'Internet Content & Information' },
  AAPL: { assetType: 'Company', sector: 'Information Technology', industry: 'Consumer Electronics' } };
g.yahooProfile_ = t => PROFILES[t] ? Object.assign({}, PROFILES[t]) : null;
g.readCategories_ = () => cats;
g.saveCategory_ = (t, c, src) => { cats[t] = Object.assign({ source: src }, c); };
g.saveAlias_ = (a, t) => { settings.aliases[a] = t; };
g.log_ = () => {};
g.clearButtons_ = () => {};
g.esc_ = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
g.reply_ = (text, buttons) => { sent.push({ text, buttons: buttons || [] }); };

function say(text) { sent = []; g.handleText_(text, settings); return last(); }
function tap(label) {
  const msg = last();
  const btn = [].concat(...msg.buttons).find(b => b[0].includes(label));
  if (!btn) throw new Error(`No button "${label}" in: ${msg.text}\n  buttons: ${JSON.stringify(msg.buttons.map(r => r.map(b => b[0])))}`);
  sent = []; g.handleCallback_(1, btn[1], settings); return last();
}
// Everything the bot sent this turn (a confirm can send "Logged" + a category message)
function last() {
  return { text: sent.map(m => m.text).join('\n---\n'), buttons: [].concat(...sent.slice().reverse().map(m => m.buttons)) };
}
const strip = s => s.replace(/<[^>]+>/g, '');

let pass = 0, fail = 0;
function scenario(name, fn) {
  reset();
  try { fn(); pass++; }
  catch (e) { fail++; console.log(`FAIL  ${name}\n      ${e.message}`); }
}
function expect(msg, re) {
  if (!re.test(strip(msg.text))) throw new Error(`Expected ${re} in:\n      ${strip(msg.text).replace(/\n/g, '\n      ')}`);
}
function eq(a, b, what) { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${what}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); }

// ---- scenarios ----------------------------------------------------------------
scenario('full message -> confirm -> saved', () => {
  expect(say('i bought 3 meta at 700'), /Confirm BUY · SHARES[\s\S]*3 × META @ \$700\.00[\s\S]*Total cost: \$2,100\.00 \(≈ RM 8,820\)/);
  expect(tap('Confirm'), /Logged: BUY 3 META @ \$700\.00[\s\S]*You now hold 3 META · avg \$700\.00/);
  eq(txs.length, 1, 'tx count'); eq(txs[0].type, 'SHARES', 'type'); eq(txs[0].date, '2026-09-25', 'date');
});

scenario('nothing is saved on cancel', () => {
  say('bought 3 meta at 700'); expect(tap('Cancel'), /Cancelled/); eq(txs.length, 0, 'tx count');
});

scenario('"1meta today" -> buy @ live', () => {
  expect(say('1meta today'), /1 × META today\. META is \$712\.40/);
  expect(tap('Buy @'), /Confirm BUY[\s\S]*1 × META @ \$712\.40/);
  tap('Confirm'); eq(txs[0].price, 712.4, 'price');
});

scenario('"1meta" then typed price, then action', () => {
  say('1meta');
  expect(say('705'), /What was it\?/);
  expect(say('bought'), /Confirm BUY[\s\S]*@ \$705\.00/);
});

scenario('missing quantity is asked', () => {
  expect(say('bought meta at 700'), /How many shares of META/);
  expect(say('abc'), /single number/);
  expect(say('4'), /Confirm BUY[\s\S]*4 × META/);
});

scenario('missing price offers live', () => {
  expect(say('bought 2 aapl'), /AAPL is \$230\.00 right now\. Use this price/);
  expect(tap('Use $230'), /Confirm BUY[\s\S]*2 × AAPL @ \$230\.00/);
});

scenario('missing price: user types own price', () => {
  say('bought 2 aapl'); expect(say('228.5'), /2 × AAPL @ \$228\.50/);
});

scenario('shares-or-price ambiguity', () => {
  expect(say('bought meta 5'), /Is 5 the number of shares or the price/);
  expect(tap('5 shares'), /Use this price/);
});

scenario('typo ticker -> did you mean -> learn alias', () => {
  expect(say('bought 3 palntir 150'), /Did you mean PLTR for "palntir"/);
  tap('PLTR');
  expect(last(), /Confirm BUY[\s\S]*3 × PLTR/);
  tap('Confirm');
  expect(last(), /Save "palntir" → PLTR/);
  tap('Save'); eq(settings.aliases.palntir, 'PLTR', 'alias');
  expect(say('bought 1 palntir 150'), /Confirm BUY[\s\S]*1 × PLTR/);
});

scenario('google -> which one', () => {
  expect(say('bought 2 google 180'), /Which one did you mean/);
  expect(tap('GOOGL'), /Confirm BUY[\s\S]*2 × GOOGL/);
});

scenario('unknown ticker is rejected and re-asked', () => {
  expect(say('bought 3 zzzq 10'), /couldn't find "zzzq"/);
  expect(say('nvda'), /Confirm BUY[\s\S]*3 × NVDA @ \$10\.00|121\.00 right now/);
});

scenario('price way off live -> warning, total interpretation', () => {
  expect(say('bought 3 meta for 2137.2'), /META is \$712\.40 right now, but you said \$2,137\.20/);
  expect(tap('each (total'), /3 × META @ \$712\.40/);
});

scenario('price way off -> user insists', () => {
  say('bought 3 meta at 50'); expect(tap('is right'), /Confirm BUY[\s\S]*@ \$50\.00/);
});

scenario('cfd with fee', () => {
  expect(say('bought 5 nvda cfd 120 fee 1.5'), /Confirm BUY · CFD[\s\S]*Total cost: \$601\.50[\s\S]*Fee: \$1\.50/);
  tap('Confirm'); eq(txs[0].type, 'CFD', 'type'); eq(txs[0].fee, 1.5, 'fee');
});

scenario('add fee from confirm', () => {
  say('bought 5 nvda 120'); expect(tap('Add fee'), /fee \/ commission/);
  expect(say('0.35'), /Fee: \$0\.35/);
});

scenario('edit menu: switch to CFD', () => {
  say('bought 5 nvda 120'); tap('Edit');
  expect(tap('→ CFD'), /Confirm BUY · CFD/);
});

scenario('sell more than held -> warning', () => {
  say('bought 2 aapl 200'); tap('Confirm');
  expect(say('sold 5 aapl 230'), /You only hold 2 AAPL \(SHARES\)/);
  expect(tap('Change quantity'), /How many shares/);
  expect(say('2'), /Confirm SELL[\s\S]*2 × AAPL/);
  expect(tap('Confirm'), /Position closed\. Realised P\/L on AAPL: \+\$60\.00/);
});

scenario('cfd fee', () => {
  expect(say('cfd fee meta 2.30'), /Confirm FEE · CFD[\s\S]*META · \$2\.30/);
  tap('Confirm'); eq(txs[0].amount, 2.3, 'amount');
});

scenario('fee without cfd word defaults to CFD; dividend defaults to SHARES', () => {
  expect(say('overnight financing nvda 0.85'), /Confirm FEE · CFD/);
  say('cancel');
  expect(say('dividend aapl 3.20'), /Confirm DIVIDEND · SHARES/);
});

scenario('no action + no price -> pick fee via buttons', () => {
  expect(say('meta 2.3'), /What was it\?/);
  expect(tap('Fee'), /Confirm FEE · CFD[\s\S]*\$2\.30/);
});

scenario('shorting refused', () => {
  expect(say('shorted 2 tsla at 250'), /Shorting isn't supported/); eq(txs.length, 0, 'tx');
});

scenario('gibberish', () => { expect(say('asdf qwer zxcv uiop'), /didn't get that/); });

scenario('future date re-asked', () => {
  expect(say('bought 1 meta 700 on 2027-01-01'), /date is in the future/);
  expect(say('yesterday'), /Date: Thu 24 Sep 2026/);
});

scenario('yes confirms', () => { say('bought 1 meta 700'); say('yes'); eq(txs.length, 1, 'tx'); });

scenario('undo', () => {
  say('bought 1 meta 700'); tap('Confirm');
  expect(say('undo'), /Remove this entry\?[\s\S]*BUY 1 META @ \$700\.00/);
  expect(tap('Remove'), /Removed/); eq(txs.length, 0, 'tx');
});

scenario('stale buttons', () => {
  say('bought 1 meta 700'); const old = last();
  say('bought 2 aapl 230');
  sent = []; g.handleCallback_(1, old.buttons[0][0][1], settings);
  expect(last(), /expired/); eq(txs.length, 0, 'tx');
});

scenario('new trade while a question is pending replaces it', () => {
  say('bought meta at 700');                 // asks quantity
  expect(say('sold 1 aapl 230'), /You only hold 0 AAPL|Confirm SELL/);
});

scenario('position lookup', () => {
  say('bought 2 meta 600'); tap('Confirm');
  expect(say('meta'), /META · Meta Platforms Inc · \$712\.40[\s\S]*2 shares · avg \$600\.00[\s\S]*P\/L \+\$224\.80/);
});

scenario('average cost with sells', () => {
  const ps = g.computePositions([
    { date: '2026-01-01', action: 'BUY', type: 'SHARES', ticker: 'X', qty: 10, price: 10, fee: 1 },
    { date: '2026-01-02', action: 'BUY', type: 'SHARES', ticker: 'X', qty: 10, price: 20, fee: 1 },
    { date: '2026-01-03', action: 'SELL', type: 'SHARES', ticker: 'X', qty: 5, price: 30, fee: 1 },
    { date: '2026-01-04', action: 'DIVIDEND', type: 'SHARES', ticker: 'X', amount: 2 },
    { date: '2026-01-04', action: 'BUY', type: 'CFD', ticker: 'X', qty: 1, price: 5, fee: 0 },
    { date: '2026-01-05', action: 'FEE', type: 'CFD', ticker: 'X', amount: 0.5 }
  ]);
  const s = ps.find(p => p.type === 'SHARES'), c = ps.find(p => p.type === 'CFD');
  eq(s.qty, 15, 'qty'); eq(+s.avg.toFixed(4), 15.1, 'avg'); eq(+s.realised.toFixed(4), 73.5, 'realised');
  eq(s.dividends, 2, 'div'); eq(c.qty, 1, 'cfd qty'); eq(c.fees, 0.5, 'cfd fees');
});

// ---- currencies / SGX -----------------------------------------------------------
scenario('SGX: known code -> SGD, no US lookup', () => {
  expect(say('bought 1300 buou 0.88'),
    /Confirm BUY · SHARES · SGD[\s\S]*1300 × BUOU @ S\$0\.88[\s\S]*SGX · IBKR[\s\S]*Total cost: S\$1,144\.00 \(≈ RM 3,775\)/);
  eq(quoteCalls, ['BUOU:SGD'], 'quote calls');
  tap('Confirm'); eq(txs[0].currency, 'SGD', 'ccy');
  expect(last(), /You now hold 1300 BUOU · avg S\$0\.88/);
});

scenario('SGX: company name', () => { expect(say('bought 100 dbs at 77.5'), /100 × D05 @ S\$77\.50/); });

scenario('SGX: code with digits and letters is not split', () => {
  expect(say('bought 500 c38u 2.3'), /500 × C38U @ S\$2\.30/);
});

scenario('SGX: unlisted code auto-detected (US first, then SGX)', () => {
  delete g.SGX_TICKERS.BUOU;
  try {
    expect(say('bought 1300 buou 0.88'), /Confirm BUY · SHARES · SGD/);
    eq(quoteCalls, ['BUOU:auto'], 'quote calls');
  } finally { g.SGX_TICKERS.BUOU = true; }
});

scenario('SGX: held currency is reused', () => {
  txs.push({ id: 'x', date: '2026-01-01', action: 'BUY', type: 'SHARES', ticker: 'BUOU', currency: 'SGD', qty: 100, price: 0.9, fee: 0 });
  expect(say('sold 100 buou 0.87'), /Confirm SELL · SHARES · SGD/);
});

scenario('explicit s$ price', () => { expect(say('bought 10 d05 s$78'), /10 × D05 @ S\$78\.00/); });

scenario('edit: switch market', () => {
  say('bought 10 meta 700'); tap('Edit');
  expect(tap('→ SGX'), /couldn't find META on SGX/);
});

scenario('sell warning is per currency', () => {
  txs.push({ id: 'x', date: '2026-01-01', action: 'BUY', type: 'SHARES', ticker: 'D05', currency: 'SGD', qty: 100, price: 70, fee: 0 });
  expect(say('sold 200 dbs 78'), /You only hold 100 D05/);
});

scenario('groupSections: stocks then CFDs, USD first', () => {
  const ps = g.computePositions([
    { date: '2026-01-01', action: 'BUY', type: 'CFD', ticker: 'AAPL', currency: 'USD', qty: 33, price: 166.6, fee: 0 },
    { date: '2026-01-01', action: 'BUY', type: 'SHARES', ticker: 'BUOU', currency: 'SGD', qty: 1300, price: 0.885, fee: 0 },
    { date: '2026-01-01', action: 'BUY', type: 'SHARES', ticker: 'META', currency: 'USD', qty: 1, price: 700, fee: 0 }
  ]);
  const sec = g.groupSections(ps).map(s => s.type + '·' + s.currency + ':' + s.positions.map(p => p.ticker).join(','));
  eq(sec, ['SHARES·USD:META', 'SHARES·SGD:BUOU', 'CFD·USD:AAPL'], 'sections');
});

scenario('groupSections: empty Shares · USD and CFDs · USD always shown', () => {
  const only = g.computePositions([{ date: '2026-01-01', action: 'BUY', type: 'SHARES', ticker: 'META', currency: 'USD', qty: 1, price: 700, fee: 0 }]);
  eq(g.groupSections(only).map(s => s.type + '·' + s.currency + ':' + s.positions.length), ['SHARES·USD:1', 'CFD·USD:0'], 'with shares');
  eq(g.groupSections([]).map(s => s.type + '·' + s.currency), ['SHARES·USD', 'CFD·USD'], 'empty');
  eq(g.moneyFmt_('MYR'), '"RM "#,##0.00', 'myr fmt'); eq(g.priceFmt_('SGD'), '"S$"#,##0.00##', 'sgd price fmt');
});

scenario('money formatting', () => {
  eq(g.money_(0.885, 'SGD'), 'S$0.885', 'sgx'); eq(g.money_(0.88, 'SGD'), 'S$0.88', 'sgx2');
  eq(g.money_(712.4, 'USD'), '$712.40', 'usd'); eq(g.money_(-5.5, 'USD'), '-$5.50', 'neg');
  eq(g.money_(52540, 'MYR', 0), 'RM 52,540', 'myr');
});

// ---- search fallback + categories ------------------------------------------------
scenario('search: unknown name -> result buttons -> confirm, no alias offer', () => {
  expect(say('bought 200 mapletree 2.4'), /"mapletree" isn't in my list - I searched and found/);
  const labels = [].concat(...last().buttons).map(b => b[0]);
  if (!labels.includes('ME8U · Mapletree Industrial Trust · SGX')) throw new Error('labels: ' + labels);
  expect(tap('ME8U'), /Confirm BUY · SHARES · SGD[\s\S]*200 × ME8U @ S\$2\.40/);
  const after = tap('Confirm');
  expect(after, /Logged: BUY 200 ME8U[\s\S]*🏷 ME8U: REIT · Real Estate/);
  if (/Save "/.test(after.text)) throw new Error('offered to save an alias after a search');
  eq(cats.ME8U.assetType, 'REIT', 'category saved from search');
});

scenario('search: multi-word name beats a 3-letter guess', () => {
  expect(say('bought 10 rocket lab 25'), /"rocket lab" isn't in my list/);
  eq(searches, ['rocket lab'], 'searched');
  expect(tap('RKLB'), /Confirm BUY · SHARES[\s\S]*10 × RKLB @ \$25\.00/);
});

scenario('search: nothing found -> ask for exact ticker', () => {
  expect(say('bought 10 qwertyuiop 5'), /couldn't find "qwertyuiop" on US or SGX markets/);
});

scenario('search: guessed ticker that fails falls back to search', () => {
  SEARCH.zzqq = [{ ticker: 'NVDA', currency: 'USD', name: 'NVIDIA', exchange: 'NASDAQ', assetType: 'Company', sector: 'Information Technology' }];
  expect(say('bought 3 zzqq 120'), /"zzqq" isn't in my list/);
  delete SEARCH.zzqq;
});

scenario('category: auto from Yahoo profile, shown once', () => {
  say('bought 1 meta 700');
  expect(tap('Confirm'), /🏷 META: Company · Communication Services/);
  say('bought 1 meta 700');
  if (/🏷/.test(tap('Confirm').text)) throw new Error('asked again for a known ticker');
});

scenario('category: not found -> ask asset type -> sector', () => {
  say('bought 5 nvda 120');
  expect(tap('Confirm'), /couldn't look up what NVDA is[\s\S]*What is NVDA/);
  expect(tap('Company'), /Which sector is NVDA/);
  expect(tap('Info Tech'), /Saved: NVDA · Company · Information Technology/);
  eq(cats.NVDA.source, 'you', 'source');
});

scenario('category: change an auto one to ETF', () => {
  say('bought 1 meta 700'); tap('Confirm');
  tap('Change');
  expect(tap('ETF'), /Saved: META · ETF/);
});

scenario('pickSearchResults keeps US + SGX only', () => {
  const quotes = [
    { symbol: 'RKLB', quoteType: 'EQUITY', exchange: 'NMS', exchDisp: 'NASDAQ', longname: 'Rocket Lab', sector: 'Industrials', industry: 'Aerospace & Defense' },
    { symbol: '6RJ0.F', quoteType: 'EQUITY', exchange: 'FRA', exchDisp: 'Frankfurt' },
    { symbol: 'RKLBB-USD', quoteType: 'CRYPTOCURRENCY', exchange: 'CCC' },
    { symbol: 'FRLOF', quoteType: 'EQUITY', exchange: 'PNK', exchDisp: 'OTC Markets' },
    { symbol: 'BUOU.SI', quoteType: 'EQUITY', exchange: 'SES', longname: 'Frasers L&C', sector: 'Real Estate', industry: 'REIT—Industrial' },
    { symbol: 'ES3.SI', quoteType: 'ETF', exchange: 'SES', longname: 'STI ETF' },
    { symbol: 'BRK-B', quoteType: 'EQUITY', exchange: 'NYQ', longname: 'Berkshire', sector: 'Financial Services' }
  ];
  const r = g.pickSearchResults(quotes).map(x => [x.ticker, x.currency, x.assetType, x.sector].join(':'));
  eq(r, ['RKLB:USD:Company:Industrials', 'BUOU:SGD:REIT:Real Estate', 'ES3:SGD:ETF:', 'BRK.B:USD:Company:Financials'], 'picked');
});

scenario('categoryFromYahoo maps to GICS names', () => {
  const m = x => { const c = g.categoryFromYahoo(x); return c.assetType + ':' + c.sector; };
  eq(m({ quoteType: 'EQUITY', sector: 'Consumer Cyclical', industry: 'Internet Retail' }), 'Company:Consumer Discretionary', 'AMZN');
  eq(m({ quoteType: 'EQUITY', sector: 'Technology' }), 'Company:Information Technology', 'tech');
  eq(m({ quoteType: 'EQUITY', sector: 'Financial Services' }), 'Company:Financials', 'V');
  eq(m({ quoteType: 'ETF' }), 'ETF:', 'etf');
  eq(g.sectorBucket({ assetType: 'ETF' }), 'ETFs', 'bucket etf');
  eq(g.sectorBucket(null), 'Uncategorised', 'bucket none');
});

console.log(`\nbot: ${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
