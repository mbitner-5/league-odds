"""Independent re-implementation of the whole forecast in Python/NumPy.
Shares no code with the JavaScript engine: it rebuilds standings, strengths and the blend from the
snapshot, simulates with a different random generator, and handles forced outcomes by brute-force
filtering instead of conditional sampling. The two must agree within Monte Carlo error."""
import json, numpy as np
from scipy.stats import norm
snap=json.load(open('data/snapshot.json')); js=json.load(open('data/js_out.json'))
# --- normal-distribution functions
e1=max(abs(v-norm.cdf(x)) for x,v in js['cdf']); e1r=max(abs(v-norm.cdf(x))/norm.cdf(x) for x,v in js['cdf'] if x<0)
e2=max(abs(v-norm.ppf(p)) for p,v in js['inv'])
print('normCdf max abs error %.2e (max relative error in the lower tail %.2e); normInv max abs error %.2e'%(e1,e1r,e2))
assert e1<1e-12 and e1r<1e-7 and e2<1e-8
# --- rebuild the model from the raw snapshot
ids=[t['rid'] for t in snap['teams']]; ix={r:i for i,r in enumerate(ids)}; n=12
W=snap['throughWeek']; X=np.zeros((n,W))
wins=np.zeros(n); pf=np.zeros(n); pa=np.zeros(n)
for w in range(1,W+1):
    for a,b,sa,sb in snap['results'][str(w)]:
        X[ix[a],w-1]=sa; X[ix[b],w-1]=sb; pf[ix[a]]+=sa; pf[ix[b]]+=sb; pa[ix[a]]+=sb; pa[ix[b]]+=sa
        wins[ix[a] if sa>sb else ix[b]]+=1
sig,tau=snap['hyper']['sigma'],snap['hyper']['tau']
dbar=(X-X.mean(axis=0)).mean(axis=1); k=tau**2/(tau**2+sig**2/W); form=k*dbar; v=k*sig**2/W; base=X.mean()
lam=snap['blend']; rel={}
for w,tot in snap['proj'].items():
    t=np.array([tot[str(r)] for r in ids]); rel[int(w)]=(1-lam)*form+lam*(t-t.mean())
games=[(w,ix[a],ix[b]) for w in (12,13) for a,b in snap['schedule'][str(w)]]
assert [(g['week'],g['a'],g['b']) for g in js['cfg']['games']]==games
def run(N,seed):
    rng=np.random.default_rng(seed)
    e=rng.normal(0,np.sqrt(v),(N,n)); Wn=np.tile(wins,(N,1)); PF=np.tile(pf,(N,1)); res=np.zeros((N,len(games)),dtype=bool)
    for gi,(w,a,b) in enumerate(games):
        sa=base+rel[w][a]+e[:,a]+rng.normal(0,sig,N); sb=base+rel[w][b]+e[:,b]+rng.normal(0,sig,N)
        PF[:,a]+=sa; PF[:,b]+=sb; aw=sa>sb; res[:,gi]=aw; Wn[:,a]+=aw; Wn[:,b]+=~aw
    order=np.argsort(-(Wn*1e7+PF),axis=1)                      # seeds, best first
    R=np.arange(N)
    def sc(team,w): return base+rel[w][team]+e[R,team]+rng.normal(0,sig,N)
    def play(hi,lo,w): return np.where(sc(hi,w)>=sc(lo,w),hi,lo)
    q1=play(order[:,3],order[:,4],14); q2=play(order[:,2],order[:,5],14)
    f1=play(order[:,0],q1,15); f2=play(order[:,1],q2,15)
    t1=sc(f1,16)+sc(f1,17); t2=sc(f2,16)+sc(f2,17); ch=np.where(t1>=t2,f1,f2)
    # next year's draft slots, written independently of the JS helper
    slot=np.zeros((N,n),dtype=np.int64)
    for i in range(6,12): slot[R,order[:,i]]=12-i
    l1=np.where(q1==order[:,3],order[:,4],order[:,3]); l2=np.where(q2==order[:,2],order[:,5],order[:,2])
    slot[R,l1]=8; slot[R,l2]=7                      # 3v6 loser is the lower seed unless the 6 seed won...
    six_won=(q2==order[:,5])                        # ...then the loser is the 3 seed, who outranks the 4v5 loser
    slot[R[six_won],l1[six_won]]=7; slot[R[six_won],l2[six_won]]=8
    x1=np.where(f1==order[:,0],q1,order[:,0]); x2=np.where(f2==order[:,1],q2,order[:,1])
    slot[R,x2]=9; slot[R,x1]=10; slot[R,np.where(ch==f1,f2,f1)]=11; slot[R,ch]=12
    return dict(order=order,q1=q1,q2=q2,f1=f1,f2=f2,ch=ch,res=res,slot=slot)
