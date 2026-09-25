/**
 * The conversation: turns your messages into a draft entry, asks for anything
 * missing or suspicious, and only writes to Transactions after you tap Confirm.
 *
 * One draft is kept at a time (Script Properties 'DRAFT'). Every button carries
 * the draft id, so old buttons can't act on a newer draft.
 */

var YES_WORDS = ['yes', 'y', 'ok', 'okay', 'confirm', 'confirmed', 'yep', 'ya', 'yup', 'correct', 'go', 'sure', 'k'];

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

function handleText_(text, settings) {
  var pctx = { today: todayIso_(), aliases: settings.aliases };
  var d = getDraft_();
  var low = String(text).trim().toLowerCase();

  // A plain "yes" while the confirm message is showing = tap Confirm
  if (d && d.stage === 'confirm' && YES_WORDS.indexOf(low) >= 0) return commit_(d, settings);

  var cmd = parseCommand(text, pctx);
  if (cmd && !(d && d.awaiting === 'ticker' && cmd.command === 'position')) {
    if (cmd.command === 'cancel') {
      clearDraft_();
      return reply_(d ? '❌ Cancelled. Nothing was saved.' : 'Nothing to cancel.');
    }
    if (cmd.command === 'help') return reply_(helpText_());
    if (cmd.command === 'portfolio') return sendPortfolio_();
    if (cmd.command === 'undo') return startUndo_();
    if (cmd.command === 'position') return sendPosition_(cmd.ticker);
  }

  // Answering a question the bot asked?
  if (d && d.awaiting && !looksLikeNewEntry(text, pctx)) {
    if (!applyAnswer_(d, text, pctx)) return; // it re-asked
    return step_(d, settings);
  }

  var p = parseMessage(text, pctx);
  log_('PARSED', text, p);
  if (p.short) {
    return reply_('Shorting isn\'t supported - this tracker only handles long positions. Nothing was saved.');
  }
  var noNumbers = p.qty == null && p.price == null && p.amount == null && p.ambiguousNumber == null;
  var weakTicker = !p.ticker || p.tickerSource === 'guess';
  var nothing = !p.action && !p.actionConflict && noNumbers && weakTicker &&
    !(p.tickerChoices.length && !p.tickerFromFuzzy);
  if (nothing) {
    return reply_('🤔 I didn\'t get that. Try something like:\n' +
      '<code>bought 3 meta at 500</code>\n<code>sold 2 aapl 230</code>\n<code>cfd fee meta 2.30</code>\n' +
      'or send <b>help</b>.');
  }
  if (d) clearDraft_();
  step_(draftFromParse_(p, text, pctx), settings);
}

function handleCallback_(messageId, data, settings) {
  var parts = data.split('|');

  if (parts[0] === 'u') return finishUndo_(messageId, parts[1], parts[2]);
  if (parts[0] === 'c') return handleCategoryTap_(messageId, parts);
  if (parts[0] === 'l') {
    clearButtons_(messageId);
    if (parts[1] && parts[2]) {
      saveAlias_(parts[1], parts[2]);
      return reply_('💾 Saved. Next time "' + esc_(parts[1]) + '" means <b>' + esc_(parts[2]) + '</b>.');
    }
    return;
  }

  var d = getDraft_();
  if (!d || d.id !== parts[0]) {
    clearButtons_(messageId);
    return reply_('That button has expired. Send the entry again.');
  }
  clearButtons_(messageId);
  var cmd = parts[1], arg = parts[2];

  switch (cmd) {
    case 'ok': return commit_(d, settings);
    case 'x': clearDraft_(); return reply_('❌ Cancelled. Nothing was saved.');
    case 't':
      if (arg === '?') { d.awaiting = 'ticker'; saveDraft_(d); return reply_('OK - reply with the ticker (e.g. <code>PLTR</code>).'); }
      if (d.choicesFuzzy && d.tickerToken) d.learn = { alias: d.tickerToken, ticker: arg };
      if (d.choicesFromSearch && d.choiceInfo && d.choiceInfo[arg]) {
        // Picked from a search: market is known, and so is the category. No alias is saved.
        d.profile = d.choiceInfo[arg];
        d.currency = parts[3] || d.profile.currency; d.currencyExplicit = true;
      }
      d.ticker = arg; d.tickerOk = false; d.choices = []; d.choicesFuzzy = false; d.choicesFromSearch = false;
      break;
    case 'a': d.action = arg; break;
    case 'ap': d.action = arg; d.price = d.live; d.priceOk = true; break;
    case 'amb':
      if (arg === 'q') d.qty = d.ambiguous; else d.price = d.ambiguous;
      d.ambiguous = null;
      break;
    case 'px': d.price = d.live; d.priceOk = true; break;
    case 'pok': d.priceOk = true; break;
    case 'pe': d.price = Number(arg); d.priceOk = true; break;
    case 'qok': d.qtyOk = true; break;
    case 'fee': return askField_(d, 'fee');
    case 'ed': return showEditMenu_(d);
    case 'e':
      if (arg === 'type') { d.type = d.type === 'CFD' ? 'SHARES' : 'CFD'; d.typeExplicit = true; d.qtyOk = false; break; }
      if (arg === 'ccy') {
        // Switch market (e.g. US <-> SGX); the ticker is re-checked on the new market.
        var auto = Object.keys(CURRENCIES).filter(function (c) { return CURRENCIES[c].autoDetect; });
        d.currency = auto[(auto.indexOf(d.currency) + 1) % auto.length];
        d.currencyExplicit = true; d.tickerOk = false; d.live = null; d.priceOk = false; d.qtyOk = false;
        break;
      }
      return askField_(d, arg);
    case 'bk': break;
  }
  step_(d, settings);
}

