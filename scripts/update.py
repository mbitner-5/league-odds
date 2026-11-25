#!/usr/bin/env python3
"""Nightly update: pull the league straight from Sleeper, check it, and write data/snapshot.json.

Nothing is written unless every team's record and points on Sleeper match the weekly scores,
so a stale or half-finished pull can never reach the page.
"""
import json, os, sys, time, datetime, urllib.request
from zoneinfo import ZoneInfo

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CFG = json.load(open(os.path.join(ROOT, 'league.json')))
API = 'https://api.sleeper.app/v1'
FIXTURES = os.environ.get('SLEEPER_FIXTURES')          # folder of saved responses, for offline tests
POS = ('QB', 'RB', 'WR', 'TE')
FLEX = {'FLEX': ('RB', 'WR', 'TE'), 'WRRB_FLEX': ('RB', 'WR'), 'REC_FLEX': ('WR', 'TE'), 'SUPER_FLEX': ('QB', 'RB', 'WR', 'TE')}


def get(name, url):
    if FIXTURES:
        return json.load(open(os.path.join(FIXTURES, name + '.json')))
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (league-odds nightly update)', 'Accept': 'application/json'})
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read().decode('utf-8'))
        except Exception as e:                           # brief retry, then give up loudly
            if attempt == 3: raise
            print('retrying', name, repr(e)); time.sleep(5 * (attempt + 1))


def short_name(rid, name):
    s = CFG.get('short_names', {}).get(str(rid))
    if s: return s
    s = name.replace('*', '').strip()
    for lead in ('The ', 'Team '):
        if s.startswith(lead): s = s[len(lead):]
    if len(s) > 14:
        w = s.split(); s = ' '.join(w[-2:]) if len(' '.join(w[-2:])) <= 14 else w[-1]
    return s


def points(stats, sc):
    """Sleeper's stock number, moved to this league's reception, interception and passing-touchdown scoring."""
    std, ppr = stats.get('pts_std'), stats.get('pts_ppr')
    if std is None or ppr is None: return None
    p = std + sc.get('rec', 0) * (ppr - std)
    p += (sc.get('pass_int', -1) + 1) * stats.get('pass_int', 0)
    p += (sc.get('pass_td', 4) - 4) * stats.get('pass_td', 0)
    return round(p, 2)


def best_lineup(cands, slots):
    """cands: [(pts, pid, pos)]. Fill single-position slots first, then flex slots from whoever is left."""
    cands = sorted(cands, reverse=True); used = set(); out = []
    for slot in [s for s in slots if s in POS]:
        c = next((c for c in cands if c[2] == slot and c[1] not in used), None)
        if c: used.add(c[1]); out.append((slot, c[0], c[1]))
        else: out.append((slot, 0.0, None))
    for slot in [s for s in slots if s in FLEX]:
        c = next((c for c in cands if c[2] in FLEX[slot] and c[1] not in used), None)
        if c: used.add(c[1]); out.append(('FLEX' if slot != 'SUPER_FLEX' else 'SFLEX', c[0], c[1]))
        else: out.append(('FLEX' if slot != 'SUPER_FLEX' else 'SFLEX', 0.0, None))
    return out


def spread(years_data, n):
    """Week-to-week luck (sigma) and true spread between teams (tau), from each season's scores."""
    ssr = df = btw = nb = 0.0; used = 0
    for X in years_data:                                 # X[team][week]
        W = len(X[0]) if X else 0
        if W < 2: continue
        means = [sum(X[t][w] for t in range(n)) / n for w in range(W)]
        D = [[X[t][w] - means[w] for w in range(W)] for t in range(n)]
        dbar = [sum(r) / W for r in D]
        ssr += sum((D[t][w] - dbar[t]) ** 2 for t in range(n) for w in range(W)); df += (n - 1) * (W - 1)
        btw += sum(d * d for d in dbar) / (n - 1); nb += 1.0 / W; used += 1
    s2 = ssr / df; t2 = max(0.0, (btw - s2 * nb) / used)
    return round(s2 ** 0.5, 3), round(t2 ** 0.5, 3)


