# Daily Pulse

A self-hosted fitness dashboard for your Apple Watch. An iPhone Shortcut sends each day's Health numbers to your own server at 9 pm, and your iPhone and watch show a short daily report. Open the dashboard any time for rings, readiness, heart trends and streaks.

- **Today:** Move, Exercise and Stand rings, steps against goal, calories, distance, sleep, workouts, weight. Each is compared with your 30-day average.
- **Readiness score:** HRV, resting heart rate and sleep against your own baseline, similar to Oura and Whoop.
- **Heart:** resting HR, HRV, average HR, VO₂ max with 30-day sparklines.
- **Insights:** plain-language notes, such as a raised resting HR, short sleep streaks and progress toward the WHO's 150 weekly exercise minutes.
- **Trends:** any metric over 7 days, 30 days, 90 days or 1 year, plus week over week.
- **Log:** edit any day and add energy, water and notes.
- **Import:** load years of history from Apple Health's `export.xml`. It's parsed in the browser.

Your data lives in your own Cloudflare account (free tier). Nothing goes anywhere else.

## How it works

```
Apple Watch ──► iPhone Health ──► Shortcut (9 pm automation)
                                     │  POST /api/sync  (JSON + token)
                                     ▼
                         Cloudflare Worker + D1 database
                                     │
         {"report": "Readiness 72. 8,432 steps …"} ──► notification on iPhone + watch
                                     │
                          Dashboard (any browser)
```

Apple only lets iPhone apps read Health data, so a web app can't read it directly. The Shortcuts app bridges that gap without a native app.

## Deploy from your browser (about 10 minutes, free, nothing to install)

1. **Create a Cloudflare account** at [dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up) and verify your email.
2. **Create the database.** In the Cloudflare dashboard open **Storage & databases → D1 SQL database → Create**. Name it `daily-pulse` and create it. Copy the **Database ID** shown on its page.
3. **Put the ID in your copy of the code.** On GitHub open `wrangler.toml` in your fork, click the pencil icon, and replace `REPLACE_WITH_YOUR_DATABASE_ID` with the ID. Set `TIMEZONE` to yours, then click **Commit changes**.
4. **Deploy.** In Cloudflare open **Compute (Workers) → Workers & Pages → Create → Import a repository**. Connect GitHub, pick your `daily-pulse` repository, keep the project name `daily-pulse` and the default deploy command (`npx wrangler deploy`), and click **Deploy**. Wait for the build to finish.
5. **Set your secret token.** Open the new worker → **Settings → Variables and Secrets → Add**. Choose type **Secret**, name `SYNC_TOKEN`, and paste a long random password (your iPhone's password generator works). Save and deploy.
6. **Open your dashboard** at the address on the worker's page, for example `https://daily-pulse.<your-subdomain>.workers.dev`. Enter the token. On iPhone tap Share → **Add to Home Screen**.

The tables are created automatically on first use. Every later change pushed to GitHub redeploys on its own.

### Or deploy from a terminal

You need [Node.js 20+](https://nodejs.org).

```bash
git clone https://github.com/<you>/daily-pulse.git
cd daily-pulse
npm install
npx wrangler login
npx wrangler d1 create daily-pulse      # paste the printed database_id into wrangler.toml
npx wrangler secret put SYNC_TOKEN
npm run deploy
```

## The 9 pm Shortcut

On your iPhone, open **Shortcuts**, tap **+**, and name it **Daily Pulse Sync**. Add these actions in order.

**1. Read each number.** For each row below, add **Find Health Samples** (Type as listed, *Start Date is today*), then **Calculate Statistics**, then **Set Variable** with the name shown.

| Health type | Calculate | Variable |
|---|---|---|
| Steps | Sum | `steps` |
| Active Energy | Sum | `kcal` |
| Exercise Minutes | Sum | `exmin` |
| Stand Hours | Sum | `stand` |
| Walking + Running Distance | Sum | `km` |
| Resting Heart Rate | Average | `rhr` |
| Heart Rate | Average | `hr` |
| Heart Rate Variability | Average | `hrv` |

For **sleep**, find *Sleep Analysis* samples with *Start Date is in the last 1 day*. Add **Get Details of Health Samples** → *Duration*, then **Calculate Statistics** → *Sum*, then **Set Variable** `sleep`. Minutes, seconds or hours all work; the server converts them.

**2. Send them.** Add **Get Contents of URL**:
- URL: `https://daily-pulse.<your-subdomain>.workers.dev/api/sync`
- Method: **POST**
- Headers: `Authorization` = `Bearer YOUR_TOKEN`
- Request Body: **JSON**, with one field per variable: `date` (Text: *Current Date* formatted `yyyy-MM-dd`), then `steps`, `kcal`, `exmin`, `stand`, `km`, `rhr`, `hr`, `hrv`, `sleep` (each a Number set to its variable).

**3. Show the report.** Add **Get Dictionary Value** for key `report` from *Contents of URL*, then **Show Notification** with that value. iPhone notifications mirror to your Apple Watch.

**4. Run it every evening.** Open the **Automation** tab and tap **+**. Choose **Time of Day**, set **9:00 PM**, **Daily**, choose **Run Immediately**, and select *Daily Pulse Sync*.

Run the shortcut once by hand first. iOS asks for Health access; allow every type. You should get a notification like:

> Readiness 72. 8,432 steps (84%) · 512 kcal · 34 exercise min · resting HR 57 (usual 60) · HRV 55 ms · sleep 7.2 h

### Good to know
- **Locked phone:** iOS hides Health data while the iPhone is locked. If the phone is locked at 9 pm, the run can send zeros or fail. Pick a time you're usually using your phone, or add a second automation (for example **When I connect to a charger**) as a backup. A later sync for the same date overwrites the earlier values.
- **Missed a day?** Use *Sync → Paste instead* on the dashboard, or run the shortcut by hand.
- **History:** Health app → your picture → *Export All Health Data* → unzip in Files → *Sync → Choose export.xml*.

## API

All routes need `Authorization: Bearer <SYNC_TOKEN>`.

| Route | What it does |
|---|---|
| `POST /api/sync` | Save one day. JSON (`{"date":"2026-10-26","steps":8432,...}`) or text (`date=2026-10-26 steps=8432 ...`). Merges into the existing day. Returns `{ok, saved, report}`. |
| `GET /api/days?from=YYYY-MM-DD` | All days from that date. |
| `POST /api/days` | Bulk write `{days:{date: record or null}, replace}`. Used by import, edits and deletes. |
| `GET` / `PUT /api/settings` | Goals: `move`, `exercise`, `stand`, `steps`, `sleep`. |
| `GET /api/report?date=` | The text summary for a day. |

Accepted keys: `steps, kcal, exmin, stand, km, mi, flights, rhr, hr, maxhr, hrv, sleep, vo2, spo2, resp, weight, lb, workout, workouts, water, energy, note`, or the full field names in `src/normalize.js`.

## Develop

```bash
cp .dev.vars.example .dev.vars   # set a local SYNC_TOKEN
npm run db:init:local
npm run dev                      # http://localhost:8787
npm test
```

Structure: `public/index.html` (the whole dashboard, no build step), `src/worker.js` (API), `src/normalize.js` (input parsing), `schema.sql`.

## Roadmap ideas
- Multi-user accounts so friends can share one deployment.
- A native iOS companion app with background HealthKit delivery, so no Shortcut is needed.
- A weekly email or Telegram summary.

## License

MIT. Not affiliated with Apple. Readiness scores are estimates, not medical advice.
