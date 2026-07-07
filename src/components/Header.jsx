import { useState, useEffect } from 'react';
import { useTerminal } from '../store/useStore';
import { Activity, Wifi, WifiOff, Zap, Pause, OctagonX, Play, Clock as ClockIconLucide } from 'lucide-react';

function ClockIcon() {
  const [time, setTime] = useState(new Date());
  useEffect(() => { const iv = setInterval(() => setTime(new Date()), 1000); return () => clearInterval(iv); }, []);
  return <span className="mono tnum text-text-secondary text-xs">{time.toISOString().replace('T', ' ').slice(0, 19)} UTC</span>;
}

function StatusDot({ label, connected }) {
  return (
    <span className="mono text-xs flex items-center gap-1.5">
      <span className="font-semibold text-text-dim hidden sm:inline">{label}</span>
      {connected ? <Wifi size={12} className="text-accent-green pulse-dot" /> : <WifiOff size={12} className="text-accent-red" />}
      <span className="font-bold text-[10px] uppercase tracking-wider">{connected ? 'L' : '!'}</span>
    </span>
  );
}

export default function Header() {
  const { config, updateConfig, status, mode, switchMode, killState, killSwitch, accounts } = useTerminal();
  const [liveConfirming, setLiveConfirming] = useState(false);
  const [liveInput, setLiveInput] = useState('');

  const handleModeClick = async () => {
    if (mode === 'demo') { setLiveConfirming(true); }
    else { await switchMode('demo'); setLiveConfirming(false); setLiveInput(''); }
  };

  const handleConfirmLive = async () => {
    if (liveInput === 'CONFIRM LIVE') {
      const result = await switchMode('live', 'CONFIRM LIVE');
      if (!result.error) { setLiveConfirming(false); setLiveInput(''); }
    }
  };

  const killIcon = killState === 'PAUSED' ? Pause : killState === 'TRIGGERED' ? OctagonX : Play;
  const KillIconComponent = killIcon;

  return (
    <header className="bg-bg-header border-b border-border px-2 sm:px-4 py-1.5 sm:py-2 flex items-center justify-between shrink-0 gap-2">
      <div className="flex items-center gap-2 sm:gap-4">
        <div className="flex items-center gap-1.5 sm:gap-2">
          <div className="w-4 h-4 sm:w-5 sm:h-5 rounded bg-accent-green flex items-center justify-center">
            <Activity size={10} className="text-bg-dark" strokeWidth={3} />
          </div>
          <span className="text-xs sm:text-sm font-bold tracking-tight text-text-primary whitespace-nowrap">
            <span className="hidden sm:inline">SPREAD ARB </span>
            <span className="text-accent-green">T</span><span className="hidden sm:inline text-accent-green">ERMINAL</span>
          </span>
        </div>
        <div className="hidden xs:flex items-center gap-2 sm:gap-3">
          <StatusDot label="BYBIT" connected={status.bybit === 'connected'} />
          <StatusDot label="KUCOIN" connected={status.kucoin === 'connected'} />
        </div>
      </div>

      <div className="flex items-center gap-1.5 sm:gap-3">
        {liveConfirming ? (
          <div className="flex items-center gap-1 sm:gap-2">
            <input type="text" value={liveInput} onChange={(e) => setLiveInput(e.target.value)} placeholder='CONFIRM LIVE'
              className="mono text-[9px] sm:text-[10px] bg-bg-dark border border-accent-red/50 rounded px-1.5 sm:px-2 py-1 w-24 sm:w-36 text-text-primary outline-none" />
            <button onClick={handleConfirmLive}
              className="mono text-[9px] sm:text-[10px] font-bold uppercase text-accent-red bg-accent-red/10 border border-accent-red/30 px-1.5 sm:px-2 py-1 rounded cursor-pointer whitespace-nowrap">OK</button>
            <button onClick={() => { setLiveConfirming(false); setLiveInput(''); }} className="mono text-[10px] text-text-dim px-1 cursor-pointer">✕</button>
          </div>
        ) : (
          <button onClick={handleModeClick}
            className={`mono text-[9px] sm:text-[10px] font-bold uppercase tracking-widest px-1.5 sm:px-2.5 py-1 rounded border transition-colors cursor-pointer flex items-center gap-1 ${mode === 'live' ? 'text-accent-green border-accent-green/40 bg-accent-green/5' : 'text-accent-amber border-accent-amber/40 bg-accent-amber/5'}`}>
            <Zap size={10} />
            {mode === 'live' ? 'LIVE' : 'DEMO'}
          </button>
        )}

        <button onClick={() => killSwitch(killState === 'PAUSED' ? 'resume' : 'pause')}
          className={`mono text-[9px] sm:text-[10px] font-bold uppercase tracking-widest p-1.5 rounded border cursor-pointer flex items-center ${killState === 'PAUSED' ? 'text-accent-amber border-accent-amber/40 bg-accent-amber/5' : killState === 'TRIGGERED' ? 'text-accent-red border-accent-red/40 bg-accent-red/5' : 'text-text-dim border-border-light'}`}>
          <KillIconComponent size={12} />
        </button>

        <div className="hidden sm:flex items-center gap-1">
          <ClockIconLucide size={10} className="text-text-dim" />
          <ClockIcon />
        </div>
      </div>

      <div className="hidden sm:flex items-center gap-3 text-xs">
        <div className="text-right">
          <div className="text-text-dim text-[10px] uppercase tracking-wider hidden lg:block">Equity</div>
          <div className="mono tnum text-accent-green font-bold text-xs">${((accounts.bybit?.balance?.totalEquity||0)+(accounts.kucoin?.balance?.totalEquity||0)).toFixed(0)}</div>
        </div>
      </div>
    </header>
  );
}
