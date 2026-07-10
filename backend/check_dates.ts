import prisma from './src/db/client.js';

(async()=>{
  const bybit = await prisma.historicalCandle.findMany({
    where: { symbol: 'BTCUSDT', exchange: 'bybit', interval: '5m' },
    orderBy: { timestamp: 'desc' },
    take: 5
  });
  console.log('Bybit latest:', bybit.map(b => ({ close: b.close, ts: b.timestamp.toISOString() })));
  const kucoin = await prisma.historicalCandle.findMany({
    where: { symbol: 'BTCUSDT', exchange: 'kucoin', interval: '5m' },
    orderBy: { timestamp: 'desc' },
    take: 5
  });
  console.log('KuCoin latest:', kucoin.map(b => ({ close: b.close, ts: b.timestamp.toISOString() })));
  
  // Check date ranges
  const bybitAll = await prisma.historicalCandle.findMany({
    where: { symbol: 'BTCUSDT', exchange: 'bybit', interval: '5m' },
    orderBy: { timestamp: 'asc' }
  });
  console.log('Bybit range:', bybitAll[0].timestamp.toISOString(), '->', bybitAll[bybitAll.length-1].timestamp.toISOString(), 'count:', bybitAll.length);
  
  const kucoinAll = await prisma.historicalCandle.findMany({
    where: { symbol: 'BTCUSDT', exchange: 'kucoin', interval: '5m' },
    orderBy: { timestamp: 'asc' }
  });
  console.log('KuCoin range:', kucoinAll[0].timestamp.toISOString(), '->', kucoinAll[kucoinAll.length-1].timestamp.toISOString(), 'count:', kucoinAll.length);
  
  await prisma.$disconnect();
  process.exit(0);
})();