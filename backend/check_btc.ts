import prisma from './src/db/client.js';

(async()=>{
  const candles = await prisma.historicalCandle.groupBy({ 
    by: ['exchange','symbol','interval'], 
    _count: { id: true },
    where: { symbol: 'BTCUSDT' }
  });
  const fund = await prisma.historicalFunding.groupBy({ 
    by: ['exchange','symbol'], 
    _count: { id: true },
    where: { symbol: 'BTCUSDT' }
  });
  console.log(JSON.stringify({candles, fund}, null, 2));
  await prisma.$disconnect();
})();