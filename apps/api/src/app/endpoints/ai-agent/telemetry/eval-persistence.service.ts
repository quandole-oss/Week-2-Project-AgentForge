import { PrismaService } from '@ghostfolio/api/services/prisma/prisma.service';

import { Injectable, Logger } from '@nestjs/common';

export interface EvalResultEntry {
  caseId: string;
  category: string;
  passed: boolean;
  durationMs: number;
  toolsCalled: string[];
  assertions: Record<string, unknown>;
}

@Injectable()
export class EvalPersistenceService {
  private readonly logger = new Logger(EvalPersistenceService.name);

  public constructor(private readonly prismaService: PrismaService) {}

  public async saveEvalRun(runId: string, results: EvalResultEntry[]) {
    const data = results.map((r) => ({
      runId,
      caseId: r.caseId,
      category: r.category,
      passed: r.passed,
      durationMs: r.durationMs,
      toolsCalled: r.toolsCalled,
      assertions: JSON.stringify(r.assertions)
    }));

    await this.prismaService.aiAgentEvalResult.createMany({ data });

    const passed = results.filter((r) => r.passed).length;
    const total = results.length;
    const passRate = total > 0 ? ((passed / total) * 100).toFixed(1) : '0';

    this.logger.log(
      JSON.stringify({
        type: 'eval_run_saved',
        runId,
        total,
        passed,
        failed: total - passed,
        passRate: `${passRate}%`,
        timestamp: new Date().toISOString()
      })
    );

    return { runId, total, passed, failed: total - passed, passRate };
  }

  public async getLatestRuns(limit = 10) {
    const runs = await this.prismaService.aiAgentEvalResult.groupBy({
      by: ['runId'],
      _count: { id: true },
      _max: { createdAt: true },
      orderBy: { _max: { createdAt: 'desc' } },
      take: limit
    });

    const results = [];

    for (const run of runs) {
      const cases = await this.prismaService.aiAgentEvalResult.findMany({
        where: { runId: run.runId }
      });

      const passed = cases.filter((c) => c.passed).length;
      const total = cases.length;

      results.push({
        runId: run.runId,
        createdAt: run._max.createdAt,
        total,
        passed,
        failed: total - passed,
        passRate: total > 0 ? (passed / total) * 100 : 0
      });
    }

    return results;
  }

  public async detectRegression(currentRunId: string) {
    const currentResults =
      await this.prismaService.aiAgentEvalResult.findMany({
        where: { runId: currentRunId }
      });

    if (currentResults.length === 0) {
      return { regression: false, message: 'No results for current run' };
    }

    const currentPassRate =
      (currentResults.filter((r) => r.passed).length /
        currentResults.length) *
      100;

    // Get last 5 runs excluding current
    const previousRuns = await this.prismaService.aiAgentEvalResult.groupBy({
      by: ['runId'],
      _max: { createdAt: true },
      where: { runId: { not: currentRunId } },
      orderBy: { _max: { createdAt: 'desc' } },
      take: 5
    });

    if (previousRuns.length === 0) {
      return {
        regression: false,
        message: 'No previous runs to compare against',
        currentPassRate
      };
    }

    let totalPassed = 0;
    let totalCases = 0;

    for (const run of previousRuns) {
      const cases = await this.prismaService.aiAgentEvalResult.findMany({
        where: { runId: run.runId }
      });
      totalPassed += cases.filter((c) => c.passed).length;
      totalCases += cases.length;
    }

    const historicalPassRate =
      totalCases > 0 ? (totalPassed / totalCases) * 100 : 0;
    const drop = historicalPassRate - currentPassRate;
    const regression = drop > 5;

    if (regression) {
      this.logger.warn(
        JSON.stringify({
          type: 'eval_regression_detected',
          currentRunId,
          currentPassRate: `${currentPassRate.toFixed(1)}%`,
          historicalPassRate: `${historicalPassRate.toFixed(1)}%`,
          drop: `${drop.toFixed(1)}%`,
          timestamp: new Date().toISOString()
        })
      );
    }

    return {
      regression,
      currentPassRate,
      historicalPassRate,
      drop: regression ? drop : 0,
      message: regression
        ? `Regression detected: ${drop.toFixed(1)}% drop from historical average`
        : 'No regression detected'
    };
  }
}
