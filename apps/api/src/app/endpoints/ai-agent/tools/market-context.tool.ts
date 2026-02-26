import { DataProviderService } from '@ghostfolio/api/services/data-provider/data-provider.service';
import { MarketDataService } from '@ghostfolio/api/services/market-data/market-data.service';

import { Injectable } from '@nestjs/common';
import { DataSource } from '@prisma/client';

import { getPreviousCloseMap } from './helpers/previous-close.helper';

export const CRYPTO_SYMBOL_MAP: Record<string, string> = {
  BTC: 'bitcoin',
  BITCOIN: 'bitcoin',
  ETH: 'ethereum',
  ETHEREUM: 'ethereum',
  SOL: 'solana',
  SOLANA: 'solana',
  BNB: 'binancecoin',
  XRP: 'ripple',
  RIPPLE: 'ripple',
  ADA: 'cardano',
  CARDANO: 'cardano',
  DOGE: 'dogecoin',
  DOGECOIN: 'dogecoin',
  AVAX: 'avalanche-2',
  AVALANCHE: 'avalanche-2',
  LINK: 'chainlink',
  CHAINLINK: 'chainlink',
  LTC: 'litecoin',
  LITECOIN: 'litecoin',
  DOT: 'polkadot',
  POLKADOT: 'polkadot',
  MATIC: 'matic-network',
  POLYGON: 'matic-network',
  SHIB: 'shiba-inu',
  UNI: 'uniswap',
  ATOM: 'cosmos',
  XLM: 'stellar',
  ALGO: 'algorand',
  FTM: 'fantom',
  NEAR: 'near'
};

export function resolveSymbol(input: {
  symbol: string;
  dataSource: string;
}): { symbol: string; dataSource: string } {
  const upper = input.symbol.toUpperCase();
  const coingeckoId = CRYPTO_SYMBOL_MAP[upper];

  if (coingeckoId) {
    return { symbol: coingeckoId, dataSource: 'COINGECKO' };
  }

  return input;
}

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
    const items = symbols.map((entry) => {
      const resolved = resolveSymbol(entry);

      return {
        dataSource: resolved.dataSource as DataSource,
        symbol: resolved.symbol
      };
    });

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
