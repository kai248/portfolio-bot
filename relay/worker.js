/**
 * Telegram -> Apps Script relay (Cloudflare Worker, free plan).
 *
 * Why: Apps Script web apps answer every POST with a "302 redirect". Telegram
 * treats that as a failure and keeps re-sending the same message, so newer
 * messages get stuck in its queue. This worker answers Telegram "200 OK" straight
 * away and passes the message on to your script in the background.
 *
 * Setup: paste your Apps Script web app URL (ends in /exec) below, then deploy.
 */
const APPS_SCRIPT_URL = 'PASTE_YOUR_APPS_SCRIPT_EXEC_URL_HERE';

export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'POST') {
      return new Response('Portfolio bot relay is running.');
    }
    const body = await request.text();
    // Forward in the background; the script runs even though we don't wait for it.
    ctx.waitUntil(
      fetch(APPS_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        redirect: 'follow'
      }).catch((err) => console.log('Forward failed: ' + err))
    );
    return new Response('ok');
  }
};
