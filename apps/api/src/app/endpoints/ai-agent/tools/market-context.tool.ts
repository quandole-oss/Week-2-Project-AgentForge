import { DataProviderService } from '@ghostfolio/api/services/data-provider/data-provider.service';

import { Injectable } from '@nestjs/common';
import { DataSource } from '@prisma/client';

@Injectable()
export class MarketContextTool {
  public constructor(
    private readonly dataProviderService: DataProviderService
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

    const quotes = await this.dataProviderService.getQuotes({
      items,
      useCache: true
    });

    const results = Object.entries(quotes).map(([symbol, data]) => ({
      symbol,
      currency: data.currency,
      marketPrice: data.marketPrice,
      marketState: data.marketState,
      dataSource: data.dataSource
    }));

    return {
      quotes: results,
      timestamp: new Date().toISOString()
    };
  }
}
