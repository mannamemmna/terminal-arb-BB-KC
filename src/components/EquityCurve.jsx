import { useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer, Tooltip, Area, AreaChart, CartesianGrid } from 'recharts';
import { useTerminal } from '../store/useStore';

function formatTime(ts) {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const val = payload[0].value;
  return (
    <div className="bg-bg-panel border border-border-light rounded px-2.5 py-1.5 shadow-lg">
      <div className="text-[10px] text-text-dim mono tnum">{formatTime(payload[0].payload.time)}</div>
      <div className={`text-xs mono tnum font-bold ${val >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
        {val >= 0 ? '+' : ''}${val.toFixed(2)}
      </div>
    </div>
  );
}

export default function EquityCurve() {
  const { equityCurve, status } = useTerminal();

  const currentPnl = equityCurve.length > 0 ? equityCurve[equityCurve.length - 1].pnl : 0;
  const currentPnlPct = equityCurve.length > 0 ? equityCurve[equityCurve.length - 1].pnlPct : 0;

  // Only show last 60 points for chart
  const chartData = useMemo(() => {
    return equityCurve.slice(-60).map(d => ({
      time: d.time,
      pnl: d.pnl,
    }));
  }, [equityCurve]);

  const isPositive = currentPnl >= 0;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <span className="text-xs font-bold uppercase tracking-wider text-text-primary">Equity Curve</span>
        <div className="flex items-center gap-3">
          <div className="mono tnum text-right">
            <span className="text-[10px] text-text-dim block">PnL</span>
            <span className={`text-sm font-bold ${isPositive ? 'text-accent-green' : 'text-accent-red'}`}>
              {currentPnl >= 0 ? '+' : ''}${currentPnl.toFixed(2)}
            </span>
          </div>
          <div className="mono tnum text-right">
            <span className="text-[10px] text-text-dim block">%</span>
            <span className={`text-sm font-bold ${isPositive ? 'text-accent-green' : 'text-accent-red'}`}>
              {currentPnlPct >= 0 ? '+' : ''}{currentPnlPct.toFixed(2)}%
            </span>
          </div>
        </div>
      </div>

      {/* Chart */}
      <div className="flex-1 min-h-0">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={chartData} margin={{ top: 8, right: 8, left: 4, bottom: 4 }}>
            <defs>
              <linearGradient id="pnlGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#22c55e" stopOpacity={0.15} />
                <stop offset="100%" stopColor="#22c55e" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="2 2" stroke="#1f2937" strokeWidth={0.5} />
            <XAxis
              dataKey="time"
              tickFormatter={formatTime}
              stroke="#4b5563"
              tick={{ fontSize: 9, fontFamily: 'monospace' }}
              tickLine={false}
              axisLine={false}
              minTickGap={40}
            />
            <YAxis
              domain={['dataMin - 10', 'dataMax + 10']}
              stroke="#4b5563"
              tick={{ fontSize: 9, fontFamily: 'monospace' }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => `$${v.toFixed(0)}`}
              width={50}
            />
            <Tooltip content={<CustomTooltip />} />
            <Area
              type="monotone"
              dataKey="pnl"
              stroke="#22c55e"
              strokeWidth={1.5}
              fill="url(#pnlGradient)"
              dot={false}
              activeDot={{ r: 3, fill: '#22c55e', stroke: '#0a0a0a', strokeWidth: 1 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
