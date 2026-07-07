# Spread Arb Terminal

Real-time **Perpetual Futures spread arbitrage scanner** for **Bybit vs KuCoin**.
Monitors cross-exchange price & funding rate differences, detects arbitrage opportunities,
and supports automated hedged execution with full safety controls.

> **⚠️ WARNING**: This tool can execute real trades. Always start in DEMO mode.
> LIVE mode requires explicit `CONFIRM LIVE` confirmation.

---

## 🖼️ Overview

| Phase | Component | Status |
|-------|-----------|--------|
| 1 | React + Vite + Tailwind UI (dark terminal dashboard) | ✅ |
| 2 | Backend data engine: Bybit & KuCoin market data, spread calc, WS push | ✅ |
| 3 | Order execution: hedged two-leg entry, position monitor, kill-switch | ✅ |
| 4 | Hardening: responsive UI, full-pair scanning, WS sharding, access control | ✅ |

---

## 🚀 Quick Start

### Prerequisites
- Node.js ≥ 18
- npm

### 1. Backend

```bash
cd backend
cp .env.example .env
# Edit .env — fill in API keys if you want trading (optional for demo)
npm install
npx prisma generate && npx prisma db push
npm run dev
```

The backend starts on **http://localhost:3001** with:
- REST API at `/api/*`
- WebSocket at `/ws`
- Auto-discovery of all trading pairs on Bybit & KuCoin
- 531+ matched pairs scanned in real-time

### 2. Frontend

```bash
# Terminal 2
npm install
npm run dev
```

Frontend starts on **http://localhost:5173** with Vite proxy → backend at :3001.

---

## 📁 Project Structure

```
root/
├── backend/                         # TypeScript backend
│   ├── src/
│   │   ├── index.ts                 # Entry point
│   │   ├── config/
│   │   │   ├── index.ts             # Env config loader
│   │   │   ├── thresholds.ts        # Spread threshold defaults
│   │   │   └── auth.ts              # Password auth service
│   │   ├── connectors/
│   │   │   ├── types.ts             # Interfaces (ExchangeConnector, ExchangeTrader)
│   │   │   ├── bybit.connector.ts   # Bybit market data WS + REST
│   │   │   ├── bybit.trader.ts      # Bybit order execution (HMAC-signed)
│   │   │   ├── kucoin.connector.ts  # KuCoin market data REST
│   │   │   └── kucoin.trader.ts     # KuCoin order execution (HMAC-signed)
│   │   ├── engine/
│   │   │   ├── symbolMapper.ts      # Symbol map (20 standard pairs)
│   │   │   ├── spreadCalculator.ts  # Spread calc + market state + signal gen
│   │   │   ├── pairDiscovery.ts     # Auto-detect all exchange pairs
│   │   │   ├── positionManager.ts   # Sizing & risk management
│   │   │   ├── executionOrchestrator.ts  # Two-leg atomic entry + rollback
│   │   │   ├── positionMonitor.ts   # Background position loop (TP/SL/max hold)
│   │   │   └── killSwitch.ts        # Pause / emergency close-all
│   │   ├── ws/
│   │   │   ├── server.ts            # Frontend WS broadcast
│   │   │   └── connectionPool.ts    # Multi-shard WS pool per exchange
│   │   ├── db/
│   │   │   └── client.ts            # Prisma singleton
│   │   └── api/routes/
│   │       ├── pairs.ts, spreads.ts, history.ts, trades.ts (public)
│   │       ├── config.ts, health.ts, mode.ts, killSwitch.ts (protected)
│   │       ├── account.ts, orders.ts, positions.ts (protected)
│   │       ├── auth.ts, wsHealth.ts, mode.ts
│   ├── prisma/schema.prisma         # Config, Signal, Trade, Position, Order
│   └── .env.example
├── src/                             # React frontend
│   ├── components/
│   │   ├── Header.jsx               # Status bar + mode toggle + kill-switch
│   │   ├── SpreadScanner.jsx        # Live spread table (responsive columns)
│   │   ├── EquityCurve.jsx          # Recharts PnL chart
│   │   ├── ActivePositions.jsx      # Open positions with close button
│   │   ├── SignalFeed.jsx           # Live reasoning log (ring buffer 500)
│   │   ├── TradeHistory.jsx         # Entry/exit history with filter
│   │   └── SettingsDrawer.jsx       # Config + auth login modal
│   ├── store/useStore.jsx            # Context + WS connect + state
│   └── data/mockData.js              # Fallback mock data generator
└── vite.config.js
```