// ---------------------------------------------------------------------------
// Draft handling
// ---------------------------------------------------------------------------

function draftFromParse_(p, text, pctx) {
  return {
    id: Utilities.getUuid().slice(0, 6),
    source: String(text).slice(0, 300),
    action: p.actionConflict ? null : p.action,
    type: p.type, typeExplicit: !!p.type,
    ticker: p.ticker, tickerOk: false, name: null, live: null,
    currency: p.currency, currencyExplicit: !!p.currencyExplicit,
    choices: p.tickerChoices || [], choicesFuzzy: !!p.tickerFromFuzzy, tickerToken: p.tickerToken,
    searchText: p.searchText, searched: false, choicesFromSearch: false, choiceInfo: null, profile: null,
    qty: p.qty, price: p.price, fee: p.fee, amount: p.amount, total: p.total,
    ambiguous: p.ambiguousNumber, date: p.date || pctx.today,
    priceOk: false, qtyOk: false, awaiting: null, stage: null, learn: null
  };
}

function getDraft_() {
  var raw = PropertiesService.getScriptProperties().getProperty('DRAFT');
  if (!raw) return null;
  var d = JSON.parse(raw);
  if (d.created && Date.now() - d.created > 24 * 3600 * 1000) { clearDraft_(); return null; }
  return d;
}
function saveDraft_(d) {
  d.created = d.created || Date.now();
  PropertiesService.getScriptProperties().setProperty('DRAFT', JSON.stringify(d));
}
function clearDraft_() { PropertiesService.getScriptProperties().deleteProperty('DRAFT'); }

function isTrade_(d) { return d.action === 'BUY' || d.action === 'SELL'; }
function typeOf_(d) { return d.type || (d.action === 'FEE' ? 'CFD' : 'SHARES'); }

/**
 * Works out the next thing to ask. Sends exactly one message and saves the draft.
 */
