/**
 * Telegram plumbing: the webhook entry point (doPost) and helpers for
 * sending messages and buttons.
 *
 * The bot token lives in Script Properties as TELEGRAM_TOKEN (never in the sheet).
 */

var CHAT_ = null; // chat we're replying to during this request

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(25000);
  } catch (err) {
    return ContentService.createTextOutput('busy');
  }
  try {
    var update = JSON.parse(e.postData.contents);
    // Telegram can deliver the same update twice; only handle each one once.
    var props = PropertiesService.getScriptProperties();
    var lastId = Number(props.getProperty('LAST_UPDATE_ID') || 0);
    if (update.update_id && update.update_id <= lastId) return ContentService.createTextOutput('dup');
    if (update.update_id) props.setProperty('LAST_UPDATE_ID', String(update.update_id));
    handleUpdate_(update);
  } catch (err) {
    log_('ERROR', String(err && err.stack || err), '');
    try { if (CHAT_) reply_('⚠️ Something went wrong: ' + esc_(String(err && err.message || err)) + '\nDetails are in the Bot Log tab.'); } catch (e2) {}
  } finally {
    lock.releaseLock();
  }
  return ContentService.createTextOutput('ok');
}

function doGet() {
  return ContentService.createTextOutput('Portfolio bot is running.');
}

function handleUpdate_(update) {
  var msg = update.message;
  var cb = update.callback_query;
  var chat = msg ? msg.chat : cb && cb.message ? cb.message.chat : null;
  if (!chat) return;

  var settings = getSettings_();
  CHAT_ = String(chat.id);

  if (!settings.chatId) {
    log_('IN', msg ? msg.text : '(button)', 'chat ' + CHAT_ + ' - no chat ID in Settings yet');
    reply_('👋 Hi! Your chat ID is <code>' + CHAT_ + '</code>\n\n' +
      'Paste it into cell <b>B3</b> of the <b>Settings</b> tab in your sheet, then send <b>help</b>.\n' +
      'Until then I ignore everything, so nobody else can use this bot.');
    return;
  }
  if (settings.chatId !== CHAT_) {
    log_('BLOCKED', msg ? msg.text : '(button)', 'from chat ' + CHAT_);
    CHAT_ = null;
    return;
  }

  if (cb) {
    tg_('answerCallbackQuery', { callback_query_id: cb.id });
    log_('TAP', cb.data, '');
    handleCallback_(cb.message.message_id, String(cb.data || ''), settings);
  } else if (msg && typeof msg.text === 'string') {
    log_('IN', msg.text, '');
    handleText_(msg.text, settings);
  } else {
    reply_('I can only read text messages.');
  }
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

/** buttons: [[ [label, data], [label, data] ], [ ...next row ] ] */
function reply_(text, buttons) {
  var payload = { chat_id: CHAT_, text: text, parse_mode: 'HTML', disable_web_page_preview: true };
  if (buttons && buttons.length) {
    payload.reply_markup = { inline_keyboard: buttons.map(function (row) {
      return row.map(function (b) { return { text: b[0], callback_data: String(b[1]).slice(0, 64) }; });
    }) };
  }
  log_('OUT', text, buttons ? buttons.map(function (r) { return r.map(function (b) { return b[0]; }).join(' | '); }).join(' / ') : '');
  return tg_('sendMessage', payload);
}

/** Removes the buttons from an earlier message so they can't be tapped twice. */
function clearButtons_(messageId, note) {
  tg_('editMessageReplyMarkup', { chat_id: CHAT_, message_id: messageId, reply_markup: { inline_keyboard: [] } });
}

function tg_(method, payload) {
  var token = PropertiesService.getScriptProperties().getProperty('TELEGRAM_TOKEN');
  if (!token) throw new Error('TELEGRAM_TOKEN is missing from Script Properties.');
  var res = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/' + method, {
    method: 'post', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true
  });
  var body = {};
  try { body = JSON.parse(res.getContentText()); } catch (e) {}
  if (!body.ok && method !== 'editMessageReplyMarkup' && method !== 'answerCallbackQuery') {
    log_('TG-ERROR', method, res.getContentText().slice(0, 500));
  }
  return body;
}

