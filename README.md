# League Odds

Playoff odds, draft-pick odds and projected lineups for a Sleeper fantasy football league.

The page plays out the rest of the season 40,000 times in the browser. Tap a winner in any game left and every number updates.

## How it updates

A GitHub Action runs every night at midnight Eastern:

1. `scripts/update.py` pulls scores, rosters, traded picks and projections from the Sleeper API.
2. It checks that every team's record and points on Sleeper match the weekly scores. If the check fails, the old data stays.
3. The backtest and the engine tests run.
4. `src/build.py` builds the single-page site and GitHub Pages publishes it.

## Run it yourself

```
python3 scripts/update.py      # pull fresh data
node src/backtest.js           # rerun the backtest
node src/test_engine.js        # run the tests
python3 src/build.py           # writes dist/index.html
```

League settings live in `league.json`.

## What's where

- `src/engine.js` – the simulation
- `src/model.js` – turns the data into team strengths
- `src/template.html` – the page
- `src/backtest.js`, `src/test_engine.js`, `src/crosscheck.py` – checks
- `data/` – weekly scores since 2023 and the latest snapshot

## Known gaps

- Built for one league so far. A start page that takes any league ID is next.
- Scores count once a week is final, so games in progress are ignored.
- Playoff results are not fed back in yet once the bracket starts.
- Sleeper's projections feed is unofficial and could change.