function step_(d, settings) {
  d.awaiting = null; d.stage = null;
  var today = todayIso_();

  // 1. Which stock?
  if (!d.ticker) {
    if (d.choices && d.choices.length) {
      var info = d.choiceInfo || {};
      var q, rowsT;
      if (d.choicesFromSearch) {
        // One button per search result, e.g. "ME8U · Mapletree Industrial Trust · SGX"
        q = '"' + esc_(d.searchText) + '" isn\'t in my list - I searched and found:';
        rowsT = d.choices.map(function (tk) {
          var x = info[tk];
          return [[tk + ' · ' + String(x.name).slice(0, 32) + ' · ' + x.exchange, d.id + '|t|' + tk + '|' + x.currency]];
        });
      } else {
        q = d.choicesFuzzy
          ? 'Did you mean ' + d.choices.map(function (t) { return '<b>' + t + '</b>'; }).join(' / ') +
            ' for "' + esc_(d.tickerToken) + '"?'
          : 'Which one did you mean?';
        rowsT = [d.choices.map(function (tk) { return [tk, d.id + '|t|' + tk]; })];
      }
      d.awaiting = 'ticker'; saveDraft_(d);
      return reply_(q, rowsT.concat([[['✏️ Type the ticker', d.id + '|t|?'], ['❌ Cancel', d.id + '|x']]]));
    }
    // Words we couldn't place ("rocket lab", "mapletree"): search Yahoo once
    if (d.searchText && !d.searched) {
      d.searched = true;
      var found = yahooSearch_(d.searchText);
      log_('SEARCH', d.searchText, found);
      if (found.length) {
        d.choices = found.map(function (x) { return x.ticker; });
        d.choiceInfo = {};
        found.forEach(function (x) { d.choiceInfo[x.ticker] = x; });
        d.choicesFromSearch = true; d.choicesFuzzy = false;
        return step_(d, settings);
      }
      d.awaiting = 'ticker'; saveDraft_(d);
      return reply_('I couldn\'t find "' + esc_(d.searchText) + '" on US or SGX markets. Reply with the exact ticker.',
        [[['❌ Cancel', d.id + '|x']]]);
    }
    d.awaiting = 'ticker'; saveDraft_(d);
    return reply_('Which stock? Reply with the ticker or company name (e.g. <code>META</code>).',
      [[['❌ Cancel', d.id + '|x']]]);
  }
  if (!d.tickerOk) {
    // Which market? What you said > what you already hold it in > try US, then SGX.
    var preferred = d.currencyExplicit ? d.currency : (heldCurrency_(d.ticker) || d.currency);
    var qt = quote_(d.ticker, preferred);
    if (!qt && preferred && !d.currencyExplicit) qt = quote_(d.ticker);
    if (!qt && !d.searched && !d.currencyExplicit) {
      // Not a ticker after all - try it as a search ("sofi" typo, a name, etc.)
      d.searchText = d.searchText || d.tickerToken || d.ticker.toLowerCase();
      d.ticker = null; d.choices = [];
      return step_(d, settings);
    }
    if (!qt) {
      var bad = d.ticker;
      var where = d.currencyExplicit ? marketName_(d.currency) : 'US or SGX';
      d.ticker = null; d.choices = []; d.awaiting = 'ticker'; saveDraft_(d);
      return reply_('I couldn\'t find <b>' + esc_(bad) + '</b> on ' + where + '. Reply with the correct ticker.',
        [[['❌ Cancel', d.id + '|x']]]);
    }
    d.tickerOk = true; d.name = qt.name; d.live = qt.price; d.currency = qt.currency;
  }

  // 2. Buy, sell, fee or dividend?
  if (!d.action) {
    var head = (d.qty != null ? fmtQty_(d.qty) + ' × ' : '') + '<b>' + d.ticker + '</b>' +
      (d.date === today ? ' today' : ' on ' + fmtDate_(d.date)) + '.';
    if (d.qty != null && d.price == null && d.ambiguous == null && d.live) {
      d.awaiting = 'price'; saveDraft_(d);
      return reply_(head + ' ' + d.ticker + ' is ' + money_(d.live, d.currency) + ' right now.\n' +
        '<i>…or reply with the price you actually paid</i>', [
        [['🟢 Buy @ ' + money_(d.live, d.currency), d.id + '|ap|BUY'], ['🔴 Sell @ ' + money_(d.live, d.currency), d.id + '|ap|SELL']],
        [['❌ Cancel', d.id + '|x']]
      ]);
    }
    d.awaiting = 'action'; saveDraft_(d);
    return reply_(head + ' What was it?', [
      [['🟢 Buy', d.id + '|a|BUY'], ['🔴 Sell', d.id + '|a|SELL']],
      [['💸 Fee / financing', d.id + '|a|FEE'], ['💰 Dividend', d.id + '|a|DIVIDEND']],
      [['❌ Cancel', d.id + '|x']]
    ]);
  }

  // Fee/dividend: the parser didn't know the action yet, so collect the one amount.
  if (!isTrade_(d)) {
    if (d.amount == null) {
      var cands = [d.fee, d.price, d.ambiguous, d.total, d.qty].filter(function (v) { return v != null; });
      if (cands.length) d.amount = cands[0];
    }
    d.qty = null; d.price = null; d.fee = null; d.ambiguous = null; d.total = null;
    if (d.amount == null) return askField_(d, 'amount');
  }

  if (isTrade_(d)) {
    // 3. "bought meta 500" - shares or price?
    if (d.ambiguous != null) {
      saveDraft_(d);
      return reply_('Is <b>' + fmtQty_(d.ambiguous) + '</b> the number of shares or the price?', [
        [[fmtQty_(d.ambiguous) + ' shares', d.id + '|amb|q'], [money_(d.ambiguous, d.currency) + ' per share', d.id + '|amb|p']],
        [['❌ Cancel', d.id + '|x']]
      ]);
    }
    // 4. Quantity
    if (d.qty == null) return askField_(d, 'qty');
    if (d.price == null && d.total != null) d.price = round_(d.total / d.qty, 4);
    // 5. Price
    if (d.price == null) {
      if (d.live) {
        d.awaiting = 'price'; saveDraft_(d);
        return reply_(d.ticker + ' is <b>' + money_(d.live, d.currency) + '</b> right now. Use this price?\n' +
          '<i>…or reply with the price you actually paid</i>',
          [[['✅ Use ' + money_(d.live, d.currency), d.id + '|px'], ['❌ Cancel', d.id + '|x']]]);
      }
      return askField_(d, 'price');
    }
  }

  // 6. Date sanity
  if (!d.date) d.date = today;
  if (d.date > today) {
    d.date = null;
    return askField_(d, 'date', 'That date is in the future. ');
  }

  // 7. Price sanity (catches missing digits, or a total typed as a per-share price)
  if (isTrade_(d) && d.live && !d.priceOk) {
    var off = Math.abs(d.price - d.live) / d.live;
    if (off > settings.warn) {
      var rows = [[['Yes, ' + money_(d.price, d.currency) + ' is right', d.id + '|pok']]];
      var each = d.qty > 1 ? round_(d.price / d.qty, 4) : null;
      if (each && Math.abs(each - d.live) / d.live <= settings.warn) {
        rows.push([[money_(each, d.currency) + ' each (total ' + money_(d.price, d.currency) + ')', d.id + '|pe|' + each]]);
      }
      rows.push([['✏️ Change price', d.id + '|e|price'], ['❌ Cancel', d.id + '|x']]);
      saveDraft_(d);
      return reply_('⚠️ ' + d.ticker + ' is ' + money_(d.live, d.currency) + ' right now, but you said <b>' + money_(d.price, d.currency) +
        '</b> per share (' + Math.round(off * 100) + '% ' + (d.price > d.live ? 'above' : 'below') + '). Is that right?', rows);
    }
  }

  // 8. Selling more than you hold?
  if (d.action === 'SELL' && !d.qtyOk) {
    var pos = getPosition_(typeOf_(d), d.currency, d.ticker);
    var held = pos ? pos.qty : 0;
    if (d.qty > held + 1e-9) {
      saveDraft_(d);
      return reply_('⚠️ You only hold <b>' + fmtQty_(held) + ' ' + d.ticker + '</b> (' + typeOf_(d) + '). Sell ' +
        fmtQty_(d.qty) + ' anyway?', [
        [['Continue anyway', d.id + '|qok'], ['✏️ Change quantity', d.id + '|e|qty']],
        [['🔁 It\'s a ' + (typeOf_(d) === 'CFD' ? 'shares' : 'CFD') + ' position', d.id + '|e|type'], ['❌ Cancel', d.id + '|x']]
      ]);
    }
  }

  // 9. All good - confirm
  d.stage = 'confirm';
  saveDraft_(d);
  return reply_(confirmText_(d), confirmButtons_(d));
}

