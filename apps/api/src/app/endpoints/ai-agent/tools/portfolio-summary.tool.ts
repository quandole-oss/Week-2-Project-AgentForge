import { PortfolioService } from '@ghostfolio/api/app/portfolio/portfolio.service';

import { Injectable } from '@nestjs/common';

@Injectable()
export class PortfolioSummaryTool {
  public constructor(
    private readonly portfolioService: PortfolioService
  ) {}

  public get definition() {
    return {
      name: 'portfolio_summary',
      description:
        'Get a comprehensive summary of the user\'s investment portfolio including holdings, allocation percentages, asset classes, current values, and overall performance metrics. Use this when the user asks about their portfolio overview, holdings, or allocation.',
      parameters: {
        type: 'object' as const,
        properties: {
          withMarkets: {
            type: 'boolean',
            description:
              'Include market data (current prices, market state) for each holding'
          },
          withSummary: {
            type: 'boolean',
            description:
              'Include summary statistics (total value, performance, dividends)'
          }
        }
      }
    };
  }

  public async execute({
    impersonationId,
    userId,
    withMarkets = true,
    withSummary = true
  }: {
    impersonationId: string;
    userId: string;
    withMarkets?: boolean;
    withSummary?: boolean;
  }) {
    const details = await this.portfolioService.getDetails({
      impersonationId,
      userId,
      withMarkets,
      withSummary
    });

    const holdings = Object.values(details.holdings).map((holding) => ({
      name: holding.name,
      symbol: holding.symbol,
      currency: holding.currency,
      assetClass: holding.assetClass,
      assetSubClass: holding.assetSubClass,
      allocationInPercentage: holding.allocationInPercentage,
      valueInBaseCurrency: holding.valueInBaseCurrency,
      netPerformancePercentWithCurrencyEffect:
        holding.netPerformancePercentWithCurrencyEffect,
      marketPrice: holding.marketPrice,
      quantity: holding.quantity,
      sectors: holding.sectors,
      countries: holding.countries
    }));

    const result: Record<string, unknown> = {
      holdingsCount: holdings.length,
      holdings: holdings.sort(
        (a, b) => b.allocationInPercentage - a.allocationInPercentage
      )
    };

    if (details.summary) {
      result.summary = {
        cash: details.summary.cash,
        currentValueInBaseCurrency:
          details.summary.currentValueInBaseCurrency,
        totalInvestment:
          details.summary.totalInvestment,
        dividendInBaseCurrency: details.summary.dividendInBaseCurrency,
        feesInBaseCurrency: details.summary.fees,
        netPerformance:
          details.summary.netPerformance,
        netPerformancePercentage:
          details.summary.netPerformancePercentage
      };
    }

    if (details.hasErrors) {
      result.warnings = [
        'Some portfolio data may be incomplete due to data provider issues.'
      ];
    }

    return result;
  }
}
