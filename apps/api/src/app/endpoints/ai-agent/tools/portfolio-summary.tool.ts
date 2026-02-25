import { PortfolioService } from '@ghostfolio/api/app/portfolio/portfolio.service';
import { ExchangeRateDataService } from '@ghostfolio/api/services/exchange-rate-data/exchange-rate-data.service';
import { MarketDataService } from '@ghostfolio/api/services/market-data/market-data.service';

import { Injectable } from '@nestjs/common';

import { getPreviousCloseMap } from './helpers/previous-close.helper';

@Injectable()
export class PortfolioSummaryTool {
  public constructor(
    private readonly exchangeRateDataService: ExchangeRateDataService,
    private readonly marketDataService: MarketDataService,
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
    userCurrency,
    userId,
    withMarkets = true,
    withSummary = true
  }: {
    impersonationId: string;
    userCurrency?: string;
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

    const holdingsArray = Object.values(details.holdings);

    const assetProfileIdentifiers = holdingsArray
      .filter((h) => h.dataSource && h.symbol)
      .map((h) => ({ dataSource: h.dataSource, symbol: h.symbol }));

    const previousCloseMap = await getPreviousCloseMap(
      this.marketDataService,
      assetProfileIdentifiers
    );

    let dailyChangeInBaseCurrency = 0;
    let totalValueInBaseCurrency = 0;

    const holdings = holdingsArray.map((holding) => {
      const previousClose =
        previousCloseMap.get(holding.symbol) ?? null;
      let dailyPriceChange: number | null = null;
      let dailyPriceChangePercent: number | null = null;
      let dailyValueChangeInBaseCurrency: number | null = null;

      if (previousClose !== null && previousClose !== 0) {
        dailyPriceChange =
          Math.round(
            (holding.marketPrice - previousClose) * 100
          ) / 100;
        dailyPriceChangePercent =
          Math.round(
            ((holding.marketPrice - previousClose) / previousClose) *
              10000
          ) / 100;

        const dailyValueChangeInHoldingCurrency =
          dailyPriceChange * holding.quantity;

        if (userCurrency && holding.currency) {
          dailyValueChangeInBaseCurrency =
            Math.round(
              this.exchangeRateDataService.toCurrency(
                dailyValueChangeInHoldingCurrency,
                holding.currency,
                userCurrency
              ) * 100
            ) / 100;
          dailyChangeInBaseCurrency +=
            dailyValueChangeInBaseCurrency;
        }
      }

      totalValueInBaseCurrency +=
        holding.valueInBaseCurrency ?? 0;

      return {
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
        countries: holding.countries,
        previousClose,
        dailyPriceChange,
        dailyPriceChangePercent,
        dailyValueChangeInBaseCurrency
      };
    });

    const dailyChangePercent =
      totalValueInBaseCurrency > 0
        ? Math.round(
            (dailyChangeInBaseCurrency / totalValueInBaseCurrency) *
              10000
          ) / 100
        : 0;

    const result: Record<string, unknown> = {
      holdingsCount: holdings.length,
      holdings: holdings.sort(
        (a, b) => b.allocationInPercentage - a.allocationInPercentage
      ),
      dailyChange: {
        valueInBaseCurrency:
          Math.round(dailyChangeInBaseCurrency * 100) / 100,
        percentage: dailyChangePercent
      }
    };

    if (details.summary) {
      result.summary = {
        cash: details.summary.cash,
        currentValueInBaseCurrency:
          details.summary.currentValueInBaseCurrency,
        totalInvestment: details.summary.totalInvestment,
        dividendInBaseCurrency:
          details.summary.dividendInBaseCurrency,
        feesInBaseCurrency: details.summary.fees,
        netPerformance: details.summary.netPerformance,
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