function askField_(d, field, prefix) {
  var q = {
    qty: 'How many shares of <b>' + d.ticker + '</b>?',
    price: 'What price per share did you ' + (d.action === 'SELL' ? 'sell' : 'pay') + ' (' + (d.currency || BASE_CCY) + ')?',
    fee: 'What was the fee / commission in ' + (d.currency || BASE_CCY) + '? Reply <code>0</code> for none.',
    amount: (d.action === 'DIVIDEND' ? 'How much was the dividend' : 'How much was the fee') + ' in ' + (d.currency || BASE_CCY) + '?',
    date: 'Which date? e.g. <code>today</code>, <code>yesterday</code>, <code>22/9</code>, <code>22 sep</code>',
    ticker: 'Reply with the ticker or company name.'
  }[field];
  d.awaiting = field; d.stage = null;
  if (field === 'price') d.priceOk = false;
  if (field === 'qty') d.qtyOk = false;
  if (field === 'ticker') { d.ticker = null; d.tickerOk = false; d.choices = []; }
  saveDraft_(d);
  return reply_((prefix || '') + q, [[['❌ Cancel', d.id + '|x']]]);
}

/** Fills in the field the bot asked for. Returns false (after re-asking) if the reply didn't fit. */
function applyAnswer_(d, text, pctx) {
  var f = d.awaiting;
  if (f === 'ticker') {
    var r = parseMessage(text, { today: pctx.today, aliases: pctx.aliases, answerMode: true });
    // A fresh answer gets its own search if it turns out not to be a ticker
    d.searched = false; d.choicesFromSearch = false; d.choiceInfo = null; d.profile = null;
    d.searchText = r.searchText || String(text).trim().toLowerCase();
    if (r.currencyExplicit) { d.currency = r.currency; d.currencyExplicit = true; }
    if (r.ticker) {
      if (d.choicesFuzzy && d.tickerToken && d.tickerToken !== r.ticker.toLowerCase()) {
        d.learn = { alias: d.tickerToken, ticker: r.ticker };
      }
      d.ticker = r.ticker; d.tickerOk = false; d.choices = []; d.choicesFuzzy = false;
      if (!r.currencyExplicit && r.currency) d.currency = r.currency;
    } else if (r.tickerChoices.length) {
      d.choices = r.tickerChoices; d.choicesFuzzy = r.tickerFromFuzzy;
      if (r.tickerFromFuzzy) d.tickerToken = r.tickerToken;
    } else if (r.searchText) {
      d.ticker = null; d.choices = []; // step_ searches it
    } else {
      reply_('Still not sure which stock that is. Reply with the exact ticker, e.g. <code>PLTR</code>.',
        [[['❌ Cancel', d.id + '|x']]]);
      return false;
    }
  } else if (f === 'action') {
    var a = parseMessage(text, pctx).action;
    if (!a) {
      reply_('Tap one of the buttons above, or reply <code>buy</code>, <code>sell</code>, <code>fee</code> or <code>dividend</code>.');
      return false;
    }
    d.action = a;
  } else if (f === 'date') {
    var dt = parseDateReply(text, pctx.today);
    if (!dt) { askField_(d, 'date', 'Sorry, I couldn\'t read that date. '); return false; }
    d.date = dt;
  } else if (f === 'fee' && /^\s*(0|none|no|nil|nope|free|-)\s*$/i.test(text)) {
    d.fee = 0;
  } else {
    var n = parseNumberReply(text);
    if (n == null) { askField_(d, f, 'I need a single number. '); return false; }
    if (f === 'qty') { d.qty = n; d.qtyOk = false; }
    else if (f === 'price') { d.price = n; d.priceOk = false; }
    else if (f === 'fee') d.fee = n;
    else if (f === 'amount') d.amount = n;
  }
  d.awaiting = null;
  return true;
}

