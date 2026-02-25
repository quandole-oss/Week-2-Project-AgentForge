import { DataProviderService } from '@ghostfolio/api/services/data-provider/data-provider.service';
import { MarketDataService } from '@ghostfolio/api/services/market-data/market-data.service';

import { Injectable } from '@nestjs/common';
import { DataSource } from '@prisma/client';

import { getPreviousCloseMap } from './helpers/previous-close.helper';

@Injectable()
export class MarketContextTool {
  public constructor(
    private readonly dataProviderService: DataProviderService,
    private readonly marketDataService: MarketDataService
  ) {}

  public async execute({
    symbols
  }: {
    symbols: { symbol: string; dataSource: string }[];
  }) {
    const items = symbols.map(({ dataSource, symbol }) => ({
      dataSource: dataSource as DataSource,
      symbol
    }));

    const [quotes, previousCloseMap] = await Promise.all([
      this.dataProviderService.getQuotes({
        items,
        useCache: true
      }),
      getPreviousCloseMap(this.marketDataService, items)
    ]);

    const results = Object.entries(quotes).map(([symbol, data]) => {
      const previousClose = previousCloseMap.get(symbol) ?? null;
      let priceChange: number | null = null;
      let priceChangePercent: number | null = null;

      if (previousClose !== null && previousClose !== 0) {
        priceChange =
          Math.round((data.marketPrice - previousClose) * 100) / 100;
        priceChangePercent =
          Math.round(
            ((data.marketPrice - previousClose) / previousClose) * 10000
          ) / 100;
      }

      return {
        symbol,
        currency: data.currency,
        marketPrice: data.marketPrice,
        marketState: data.marketState,
        dataSource: data.dataSource,
        previousClose,
        priceChange,
        priceChangePercent
      };
    });

    return {
      quotes: results,
      timestamp: new Date().toISOString()
    };
  }
}
