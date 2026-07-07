import { useState, useEffect } from 'react';
import { useTerminal } from '../store/useStore';

function Clock() {
  const [time, setTime] = useState(new Date());
  useEffect(() => { const iv = setInterval(() => setTime(new Date()), 1000); return () => clearInterval(iv); }, []);
  return <span className="mono tnum text-text-secondary text-xs">{time.toISOString().replace('T', ' ').slice(0, 19)} UTC</span>;
}

function StatusDot({ label, connected }) {
  return (
    <span className="mono text-xs flex items-center gap-1.5">
      <span className="font-semibold text-text-dim hidden sm:inline">{label}</span>
      <span className={`inline-flex items-center gap-1 ${connected ? 'text-accent-green' : 'text-accent-red'}`}>
        <span className={`w-1.5 h-1.5 rounded-full inline-block ${connected ? 'bg-accent-green pulse-dot' : 'bg-accent-red'}`} />
        <span className="font-bold text-[10px] uppercase tracking-wider">{connected ? 'L' : '!'}</span>
      </span>
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

  return (
    <header className="bg-bg-header border-b border-border px-2 sm:px-4 py-1.5 sm:py-2 flex items-center justify-between shrink-0 gap-2">
      {/* Left */}
      <div className="flex items-center gap-2 sm:gap-4">
        <div className="flex items-center gap-1.5 sm:gap-2">
          <div className="w-4 h-4 sm:w-5 sm:h-5 rounded bg-accent-green flex items-center justify-center">
            <span className="text-bg-dark text-[8px] sm:text-[10px] font-black">⇄</span>
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

      {/* Center */}
      <div className="flex items-center gap-1.5 sm:gap-3">
        {liveConfirming ? (
          <div className="flex items-center gap-1 sm:gap-2">
            <input type="text" value={liveInput} onChange={(e) => setLiveInput(e.target.value)} placeholder='CONFIRM LIVE' className="mono text-[9px] sm:text-[10px] bg-bg-dark border border-accent-red/50 rounded px-1.5 sm:px-2 py-1 w-24 sm:w-36 text-text-primary outline-none" />
            <button onClick={handleConfirmLive} className="mono text-[9px] sm:text-[10px] font-bold uppercase text-accent-red bg-accent-red/10 border border-accent-red/30 px-1.5 sm:px-2 py-1 rounded cursor-pointer whitespace-nowrap">OK</button>
            <button onClick={() => { setLiveConfirming(false); setLiveInput(''); }} className="mono text-[10px] text-text-dim px-1 cursor-pointer">✕</button>
          </div>
        ) : (
          <button onClick={handleModeClick} className={`mono text-[9px] sm:text-[10px] font-bold uppercase tracking-widest px-1.5 sm:px-2.5 py-1 rounded border transition-colors cursor-pointer ${mode === 'live' ? 'text-accent-green border-accent-green/40 bg-accent-green/5' : 'text-accent-amber border-accent-amber/40 bg-accent-amber/5'}`}>
            <span className={`inline-block w-1 h-1 sm:w-1.5 sm:h-1.5 rounded-full mr-0.5 sm:mr-1.5 ${mode === 'live' ? 'bg-accent-green' : 'bg-accent-amber'}`} />
            {mode === 'live' ? 'LIVE' : 'DEMO'}
          </button>
        )}

        <button onClick={() => killSwitch(killState === 'PAUSED' ? 'resume' : 'pause')} className={`mono text-[9px] sm:text-[10px] font-bold uppercase tracking-widest px-1.5 sm:px-2 py-1 rounded border cursor-pointer ${killState === 'PAUSED' ? 'text-accent-amber border-accent-amber/40 bg-accent-amber/5' : killState === 'TRIGGERED' ? 'text-accent-red border-accent-red/40 bg-accent-red/5' : 'text-text-dim border-border-light'}`}>
          {killState === 'PAUSED' ? '⏸' : killState === 'TRIGGERED' ? '🛑' : '▶'}
        </button>

        <div className="hidden sm:block"><Clock /></div>
      </div>

      {/* Right */}
      <div className="hidden sm:flex items-center gap-3 text-xs">
        <div className="text-right">
          <div className="text-text-dim text-[10px] uppercase tracking-wider hidden lg:block">Equity</div>
          <div className="mono tnum text-accent-green font-bold text-xs">{((accounts.bybit?.balance?.totalEquity||0)+(accounts.kucoin?.balance?.totalEquity||0)).toFixed(0)}</div>
        </div>
      </div>
    </header>
  );
}
