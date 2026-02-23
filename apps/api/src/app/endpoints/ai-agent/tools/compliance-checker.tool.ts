import { PortfolioService } from '@ghostfolio/api/app/portfolio/portfolio.service';

import { Injectable } from '@nestjs/common';

interface ComplianceViolation {
  rule: string;
  severity: 'warning' | 'violation';
  description: string;
  affectedPositions: string[];
  value?: number;
  threshold?: number;
}

@Injectable()
export class ComplianceCheckerTool {
  public constructor(
    private readonly portfolioService: PortfolioService
  ) {}

  public async execute({
    impersonationId,
    ruleSet = ['concentration', 'diversification', 'currency'],
    userId
  }: {
    impersonationId: string;
    ruleSet?: string[];
    userId: string;
  }) {
    const details = await this.portfolioService.getDetails({
      impersonationId,
      userId,
      withSummary: true
    });

    const holdings = Object.values(details.holdings);
    const violations: ComplianceViolation[] = [];

    if (ruleSet.includes('concentration')) {
      for (const holding of holdings) {
        if (holding.allocationInPercentage > 0.25) {
          violations.push({
            rule: 'Single Position Concentration',
            severity: 'violation',
            description: `${holding.name} represents ${(holding.allocationInPercentage * 100).toFixed(1)}% of the portfolio, exceeding the 25% single-position limit.`,
            affectedPositions: [holding.symbol],
            value: holding.allocationInPercentage,
            threshold: 0.25
          });
        } else if (holding.allocationInPercentage > 0.15) {
          violations.push({
            rule: 'Single Position Concentration',
            severity: 'warning',
            description: `${holding.name} represents ${(holding.allocationInPercentage * 100).toFixed(1)}% of the portfolio, approaching the 25% concentration limit.`,
            affectedPositions: [holding.symbol],
            value: holding.allocationInPercentage,
            threshold: 0.25
          });
        }
      }
    }

    if (ruleSet.includes('diversification')) {
      const assetClassAllocation: Record<string, number> = {};
      for (const holding of holdings) {
        const ac = holding.assetClass ?? 'UNKNOWN';
        assetClassAllocation[ac] =
          (assetClassAllocation[ac] ?? 0) +
          holding.allocationInPercentage;
      }

      for (const [assetClass, allocation] of Object.entries(
        assetClassAllocation
      )) {
        if (allocation > 0.8) {
          violations.push({
            rule: 'Asset Class Diversification',
            severity: 'violation',
            description: `${assetClass} represents ${(allocation * 100).toFixed(1)}% of the portfolio. Consider diversifying across asset classes.`,
            affectedPositions: holdings
              .filter((h) => (h.assetClass ?? 'UNKNOWN') === assetClass)
              .map((h) => h.symbol),
            value: allocation,
            threshold: 0.8
          });
        } else if (allocation > 0.6) {
          violations.push({
            rule: 'Asset Class Diversification',
            severity: 'warning',
            description: `${assetClass} represents ${(allocation * 100).toFixed(1)}% of the portfolio.`,
            affectedPositions: holdings
              .filter((h) => (h.assetClass ?? 'UNKNOWN') === assetClass)
              .map((h) => h.symbol),
            value: allocation,
            threshold: 0.8
          });
        }
      }

      if (holdings.length < 5) {
        violations.push({
          rule: 'Minimum Holdings',
          severity: 'warning',
          description: `Portfolio has only ${holdings.length} holdings. Consider adding more positions for better diversification.`,
          affectedPositions: holdings.map((h) => h.symbol),
          value: holdings.length,
          threshold: 5
        });
      }
    }

    if (ruleSet.includes('currency')) {
      const currencyExposure: Record<string, number> = {};
      for (const holding of holdings) {
        const cur = holding.currency ?? 'UNKNOWN';
        currencyExposure[cur] =
          (currencyExposure[cur] ?? 0) +
          holding.allocationInPercentage;
      }

      for (const [currency, exposure] of Object.entries(
        currencyExposure
      )) {
        if (exposure > 0.7) {
          violations.push({
            rule: 'Currency Concentration',
            severity: 'warning',
            description: `${(exposure * 100).toFixed(1)}% of the portfolio is denominated in ${currency}. Consider currency diversification.`,
            affectedPositions: holdings
              .filter((h) => h.currency === currency)
              .map((h) => h.symbol),
            value: exposure,
            threshold: 0.7
          });
        }
      }
    }

    return {
      rulesChecked: ruleSet,
      totalHoldings: holdings.length,
      violations: violations.filter((v) => v.severity === 'violation'),
      warnings: violations.filter((v) => v.severity === 'warning'),
      summary: {
        violationCount: violations.filter(
          (v) => v.severity === 'violation'
        ).length,
        warningCount: violations.filter(
          (v) => v.severity === 'warning'
        ).length,
        isCompliant:
          violations.filter((v) => v.severity === 'violation')
            .length === 0
      }
    };
  }
}
