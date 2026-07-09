import { Router, type Request, type Response } from 'express';
import { runBacktest } from '../../backtest/backtestEngine.js';
import { backfillHistoricalData } from '../../backtest/historicalFetcher.js';
import prisma from '../../db/client.js';

const activeRuns = new Map<string, { status: string }>();

export function createBacktestRouter() {
  const router = Router();

  // List all backtest runs
  router.get('/', async (_req: Request, res: Response) => {
    const runs = await prisma.backtestRun.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    res.json({ runs });
  });

  // Start data backfill
  router.post('/backfill', async (req: Request, res: Response) => {
    const { pairs, startDate, endDate, interval } = req.body || {};
    if (!pairs?.length || !startDate || !endDate) {
      res.status(400).json({ error: 'pairs[], startDate, endDate required' });
      return;
    }
    const intervals = [interval || '5m'];
    backfillHistoricalData(pairs, intervals, new Date(startDate), new Date(endDate))
      .catch(() => {});
    res.json({ ok: true, message: `Backfill started for ${pairs.length} pairs` });
  });

  // Start a backtest
  router.post('/run', async (req: Request, res: Response) => {
    const params = req.body;
    if (!params?.pairs?.length || !params?.startDate || !params?.endDate) {
      res.status(400).json({ error: 'pairs[], startDate, endDate required' });
      return;
    }
    const run = await prisma.backtestRun.create({
      data: { status: 'running', paramsJson: JSON.stringify(params) },
    });
    activeRuns.set(run.id, { status: 'running' });

    runBacktest(params).then(async (result) => {
      await prisma.backtestRun.update({
        where: { id: run.id },
        data: {
          status: 'completed',
          resultsJson: JSON.stringify(result),
          equityCurveJson: JSON.stringify(result.equityCurve),
        },
      });
      activeRuns.set(run.id, { status: 'completed' });
    }).catch(async (err: Error) => {
      await prisma.backtestRun.update({
        where: { id: run.id },
        data: { status: 'failed', resultsJson: JSON.stringify({ error: err.message }) },
      });
      activeRuns.set(run.id, { status: 'failed' });
    });

    res.json({ runId: run.id, status: 'running' });
  });

  // Get run status & results
  router.get('/:runId', async (req: Request, res: Response) => {
    const run = await prisma.backtestRun.findUnique({ where: { id: (req.params.runId as string) } });
    if (!run) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }
    res.json({
      id: run.id,
      status: run.status,
      params: JSON.parse(run.paramsJson),
      results: run.resultsJson ? JSON.parse(run.resultsJson) : null,
      equityCurve: run.equityCurveJson ? JSON.parse(run.equityCurveJson) : null,
      createdAt: run.createdAt,
    });
  });

  return router;
}
