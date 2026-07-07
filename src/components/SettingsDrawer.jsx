import { useState } from 'react';
import { useTerminal } from '../store/useStore';
import { Lock, Pause, Play, OctagonX, X } from 'lucide-react';

const ALL_SYMBOLS = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'DOGEUSDT',
  'ADAUSDT', 'AVAXUSDT', 'LINKUSDT', 'DOTUSDT', 'POLUSDT',
  'ATOMUSDT', 'UNIUSDT', 'BCHUSDT', 'LTCUSDT', 'NEARUSDT',
  'APTUSDT', 'ARBUSDT', 'OPUSDT', 'FILUSDT', 'INJUSDT',
];

const BACKEND_PORT = 3001;
const getBackend = () => `http://${window.location.hostname || 'localhost'}:${BACKEND_PORT}`;

export default function SettingsDrawer({ open, onClose }) {
  const { config, updateConfig, killSwitch, killState } = useTerminal();
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [checking, setChecking] = useState(true);

  useState(() => {
    fetch(`${getBackend()}/api/auth/status`, { credentials: 'include' })
      .then(r => r.json()).then(d => { setAuthenticated(d.authenticated); setChecking(false); })
      .catch(() => setChecking(false));
  });

  const handleLogin = async () => {
    try {
      const res = await fetch(`${getBackend()}/api/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }), credentials: 'include',
      });
      const data = await res.json();
      if (data.ok) { setAuthenticated(true); setLoginError(''); }
      else setLoginError(data.error || 'Login failed');
    } catch { setLoginError('Connection error'); }
  };

  const togglePair = (symbol) => {
    const current = config.watchedPairs;
    if (current.includes(symbol)) updateConfig({ watchedPairs: current.filter(s => s !== symbol) });
    else updateConfig({ watchedPairs: [...current, symbol] });
  };

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 bg-black/60 z-40 transition-opacity" onClick={onClose} />
      <div className="fixed right-0 top-0 h-full w-full sm:w-80 bg-bg-panel border-l border-border z-50 shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-3 sm:px-4 py-3 border-b border-border shrink-0">
          <span className="text-sm font-bold uppercase tracking-wider text-text-primary">Settings</span>
          <button onClick={onClose} className="text-text-dim hover:text-text-primary cursor-pointer"><X size={16} /></button>
        </div>

        {!checking && !authenticated && (
          <div className="flex-1 flex items-center justify-center px-6">
            <div className="w-full max-w-xs">
              <div className="text-center mb-4">
                <Lock size={28} className="mx-auto mb-2 text-text-dim" />
                <div className="mono text-xs text-text-dim uppercase tracking-wider">Protected Settings</div>
                <div className="text-[10px] text-text-dim mt-1">Enter password to access configuration</div>
              </div>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleLogin()}
                placeholder="Password" autoFocus
                className="w-full mono text-xs bg-bg-dark border border-border-light rounded px-3 py-2 text-text-primary outline-none focus:border-accent-blue mb-2" />
              {loginError && <div className="mono text-[10px] text-accent-red mb-2">{loginError}</div>}
              <button onClick={handleLogin}
                className="w-full mono text-xs font-bold uppercase bg-accent-blue/10 border border-accent-blue/30 text-accent-blue rounded px-3 py-2 cursor-pointer hover:bg-accent-blue/20 transition-colors">Unlock</button>
            </div>
          </div>
        )}

        {checking && <div className="flex-1 flex items-center justify-center"><div className="mono text-xs text-text-dim pulse-dot">Checking...</div></div>}

        {authenticated && (
          <div className="flex-1 overflow-auto px-3 sm:px-4 py-3 space-y-4 sm:space-y-5">
            <div>
              <label className="text-xs text-text-dim uppercase tracking-wider font-semibold">Kill-Switch</label>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <button onClick={() => killSwitch('pause')}
                  className={`mono text-xs font-bold px-3 py-1.5 rounded border cursor-pointer flex items-center gap-1 ${killState === 'PAUSED' ? 'text-accent-amber border-accent-amber/40 bg-accent-amber/5' : 'text-text-dim border-border-light bg-transparent'}`}>
                  <Pause size={12} /> Pause</button>
                <button onClick={() => killSwitch('resume')}
                  className={`mono text-xs font-bold px-3 py-1.5 rounded border cursor-pointer flex items-center gap-1 ${killState === 'ACTIVE' ? 'text-accent-green border-accent-green/40 bg-accent-green/5' : 'text-text-dim border-border-light bg-transparent'}`}>
                  <Play size={12} /> Resume</button>
                <button onClick={() => killSwitch('close-all')}
                  className="mono text-xs font-bold px-3 py-1.5 rounded border text-accent-red border-accent-red/40 bg-accent-red/5 cursor-pointer flex items-center gap-1">
                  <OctagonX size={12} /> Close All</button>
              </div>
              <div className="mt-1 text-[10px] text-text-dim mono">State: {killState}</div>
            </div>

            <div>
              <label className="text-xs text-text-dim uppercase tracking-wider font-semibold">Mode</label>
              <div className="mt-1.5 text-[10px] text-text-dim mono">Switch via header — LIVE requires "CONFIRM LIVE"</div>
            </div>

            <div>
              <label className="text-xs text-text-dim uppercase tracking-wider font-semibold">Min Spread (%)</label>
              <input type="number" step="0.05" min="0.05" max="2" value={config.spreadThreshold}
                onChange={(e) => updateConfig({ spreadThreshold: +e.target.value })}
                className="mt-1 mono tnum text-xs bg-bg-dark border border-border-light rounded px-2 py-1.5 w-20 text-text-primary outline-none focus:border-accent-blue" />
            </div>

            <div>
              <label className="text-xs text-text-dim uppercase tracking-wider font-semibold">Min Funding Diff (%)</label>
              <input type="number" step="0.005" min="0.005" max="0.1" value={config.minFundingDiff}
                onChange={(e) => updateConfig({ minFundingDiff: +e.target.value })}
                className="mt-1 mono tnum text-xs bg-bg-dark border border-border-light rounded px-2 py-1.5 w-20 text-text-primary outline-none focus:border-accent-blue" />
            </div>

            <div>
              <div className="flex items-center justify-between">
                <label className="text-xs text-text-dim uppercase tracking-wider font-semibold">Watched Pairs</label>
                <div className="flex gap-2">
                  <button onClick={() => updateConfig({ watchedPairs: [...ALL_SYMBOLS] })} className="mono text-[9px] uppercase text-accent-blue cursor-pointer">All</button>
                  <button onClick={() => updateConfig({ watchedPairs: [] })} className="mono text-[9px] uppercase text-accent-red cursor-pointer">None</button>
                </div>
              </div>
              <div className="mt-1.5 grid grid-cols-2 gap-1">
                {ALL_SYMBOLS.map(sym => (
                  <label key={sym} className={`flex items-center gap-2 px-2 py-1 rounded cursor-pointer transition-colors text-xs ${config.watchedPairs.includes(sym) ? 'bg-accent-blue/10 text-text-primary' : 'text-text-dim hover:bg-white/[0.02]'}`}>
                    <input type="checkbox" checked={config.watchedPairs.includes(sym)} onChange={() => togglePair(sym)} className="accent-accent-blue w-3 h-3" />
                    <span className="mono truncate">{sym}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="border-t border-border px-3 sm:px-4 py-2 shrink-0">
          <div className="text-[10px] text-text-dim mono">Phase 4 · {authenticated ? 'Authenticated' : 'Read-only view'}</div>
        </div>
      </div>
    </>
  );
}