function showEditMenu_(d) {
  var auto = Object.keys(CURRENCIES).filter(function (c) { return CURRENCIES[c].autoDetect; });
  var nextCcy = auto[(auto.indexOf(d.currency) + 1) % auto.length];
  var switches = [['→ ' + (typeOf_(d) === 'CFD' ? 'Shares' : 'CFD'), d.id + '|e|type'],
    ['→ ' + marketName_(nextCcy) + ' (' + nextCcy + ')', d.id + '|e|ccy']];
  var rows = isTrade_(d)
    ? [[['Quantity', d.id + '|e|qty'], ['Price', d.id + '|e|price'], ['Fee', d.id + '|e|fee']],
       [['Date', d.id + '|e|date'], ['Ticker', d.id + '|e|ticker']], switches]
    : [[['Amount', d.id + '|e|amount'], ['Date', d.id + '|e|date'], ['Ticker', d.id + '|e|ticker']], switches];
  rows.push([['↩️ Back', d.id + '|bk'], ['❌ Cancel', d.id + '|x']]);
  saveDraft_(d);
  return reply_('What do you want to change?', rows);
}

function confirmText_(d) {
  var type = typeOf_(d);
  var lines = ['<b>Confirm ' + d.action + ' · ' + type + (d.currency !== BASE_CCY ? ' · ' + d.currency : '') + '</b>'];
  if (isTrade_(d)) {
    var fee = d.fee || 0;
    var total = d.qty * d.price + (d.action === 'BUY' ? fee : -fee);
    lines.push(fmtQty_(d.qty) + ' × <b>' + d.ticker + '</b> @ ' + money_(d.price, d.currency));
    lines.push(esc_(d.name || d.ticker) + ' · ' + marketName_(d.currency) + ' · ' + esc_(getSettings_().platform));
    var fx = fxRate_(d.currency, HOME_CCY);
    lines.push((d.action === 'BUY' ? 'Total cost: ' : 'Proceeds: ') + money_(total, d.currency) +
      (fx && d.currency !== HOME_CCY ? ' (≈ ' + money_(total * fx, HOME_CCY, 0) + ')' : ''));
    lines.push('Fee: ' + (fee ? money_(fee, d.currency) : 'none'));
  } else {
    lines.push('<b>' + d.ticker + '</b> · ' + money_(d.amount, d.currency));
  }
  lines.push('Date: ' + fmtDate_(d.date));
  return lines.join('\n');
}

function confirmButtons_(d) {
  var rows = [[['✅ Confirm', d.id + '|ok'], ['❌ Cancel', d.id + '|x']]];
  var second = [];
  if (isTrade_(d)) second.push([d.fee ? '💲 Change fee' : '💲 Add fee', d.id + '|fee']);
  second.push(['✏️ Edit', d.id + '|ed']);
  rows.push(second);
  return rows;
}

// ---------------------------------------------------------------------------
// Saving
// ---------------------------------------------------------------------------

