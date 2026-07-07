import { useState } from 'react';
import { useTerminal } from '../store/useStore';

function PnLBadge({ pnl }) {
  return (
    <span className={`mono tnum font-bold text-xs ${pnl >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>
      {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}
    </span>
  );
}

function StatusBadge({ status }) {
  return (
    <span className={`mono text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${
      status === 'CLOSED' ? 'text-text-dim bg-text-dim/10' : 'text-accent-green bg-accent-green/10'
    }`}>
      {status}
    </span>
  );
}

function formatDateTime(date) {
  const d = new Date(date);
  const month = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  const hours = d.getHours().toString().padStart(2, '0');
  const mins = d.getMinutes().toString().padStart(2, '0');
  return `${month}/${day} ${hours}:${mins}`;
}

export default function TradeHistory() {
  const { tradeHistory } = useTerminal();
  const [filter, setFilter] = useState('ALL');

  const filtered = filter === 'ALL'
    ? tradeHistory
    : tradeHistory.filter(t => t.status === filter);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-wider text-text-primary">Trade History</span>
          <span className="mono text-[10px] text-text-dim bg-bg-dark px-1.5 py-0.5 rounded">
            {filtered.length} entries
          </span>
        </div>

        {/* Filter tabs */}
        <div className="flex items-center gap-1">
          {['ALL', 'OPEN', 'CLOSED'].map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`mono text-[10px] uppercase tracking-wider px-2 py-0.5 rounded border transition-colors cursor-pointer
                ${filter === f
                  ? 'text-accent-blue border-accent-blue/40 bg-accent-blue/5'
                  : 'text-text-dim border-transparent hover:border-border-light'
                }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-text-dim text-xs">No trades found</div>
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-bg-panel z-10">
              <tr className="text-[10px] text-text-dim uppercase tracking-wider border-b border-border">
                <th className="text-left px-3 py-1.5 font-semibold">TIME</th>
                <th className="text-left px-2 py-1.5 font-semibold">SYM</th>
                <th className="text-right px-2 py-1.5 font-semibold">ENTRY SPREAD</th>
                <th className="text-right px-2 py-1.5 font-semibold">EXIT SPREAD</th>
                <th className="text-right px-2 py-1.5 font-semibold">RESULT</th>
                <th className="text-right px-2 py-1.5 font-semibold">PNL</th>
                <th className="text-center px-2 py-1.5 font-semibold">STATUS</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((trade) => {
                const spreadResult = (trade.exitSpread - trade.entrySpread);
                return (
                  <tr key={trade.id} className="border-b border-border/50 hover:bg-white/[0.02]">
                    <td className="px-3 py-1.5 mono tnum text-[10px] text-text-dim">
                      {formatDateTime(trade.time)}
                    </td>
                    <td className="px-2 py-1.5">
                      <span className="mono font-bold text-xs text-text-primary">{trade.symbol}</span>
                    </td>
                    <td className="px-2 py-1.5 mono tnum text-right text-text-secondary">
                      {trade.entrySpread.toFixed(4)}%
                    </td>
                    <td className="px-2 py-1.5 mono tnum text-right text-text-secondary">
                      {trade.exitSpread.toFixed(4)}%
                    </td>
                    <td className={`px-2 py-1.5 mono tnum text-right font-bold text-xs ${
                      spreadResult > 0 ? 'text-accent-green' : spreadResult < 0 ? 'text-accent-red' : 'text-text-dim'
                    }`}>
                      {spreadResult >= 0 ? '+' : ''}{spreadResult.toFixed(4)}%
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <PnLBadge pnl={trade.pnl} />
                    </td>
                    <td className="px-2 py-1.5 text-center">
                      <StatusBadge status={trade.status} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