def summarize(o,mask=None):
    if mask is None: mask=np.ones(len(o['ch']),dtype=bool)
    m=mask.sum(); out={}
    cnt=lambda arr: np.bincount(arr[mask].ravel(),minlength=n)/m
    out['playoff']=cnt(o['order'][:,:6]); out['bye']=cnt(o['order'][:,:2])
    out['slotDist']=np.stack([(o['slot'][mask]==k+1).mean(axis=0) for k in range(n)],axis=1)
    out['semi']=cnt(o['order'][:,:2])+cnt(o['q1'])+cnt(o['q2']); out['fin']=cnt(o['f1'])+cnt(o['f2']); out['champ']=cnt(o['ch']); out['m']=m
    return out
N=1_000_000; o=run(N,2026); py=summarize(o)
worst=0
for kname in ('playoff','bye','semi','fin','champ'):
    a=np.array(js['base'][kname]); b=py[kname]; pm=(a+b)/2
    z=np.abs(a-b)/np.sqrt(pm*(1-pm)*(1/js['base']['n']+1/N)+1e-12); worst=max(worst,z.max())
    print('%-8s largest JS-vs-Python gap %.2f points (%.2f standard errors)'%(kname,100*np.abs(a-b).max(),z.max()))
a=np.array(js['base']['slotDist']); b=py['slotDist']; pm=(a+b)/2
z=np.abs(a-b)/np.sqrt(pm*(1-pm)*(1/js['base']['n']+1/N)+1e-12); worst=max(worst,z.max())
print('draft slots: largest JS-vs-Python gap %.2f points (%.2f standard errors) across 144 team-by-slot odds'%(100*np.abs(a-b).max(),z.max()))
slot_gap=float(100*np.abs(a-b).max())
assert worst<4.5, worst
# --- forced scenario: three picked games, brute-force filtering here vs conditional sampling in JS
picks=js['forced']['picks']; mask=np.ones(N,dtype=bool)
for gi,p in enumerate(picks):
    if p==1: mask&=o['res'][:,gi]
    if p==2: mask&=~o['res'][:,gi]
f=summarize(o,mask); wz=0
for kname in ('playoff','champ'):
    a=np.array(js['forced'][kname]); b=f[kname]; pm=(a+b)/2
    z=np.abs(a-b)/np.sqrt(pm*(1-pm)*(1/js['forced']['ess']+1/f['m'])+1e-12); wz=max(wz,z.max())
    print('forced %-8s largest gap %.2f points (%.2f standard errors); python kept %d of %d runs, JS effective sample %.0f'%(kname,100*np.abs(a-b).max(),z.max(),f['m'],N,js['forced']['ess']))
assert wz<4.5, wz
json.dump({'maxGapPoints':round(max(slot_gap,float(max(100*np.abs(np.array(js['base'][k])-py[k]).max() for k in ('playoff','bye','semi','fin','champ')))),2),'pythonRuns':N},open('data/crosscheck.json','w'))
print('CROSS-CHECK PASSED')
names=[t['name'] for t in snap['teams']]
print('\nBaseline (JS engine, blend 0.5):')
for i in np.argsort(-np.array(js['base']['playoff'])):
    print('  %-26s %d-%d  playoffs %5.1f%%  bye %5.1f%%  semis %5.1f%%  final %5.1f%%  title %5.1f%%'%(names[i],wins[i],W-wins[i],*[100*js['base'][k][i] for k in ('playoff','bye','semi','fin','champ')]))