function commit_(d, settings) {
  var type = typeOf_(d);
  var entry = {
    date: d.date, action: d.action, type: type, ticker: d.ticker, currency: d.currency || BASE_CCY,
    qty: d.qty, price: d.price, fee: d.fee || 0, amount: d.amount,
    notes: d.source
  };
  var id = appendTransaction_(entry);
  clearDraft_();
  log_('SAVED', d.source, entry);
  var cat = categoriseNew_(d);
  rebuildHoldings_();

  var msg;
  if (isTrade_(d)) {
    var pos = getPosition_(type, d.currency, d.ticker);
    msg = '✅ Logged: ' + d.action + ' ' + fmtQty_(d.qty) + ' ' + d.ticker + ' @ ' + money_(d.price, d.currency) + ' (' + type + ')';
    if (pos && pos.qty > 1e-9) msg += '\nYou now hold <b>' + fmtQty_(pos.qty) + ' ' + d.ticker + '</b> · avg ' + money_(pos.avg, d.currency);
    else if (pos) msg += '\nPosition closed. Realised P/L on ' + d.ticker + ': <b>' + moneySigned_(pos.realised, d.currency) + '</b>';
  } else {
    msg = '✅ Logged ' + (d.action === 'FEE' ? 'fee' : 'dividend') + ' ' + money_(d.amount, d.currency) + ' on ' + d.ticker + ' (' + type + ')';
  }
  msg += '\n<i>Send undo to remove it.</i>';
  reply_(msg);

  // New ticker: show what it was categorised as, or ask
  if (cat.status === 'auto') {
    reply_('🏷 <b>' + d.ticker + '</b>: ' + describeCat_(cat.cat), [[['✏️ Change', 'c|' + d.ticker]]]);
  } else if (cat.status === 'ask') {
    askAssetType_(d.ticker, 'New ticker - I couldn\'t look up what <b>' + d.ticker + '</b> is.');
  }

  if (d.learn && d.learn.alias && d.learn.alias.length <= 30 && !settings.aliases[d.learn.alias]) {
    reply_('Save "' + esc_(d.learn.alias) + '" → <b>' + d.learn.ticker + '</b> so I recognise it next time?', [[
      ['💾 Save', 'l|' + d.learn.alias + '|' + d.learn.ticker], ['No thanks', 'l||']
    ]]);
  }
  return id;
}

// ---------------------------------------------------------------------------
// Undo
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Categories (asset type + GICS sector), one per ticker
// ---------------------------------------------------------------------------

/** For a ticker without a category: use the search result, else look it up on Yahoo. */
function categoriseNew_(d) {
  if (readCategories_()[d.ticker]) return { status: 'known' };
  var fromSearch = d.profile && (d.profile.assetType !== 'Company' || d.profile.sector);
  var c = fromSearch ? d.profile : yahooProfile_(d.ticker, d.currency);
  if (!c) return { status: 'ask' };
  c = { name: c.name || d.name, assetType: c.assetType, sector: c.sector, industry: c.industry };
  saveCategory_(d.ticker, c, 'auto');
  return { status: 'auto', cat: c };
}

function describeCat_(c) {
  if (c.assetType === 'ETF') return 'ETF';
  return c.assetType + ' · ' + (c.sector || UNCATEGORISED) + (c.industry ? ' <i>(' + esc_(c.industry) + ')</i>' : '');
}

function askAssetType_(ticker, intro) {
  return reply_((intro ? intro + '\n' : '') + 'What is <b>' + ticker + '</b>?', [
    ASSET_TYPES.map(function (a) { return [a, 'c|' + ticker + '|a|' + a]; }),
    [['Skip for now', 'c|' + ticker + '|skip']]
  ]);
}

function askSector_(ticker) {
  var rows = [], row = [];
  SECTORS.forEach(function (sct, i) {
    row.push([sct[1], 'c|' + ticker + '|s|' + i]);
    if (row.length === 3) { rows.push(row); row = []; }
  });
  if (row.length) rows.push(row);
  return reply_('Which sector is <b>' + ticker + '</b>?', rows);
}

