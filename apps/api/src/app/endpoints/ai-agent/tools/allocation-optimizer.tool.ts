import { PortfolioService } from '@ghostfolio/api/app/portfolio/portfolio.service';

import { Injectable } from '@nestjs/common';

@Injectable()
export class AllocationOptimizerTool {
  public constructor(
    private readonly portfolioService: PortfolioService
  ) {}

  public async execute({
    impersonationId,
    targetAllocation,
    userId
  }: {
    impersonationId: string;
    targetAllocation: Record<string, number>;
    userId: string;
  }) {
    const details = await this.portfolioService.getDetails({
      impersonationId,
      userId,
      withSummary: true
    });

    const holdings = Object.values(details.holdings);

    // Calculate current allocation by asset class
    const currentAllocation: Record<string, number> = {};
    for (const holding of holdings) {
      const ac = holding.assetClass ?? 'OTHER';
      currentAllocation[ac] =
        (currentAllocation[ac] ?? 0) +
        holding.allocationInPercentage;
    }

    // Convert to percentages for display
    const comparison: {
      assetClass: string;
      currentPercent: number;
      targetPercent: number;
      driftPercent: number;
      driftDirection: 'over' | 'under' | 'on-target';
    }[] = [];

    const allAssetClasses = new Set([
      ...Object.keys(currentAllocation),
      ...Object.keys(targetAllocation)
    ]);

    let totalDrift = 0;

    for (const assetClass of allAssetClasses) {
      const current = (currentAllocation[assetClass] ?? 0) * 100;
      const target = (targetAllocation[assetClass] ?? 0) * 100;
      const drift = current - target;
      totalDrift += Math.abs(drift);

      comparison.push({
        assetClass,
        currentPercent: Math.round(current * 100) / 100,
        targetPercent: Math.round(target * 100) / 100,
        driftPercent: Math.round(drift * 100) / 100,
        driftDirection:
          Math.abs(drift) < 1
            ? 'on-target'
            : drift > 0
              ? 'over'
              : 'under'
      });
    }

    comparison.sort(
      (a, b) => Math.abs(b.driftPercent) - Math.abs(a.driftPercent)
    );

    // Generate rebalance suggestions (text only, no trade orders)
    const suggestions: string[] = [];
    for (const entry of comparison) {
      if (entry.driftDirection === 'over' && entry.driftPercent > 2) {
        suggestions.push(
          `Consider reducing ${entry.assetClass} exposure by ~${entry.driftPercent.toFixed(1)}pp (currently ${entry.currentPercent.toFixed(1)}%, target ${entry.targetPercent.toFixed(1)}%).`
        );
      } else if (
        entry.driftDirection === 'under' &&
        entry.driftPercent < -2
      ) {
        suggestions.push(
          `Consider increasing ${entry.assetClass} exposure by ~${Math.abs(entry.driftPercent).toFixed(1)}pp (currently ${entry.currentPercent.toFixed(1)}%, target ${entry.targetPercent.toFixed(1)}%).`
        );
      }
    }

    return {
      comparison,
      totalDriftPercent: Math.round(totalDrift * 100) / 100,
      isRebalanceNeeded: totalDrift > 5,
      suggestions:
        suggestions.length > 0
          ? suggestions
          : ['Portfolio is well-aligned with target allocation.'],
      holdingsCount: holdings.length,
      totalValueInBaseCurrency:
        details.summary?.currentValueInBaseCurrency ?? null
    };
  }
}
