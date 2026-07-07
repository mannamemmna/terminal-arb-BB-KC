import { useEffect, useRef, useState } from 'react';
import { useTerminal } from '../store/useStore';

function formatTime(date) {
  const d = new Date(date);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
}

export default function SignalFeed() {
  const { logs, config, updateConfig } = useTerminal();
  const feedRef = useRef(null);
  const [atBottom, setAtBottom] = useState(true);

  // Auto-scroll to bottom
  useEffect(() => {
    if (config.feedAutoScroll && feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [logs, config.feedAutoScroll]);

  const handleScroll = () => {
    if (!feedRef.current) return;
    const el = feedRef.current;
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setAtBottom(isAtBottom);
    // If user scrolls up, disable auto-scroll; if they scroll back to bottom, re-enable
    if (!isAtBottom && config.feedAutoScroll) {
      updateConfig({ feedAutoScroll: false });
    }
  };

  const toggleAutoScroll = () => {
    updateConfig({ feedAutoScroll: !config.feedAutoScroll });
    if (!config.feedAutoScroll) {
      // Re-enable — scroll to bottom
      setTimeout(() => {
        if (feedRef.current) {
          feedRef.current.scrollTop = feedRef.current.scrollHeight;
        }
      }, 50);
    }
  };

  // Show last 200 entries max
  const visibleLogs = logs.slice(-200);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-wider text-text-primary">Signal Feed</span>
          <span className="w-1.5 h-1.5 rounded-full bg-accent-green pulse-dot" />
          <span className="mono text-[10px] text-accent-green font-bold uppercase">Live</span>
        </div>
        <button
          onClick={toggleAutoScroll}
          className={`mono text-[9px] uppercase tracking-wider px-2 py-0.5 rounded border transition-colors cursor-pointer
            ${config.feedAutoScroll
              ? 'text-accent-blue border-accent-blue/40 bg-accent-blue/5'
              : 'text-text-dim border-border-light bg-transparent'
            }`}
        >
          {config.feedAutoScroll ? '⏬ AUTO-SCROLL ON' : '⏸ AUTO-SCROLL OFF'}
        </button>
      </div>

      {/* Feed */}
      <div
        ref={feedRef}
        onScroll={handleScroll}
        className="flex-1 overflow-auto px-2 py-1 feed-container"
      >
        {visibleLogs.map((entry) => (
          <div key={entry.id} className="flex items-start gap-2 py-[1px] hover:bg-white/[0.02] rounded px-1">
            <span className="mono text-[10px] text-text-dim shrink-0 w-16 tnum">
              {formatTime(entry.time)}
            </span>
            <span className="mono text-[11px] text-text-primary leading-4">
              {entry.message}
            </span>
          </div>
        ))}
      </div>

      {/* Footer — count */}
      <div className="border-t border-border px-3 py-1 shrink-0 flex items-center justify-between">
        <span className="mono text-[9px] text-text-dim">{logs.length} entries (ring buffer 500)</span>
      </div>
    </div>
  );
}
