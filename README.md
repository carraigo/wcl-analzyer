# Raid Log Analyzer

Paste a [Warcraft Logs](https://classic.warcraftlogs.com) report link and get a one-page summary of the raid night. It's a static site: plain HTML, CSS and JavaScript with no build step and no server, so it runs on GitHub Pages and needs nothing installed.

**What it shows**

| Section | What you learn |
|---|---|
| Headline tiles | Bosses killed, pulls (kills vs wipes), time spent wiping, deaths per pull, raid size |
| Bosses | Per boss and difficulty: pulls, pulls needed to kill, kill time, best wipe %, total time spent |
| Progression | A small chart per boss showing the boss's health left at the end of every pull |
| Deaths by player | Total deaths, and how often each player was the first to die |
| What killed people early | Killing blows among the first three deaths of each pull (later deaths are usually the wipe snowballing) |
| Kills | Damage and healing per second for every player on each boss kill |
| Raid composition | Class counts for the players seen in boss pulls |
| Exports | Pulls and deaths as CSV, and the full raw API response as JSON (which you can re-open later without signing in) |

Click **Try it with demo data** to see everything with an invented raid night, no sign-in needed.

## Publish it on GitHub Pages

1. Create a new GitHub repository (for example `wcl-report-analyzer`) and put these files in the root of it.
2. In the repo, go to **Settings → Pages**, set **Source** to *Deploy from a branch*, pick `main` and `/ (root)`, and save.
3. After a minute the site is live at `https://<your-username>.github.io/<repo-name>/`. The demo works straight away.

## Let it read live reports (one-time, about two minutes)

Warcraft Logs requires every API call to come from a registered app. Because this site has no server it can't keep a secret, so it uses the **PKCE** sign-in flow, which is designed for exactly that: visitors sign in with their own Warcraft Logs account and nothing secret lives in the code.

1. Sign in at <https://www.warcraftlogs.com/api/clients/> and click **Create Client**.
2. Name: anything (e.g. *Raid Log Analyzer*).
3. Redirect URL: your Pages address exactly, including the trailing slash, e.g. `https://<your-username>.github.io/<repo-name>/`. The Settings panel on the site shows the exact value to use.
4. Tick **Public Client** and save. Copy the **Client ID** (there's no secret for a public client).
5. Either paste the ID into `js/config.js` (`clientId: "..."`) and commit, so every visitor can just click *Sign in*, or paste it into the site's **Settings** panel, which keeps it in that browser only. The client ID is not secret; committing it is fine.

Then paste a report link such as `https://classic.warcraftlogs.com/reports/C9vGDNW7p6Aq1Ld2` and press **Analyze**. The first time, you'll be sent to Warcraft Logs to approve access and brought straight back.

**Alternative:** if you already have a normal (non-public) API client, open **Settings → Advanced** and enter its ID and secret. The secret is used once to get a token and isn't stored.

### If something goes wrong

- *"Report not found"*: the report is private or the code is wrong.
- *Sign-in loops or "redirect_uri mismatch"*: the redirect URL on the client must match the page address exactly (https, trailing slash).
- *Network or CORS error*: the browser blocked a request to Warcraft Logs. Try the Advanced (client secret) option; if both fail, open an issue with the message shown.
- Kill breakdowns are fetched for kills only, to stay well inside Warcraft Logs' hourly API point limit.

## Run it locally

Browsers won't load JavaScript modules from a file opened by double-clicking, so serve the folder instead. Any one of these works:

- VS Code: install the *Live Server* extension, right-click `index.html`, **Open with Live Server**.
- Node: `npx serve .`
- Python: `python -m http.server`

Sign-in only works from the address registered on your client, so locally you'll mostly use the demo data or a saved JSON file. You can add `http://localhost:5500/` (or whatever port you use) as a second client if you want live data locally.

## How it's built

```
index.html            page shell
assets/style.css      styles, light and dark
js/report-url.js      parse the pasted link into { site, code }
js/auth.js            OAuth: PKCE sign-in and the client-credentials fallback
js/api.js             EXTRACT: GraphQL queries, paging, returns one raw "bundle"
js/transform.js       TRANSFORM: pure functions, raw bundle -> analysis model
js/render.js          PRESENT: analysis model -> HTML and SVG charts
js/main.js            wiring: form, settings, downloads, tooltips
demo/demo-report.json invented raid night in the raw bundle format
tools/make-demo.mjs   regenerates the demo file (seeded, repeatable)
tests/                node:test unit tests, no dependencies
```

The design is a small ETL pipeline. `api.js` lands the raw API response untouched, `transform.js` does every calculation as pure functions (so it's unit-tested without a browser), and `render.js` only formats. The demo file and the "Raw JSON" export are the same format as a live fetch, so all three paths go through identical transform code.

| Ab Initio idea | Here |
|---|---|
| Input file / extract graph | `fetchReportBundle()` pulls the report, pages through death events, and batches per-kill tables into one aliased GraphQL query |
| Reformat / filter by expression | `buildPulls()` drops trash fights, derives durations, normalises boss health % |
| Rollup | `summariseBosses()`, `summariseDeaths()` |
| Join (lookup) | death events joined to players and ability names from `masterData` |
| Scan (running count) | `pullNo` per boss and death `order` within a pull |
| Output file | CSV and JSON downloads |

### Tests

```
npm test
```

Uses Node's built-in test runner (Node 18+), no packages to install. GitHub Actions runs it on every push (`.github/workflows/test.yml`).

## Data and privacy

Everything runs in your browser. The only requests go to warcraftlogs.com. Your sign-in token is kept in this browser's local storage until it expires or you click **Sign out**.

Not affiliated with Warcraft Logs or Blizzard Entertainment.