def main():
    lid = CFG['league_id']
    league = get('league', f'{API}/league/{lid}'); season = int(league['season']); st = league['settings']
    users = get('users', f'{API}/league/{lid}/users'); rosters = sorted(get('rosters', f'{API}/league/{lid}/rosters'), key=lambda r: r['roster_id'])
    traded = get('traded_picks', f'{API}/league/{lid}/traded_picks')
    n = len(rosters); PT = int(st['playoff_teams']); reg = int(st['playoff_week_start']) - 1; pw = CFG['playoff_weeks']
    ids = [r['roster_id'] for r in rosters]
    uname = {u['user_id']: u for u in users}
    teams = []
    for r in rosters:
        u = uname.get(r.get('owner_id'), {}); mgr = u.get('display_name', '?')
        name = ((u.get('metadata') or {}).get('team_name') or '').strip() or f'Team {mgr}'
        teams.append({'rid': r['roster_id'], 'name': name, 'mgr': mgr, 'short': short_name(r['roster_id'], name)})

    # ---- weekly scores and schedule
    weeks = {}
    for w in range(1, reg + 1):
        by = {}
        for m in get(f'matchups_{w}', f'{API}/league/{lid}/matchups/{w}'):
            if m.get('matchup_id') is not None: by.setdefault(m['matchup_id'], []).append(m)
        games = []
        for mid in sorted(by):
            pair = sorted(by[mid], key=lambda m: m['roster_id'])
            if len(pair) == 2: games.append({'a': pair[0]['roster_id'], 'b': pair[1]['roster_id'], 'pa': float(pair[0].get('points') or 0), 'pb': float(pair[1].get('points') or 0)})
        weeks[w] = games

    # ---- how many weeks are final: the week count Sleeper's own records add up to. This doubles as the freshness check.
    official = {}
    for r in rosters:
        s = r['settings']
        official[r['roster_id']] = (s.get('wins', 0), s.get('losses', 0), s.get('ties', 0), s.get('fpts', 0) + s.get('fpts_decimal', 0) / 100.0, s.get('fpts_against', 0) + s.get('fpts_against_decimal', 0) / 100.0)
    played = {sum(official[i][:3]) for i in ids}
    if len(played) != 1: sys.exit(f'CHECK FAILED: teams have played different numbers of games {played}')
    thru = min(played.pop(), reg)
    tot = {i: [0, 0, 0, 0.0, 0.0] for i in ids}
    for w in range(1, thru + 1):
        for g in weeks[w]:
            a, b, pa, pb = g['a'], g['b'], g['pa'], g['pb']
            tot[a][3] += pa; tot[b][3] += pb; tot[a][4] += pb; tot[b][4] += pa
            if pa > pb: tot[a][0] += 1; tot[b][1] += 1
            elif pb > pa: tot[b][0] += 1; tot[a][1] += 1
            else: tot[a][2] += 1; tot[b][2] += 1
    bad = [i for i in ids if tuple(tot[i][:3]) != tuple(official[i][:3]) or abs(tot[i][3] - official[i][3]) > 0.06 or abs(tot[i][4] - official[i][4]) > 0.06]
    if bad: sys.exit(f'CHECK FAILED: weekly scores do not add up to Sleeper\'s records for rosters {bad}')
    print(f'data check passed: records and points match weekly scores for all {n} teams through week {thru}')

    # ---- projections for every week still to play, regular season through the final
    sc = league.get('scoring_settings') or {}
    slots = [s for s in league.get('roster_positions', []) if s in POS or s in FLEX]
    last = max(pw['final']); pweeks = list(range(thru + 1, last + 1)); tables = {}; names = {}; pos_of = {}
    for w in pweeks:
        url = f'https://api.sleeper.app/projections/nfl/{season}/{w}?season_type=regular&position[]=QB&position[]=RB&position[]=TE&position[]=WR&order_by=pts_ppr'
        t = {}
        for e in get(f'projections_{w}', url) or []:
            pl = e.get('player') or {}; pid = str(e.get('player_id')); pos = pl.get('position')
            p = points(e.get('stats') or {}, sc)
            if pos not in POS or p is None or p <= 0: continue
            t[pid] = p; pos_of[pid] = pos; names[pid] = (pl.get('first_name', '') + ' ' + pl.get('last_name', '')).strip() or pid
        tables[w] = t
    full = [w for w in pweeks if len(tables[w]) >= 100]
    if pweeks and not full: sys.exit('CHECK FAILED: no usable projections came back')
    for w in pweeks:                                     # a week Sleeper has not projected yet borrows each player's average
        if w not in full:
            tables[w] = {pid: round(sum(tables[x][pid] for x in full if pid in tables[x]) / sum(1 for x in full if pid in tables[x]), 2) for pid in names}
    print('projection weeks', {w: len(tables[w]) for w in pweeks}, 'borrowed:', [w for w in pweeks if w not in full])

    rostered = {p for r in rosters for p in (r.get('players') or [])}
    claimed = {}; proj = {}; lineups = {}
    for w in pweeks:
        table = tables[w]
        def pool(positions): return sorted([(v, pid) for pid, v in table.items() if pos_of[pid] in positions and pid not in rostered and pid not in claimed], reverse=True)
        tot_w = {}; lu = {}
        for r in rosters:
            rid = r['roster_id']; out_ = set(r.get('reserve') or []) | set(r.get('taxi') or [])
            active = [p for p in (r.get('players') or []) if p not in out_] + [p for p, t in claimed.items() if t == rid]
            while True:
                L = best_lineup([(table[p], p, pos_of[p]) for p in active if p in table], slots)
                gap = next(((i, s) for i, (s, pts, pid) in enumerate(L) if pid is None), None)
                if not gap: break
                want = [x for x in slots if x in POS] + [x for x in slots if x in FLEX]
                need = want[gap[0]]
                fa = pool((need,) if need in POS else FLEX[need])     # an empty slot: assume the best free agent gets added, and stays
                if not fa: break
                claimed[fa[0][1]] = rid; active.append(fa[0][1])
            rows = [[s, (names[pid] + (' (free agent)' if pid in claimed else '')) if pid else '(empty)', pts, 1 if pid in claimed else 0] for s, pts, pid in L]
            tot_w[str(rid)] = round(sum(x[2] for x in rows), 2); lu[str(rid)] = rows
        proj[str(w)] = tot_w; lineups[str(w)] = lu

    # ---- luck and spread from this league's own history
    def grid(wk, W): return [[next((g['pa'] if g['a'] == i else g['pb']) for g in wk[w] if i in (g['a'], g['b'])) for w in range(1, W + 1)] for i in ids]
    hist = []
    for y in CFG.get('history_seasons', []):
        d = {int(k): v for k, v in json.load(open(os.path.join(ROOT, 'data', f'weeks_{y}.json'))).items()}
        hist.append(grid(d, max(d)))
    hist.append(grid(weeks, thru))
    sigma, tau = spread(hist, n)

    now = datetime.datetime.now(ZoneInfo('America/New_York'))
    stamp = f"{now:%b} {now.day}, {now.year}, {(now.hour % 12) or 12}:{now:%M} {'am' if now.hour < 12 else 'pm'} ET"
    snap = {'asOf': f'{now:%Y-%m-%d}', 'season': season, 'throughWeek': thru,
            'league': {'name': league.get('name', 'League'), 'playoffTeams': PT, 'regWeeks': reg, 'playoffWeeks': pw},
            'teams': teams,
            'draft': {'season': season + 1, 'rounds': CFG['draft_rounds'], 'linear': CFG['draft_linear'],
                      'traded': sorted([int(t['round']), int(t['roster_id']), int(t['owner_id'])] for t in traded if str(t.get('season')) == str(season + 1) and int(t['round']) <= CFG['draft_rounds'])},
            'pulled': stamp,
            'results': {str(w): [[g['a'], g['b'], g['pa'], g['pb']] for g in weeks[w]] for w in range(1, thru + 1)},
            'schedule': {str(w): [[g['a'], g['b']] for g in weeks[w]] for w in range(thru + 1, reg + 1)},
            'proj': proj, 'lineups': lineups, 'hyper': {'sigma': sigma, 'tau': tau}, 'blend': 0.5, 'backtest': None}
    d = os.path.join(ROOT, 'data')
    json.dump({str(w): weeks[w] for w in weeks}, open(os.path.join(d, f'weeks_{season}.json'), 'w'))
    open(os.path.join(d, f'rosters_{season}.txt'), 'w').write(''.join(f'{i}|{official[i][0]}|{official[i][1]}|{official[i][2]}|{official[i][3]:.2f}|{official[i][4]:.2f}\n' for i in ids))
    json.dump(snap, open(os.path.join(d, 'snapshot.json'), 'w'))
    print('snapshot written:', stamp, '| free agents assumed:', {names[p]: t for p, t in claimed.items()})


if __name__ == '__main__':
    main()
