import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';

const TerminalContext = createContext(null);

const DEFAULT_CONFIG = {
  spreadThreshold: 0.3,
  minFundingDiff: 0.01,
  dryRun: true,
  watchedPairs: [],
  watchlistOnly: false,
  feedAutoScroll: true,
  displayLimit: 100,
};

/** Build origin-relative WebSocket URL — works with Vite proxy & production */
const getWsUrl = () => {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${window.location.host}/ws`;
};

export function TerminalProvider({ children }) {
  const [config, setConfig] = useState(DEFAULT_CONFIG);
  const [spreads, setSpreads] = useState([]);
  const [equityCurve, setEquityCurve] = useState([]);
  const [positions, setPositions] = useState([]);
  const [logs, setLogs] = useState([]);
  const [tradeHistory, setTradeHistory] = useState([]);
  const [selectedSymbol, setSelectedSymbol] = useState(null);
  const [status, setStatus] = useState({
    bybit: 'connecting',
    kucoin: 'connecting',
    lastUpdate: new Date(),
    totalSpreadsFound: 0,
    winRate: 0,
    totalPnl: 0,
  });

  const [mode, setMode] = useState('paper');
  const [killState, setKillState] = useState('ACTIVE');
  const [accounts, setAccounts] = useState({ bybit: null, kucoin: null });

  const logCounter = useRef(500);
  const MAX_LOGS = 500;
  const wsRef = useRef(null);
  const connectedRef = useRef(false);

  // Common fetch helper with credentials
  const api = (path, opts = {}) =>
    fetch(path, { credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...opts });

  const fetchAccounts = useCallback(async () => {
    try {
      const [bybitRes, kucoinRes] = await Promise.all([
        api('/api/account/bybit'),
        api('/api/account/kucoin'),
      ]);
      setAccounts({ bybit: await bybitRes.json(), kucoin: await kucoinRes.json() });
    } catch {}
  }, []);

  const fetchPositions = useCallback(async () => {
    try {
      const res = await api('/api/positions/open');
      const data = await res.json();
      if (data.positions) setPositions(data.positions);
    } catch {}
  }, []);

  const fetchTradeHistory = useCallback(async () => {
    try {
      const res = await api(`/api/trades?mode=${mode}&limit=50`);
      const data = await res.json();
      if (data.trades) setTradeHistory(data.trades);
    } catch {}
  }, [mode]);

  const fetchEquityCurve = useCallback(async () => {
    try {
      const res = await api(`/api/equity-curve?mode=${mode}`);
      const data = await res.json();
      if (data.curve) setEquityCurve(data.curve);
    } catch {}
  }, [mode]);

  // Connect to backend WebSocket
  useEffect(() => {
    const connectWs = () => {
      const wsUrl = getWsUrl();
      let ws;
      try { ws = new WebSocket(wsUrl); }
      catch { return; }

      ws.onopen = () => {
        connectedRef.current = true;
        api('/api/spreads').then(r => r.json()).then(d => { if (d.spreads) setSpreads(d.spreads); }).catch(() => {});
        api('/api/config').then(r => r.json()).then(d => { if (d.spreadThreshold !== undefined) setConfig(p => ({...p, spreadThreshold: d.spreadThreshold, minFundingDiff: d.minFundingDiff})); }).catch(() => {});
        api('/api/mode').then(r => r.json()).then(d => setMode(d.mode || 'paper')).catch(() => {});
        api('/api/kill-switch').then(r => r.json()).then(d => setKillState(d.state)).catch(() => {});
        fetchAccounts();
        fetchPositions();
        fetchTradeHistory();
        fetchEquityCurve();
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          switch (msg.type) {
            case 'spread:batch':
              if (Array.isArray(msg.data)) setSpreads(msg.data);
              break;
            case 'spread:update':
              if (msg.data) setSpreads(prev => { const i = prev.findIndex(s => s.symbol === msg.data.symbol); if (i>=0) { const n=[...prev]; n[i]=msg.data; return n; } return [msg.data,...prev]; });
              break;
            case 'signal:log':
              if (msg.data) {
                logCounter.current++;
                setLogs(prev => { const nl = { id: `log-${logCounter.current}`, time: new Date(msg.data.timestamp), message: msg.data.message }; const n = [...prev, nl]; return n.length > MAX_LOGS ? n.slice(n.length-MAX_LOGS) : n; });
              }
              break;
            case 'connection:status':
              if (msg.data) setStatus(p => ({...p, bybit: msg.data.bybit === 'live' ? 'connected' : msg.data.bybit, kucoin: msg.data.kucoin === 'live' ? 'connected' : msg.data.kucoin, lastUpdate: new Date(), totalSpreadsFound: p.totalSpreadsFound + (msg.data.bybit === 'live' ? 1 : 0)}));
              break;
            case 'positions:update':
              if (Array.isArray(msg.data)) setPositions(msg.data);
              break;
            case 'trade:closed':
              fetchTradeHistory();
              fetchEquityCurve();
              break;
            case 'welcome': break;
          }
        } catch {}
      };
      ws.onclose = () => { connectedRef.current = false; wsRef.current = null; setStatus(p => ({...p, bybit:'disconnected', kucoin:'disconnected'})); setTimeout(connectWs, 3000); };
      ws.onerror = () => {};
      wsRef.current = ws;
    };

    connectWs();
    return () => { if (wsRef.current) { wsRef.current.onclose = null; wsRef.current.close(); wsRef.current = null; } };
  }, [fetchAccounts, fetchPositions, fetchTradeHistory, fetchEquityCurve]);

  useEffect(() => {
    const iv = setInterval(fetchAccounts, 15000);
    return () => clearInterval(iv);
  }, [fetchAccounts]);

  const updateConfig = useCallback(async (patch) => {
    setConfig(prev => ({ ...prev, ...patch }));
    try { await api('/api/config', { method: 'POST', body: JSON.stringify(patch) }); } catch {}
  }, []);

  const switchMode = useCallback(async (newMode, confirm) => {
    try {
      const res = await api('/api/mode', { method: 'POST', body: JSON.stringify({ mode: newMode, confirm }) });
      const data = await res.json();
      if (data.mode) setMode(data.mode);
      return data;
    } catch { return { error: 'Failed to switch mode' }; }
  }, []);

  const killSwitch = useCallback(async (action) => {
    try {
      const res = await api('/api/kill-switch', { method: 'POST', body: JSON.stringify({ action }) });
      const data = await res.json();
      if (data.state) setKillState(data.state);
      return data;
    } catch { return { error: 'Failed' }; }
  }, []);

  const closePosition = useCallback(async (positionId) => {
    try { await api(`/api/positions/${positionId}/close`, { method: 'POST' }); fetchPositions(); } catch {}
  }, [fetchPositions]);

  return (
    <TerminalContext.Provider value={{
      config, updateConfig,
      spreads, equityCurve, positions, logs, tradeHistory,
      selectedSymbol, setSelectedSymbol,
      status, mode, killState, accounts,
      switchMode, killSwitch, closePosition,
    }}>
      {children}
    </TerminalContext.Provider>
  );
}

export function useTerminal() {
  const ctx = useContext(TerminalContext);
  if (!ctx) throw new Error('useTerminal must be used within TerminalProvider');
  return ctx;
}