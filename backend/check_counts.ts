import prisma from './src/db/client.js';

async function main() {
  const candles = await prisma.historicalCandle.groupBy({ by: ['exchange','symbol','interval'], _count: { id: true }});
  const fund = await prisma.historicalFunding.groupBy({ by: ['exchange','symbol'], _count: { id: true }});
  console.log(JSON.stringify({candles, fund}, null, 2));
  await prisma.$disconnect();
}
main().catch(async e => { console.error(e); await prisma.$disconnect(); process.exit(1); });
