import { useState } from 'react';
import { useTerminal } from '../store/useStore';

function VerdictBadge({ verdict }) {
  const styles = { SAFE: 'text-accent-green bg-accent-green/10 border-accent-green/30', WATCH: 'text-accent-amber bg-accent-amber/10 border-accent-amber/30', SKIP: 'text-text-dim bg-transparent border-border-light' };
  return <span className={`mono text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border ${styles[verdict] || styles.SKIP}`}>{verdict}</span>;
}

function formatPrice(p, s) { if (p > 1000) return p.toFixed(2); if (p > 1) return p.toFixed(4); if (p > 0.01) return p.toFixed(5); return p.toFixed(6); }

function formatVolume(v) { if (v >= 1_000_000_000) return `${(v/1_000_000_000).toFixed(1)}B`; if (v >= 1_000_000) return `${(v/1_000_000).toFixed(1)}M`; if (v >= 1_000) return `${(v/1_000).toFixed(1)}K`; return v.toString(); }

export default function SpreadScanner() {
  const { spreads, config, setSelectedSymbol, selectedSymbol } = useTerminal();
  const [expandedRow, setExpandedRow] = useState(null);
  const filtered = config.watchedPairs.length > 0
    ? spreads.filter(s => config.watchedPairs.includes(s.symbol))
    : spreads; // empty = show all

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-2 sm:px-3 py-1.5 sm:py-2 border-b border-border shrink-0">
        <div className="flex items-center gap-1.5 sm:gap-2">
          <span className="text-[11px] sm:text-xs font-bold uppercase tracking-wider text-text-primary truncate">Scanner</span>
          <span className="mono text-[9px] sm:text-[10px] text-text-dim bg-bg-dark px-1.5 py-0.5 rounded">{filtered.length}p</span>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full text-[10px] sm:text-xs">
          <thead className="sticky top-0 bg-bg-panel z-10">
            <tr className="text-[8px] sm:text-[10px] text-text-dim uppercase tracking-wider border-b border-border">
              <th className="text-left px-1.5 sm:px-3 py-1 font-semibold">SYM</th>
              {/* Desktop columns */}
              <th className="text-right px-1 sm:px-2 py-1 font-semibold hidden sm:table-cell">BYBIT</th>
              <th className="text-right px-1 sm:px-2 py-1 font-semibold hidden sm:table-cell">KUCOIN</th>
              <th className="text-right px-1 sm:px-2 py-1 font-semibold">SPRD%</th>
              <th className="text-right px-1 sm:px-2 py-1 font-semibold hidden md:table-cell">SPRD$</th>
              <th className="text-right px-1 sm:px-2 py-1 font-semibold hidden lg:table-cell">BYBIT F</th>
              <th className="text-right px-1 sm:px-2 py-1 font-semibold hidden lg:table-cell">KUCOIN F</th>
              <th className="text-right px-1 sm:px-2 py-1 font-semibold hidden xl:table-cell">F DIFF</th>
              <th className="text-right px-1 sm:px-2 py-1 font-semibold hidden xl:table-cell">VOL</th>
              <th className="text-center px-1 sm:px-2 py-1 font-semibold">V</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => {
              const isExpanded = expandedRow === row.symbol;
              return (
                <>
                  <tr key={row.symbol} onClick={() => setExpandedRow(isExpanded ? null : row.symbol)} className={`clickable cursor-pointer border-b border-border/50 transition-colors ${row.verdict === 'SAFE' ? 'bg-accent-green/[0.02]' : ''}`}>
                    <td className="px-1.5 sm:px-3 py-1.5"><span className="mono font-bold text-[10px] sm:text-xs text-text-primary">{row.symbol.replace('USDT', '')}</span></td>
                    <td className="px-1 sm:px-2 py-1.5 mono tnum text-right text-text-secondary hidden sm:table-cell">${formatPrice(row.bybitPrice, row.symbol)}</td>
                    <td className="px-1 sm:px-2 py-1.5 mono tnum text-right text-text-secondary hidden sm:table-cell">${formatPrice(row.kucoinPrice, row.symbol)}</td>
                    <td className={`px-1 sm:px-2 py-1.5 mono tnum text-right font-bold ${Math.abs(row.spreadPct) > 0.5 ? 'text-accent-green' : Math.abs(row.spreadPct) > 0.2 ? 'text-accent-amber' : 'text-text-primary'}`}>{row.spreadPct >= 0 ? '+' : ''}{row.spreadPct.toFixed(4)}%</td>
                    <td className="px-1 sm:px-2 py-1.5 mono tnum text-right text-text-dim hidden md:table-cell">${row.spreadPrice.toFixed(2)}</td>
                    <td className="px-1 sm:px-2 py-1.5 mono tnum text-right text-text-dim hidden lg:table-cell">{row.fundingBybit > 0 ? '+' : ''}{row.fundingBybit.toFixed(4)}</td>
                    <td className="px-1 sm:px-2 py-1.5 mono tnum text-right text-text-dim hidden lg:table-cell">{row.fundingKucoin > 0 ? '+' : ''}{row.fundingKucoin.toFixed(4)}</td>
                    <td className={`px-1 sm:px-2 py-1.5 mono tnum text-right hidden xl:table-cell ${Math.abs(row.fundingDiff) > 0.01 ? 'text-accent-amber' : 'text-text-dim'}`}>{row.fundingDiff >= 0 ? '+' : ''}{row.fundingDiff.toFixed(4)}</td>
                    <td className="px-1 sm:px-2 py-1.5 mono tnum text-right text-text-dim hidden xl:table-cell">${formatVolume(row.volume24h)}</td>
                    <td className="px-1 sm:px-2 py-1.5 text-center"><VerdictBadge verdict={row.verdict} /></td>
                  </tr>
                  {/* Mobile expanded detail row */}
                  {isExpanded && (
                    <tr className="bg-bg-dark/50 sm:hidden">
                      <td colSpan="4" className="px-3 py-2">
                        <div className="text-[10px] space-y-1">
                          <div className="flex justify-between"><span className="text-text-dim">Bybit:</span><span className="mono tnum text-text-primary">$${formatPrice(row.bybitPrice, row.symbol)}</span></div>
                          <div className="flex justify-between"><span className="text-text-dim">KuCoin:</span><span className="mono tnum text-text-primary">$${formatPrice(row.kucoinPrice, row.symbol)}</span></div>
                          <div className="flex justify-between"><span className="text-text-dim">Spread $:</span><span className="mono tnum text-text-primary">${row.spreadPrice.toFixed(2)}</span></div>
                          <div className="flex justify-between"><span className="text-text-dim">Funding Bybit:</span><span className="mono tnum text-text-dim">{row.fundingBybit.toFixed(4)}%</span></div>
                          <div className="flex justify-between"><span className="text-text-dim">Funding KuCoin:</span><span className="mono tnum text-text-dim">{row.fundingKucoin.toFixed(4)}%</span></div>
                          <div className="flex justify-between"><span className="text-text-dim">Funding Diff:</span><span className={`mono tnum ${Math.abs(row.fundingDiff) > 0.01 ? 'text-accent-amber' : 'text-text-dim'}`}>{row.fundingDiff >= 0 ? '+' : ''}{row.fundingDiff.toFixed(4)}%</span></div>
                          <div className="flex justify-between"><span className="text-text-dim">Volume 24h:</span><span className="mono tnum text-text-dim">${formatVolume(row.volume24h)}</span></div>
                          <div className="flex justify-between border-t border-border pt-1 mt-1">
                            <span className="text-text-dim">Verdict:</span>
                            <VerdictBadge verdict={row.verdict} />
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Desktop detail bar */}
      {selectedSymbol && (() => {
        const row = spreads.find(s => s.symbol === selectedSymbol);
        if (!row) return null;
        return (
          <div className="border-t border-border px-3 py-2 bg-accent-blue/5 shrink-0 hidden sm:block">
            <div className="flex items-center gap-4 text-[11px]">
              <span className="mono font-bold text-accent-blue">{row.symbol}</span>
              <span className="text-text-dim">|</span>
              <span className="text-text-secondary">Spread <span className="mono tnum text-accent-green font-bold">{row.spreadPct.toFixed(4)}%</span></span>
              <span className="text-text-dim">|</span>
              <span className="text-text-secondary">Signal: <span className={`mono tnum font-bold ${row.verdict === 'SAFE' ? 'text-accent-green' : 'text-text-dim'}`}>{row.verdict === 'SAFE' ? 'ACTIONABLE ✓' : row.verdict === 'WATCH' ? 'WATCHING' : 'HOLD'}</span></span>
              {row.verdict === 'SAFE' && <span className="text-text-dim text-[10px]">Direction: {row.fundingDiff > 0 ? 'LONG Bybit / SHORT KuCoin' : 'SHORT Bybit / LONG KuCoin'}</span>}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
