"""Assemble the single-file page from the template, engine, model and data snapshot."""
import json, html, os
LEAGUE_ID=json.load(open('league.json'))['league_id']
snap=json.load(open('data/snapshot.json')); bt=json.load(open('data/backtest.json')); tl=json.load(open('data/test_log.json')); cc=json.load(open('data/crosscheck.json'))
lg=snap['league']; nt=len(snap['teams']); PT=lg['playoffTeams']; dr=snap['draft']
sig,tau=snap['hyper']['sigma'],snap['hyper']['tau']; n=snap['throughWeek']; k=tau**2/(tau**2+sig**2/max(n,1))
g=bt['games']['shrunk season average']; gain=bt['games']['gain']; m=bt['games']['margin']; po=bt['playoff']['overall']
names={t['rid']:t['name'] for t in snap['teams']}
games_left=sum(len(v) for v in snap['schedule'].values())
team_weeks=3*nt*lg['regWeeks']+nt*n
# free-agent fill-ins the projection side assumes (weeks 12-14)
fa={}
for wk,lus in snap['lineups'].items():
    for rid,rows in lus.items():
        for slot,name,pts,flag in rows:
            if flag: fa.setdefault(int(rid),{}).setdefault(name.replace(' (free agent)',''),slot)
fa_txt='; '.join(f"{html.escape(names[r])}: {', '.join(html.escape(p)+' ('+s+')' for p,s in sorted(v.items(), key=lambda x: x[1]))}" for r,v in sorted(fa.items(), key=lambda x: len(x[1])))
def cal(rows, cap, unit):
    out=f'<table class="cal"><caption>{cap}</caption><thead><tr><th>Model said</th><th>Happened</th><th>{unit}</th></tr></thead><tbody>'
    for r in rows:
        if r['n']: out+=f"<tr><td>{100*r['predicted']:.0f}%</td><td>{100*r['actual']:.0f}%</td><td>{r['n']}</td></tr>"
    return out+'</tbody></table>'
draft_checks=[x for x in tl['log'] if x['name'].startswith('draft rule')]
assert tl['fail']==0 and len(draft_checks)==3 and all(x['ok'] and x['detail']=='12 of 12 slots' for x in draft_checks)
pulled_short=snap['pulled'].replace(f", {snap['season']}",'')
left_weeks=lg['regWeeks']-n
method=f"""
      <div>
        <h3>The model</h3>
        <p>The rest of the season is played out 40,000 times. A team's weekly score is the league average, plus its strength, plus luck ({sig:.1f} points a week in this league).</p>
        <p>Strength blends season scoring with Sleeper's projections for each team's best lineup. Season scoring is pulled {100*(1-k):.0f}% toward average after {n} games.</p>
        <p>Seeding follows Sleeper: record, then points for. Draft order follows this league's past drafts: non-playoff teams by record, then playoff teams by finish.</p>
        <h3 style="margin-top:16px">This league</h3>
        <ul>
          <li>{nt} teams, {PT} make the playoffs{', top two get a bye' if PT==6 else ''}</li>
          <li>{('%d games left through Week %d' % (games_left, lg['regWeeks'])) if games_left else 'Regular season over'}</li>
          <li>Playoffs in Weeks {lg['playoffWeeks']['r1']} and {lg['playoffWeeks']['r2']}, then a {len(lg['playoffWeeks']['final'])}-week final</li>
          <li>{dr['season']} draft: {dr['rounds']} rounds, {'same order every round' if dr['linear'] else 'snake'}</li>
        </ul>
      </div>
      <div>
        <h3>Checks</h3>
        <ul>
          <li>Weekly scores match Sleeper's official records for all {4*nt} team-seasons since 2023.</li>
          <li>Seeding matches every past bracket. The draft rule matches all {12*len(draft_checks)} slots of the last {len(draft_checks)} drafts.</li>
          <li>{tl['pass']} automated tests pass, and a second engine written in Python agrees within {cc['maxGapPoints']:.2f} points.</li>
          <li>{g['n']} past games, predicted in advance: Brier {g['brier']:.3f} vs 0.250 for a coin flip.</li>
          <li>{po['n']} past playoff forecasts: Brier {po['model']:.3f} vs {po['standingsNow']:.3f} for assuming the standings hold.</li>
        </ul>
        {cal(bt['playoffCalib'],'Past playoff forecasts','Forecasts')}
      </div>
      <div>
        <h3>Limits</h3>
        <ul>
          <li>Data is a snapshot from {pulled_short}.</li>
          <li>The 50/50 blend is a judgment call. Only season scoring is backtested.</li>
          <li>Every team starts its best lineup. Nobody tanks.{' Empty slots get the best free agent: ' + fa_txt + '.' if fa_txt else ''}</li>
          <li>A commissioner can set a different draft order.</li>
          <li>Title odds are rough.</li>
        </ul>
      </div>
"""
title=f"{lg['name'].title()} League Odds"
meta=f"Through Week {n} of {lg['regWeeks']}. Updated {pulled_short}."
footer=f"Scores, rosters, traded picks and projections come from the Sleeper API for league {LEAGUE_ID}. Rosters and traded picks were pulled {snap['pulled']}, projections the same evening. The random seed is fixed, so the same picks give the same numbers on every device."
page=open('src/template.html').read()
page=page.replace('__TITLE__',html.escape(title)).replace('__LEAGUE__',html.escape(lg['name'])).replace('__META__',html.escape(meta))
page=page.replace('__METHOD__',method).replace('__FOOTER__',html.escape(footer))
page=page.replace('__ENGINE__',open('src/engine.js').read()).replace('__MODEL__',open('src/model.js').read())
small=dict(snap); small['backtest']=None
page=page.replace('__SNAPSHOT__',json.dumps(small,separators=(',',':')).replace('</','<\\/'))
assert '__' not in page.replace('__proto__','') or all(tok not in page for tok in ('__TITLE__','__LEAGUE__','__META__','__METHOD__','__FOOTER__','__ENGINE__','__MODEL__','__SNAPSHOT__'))
os.makedirs('dist',exist_ok=True); open('dist/index.html','w').write(page)
print('built dist/index.html', len(page),'bytes'); print('title:',title); print('meta:',meta); print('FA text:',fa_txt)