/** Buttons: c|TICKER (change) · c|TICKER|a|ETF · c|TICKER|s|4 · c|TICKER|skip */
function handleCategoryTap_(messageId, parts) {
  clearButtons_(messageId);
  var ticker = parts[1], what = parts[2], val = parts[3];
  if (!what) return askAssetType_(ticker);
  if (what === 'skip') {
    return reply_('OK - ' + ticker + ' shows as ' + UNCATEGORISED + '. You can set it on the Categories tab.');
  }
  var existing = readCategories_()[ticker] || {};
  var c;
  if (what === 'a') {
    if (val === 'Company') return askSector_(ticker);
    c = { assetType: val, sector: val === 'REIT' ? 'Real Estate' : '', industry: existing.industry, name: existing.name };
  } else if (what === 's') {
    var sct = SECTORS[Number(val)];
    if (!sct) return;
    c = { assetType: 'Company', sector: sct[0], industry: existing.industry, name: existing.name };
  } else {
    return;
  }
  saveCategory_(ticker, c, 'you');
  rebuildHoldings_();
  return reply_('🏷 Saved: <b>' + ticker + '</b> · ' + describeCat_(c));
}

function startUndo_() {
  var t = lastTransaction_();
  if (!t) return reply_('There\'s nothing to undo yet.');
  return reply_('Remove this entry?\n<b>' + describeTx_(t) + '</b>', [[
    ['🗑 Remove', 'u|' + t.id + '|y'], ['Keep it', 'u|' + t.id + '|n']
  ]]);
}

function finishUndo_(messageId, id, answer) {
  clearButtons_(messageId);
  if (answer !== 'y') return reply_('OK, kept it.');
  var t = findTransaction_(id);
  if (!t) return reply_('That entry is already gone.');
  deleteTransaction_(id);
  log_('UNDO', describeTx_(t), t);
  rebuildHoldings_();
  return reply_('🗑 Removed: ' + describeTx_(t));
}

function describeTx_(t) {
  var body = (t.action === 'BUY' || t.action === 'SELL')
    ? t.action + ' ' + fmtQty_(t.qty) + ' ' + t.ticker + ' @ ' + money_(t.price, t.currency) + (t.fee ? ' + fee ' + money_(t.fee, t.currency) : '')
    : t.action + ' ' + t.ticker + ' ' + money_(t.amount, t.currency);
  return body + ' · ' + t.type + ' · ' + fmtDate_(t.date);
}

// ---------------------------------------------------------------------------
// Portfolio & position replies
// ---------------------------------------------------------------------------

function sendPortfolio_() {
  var p = readPortfolio_();
  if (typeof p.worth !== 'number') {
    return reply_('Prices are still loading in the sheet - try again in a few seconds.');
  }
  var lines = ['💼 <b>Portfolio</b>',
    'Worth: <b>' + money_(p.worth, BASE_CCY) + '</b>' +
      (typeof p.worthHome === 'number' ? ' (' + money_(p.worthHome, HOME_CCY, 0) + ')' : ''),
    'Cost: ' + money_(p.cost, BASE_CCY),
    'P/L: <b>' + moneySigned_(p.unrealised, BASE_CCY) + '</b> (' + pctSigned_(p.pct) + ') · Today ' +
      moneySigned_(p.today, BASE_CCY)];
  if (typeof p.other === 'number' && Math.abs(p.other) > 0.005) {
    lines.push('Realised + dividends − fees: ' + moneySigned_(p.other, BASE_CCY));
  }
  if (p.currencies.length > 1) {
    lines.push('', '<b>By currency</b>');
    p.currencies.forEach(function (c) {
      lines.push('<code>' + pad_(c.ccy, 4) + '</code> ' + money_(c.worth, c.ccy, 0) +
        (c.ccy !== BASE_CCY && typeof c.worthBase === 'number' ? ' (≈ ' + money_(c.worthBase, BASE_CCY, 0) + ')' : '') +
        ' · ' + pct_(c.weight) + ' · P/L ' + moneySigned_(c.pl, c.ccy) + ' (' + pctSigned_(c.pct) + ')');
    });
  }
  if (p.sectors && p.sectors.length) {
    lines.push('', '<b>By sector</b>');
    lines.push(p.sectors.map(function (s) { return esc_(s.name) + ' ' + pct_(s.weight); }).join(' · '));
  }
  var any = false;
  p.sections.forEach(function (s) {
    if (!s.rows.length) return;
    any = true;
    lines.push('', '<b>' + (s.type === 'CFD' ? 'CFDs' : 'Shares') + ' · ' + s.currency + '</b>');
    s.rows.sort(function (a, b) { return (Number(b.weight) || 0) - (Number(a.weight) || 0); });
    s.rows.forEach(function (r) {
      lines.push('<code>' + pad_(r.ticker, 6) + '</code> ' + pct_(r.weight) + ' · ' + money_(r.worth, s.currency, 0) +
        ' · ' + pctSigned_(r.plPct));
    });
  });
  if (!any) lines.push('', 'No open positions yet.');
  return reply_(lines.join('\n'));
}

