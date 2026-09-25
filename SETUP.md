# Portfolio bot – setup (about 15 minutes, all free)

Do this on a laptop. Once it's set up, you only need your phone.

## 1. Create the sheet and paste in the code

1. Go to sheets.new to create a blank Google Sheet. Name it something like **Portfolio**.
2. Open **Extensions → Apps Script**.
3. Click **⚙ Project Settings** (left sidebar) and tick **Show "appsscript.json" manifest file in editor**.
4. Go back to **Editor** (`< >`). For each file in `src/`, create a script file with the same name and paste the contents in:

   | File in `src/` | In Apps Script |
   |---|---|
   | `appsscript.json` | Already exists. Replace everything in it. |
   | `Code.gs` (the default one) | Rename it to `Config` and paste in `Config.gs` |
   | `Tickers.gs`, `Parser.gs`, `Data.gs`, `Bot.gs`, `Telegram.gs`, `Setup.gs` | **+ → Script**, name it without the `.gs`, then paste |

5. Click **💾 Save**.

## 2. Build the tabs

1. In the function dropdown at the top, choose **`setup`** and click **▶ Run**.
2. Google asks for permission. Pick your account → **Advanced** → **Go to (project name) (unsafe)** → **Allow**.
   The "unsafe" warning appears because it's your own script and Google hasn't reviewed it. It only accesses this sheet and Telegram.
3. Go back to the sheet. You should see the tabs **Dashboard, Holdings, Transactions, Bot Log, Settings, History**, plus a **Portfolio** menu.

## 3. Create your Telegram bot

1. In Telegram, message **@BotFather** → `/newbot` → choose a name and a username (it must end in `bot`).
2. BotFather replies with a **token** like `123456:ABC-xyz…`. Treat it like a password.
3. In Apps Script: **⚙ Project Settings → Script properties → Add script property**
   - Property: `TELEGRAM_TOKEN`
   - Value: *(paste the token)*
   - **Save script properties**

## 4. Put the bot online

1. In Apps Script: **Deploy → New deployment → ⚙ (Select type) → Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**. Telegram has to be able to reach it. The bot ignores everyone except you (step 5).
   - **Deploy**, then copy the **Web app URL** (it ends in `/exec`).
2. Add another script property: `WEBAPP_URL` = *(that URL)*.
3. Set up the relay (next section), then choose the **`connectTelegram`** function and click **▶ Run**. The log should show `"ok":true`.

> **Only ever click "New deployment" once.** For code updates use **Deploy → Manage deployments → ✏️ → Version: New version → Deploy**. The URL then stays the same.

## 4b. Add the relay (free, about 5 minutes, needed for reliable replies)

Apps Script answers Telegram with a "302 redirect". Telegram treats that as a failure and keeps re-sending old messages, so new ones get stuck. A tiny free Cloudflare Worker fixes this: it answers Telegram "OK" instantly and passes each message on to your script.

1. Create a free account at **dash.cloudflare.com** (sign up yourself; no card needed).
2. **Workers & Pages → Create → Create Worker** (the "Hello World" template). Name it e.g. `portfolio-relay` → **Deploy**.
3. Click **Edit code**. Delete everything and paste in [`relay/worker.js`](relay/worker.js).
4. On the `APPS_SCRIPT_URL` line, replace `PASTE_YOUR_APPS_SCRIPT_EXEC_URL_HERE` with your web app URL (the `/exec` one, inside the quotes) → **Deploy**.
5. Copy the worker's URL, e.g. `https://portfolio-relay.yourname.workers.dev`. Opening it in a browser should show *"Portfolio bot relay is running."*
6. In Apps Script, add a script property: `RELAY_URL` = *(the worker URL)*.
7. Run **`connectTelegram`**. Then **Portfolio → Check Telegram connection** should show the worker URL, with no `last_error_message` and `pending_update_count: 0`.

If you ever make a new deployment with a different `/exec` URL, update it in the worker code too.

## 5. Lock the bot to your account

1. Open your bot in Telegram and send `hi`.
2. It replies with **your chat ID**. Paste that number into **Settings → B3** in the sheet.
3. Send `help`. You're done 🎉

---

## Using it

```
bought 3 meta at 500          sold 2 aapl 230 fee 1
bought 5 nvda cfd 121.5       bought 3 meta          (offers the live price)
bought 2 tsla 250 yesterday   (or 22/9, 22 sep, friday)
cfd fee meta 2.30             dividend aapl 3.20
bought 1300 buou 0.88         bought 100 dbs 77.5    (SGX, priced in SGD)
portfolio   meta   undo   cancel   help
```

