import { backfillHistoricalData } from './src/backtest/historicalFetcher.js';
import prisma from './src/db/client.js';

async function test() {
  await backfillHistoricalData(['BTCUSDT'], ['5m'], new Date('2026-07-01'), new Date('2026-07-03'), 2);
  await prisma.$disconnect();
}
test().catch(console.error);