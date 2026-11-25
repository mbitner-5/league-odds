# League Odds

Playoff odds, draft-pick odds and projected lineups for Sleeper fantasy football leagues.

The page plays out the rest of the season up to 40,000 times in the browser. Tap a winner in any game left and every number updates.

Paste a Sleeper league ID, a league link or a username. The page reads the league straight from Sleeper in your browser.
Nothing is stored and there is no account. Public ESPN leagues work too (beta): paste the league's link.

## What it handles

- Any number of teams and playoff spots, byes, divisions, median games, re-seeded brackets, two-week rounds
- Any scoring settings and any lineup (superflex, kickers, defenses, IDP, best ball)
- Seasons before, during and after the playoffs, including a week that is still being played
- Next year's draft order for dynasty leagues, using the rule each league's own past drafts followed
- Guillotine leagues and leagues that haven't drafted get a plain message

`next/research.md` has the checks behind this: seeding, records and scoring matched Sleeper across several hundred real leagues,
and the strength model was fitted and scored on 26,000 real games.

## How it's put together

- `next/js/core.js` – scoring, best lineups, standings, bracket shapes
- `next/js/engine.js` – the simulation
- `next/js/sleeper.js`, `next/js/espn.js` – read a league from Sleeper or ESPN
- `next/js/model.js` – team strength, week under way, draft-order rule
- `next/js/app.js`, `next/js/main.js`, `next/index.html` – the page
- `scripts/build_shared.mjs` – nightly player projections the page reads (`data/` on the site)
- `src/`, `data/` – the first single-league version, kept because the tests compare the general engine against it

A GitHub Action (`.github/workflows/update.yml`) runs every night at midnight Eastern and on every push:
it runs every test, pulls fresh projections and publishes the site.

## Run it yourself

```
node next/test/unit.js            # 300+ tests of the engine, scoring, lineups, draft rules
node next/test/engine_regress.js  # the general engine against the original six-team one
node src/test_engine.js           # the original engine's tests
node scripts/build_shared.mjs dist/data        # projection files (needs network)
```

`lab/` holds the research scripts. They run on GitHub (the `Lab` workflow), read public Sleeper data,
and write only anonymous results to the `lab-results` branch.

## Known limits

- Sleeper, plus ESPN leagues that are set to public. Private ESPN leagues, Yahoo, MFL and Fleaflicker block browser access and would need a small server.
- Sleeper's projections feed is unofficial and could change.
- Projections for later weeks are less sure than this week's, and the model can't measure by how much yet.
- Commissioner edits to seeds or draft order can't be predicted.