- Nothing is saved until you tap **✅ Confirm** (or reply `yes`).
- If something is missing or looks wrong, the bot asks you instead of guessing.
- You hold **SHARES** by default. Add `cfd` for CFDs. A fee message with no type counts as **CFD**.
- **Don't know the ticker?** Type the name (`rocket lab`, `mapletree`, `sti etf`). If it's not in the bot's list, the bot searches Yahoo and shows buttons for the US and SGX matches.
- **New tickers are categorised automatically** after you confirm (e.g. *🏷 SOFI: Company · Financials*), with a **✏️ Change** button. If the bot can't look it up, it asks you with buttons: Company / ETF / REIT, then the sector.
- **Market / currency** is worked out for you. It uses the currency you already hold the stock in if there is one. Otherwise it checks the US market first, then SGX. Known SGX codes and names (`D05`, `C38U`, `dbs`, `ocbc`…) go straight to SGX. Add `sgx`/`sgd` (or write `s$0.88`) to say it yourself, or change it with **✏️ Edit** on the confirm message.
- To check how the bot reads a message without saving anything, use **Portfolio → Test a message** in the sheet.

## The tabs

| Tab | What it does |
|---|---|
| **Dashboard** | Headline numbers; tables for **by currency**, **by sector** (ETFs get their own slice) and **by asset type**; pie charts for sector, position, asset type, currency and Shares vs CFDs; and a value-over-time line built from the daily snapshots. |
| **Holdings** | Rebuilt automatically from Transactions. It starts with a **By currency** table: worth, P/L and today's change per currency, each converted to USD and shown as a share of the portfolio. Below that, a section per type and currency (Stocks · USD, Stocks · SGD, CFDs · USD…), each in its own currency, using your columns plus P/L %, today's change, realised P/L, dividends and fees. |
| **Transactions** | Every confirmed entry. You can edit a row by hand and Holdings updates itself. **Currency** is USD for US stocks and SGD for SGX stocks; Price, Fee and Amount are in that currency. Use plain tickers (`AAPL`, not IBKR's CFD name `AAPLn`, although `AAPLn` on a CFD row is fixed automatically). |
| **Categories** | One row per ticker: **Asset type** (Company / ETF / REIT) and **Sector** (the 11 GICS sectors). Filled in from Yahoo automatically; anything you set yourself is marked `you`. Edit a row and Holdings updates. Use **Portfolio → Categorise all tickers** to fill in anything missing. |
| **Prices** | Prices for SGX and other non-US stocks, from Yahoo Finance (Google Finance doesn't cover SGX). Refreshed every 15 minutes during Asian market hours, and whenever holdings change. |
| **Bot Log** | Every message in and out, how it was read, and any errors. Check here first when debugging. |
| **Settings** | Your chat ID, the price-warning threshold (default 30%) and ticker aliases (the words you type, mapped to tickers). |
| **History** | One row per day at about 7am MYT (after the US market closes). This feeds the line chart. |

**How the numbers work:** average-cost method. Commission is included in your average cost. Selling doesn't change your average cost; the gain or loss on the shares sold goes into **Realised P/L**. CFDs count at full position size. Each currency is totalled in its own currency; the combined total converts everything to USD (and MYR) at today's exchange rates.

## Changing the code later

After pasting in new code, **run `setup` again**. It's safe: it never deletes your Transactions, Settings or History. It adds any new tabs, columns and triggers (for example the Currency column and the Prices tab).


After editing, go to **Deploy → Manage deployments → ✏️ → Version: New version → Deploy**.
The URL stays the same, so you don't need to reconnect Telegram.

## Troubleshooting

- **Bot doesn't reply:** go to **Portfolio → Check Telegram connection** and look at `last_error_message`. Then check the **Bot Log** tab and **Apps Script → Executions**.
- **You see `Wrong response from the webhook: 302`, or messages get no reply:** Telegram is talking to Apps Script directly. Set up the relay (step 4b) and run `connectTelegram`. As a last resort, run **`usePolling`** once. Replies then take up to about 1 minute. Run `connectTelegram` to switch back.
- **A price shows blank or "Loading":** GOOGLEFINANCE is sometimes slow. Wait a moment, or use **Portfolio → Rebuild holdings**.
- **An SGX price is blank:** use **Portfolio → Refresh SGX / non-US prices** and check the **Prices** tab. If Yahoo is blocking requests, the **Bot Log** shows `PRICE-ERROR` rows.
- **A ticker isn't recognised:** type it exactly (e.g. `SOFI`), or add a row in **Settings → Ticker aliases**.
