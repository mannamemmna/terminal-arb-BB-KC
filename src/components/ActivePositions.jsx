import { useTerminal } from '../store/useStore';

function PnLBadge({ pnl }) {
  return <span className={`mono tnum font-bold text-xs ${pnl >= 0 ? 'text-accent-green' : 'text-accent-red'}`}>{pnl >= 0 ? '+' : ''}$${parseFloat(pnl || 0).toFixed(2)}</span>;
}

export default function ActivePositions() {
  const { positions, closePosition } = useTerminal();

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-wider text-text-primary">Active Positions</span>
          {positions.length > 0 && (
            <span className="mono text-[10px] text-accent-amber bg-accent-amber/10 px-1.5 py-0.5 rounded font-bold">{positions.length} open</span>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        {positions.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <div className="text-text-dim text-2xl mb-1">⏸</div>
              <div className="mono text-xs text-text-dim uppercase tracking-wider">No Open Positions</div>
              <div className="text-[10px] text-text-dim mt-1">Waiting for arbitrage signals...</div>
            </div>
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-bg-panel z-10">
              <tr className="text-[10px] text-text-dim uppercase tracking-wider border-b border-border">
                <th className="text-left px-3 py-1.5 font-semibold">SYM</th>
                <th className="text-center px-2 py-1.5 font-semibold">BYBIT</th>
                <th className="text-center px-2 py-1.5 font-semibold">KUCOIN</th>
                <th className="text-right px-2 py-1.5 font-semibold">ENTRY SPREAD</th>
                <th className="text-right px-2 py-1.5 font-semibold">CURR SPREAD</th>
                <th className="text-right px-2 py-1.5 font-semibold">PnL</th>
                <th className="text-right px-2 py-1.5 font-semibold">SIZE</th>
                <th className="text-center px-2 py-1.5 font-semibold"></th>
              </tr>
            </thead>
            <tbody>
              {positions.map((pos) => (
                <tr key={pos.id || pos.symbol} className="border-b border-border/50 hover:bg-white/[0.02]">
                  <td className="px-3 py-1.5">
                    <span className="mono font-bold text-xs text-text-primary">{pos.symbol}</span>
                    <span className="mono text-[9px] text-text-dim ml-1">{pos.mode || ''}</span>
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <span className={`mono text-[10px] font-bold px-1.5 py-0.5 rounded ${pos.legASide === 'LONG' ? 'text-accent-green bg-accent-green/10' : 'text-accent-red bg-accent-red/10'}`}>{pos.legASide}</span>
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <span className={`mono text-[10px] font-bold px-1.5 py-0.5 rounded ${pos.legBSide === 'LONG' ? 'text-accent-green bg-accent-green/10' : 'text-accent-red bg-accent-red/10'}`}>{pos.legBSide}</span>
                  </td>
                  <td className="px-2 py-1.5 mono tnum text-right text-text-secondary">{parseFloat(pos.entrySpread || 0).toFixed(4)}%</td>
                  <td className={`px-2 py-1.5 mono tnum text-right ${(pos.currentSpread || 0) > (pos.entrySpread || 0) ? 'text-accent-green' : 'text-accent-red'}`}>{parseFloat(pos.currentSpread || 0).toFixed(4)}%</td>
                  <td className="px-2 py-1.5 text-right"><PnLBadge pnl={pos.unrealizedPnl} /></td>
                  <td className="px-2 py-1.5 mono tnum text-right text-text-dim">{parseFloat(pos.size || 0).toFixed(4)}</td>
                  <td className="px-2 py-1.5 text-center">
                    <button onClick={() => closePosition(pos.id)} className="mono text-[9px] uppercase text-accent-red hover:text-accent-red/80 px-1.5 py-0.5 rounded border border-accent-red/30 hover:bg-accent-red/5 cursor-pointer">Close</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
