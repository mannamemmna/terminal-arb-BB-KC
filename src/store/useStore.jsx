import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
const TerminalContext = createContext(null);

const DEFAULT_CONFIG = {
  spreadThreshold: 0.3,
  minFundingDiff: 0.01,
  dryRun: true,
  watchedPairs: [], // empty = show ALL pairs from backend
  feedAutoScroll: true,
};

const BACKEND_PORT = 3001;
const getBackendUrl = () => {
  const host = window.location.hostname || 'localhost';
  return { rest: `http://${host}:${BACKEND_PORT}`, ws: `ws://${host}:${BACKEND_PORT}/ws` };
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

  // Phase 3 state
  const [mode, setMode] = useState('demo');
  const [killState, setKillState] = useState('ACTIVE');
  const [accounts, setAccounts] = useState({ bybit: null, kucoin: null });

  const logCounter = useRef(500);
  const MAX_LOGS = 500;
  const wsRef = useRef(null);
  const connectedRef = useRef(false);

  // Data comes from backend — no mock seed

  // Fetch accounts + positions periodically
  const fetchAccounts = useCallback(async () => {
    const { rest } = getBackendUrl();
    try {
      const [bybitRes, kucoinRes] = await Promise.all([
        fetch(`${rest}/api/account/bybit`),
        fetch(`${rest}/api/account/kucoin`),
      ]);
      setAccounts({ bybit: await bybitRes.json(), kucoin: await kucoinRes.json() });
    } catch {}
  }, []);

  const fetchPositions = useCallback(async () => {
    const { rest } = getBackendUrl();
    try {
      const res = await fetch(`${rest}/api/positions/open`);
      const data = await res.json();
      if (data.positions) setPositions(data.positions);
    } catch {}
  }, []);

  // Connect to backend WebSocket
  useEffect(() => {
    const connectWs = () => {
      const { ws: wsUrl, rest: restUrl } = getBackendUrl();
      let ws;
      try { ws = new WebSocket(wsUrl); }
      catch { fallbackToMock(); return; }

      ws.onopen = () => {
        connectedRef.current = true;
        fetch(`${restUrl}/api/spreads`).then(r => r.json()).then(d => { if (d.spreads) setSpreads(d.spreads); }).catch(() => {});
        fetch(`${restUrl}/api/config`).then(r => r.json()).then(d => { if (d.spreadThreshold) setConfig(p => ({...p, spreadThreshold: d.spreadThreshold, minFundingDiff: d.minFundingDiff})); }).catch(() => {});
        fetch(`${restUrl}/api/mode`).then(r => r.json()).then(d => setMode(d.mode)).catch(() => {});
        fetch(`${restUrl}/api/kill-switch`).then(r => r.json()).then(d => setKillState(d.state)).catch(() => {});
        fetchAccounts();
        fetchPositions();
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
            case 'welcome': break;
          }
        } catch {}
      };
      ws.onclose = () => { connectedRef.current = false; wsRef.current = null; setStatus(p => ({...p, bybit:'disconnected', kucoin:'disconnected'})); setTimeout(connectWs, 3000); };
      ws.onerror = () => {};
      wsRef.current = ws;
    };

    const fallbackToMock = () => {
      console.warn('[WS] Backend unavailable — using local fallback');
      setStatus(p => ({...p, bybit:'connected', kucoin:'connected', lastUpdate: new Date()}));
    };

    connectWs();
    const ft = setTimeout(() => { if (!connectedRef.current) fallbackToMock(); }, 10000);
    return () => { clearTimeout(ft); if (wsRef.current) { wsRef.current.onclose = null; wsRef.current.close(); wsRef.current = null; } };
  }, [fetchAccounts, fetchPositions]);

  // Periodic fetch
  useEffect(() => {
    const iv = setInterval(fetchAccounts, 15000);
    return () => clearInterval(iv);
  }, [fetchAccounts]);

  const updateConfig = useCallback(async (patch) => {
    setConfig(prev => ({ ...prev, ...patch }));
    const { rest: restUrl } = getBackendUrl();
    try { await fetch(`${restUrl}/api/config`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ spreadThreshold: patch.spreadThreshold, minFundingDiff: patch.minFundingDiff }) }); } catch {}
  }, []);

  const switchMode = useCallback(async (newMode, confirm) => {
    const { rest } = getBackendUrl();
    try {
      const res = await fetch(`${rest}/api/mode`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ mode: newMode, confirm }) });
      const data = await res.json();
      if (data.mode) setMode(data.mode);
      return data;
    } catch { return { error: 'Failed to switch mode' }; }
  }, []);

  const killSwitch = useCallback(async (action) => {
    const { rest } = getBackendUrl();
    try {
      const res = await fetch(`${rest}/api/kill-switch`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ action }) });
      const data = await res.json();
      if (data.state) setKillState(data.state);
      return data;
    } catch { return { error: 'Failed' }; }
  }, []);

  const closePosition = useCallback(async (positionId) => {
    const { rest } = getBackendUrl();
    try { await fetch(`${rest}/api/positions/${positionId}/close`, { method: 'POST' }); fetchPositions(); } catch {}
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
