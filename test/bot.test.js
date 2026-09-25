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
const LIVE = { META: { price: 712.4, name: 'Meta Platforms Inc' }, AAPL: { price: 230, name: 'Apple Inc' },
  NVDA: { price: 121, name: 'NVIDIA Corp' }, PLTR: { price: 150, name: 'Palantir Technologies' },
  GOOGL: { price: 180, name: 'Alphabet Inc Class A' } };
let txs = [], sent = [], settings;
function reset() {
  txs = []; sent = []; Object.keys(props).forEach(k => delete props[k]);
  settings = { chatId: '1', platform: 'IBKR', warn: 0.3, aliases: {} };
}
g.getSettings_ = () => settings;
g.todayIso_ = () => '2026-09-25';
g.quote_ = t => LIVE[t] || null;
g.fxRate_ = () => 4.2;
g.readTransactions_ = () => txs.map((t, i) => Object.assign({ row: i + 2 }, t));
g.appendTransaction_ = t => { const id = 'id' + txs.length; txs.push(Object.assign({ id }, t)); return id; };
g.deleteTransaction_ = id => { txs = txs.filter(t => t.id !== id); return true; };
g.rebuildHoldings_ = () => {};
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
function last() { return sent[sent.length - 1]; }
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
  expect(say('i bought 3 meta at 700'), /Confirm BUY · STOCK[\s\S]*3 × META @ \$700\.00[\s\S]*Total cost: \$2,100\.00 \(≈ RM 8,820\)/);
  expect(tap('Confirm'), /Logged: BUY 3 META @ \$700\.00[\s\S]*You now hold 3 META · avg \$700\.00/);
  eq(txs.length, 1, 'tx count'); eq(txs[0].type, 'STOCK', 'type'); eq(txs[0].date, '2026-09-25', 'date');
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
  expect(say('bought 3 zzzq 10'), /couldn't find ZZZQ/);
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
  expect(say('sold 5 aapl 230'), /You only hold 2 AAPL \(STOCK\)/);
  expect(tap('Change quantity'), /How many shares/);
  expect(say('2'), /Confirm SELL[\s\S]*2 × AAPL/);
  expect(tap('Confirm'), /Position closed\. Realised P\/L on AAPL: \+\$60\.00/);
});

scenario('cfd fee', () => {
  expect(say('cfd fee meta 2.30'), /Confirm FEE · CFD[\s\S]*META · \$2\.30/);
  tap('Confirm'); eq(txs[0].amount, 2.3, 'amount');
});

scenario('fee without cfd word defaults to CFD; dividend defaults to STOCK', () => {
  expect(say('overnight financing nvda 0.85'), /Confirm FEE · CFD/);
  say('cancel');
  expect(say('dividend aapl 3.20'), /Confirm DIVIDEND · STOCK/);
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
    { date: '2026-01-01', action: 'BUY', type: 'STOCK', ticker: 'X', qty: 10, price: 10, fee: 1 },
    { date: '2026-01-02', action: 'BUY', type: 'STOCK', ticker: 'X', qty: 10, price: 20, fee: 1 },
    { date: '2026-01-03', action: 'SELL', type: 'STOCK', ticker: 'X', qty: 5, price: 30, fee: 1 },
    { date: '2026-01-04', action: 'DIVIDEND', type: 'STOCK', ticker: 'X', amount: 2 },
    { date: '2026-01-04', action: 'BUY', type: 'CFD', ticker: 'X', qty: 1, price: 5, fee: 0 },
    { date: '2026-01-05', action: 'FEE', type: 'CFD', ticker: 'X', amount: 0.5 }
  ]);
  const s = ps.find(p => p.type === 'STOCK'), c = ps.find(p => p.type === 'CFD');
  eq(s.qty, 15, 'qty'); eq(+s.avg.toFixed(4), 15.1, 'avg'); eq(+s.realised.toFixed(4), 73.5, 'realised');
  eq(s.dividends, 2, 'div'); eq(c.qty, 1, 'cfd qty'); eq(c.fees, 0.5, 'cfd fees');
});

console.log(`\nbot: ${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
