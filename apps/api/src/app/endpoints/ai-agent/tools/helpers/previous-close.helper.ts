import { MarketDataService } from '@ghostfolio/api/services/market-data/market-data.service';
import { resetHours } from '@ghostfolio/common/helper';
import { AssetProfileIdentifier } from '@ghostfolio/common/interfaces';

import { subDays } from 'date-fns';

const MAX_LOOKBACK_DAYS = 5;

export async function getPreviousCloseMap(
  marketDataService: MarketDataService,
  assetProfileIdentifiers: AssetProfileIdentifier[]
): Promise<Map<string, number>> {
  const result = new Map<string, number>();

  if (assetProfileIdentifiers.length === 0) {
    return result;
  }

  const today = resetHours(new Date());

  for (let daysBack = 1; daysBack <= MAX_LOOKBACK_DAYS; daysBack++) {
    const lookupDate = subDays(today, daysBack);
    const nextDay = subDays(today, daysBack - 1);

    const missing = assetProfileIdentifiers.filter(
      ({ symbol }) => !result.has(symbol)
    );

    if (missing.length === 0) {
      break;
    }

    const records = await marketDataService.getRange({
      assetProfileIdentifiers: missing,
      dateQuery: { gte: lookupDate, lt: nextDay }
    });

    for (const record of records) {
      if (!result.has(record.symbol) && record.marketPrice > 0) {
        result.set(record.symbol, record.marketPrice);
      }
    }
  }

  return result;
}
