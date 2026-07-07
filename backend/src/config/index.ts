import 'dotenv/config';

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',

  bybit: {
    wsUrl: process.env.BYBIT_WS_URL || 'wss://stream.bybit.com/v5/public/linear',
    restUrl: process.env.BYBIT_REST_URL || 'https://api.bybit.com',
  },

  kucoin: {
    restUrl: process.env.KUCOIN_REST_URL || 'https://api-futures.kucoin.com',
  },

  health: {
    restPollIntervalMs: 5000,
    wsReconnectBaseMs: 1000,
    wsReconnectMaxMs: 30000,
  },
};