function sendPosition_(ticker) {
  var all = computePositions(readTransactions_()).filter(function (p) { return p.ticker === ticker; });
  var quotes = {};
  var quoteFor = function (ccy) {
    if (!(ccy in quotes)) quotes[ccy] = quote_(ticker, ccy);
    return quotes[ccy];
  };
  var head = all.length ? quoteFor(all[0].currency) : quote_(ticker);
  var lines = ['<b>' + ticker + '</b>' + (head ? ' · ' + esc_(head.name) + ' · ' + money_(head.price, head.currency) : '')];
  if (!all.length) lines.push('You don\'t hold any ' + ticker + '.');
  all.forEach(function (p) {
    var c = p.currency;
    lines.push('', '<b>' + p.type + (c !== BASE_CCY ? ' · ' + c : '') + '</b>');
    if (p.qty > 1e-9) {
      lines.push(fmtQty_(p.qty) + ' shares · avg ' + money_(p.avg, c) + ' · cost ' + money_(p.cost, c));
      var q = quoteFor(c);
      if (q) {
        var worth = p.qty * q.price, pl = worth - p.cost;
        lines.push('Worth ' + money_(worth, c) + ' · P/L <b>' + moneySigned_(pl, c) + '</b> (' +
          pctSigned_(p.cost ? pl / p.cost : 0) + ')');
      }
    } else {
      lines.push('Closed position');
    }
    if (Math.abs(p.realised) > 0.005) lines.push('Realised: ' + moneySigned_(p.realised, c));
    if (p.dividends) lines.push('Dividends: ' + money_(p.dividends, c));
    if (p.fees) lines.push('Fees & financing: ' + money_(p.fees, c));
  });
  return reply_(lines.join('\n'));
}

function helpText_() {
  return [
    '<b>Just tell me what you did</b> - I\'ll confirm before saving anything.',
    '',
    '<code>bought 3 meta at 500</code>',
    '<code>sold 2 aapl 230 fee 1</code>',
    '<code>bought 5 nvda cfd 121.5</code>',
    '<code>bought 3 meta</code>  (I\'ll offer the live price)',
    '<code>bought 2 tsla 250 yesterday</code>  (or 22/9, 22 sep, friday)',
    '<code>cfd fee meta 2.30</code>  (financing / charges)',
    '<code>dividend aapl 3.20</code>',
    '<code>bought 1300 buou 0.88</code>  (SGX - also dbs, ocbc, c38u…)',
    '',
    '<b>Commands</b>',
    '<code>portfolio</code> - summary · <code>meta</code> - one position',
    '<code>undo</code> - remove last entry · <code>cancel</code> - drop the current one',
    '',
    'You hold SHARES by default - add <code>cfd</code> for CFDs. Market is detected (US first, then SGX); ' +
      'add <code>sgx</code> or <code>sgd</code> to be explicit.'
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function fmtNum_(n, dp) {
  var s = Number(n).toFixed(dp);
  var parts = s.split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return parts.join('.');
}
/** "$1,234.56", "S$0.885", "RM 5,000" */
function money_(n, ccy, dp) {
  if (typeof n !== 'number' || !isFinite(n)) return '-';
  var sym = (CURRENCIES[ccy || BASE_CCY] || {}).symbol || (ccy + ' ');
  if (sym === 'RM') sym = 'RM ';
  var d = dp != null ? dp : (Math.abs(n) < 1 ? 4 : Math.abs(n) < 10 ? 3 : 2);
  var s = fmtNum_(Math.abs(n), d);
  if (dp == null) s = s.replace(/(\.\d\d\d*?)0+$/, '$1'); // 0.8800 -> 0.88, keep 0.885
  return (n < 0 ? '-' : '') + sym + s;
}
function moneySigned_(n, ccy) { return typeof n === 'number' ? (n > 0 ? '+' : '') + money_(n, ccy) : '-'; }
function marketName_(ccy) { return { USD: 'US', SGD: 'SGX', HKD: 'HKEX', MYR: 'Bursa', AUD: 'ASX', GBP: 'LSE' }[ccy] || ccy; }
function pct_(n) { return typeof n === 'number' ? (n * 100).toFixed(1) + '%' : '-'; }
function pctSigned_(n) { return typeof n === 'number' ? (n > 0 ? '+' : '') + (n * 100).toFixed(1) + '%' : '-'; }
function fmtQty_(n) { return String(Math.round(Number(n) * 10000) / 10000); }
function pad_(s, n) { s = String(s); while (s.length < n) s += ' '; return s; }
function fmtDate_(iso) {
  if (!iso) return '-';
  var p = iso.split('-');
  var dt = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
  var days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return days[dt.getUTCDay()] + ' ' + (+p[2]) + ' ' + months[+p[1] - 1] + ' ' + p[0];
}
