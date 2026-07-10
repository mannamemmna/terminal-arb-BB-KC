import prisma from './src/db/client.js';

(async()=>{
  const bars = await prisma.historicalCandle.findMany({
    where: { symbol: 'BTCUSDT', exchange: 'bybit', interval: '5m' },
    orderBy: { timestamp: 'asc' },
    take: 10
  });
  console.log('Bybit first:', bars[0].close, bars[0].timestamp.toISOString());
  const bars2 = await prisma.historicalCandle.findMany({
    where: { symbol: 'BTCUSDT', exchange: 'kucoin', interval: '5m' },
    orderBy: { timestamp: 'asc' },
    take: 10
  });
  console.log('KuCoin first:', bars2[0].close, bars2[0].timestamp.toISOString());
  for (let i=0; i<Math.min(bars.length, bars2.length); i++) {
    const a = bars[i].close;
    const b = bars2[i].close;
    const spread = Math.abs(a-b)/((a+b)/2)*100;
    if (spread > 0.01) console.log('Spread > 0.01%:', spread.toFixed(4)+'%', bars[i].timestamp.toISOString());
  }
  await prisma.$disconnect();
  process.exit(0);
})();