function esc_(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ---------------------------------------------------------------------------
// One-off setup helpers - run these from the Apps Script editor
// ---------------------------------------------------------------------------

/**
 * Points Telegram at the bot. Uses the Cloudflare relay (Script Property RELAY_URL)
 * when set - recommended, see relay/worker.js - otherwise the web app URL directly.
 * Run again after setting RELAY_URL or after a NEW deployment URL.
 */
function connectTelegram() {
  var props = PropertiesService.getScriptProperties();
  var relay = String(props.getProperty('RELAY_URL') || '').trim();
  var url = relay || props.getProperty('WEBAPP_URL') || ScriptApp.getService().getUrl();
  if (relay && !/^https:\/\//.test(relay)) throw new Error('RELAY_URL must start with https:// - got: ' + relay);
  if (!relay && (!url || !/\/exec$/.test(url))) {
    throw new Error('No web app URL found. Deploy the script as a Web app first (see SETUP), ' +
      'or add a Script Property WEBAPP_URL with the ".../exec" link. Got: ' + url);
  }
  stopPolling();
  // Update IDs are per bot - forget any from a copied sheet/other bot so nothing is skipped as a "duplicate".
  props.deleteProperty('LAST_UPDATE_ID');
  props.deleteProperty('DRAFT');
  var r1 = tg_('setWebhook', { url: url, allowed_updates: ['message', 'callback_query'], drop_pending_updates: true });
  tg_('setMyCommands', { commands: [
    { command: 'portfolio', description: 'Summary of your holdings' },
    { command: 'undo', description: 'Remove the last entry' },
    { command: 'cancel', description: 'Cancel the entry in progress' },
    { command: 'help', description: 'How to talk to me' }
  ] });
  var info = tg_('getWebhookInfo', {});
  var msg = 'setWebhook: ' + JSON.stringify(r1) + '\n\nWebhook info: ' + JSON.stringify(info.result || info);
  console.log(msg);
  return msg;
}

/** Shows what Telegram thinks of the webhook (last error, pending messages). */
function checkTelegram() {
  var info = tg_('getWebhookInfo', {});
  console.log(JSON.stringify(info, null, 2));
  return info;
}

/** Stops Telegram from sending messages to this script. */
function disconnectTelegram() {
  console.log(JSON.stringify(tg_('deleteWebhook', { drop_pending_updates: true })));
}

// ---------------------------------------------------------------------------
// Fallback: polling instead of webhook. Only use this if the webhook route
// misbehaves. Replies then take up to ~1 minute. Run usePolling() once;
// run connectTelegram() to go back to instant replies.
// ---------------------------------------------------------------------------

function usePolling() {
  tg_('deleteWebhook', { drop_pending_updates: false });
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'pollTelegram') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('pollTelegram').timeBased().everyMinutes(1).create();
  console.log('Polling every minute. Run connectTelegram() + stopPolling() to switch back.');
}

function stopPolling() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'pollTelegram') ScriptApp.deleteTrigger(t);
  });
}

function pollTelegram() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try {
    var props = PropertiesService.getScriptProperties();
    var lastId = Number(props.getProperty('LAST_UPDATE_ID') || 0);
    var res = tg_('getUpdates', { offset: lastId + 1, timeout: 0, allowed_updates: ['message', 'callback_query'] });
    (res.result || []).forEach(function (u) {
      props.setProperty('LAST_UPDATE_ID', String(u.update_id));
      try { handleUpdate_(u); } catch (err) {
        log_('ERROR', String(err && err.stack || err), '');
        try { if (CHAT_) reply_('⚠️ Something went wrong: ' + esc_(String(err.message || err))); } catch (e2) {}
      }
    });
  } finally {
    lock.releaseLock();
  }
}
