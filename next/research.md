# What the numbers rest on

Everything here was checked against real public Sleeper leagues (anonymous: no names or league IDs are kept).
The scripts are in `lab/`, the tests in `next/test/`.

## Rules, checked league by league

| Check | Leagues | Result |
|---|---|---|
| Seeding and first-round pairings (record, then points for, then points against; division winners first) | 475 finished, 224 in progress | Matches Sleeper in every league whose commissioner has not edited the bracket |
| Re-seeded brackets: best seed left plays the worst seed left | 112 six-team leagues | 112 of 112 |
| Records rebuilt from weekly scores, median game included | 230 in progress | 230 of 230 |
| Fantasy points from the stat feed under each league's scoring | 440 leagues, 103,182 player-weeks, every position including kickers, defenses and IDP | 103,182 of 103,182 exact |
| Whole pipeline (load, lineups, simulation, sure-thing flags) | 290 leagues | 0 errors |
| Playoffs replayed from the middle (after each playoff week of finished 2025 seasons) | 140 leagues, 391 snapshots | 0 errors; no eliminated team ever kept title odds, the real champion always kept some |
| The deployed page in a real browser | 32 league shapes, phone and desktop widths | 0 errors, no sideways scrolling, about 1 second to load |

## Draft order

In 263 dynasty leagues, next year's order for teams that miss the playoffs followed potential points (Max PF) in about 68%,
reverse record in about 22%, and something else (lottery, manual) in the rest. Playoff teams pick by how far they got; the
third-place game loser picks ahead of its winner in 82%. The page checks each league's own past drafts and uses the rule that reproduces them.

## Strength model

Fitted on 62,904 team-weeks from 440 leagues (2025 and 2026). Win-probability quality on 26,488 real games:

| Rating | Brier score | Favorites win |
|---|---|---|
| Coin flip | 0.2500 | 51% |
| Season scoring only | 0.2217 | 64% |
| Half season, half projections (the first version of this page) | 0.2039 | 67% |
| Projections only | 0.1992 | 68% |
| Blend used now | 0.1990 to 0.2007 | 68% |

Calibration of the blend: games it called 70-80% were won 76% of the time; 80-90%, 86%; 90%+, 94%.

Known soft spot: past weeks only have game-day projections, so the fit can't see how much projections for weeks further out
degrade. The blend keeps more uncertainty than the fit asks for to cover that.

Typical sizes: week-to-week noise is about 18% of a league's average score (20 points at 100, 24 at 130);
true team strength spreads about 14%; teams score about 94% of their best projected lineup.

## A week under way

Real weeks from 2026 were frozen after each day of games; win chances came from points banked plus projections for players still to play.
Across 5,897 matchups: after Thursday the Brier score was 0.174 (0.179 ignoring the live scores), and games called 80-90% were won 85% of the time.
After Sunday, with only Monday left, it was 0.032, and games called 90-97% were won 99% of the time (slightly cautious).

## ESPN (beta)

ESPN lets a browser read leagues that are set to public (about 6% of the league IDs tried were). On 24 public leagues,
this season and last, our seeds matched ESPN's own in 41 of 42 league-seasons, under both of ESPN's common tiebreak rules
(points for, and head-to-head among tied teams with division winners first). Finished 2025 brackets replayed to the right
champion in 15 of 19; in the other 4 the bracket didn't follow the seeds, and the page says so instead of guessing.
Projected points come straight from ESPN, already scored under each league's rules.
