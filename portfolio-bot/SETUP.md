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
3. Choose the **`connectTelegram`** function and click **▶ Run**. The log should show `"ok":true`.

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
portfolio   meta   undo   cancel   help
```

- Nothing is saved until you tap **✅ Confirm** (or reply `yes`).
- If something is missing or looks wrong, the bot asks you instead of guessing.
- Type defaults to **STOCK**. Add `cfd` for CFDs. A fee message with no type counts as **CFD**.
- To check how the bot reads a message without saving anything, use **Portfolio → Test a message** in the sheet.

## The tabs

| Tab | What it does |
|---|---|
| **Dashboard** | Headline numbers and charts. The value-over-time chart fills in from daily snapshots. |
| **Holdings** | Rebuilt automatically from Transactions. The Stocks and CFDs sections use your columns, plus P/L %, today's change, realised P/L, dividends and fees. |
| **Transactions** | Every confirmed entry. You can edit a row by hand and Holdings updates itself. |
| **Bot Log** | Every message in and out, how it was read, and any errors. Check here first when debugging. |
| **Settings** | Your chat ID, the price-warning threshold (default 30%) and ticker aliases (the words you type, mapped to tickers). |
| **History** | One row per day at about 7am MYT (after the US market closes). This feeds the line chart. |

**How the numbers work:** average-cost method. Commission is included in your average cost. Selling doesn't change your average cost; the gain or loss on the shares sold goes into **Realised P/L**. CFDs count at full position size. MYR values use today's USD/MYR rate.

## Changing the code later

After editing, go to **Deploy → Manage deployments → ✏️ → Version: New version → Deploy**.
The URL stays the same, so you don't need to reconnect Telegram.

## Troubleshooting

- **Bot doesn't reply:** go to **Portfolio → Check Telegram connection** and look at `last_error_message`. Then check the **Bot Log** tab and **Apps Script → Executions**.
- **You see `Wrong response from the webhook: 302`:** this is normal for Apps Script. The bot ignores duplicate deliveries. If replies stop arriving, run **`usePolling`** once. Replies then take up to about 1 minute, but it's very reliable. Run `connectTelegram` to switch back.
- **A price shows blank or "Loading":** GOOGLEFINANCE is sometimes slow. Wait a moment, or use **Portfolio → Rebuild holdings**.
- **A ticker isn't recognised:** type it exactly (e.g. `SOFI`), or add a row in **Settings → Ticker aliases**.
