# World Cup 2026 — Goals Contest Tracker

A zero-dependency static site for an office contest. Group any number of World Cup
2026 teams under a **nickname**, and the site ranks everyone by the **total goals**
their teams score — **penalty-shootout goals included** — pulling results from a
free, public-domain data feed. No server, no API key, no cost.

## Files

| File | What it is |
|------|------------|
| `index.html` | The page. |
| `styles.css` | Styling. |
| `app.js` | Fetches the feed and builds the ranking. You don't need to touch this. |
| `config.js` | **The only file you edit** — participants, nicknames, teams, settings. |

## Set up your contest

Open `config.js` and edit the `entries` list. Each participant is one line:

```js
{ nickname: "Sam", teams: ["Brazil", "France", "Spain", "Germany"] },
```

- `teams` can hold **any number** of teams (your office rule is 4 each, but the
  code doesn't enforce it — you can also make "super teams" of more).
- Team names must match the feed **exactly**. Copy them from the
  `VALID_TEAM_NAMES` list at the bottom of `config.js`. If you mistype one, the
  page shows a yellow/red warning and that team scores 0, so typos are easy to spot.
- Six slots are still play-off placeholders (e.g. `"UEFA Path D winner"`). Use
  those exact strings; once the play-offs resolve, the feed swaps in the real
  country name and goals start counting automatically.

Other settings at the top of `config.js`: `contestName`, `includeShootoutGoals`
(true/false), and `refreshMinutes`.

## Deploy on GitHub Pages (free)

1. Create a new GitHub repository (e.g. `wc2026-goals`).
2. Upload these four files (`index.html`, `styles.css`, `app.js`, `config.js`)
   to the root of the repo. Either drag-and-drop in the GitHub web UI, or:
   ```bash
   git init
   git add .
   git commit -m "World Cup 2026 goals tracker"
   git branch -M main
   git remote add origin https://github.com/<you>/wc2026-goals.git
   git push -u origin main
   ```
3. In the repo: **Settings → Pages**. Under "Build and deployment", set
   **Source = Deploy from a branch**, **Branch = `main`**, folder = `/ (root)`. Save.
4. Wait ~1 minute. Your site is live at
   `https://<you>.github.io/wc2026-goals/`. Share that link with the office.

To update standings or fix a nickname later, just edit `config.js` in GitHub and
commit — Pages redeploys automatically. (Match results update themselves from the
feed; you only edit config for participants/teams.)

## How goals are counted

For every match that has a result, each team gets:

- **In-play goals** — the score after extra time if a match went to extra time,
  otherwise the 90-minute score. Penalties taken *during* play are already in this
  number.
- **Shootout goals** — tie-breaker penalty-shootout goals (counted only if
  `includeShootoutGoals: true`).

A team's tournament total is the sum across all its matches (group stage +
knockouts). A nickname's score is the sum of all its teams. Unplayed and
not-yet-decided knockout matches are simply ignored until they have a result.

## Data source & freshness

Data comes from [`openfootball/worldcup.json`](https://github.com/openfootball/worldcup.json),
a public-domain feed served over HTTPS with no key. It's maintained by hand and
**updates roughly once a day**, so standings may lag a live broadcast by a few hours.
That's the trade-off for a truly free, key-less feed on a static site.

Want faster updates? There's a community mirror that refreshes more often. To use
it, change `dataUrl` in `config.js` to:

```
https://raw.githubusercontent.com/upbound-web/worldcup-live.json/main/2026/worldcup.json
```

(Same format; it just depends on that smaller project staying online — verify the
exact path in its repo if it doesn't load.)

There is no free **official** FIFA API; near-real-time commercial APIs exist but
require a paid key that would be exposed in your public site source.
