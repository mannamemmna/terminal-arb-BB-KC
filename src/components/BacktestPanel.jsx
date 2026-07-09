import { useState } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { Play, Download, BarChart3, Clock, TrendingUp, AlertTriangle, Database } from 'lucide-react';

const api = (path, opts = {}) =>
  fetch(path, { credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...opts });

export default function BacktestPanel({ open }) {
  const [pairs, setPairs] = useState('BTCUSDT,ETHUSDT,SOLUSDT');
  const [startDate, setStartDate] = useState('2026-06-01');
  const [endDate, setEndDate] = useState('2026-07-01');
  const [minSpread, setMinSpread] = useState(0.3);
  const [maxHold, setMaxHold] = useState(48);
  const [positionSize, setPositionSize] = useState(100);
  const [feeA, setFeeA] = useState(0.00055);
  const [feeB, setFeeB] = useState(0.0006);
  const [slippage, setSlippage] = useState(5);

  const [running, setRunning] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [results, setResults] = useState(null);
  const [equityData, setEquityData] = useState([]);
  const [error, setError] = useState('');
  const [history, setHistory] = useState([]);

  const loadHistory = async () => {
    try {
      const res = await api('/api/backtest');
      const data = await res.json();
      setHistory(data.runs || []);
    } catch {}
  };

  const startBackfill = async () => {
    setBackfilling(true);
    setError('');
    try {
      const pairList = pairs.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
      await api('/api/backtest/backfill', {
        method: 'POST',
        body: JSON.stringify({ pairs: pairList, startDate, endDate, interval: '5m' }),
      });
    } catch (e) { setError(e.message); }
    setBackfilling(false);
  };

  const startBacktest = async () => {
    setRunning(true);
    setError('');
    setResults(null);
    setEquityData([]);
    try {
      const pairList = pairs.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
      const res = await api('/api/backtest/run', {
        method: 'POST',
        body: JSON.stringify({
          pairs: pairList, startDate, endDate, interval: '5m',
          minSpreadPct: minSpread, minFundingDiff: 0, maxHoldBars: maxHold,
          takerFeePctA: feeA, takerFeePctB: feeB, slippageBps: slippage,
          positionSizeUsd: positionSize, fundingIntervalHours: 8,
        }),
      });
      const { runId } = await res.json();
      // Poll until done
      let attempts = 0;
      const poll = async () => {
        await new Promise(r => setTimeout(r, 3000));
        const pRes = await api(`/api/backtest/${runId}`);
        const pData = await pRes.json();
        if (pData.status === 'completed') {
          setResults(pData.results);
          setEquityData(pData.equityCurve || []);
          setRunning(false);
          loadHistory();
        } else if (pData.status === 'failed') {
          setError(pData.results?.error || 'Backtest failed');
          setRunning(false);
        } else if (attempts++ < 100) {
          poll();
        } else {
          setError('Timeout waiting for results');
          setRunning(false);
        }
      };
      poll();
    } catch (e) { setError(e.message); setRunning(false); }
  };

  if (!open) return null;

  const inputCls = "w-full mono text-xs bg-bg-dark border border-border-light rounded px-2 py-1.5 text-text-primary outline-none focus:border-accent-blue";
  const labelCls = "text-[10px] text-text-dim uppercase tracking-wider font-semibold mb-1 block";

  return (
    <div className="space-y-4">
      {/* Error */}
      {error && <div className="flex items-center gap-2 text-xs text-accent-red bg-accent-red/10 border border-accent-red/20 rounded p-2">
        <AlertTriangle size={12} />{error}
      </div>}

      {/* Pairs + Dates */}
      <div className="grid grid-cols-2 gap-2">
        <div className="col-span-2">
          <label className={labelCls}>Pairs (comma-separated)</label>
          <input className={inputCls} value={pairs} onChange={e => setPairs(e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>Start Date</label>
          <input type="date" className={inputCls} value={startDate} onChange={e => setStartDate(e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>End Date</label>
          <input type="date" className={inputCls} value={endDate} onChange={e => setEndDate(e.target.value)} />
        </div>
      </div>

      {/* Parameters */}
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className={labelCls}>Min Spread %</label>
          <input type="number" step="0.1" className={inputCls} value={minSpread} onChange={e => setMinSpread(+e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>Max Hold (bars)</label>
          <input type="number" className={inputCls} value={maxHold} onChange={e => setMaxHold(+e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>Position Size $</label>
          <input type="number" className={inputCls} value={positionSize} onChange={e => setPositionSize(+e.target.value)} />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className={labelCls}>Fee Bybit</label>
          <input type="number" step="0.00001" className={inputCls} value={feeA} onChange={e => setFeeA(+e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>Fee KuCoin</label>
          <input type="number" step="0.00001" className={inputCls} value={feeB} onChange={e => setFeeB(+e.target.value)} />
        </div>
        <div>
          <label className={labelCls}>Slippage BPS</label>
          <input type="number" className={inputCls} value={slippage} onChange={e => setSlippage(+e.target.value)} />
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-2">
        <button onClick={startBackfill} disabled={backfilling}
          className="flex-1 mono text-xs font-bold px-3 py-2 rounded border cursor-pointer flex items-center justify-center gap-1 bg-accent-blue/10 border-accent-blue/30 text-accent-blue hover:bg-accent-blue/20 disabled:opacity-50">
          <Database size={12} />{backfilling ? 'Fetching...' : 'Backfill Data'}
        </button>
        <button onClick={startBacktest} disabled={running}
          className="flex-1 mono text-xs font-bold px-3 py-2 rounded border cursor-pointer flex items-center justify-center gap-1 bg-accent-green/10 border-accent-green/30 text-accent-green hover:bg-accent-green/20 disabled:opacity-50">
          <Play size={12} />{running ? 'Running...' : 'Run Backtest'}
        </button>
        <button onClick={loadHistory}
          className="px-3 py-2 rounded border cursor-pointer flex items-center justify-center gap-1 bg-white/5 border-border-light text-text-dim hover:text-text-primary">
          <Clock size={12} />
        </button>
      </div>

      {/* Results */}
      {results && (
        <div className="space-y-3">
          {/* Summary Cards */}
          <div className="grid grid-cols-4 gap-2">
            {[
              { label: 'Trades', value: results.totalTrades, icon: BarChart3 },
              { label: 'Win Rate', value: `${(results.winRate * 100).toFixed(1)}%`, icon: TrendingUp },
              { label: 'Total PnL', value: `$${results.totalPnl?.toFixed(2)}`, icon: DollarIcon },
              { label: 'Max DD', value: `${results.maxDrawdown?.toFixed(2)}%`, icon: AlertTriangle },
            ].map((c, i) => (
              <div key={i} className="bg-bg-dark border border-border-light rounded p-2 text-center">
                <c.icon size={12} className="mx-auto mb-1 text-text-dim" />
                <div className="text-[10px] text-text-dim uppercase">{c.label}</div>
                <div className="mono text-sm text-text-primary font-bold">{c.value}</div>
              </div>
            ))}
          </div>

          {/* PnL Breakdown */}
          <div className="bg-bg-dark border border-border-light rounded p-2 mono text-xs">
            <div className="text-text-dim uppercase text-[10px] mb-1 font-semibold">PnL Breakdown</div>
            <div className="flex justify-between"><span className="text-text-dim">Spread PnL</span><span className="text-accent-green">${results.spreadPnl?.toFixed(2)}</span></div>
            <div className="flex justify-between"><span className="text-text-dim">Funding PnL</span><span className="text-accent-green">${results.fundingPnl?.toFixed(2)}</span></div>
            <div className="flex justify-between"><span className="text-text-dim">Fees Paid</span><span className="text-accent-red">-${results.totalFees?.toFixed(2)}</span></div>
            <div className="flex justify-between"><span className="text-text-dim">Profit Factor</span><span>{results.profitFactor?.toFixed(2)}</span></div>
            <div className="flex justify-between"><span className="text-text-dim">Avg Hold</span><span>{results.avgHoldBars?.toFixed(0)} bars</span></div>
          </div>

          {/* Equity Curve */}
          {equityData.length > 0 && (
            <div className="bg-bg-dark border border-border-light rounded p-2">
              <div className="text-text-dim uppercase text-[10px] mb-2 font-semibold">Equity Curve</div>
              <ResponsiveContainer width="100%" height={150}>
                <AreaChart data={equityData}>
                  <defs>
                    <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#22c55e" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="#22c55e" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="timestamp" tick={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: '#666' }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ background: '#1a1a1a', border: '1px solid #333', fontSize: 11 }} labelStyle={{ color: '#999' }} />
                  <Area type="monotone" dataKey="equity" stroke="#22c55e" fill="url(#eqGrad)" strokeWidth={1.5} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Pair Breakdown */}
          {results.pairBreakdown && Object.keys(results.pairBreakdown).length > 0 && (
            <div className="bg-bg-dark border border-border-light rounded p-2">
              <div className="text-text-dim uppercase text-[10px] mb-2 font-semibold">Pair Breakdown</div>
              <table className="w-full mono text-xs">
                <thead><tr className="text-text-dim border-b border-border-light">
                  <th className="text-left py-1">Pair</th><th className="text-right py-1">Trades</th><th className="text-right py-1">Win%</th><th className="text-right py-1">PnL</th>
                </tr></thead>
                <tbody>
                  {Object.entries(results.pairBreakdown).sort((a, b) => b[1].pnl - a[1].pnl).map(([sym, d]) => (
                    <tr key={sym} className="border-b border-border-light/50">
                      <td className="py-1">{sym}</td>
                      <td className="text-right py-1">{d.trades}</td>
                      <td className="text-right py-1">{(d.winRate * 100).toFixed(0)}%</td>
                      <td className={`text-right py-1 ${d.pnl >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>${d.pnl.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Recent Trades */}
          {results.trades?.length > 0 && (
            <div className="bg-bg-dark border border-border-light rounded p-2">
              <div className="text-text-dim uppercase text-[10px] mb-2 font-semibold">Recent Trades</div>
              <div className="max-h-40 overflow-auto">
                <table className="w-full mono text-[10px]">
                  <thead><tr className="text-text-dim border-b border-border-light">
                    <th className="text-left py-1">Pair</th><th className="text-right py-1">Entry</th><th className="text-right py-1">Exit</th><th className="text-right py-1">Spread</th><th className="text-right py-1">Funding</th><th className="text-right py-1">Fees</th><th className="text-right py-1">Total</th>
                  </tr></thead>
                  <tbody>
                    {results.trades.slice(0, 50).map((t, i) => (
                      <tr key={i} className="border-b border-border-light/50">
                        <td className="py-0.5">{t.symbol}</td>
                        <td className="text-right">{new Date(t.entryAt).toLocaleDateString()}</td>
                        <td className="text-right">{new Date(t.exitAt).toLocaleDateString()}</td>
                        <td className="text-right">${t.spreadPnl.toFixed(2)}</td>
                        <td className="text-right">${t.fundingPnl.toFixed(2)}</td>
                        <td className="text-right text-accent-red">-${t.feesPaid.toFixed(2)}</td>
                        <td className={`text-right font-bold ${t.totalPnl >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>${t.totalPnl.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* History */}
      {history.length > 0 && (
        <div className="bg-bg-dark border border-border-light rounded p-2">
          <div className="text-text-dim uppercase text-[10px] mb-2 font-semibold">Previous Runs</div>
          <div className="max-h-32 overflow-auto">
            {history.map(r => (
              <div key={r.id} className="flex items-center justify-between py-1 border-b border-border-light/50 mono text-[10px]">
                <span className="text-text-dim">{new Date(r.createdAt).toLocaleString()}</span>
                <span className={r.status === 'completed' ? 'text-accent-green' : r.status === 'failed' ? 'text-accent-red' : 'text-accent-amber'}>{r.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function DollarIcon(props) {
  return <span {...props}>$</span>;
}