---

## 🌐 Architecture

```
┌─────────┐     Bybit WS (3 shards)      ┌────────────────┐
│  Bybit  │◄══════════════════════════════│                │
│ Exchange│     KuCoin WS (7 shards)      │  Backend (:3001)│
│         │◄══════════════════════════════│  Express + WS  │
└─────────┘                               │                │
                                          │ SpreadCalculator│
┌─────────┐     Bybit REST (fallback)    │ PairDiscovery  │
│  KuCoin │◄══════════════════════════════│ KillSwitch     │
│ Exchange│     KuCoin REST (fallback)    │ PositionMonitor│
└─────────┘◄══════════════════════════════│ ExecutionOrch  │
         └───────┬────────┬───────┘
                 │        │
            REST API   WebSocket
            :3001/api  /ws
                 │        │
            ┌────▼────────▼──┐
            │  Frontend (:5173)  │
            │  React + Vite     │
            │  Tailwind CSS     │
            └──────────────────┘
```

---

## 🔌 API Endpoints

### Public (no auth needed)
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/health` | Server status, exchange connections, symbol count |
| GET | `/api/ws-health` | Per-shard WebSocket connection details |
| GET | `/api/spreads` | All computed spreads (sorted by spread %) |
| GET | `/api/spreads/:symbol` | Single symbol spread + snapshot |
| GET | `/api/pairs` | Available pairs on both exchanges |
| GET | `/api/history/:symbol` | Historical signals for a symbol |
| GET | `/api/trades` | Trade history |
| GET | `/api/auth/status` | Check if authenticated |

### Protected (requires auth — set SETTINGS_PASSWORD)
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/login` | Login with password |
| POST | `/api/auth/logout` | Logout |
| GET/POST | `/api/config` | Read/update spread threshold |
| GET/POST | `/api/mode` | Read/switch demo/live mode |
| GET/POST | `/api/kill-switch` | Pause/resume/close-all |
| GET | `/api/account/:exchange` | Balance & positions per exchange |
| GET | `/api/orders` | Audit log of all order attempts |
| GET/POST | `/api/positions` | Position list / manual close |

---

## 🛡️ Trading Controls

### Modes
- **DEMO** (default) — uses testnet/sandbox API endpoints. Safe for testing.
- **LIVE** — uses mainnet. Requires typing `CONFIRM LIVE` explicitly.

### Kill-Switch
- **Pause** — stop new entries, monitor existing positions
- **Resume** — re-enable entries
- **Close All** — emergency close of ALL open positions immediately
- Auto-triggers on: exchange disconnect > 30s, excessive drawdown

### Position Monitor (every 5s)
- Updates unrealized PnL & current spread
- Auto-exit on: take-profit, stop-loss, mean reversion, max hold time (30min)

---

## 📊 Spread Calculation

```
spreadPct = |bybitPrice - kucoinPrice| / avgPrice × 100
fundingDiff = fundingBybit - fundingKucoin
```

**Verdict:**
- `SAFE` → spread > threshold **AND** |fundingDiff| > minFundingDiff
- `WATCH` → spread > 60% of threshold
- `SKIP` → below thresholds

---

## 🔐 Security

- API keys NEVER sent to frontend — all signing happens server-side
- Settings password is HMAC-SHA256 hashed, stored only as hash
- Session tokens are httpOnly cookies (not localStorage)
- Login rate-limited: 5 attempts per 15 minutes per IP
- CORS restricted to configured origin

---

## 📦 Dependencies

**Backend:** express, ws, prisma, dotenv, cors, cookie-parser, typescript, tsx  
**Frontend:** react, recharts, tailwindcss, vite
