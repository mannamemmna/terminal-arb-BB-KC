import { useState } from 'react';
import { TerminalProvider, useTerminal } from './store/useStore';
import Header from './components/Header';
import SpreadScanner from './components/SpreadScanner';
import EquityCurve from './components/EquityCurve';
import ActivePositions from './components/ActivePositions';
import SignalFeed from './components/SignalFeed';
import TradeHistory from './components/TradeHistory';
import SettingsDrawer from './components/SettingsDrawer';

function Dashboard() {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [mobileTab, setMobileTab] = useState('scanner');
  const { killSwitch } = useTerminal();

  const tabs = [
    { id: 'scanner', label: 'Scanner', icon: '📊' },
    { id: 'chart', label: 'Chart', icon: '📈' },
    { id: 'positions', label: 'Positions', icon: '💼' },
    { id: 'log', label: 'Log', icon: '📝' },
    { id: 'history', label: 'History', icon: '📜' },
  ];

  return (
    <div className="h-screen w-screen flex flex-col bg-bg-dark overflow-hidden">
      <Header />

      {/* Desktop layout (>1024px) */}
      <main className="hidden lg:flex flex-1 flex-col min-h-0">
        {/* Top row */}
        <div className="flex flex-1 min-h-0" style={{ height: '60%' }}>
          <div className="flex-[2] border-r border-border overflow-hidden min-w-0">
            <div className="h-full bg-bg-panel"><SpreadScanner /></div>
          </div>
          <div className="flex-1 flex flex-col min-w-0">
            <div className="flex-1 border-b border-border overflow-hidden">
              <div className="h-full bg-bg-panel"><EquityCurve /></div>
            </div>
            <div className="flex-1 overflow-hidden">
              <div className="h-full bg-bg-panel"><ActivePositions /></div>
            </div>
          </div>
        </div>
        {/* Bottom row */}
        <div className="flex flex-1 border-t border-border" style={{ height: '40%' }}>
          <div className="flex-[1.3] border-r border-border overflow-hidden min-w-0">
            <div className="h-full bg-bg-panel"><SignalFeed /></div>
          </div>
          <div className="flex-1 overflow-hidden min-w-0">
            <div className="h-full bg-bg-panel"><TradeHistory /></div>
          </div>
        </div>
      </main>

      {/* Tablet layout (640-1024px) — 2-column grid */}
      <main className="hidden md:flex lg:hidden flex-1 flex-col min-h-0 overflow-auto p-2 gap-2">
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-bg-panel rounded border border-border h-80"><SpreadScanner /></div>
          <div className="bg-bg-panel rounded border border-border h-64"><EquityCurve /></div>
          <div className="bg-bg-panel rounded border border-border h-64"><ActivePositions /></div>
          <div className="bg-bg-panel rounded border border-border h-80"><SignalFeed /></div>
        </div>
        <div className="bg-bg-panel rounded border border-border h-64"><TradeHistory /></div>
      </main>

      {/* Mobile layout (<640px) — tab-based */}
      <main className="flex md:hidden flex-1 flex-col min-h-0 overflow-hidden">
        <div className="flex-1 overflow-auto p-2 min-h-0">
          {mobileTab === 'scanner' && <div className="bg-bg-panel rounded border border-border h-full min-h-[70vh]"><SpreadScanner /></div>}
          {mobileTab === 'chart' && <div className="bg-bg-panel rounded border border-border h-full min-h-[70vh]"><EquityCurve /></div>}
          {mobileTab === 'positions' && <div className="bg-bg-panel rounded border border-border h-full min-h-[70vh]"><ActivePositions /></div>}
          {mobileTab === 'log' && <div className="bg-bg-panel rounded border border-border h-full min-h-[70vh]"><SignalFeed /></div>}
          {mobileTab === 'history' && <div className="bg-bg-panel rounded border border-border h-full min-h-[70vh]"><TradeHistory /></div>}
        </div>

        {/* Mobile bottom tab nav */}
        <nav className="bg-bg-header border-t border-border flex shrink-0 overflow-x-auto">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setMobileTab(tab.id)}
              className={`flex-1 flex flex-col items-center py-2 text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer min-w-0 ${
                mobileTab === tab.id ? 'text-accent-green border-t-2 border-accent-green' : 'text-text-dim hover:text-text-primary'
              }`}
            >
              <span className="text-sm mb-0.5">{tab.icon}</span>
              <span className="truncate max-w-full px-1">{tab.label}</span>
            </button>
          ))}
        </nav>
      </main>

      {/* Floating buttons */}
      <div className="fixed bottom-4 left-4 z-30 flex items-center gap-2">
        <button onClick={() => killSwitch('close-all')} className="bg-accent-red/10 border border-accent-red/30 rounded-full px-3 py-1.5 flex items-center gap-2 shadow-lg hover:bg-accent-red/20 transition-colors cursor-pointer">
          <span className="text-accent-red text-sm">🛑</span>
          <span className="mono text-[10px] text-accent-red uppercase tracking-wider font-semibold hidden sm:inline">Close All</span>
        </button>
        <button onClick={() => setSettingsOpen(true)} className="bg-bg-panel border border-border-light rounded-full px-3 py-1.5 flex items-center gap-2 shadow-lg hover:border-border-light/50 transition-colors cursor-pointer">
          <span className="text-accent-amber text-sm">⚙</span>
          <span className="mono text-[10px] text-text-dim uppercase tracking-wider font-semibold hidden sm:inline">Settings</span>
        </button>
      </div>

      <SettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}

export default function App() {
  return (
    <TerminalProvider>
      <Dashboard />
    </TerminalProvider>
  );
}
