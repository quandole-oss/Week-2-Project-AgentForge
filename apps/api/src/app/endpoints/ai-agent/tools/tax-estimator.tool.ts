import { OrderService } from '@ghostfolio/api/app/order/order.service';

import { Injectable } from '@nestjs/common';
import { Type as ActivityType } from '@prisma/client';

interface TaxLot {
  symbol: string;
  buyDate: string;
  quantity: number;
  costBasis: number;
  sellDate?: string;
  proceeds?: number;
  gainLoss?: number;
  isLongTerm?: boolean;
}

@Injectable()
export class TaxEstimatorTool {
  public constructor(private readonly orderService: OrderService) {}

  public async execute({
    lotMethod = 'FIFO',
    taxYear,
    userCurrency,
    userId
  }: {
    jurisdiction?: string;
    lotMethod?: string;
    taxYear: number;
    userCurrency: string;
    userId: string;
  }) {
    const yearStart = new Date(`${taxYear}-01-01`);
    const yearEnd = new Date(`${taxYear}-12-31`);

    const { activities } = await this.orderService.getOrders({
      userId,
      userCurrency,
      types: [ActivityType.BUY, ActivityType.SELL]
    });

    const buys = activities.filter((a) => a.type === ActivityType.BUY);
    const sells = activities.filter(
      (a) =>
        a.type === ActivityType.SELL &&
        new Date(a.date) >= yearStart &&
        new Date(a.date) <= yearEnd
    );

    // Build FIFO lots per symbol
    const buyLotsBySymbol = new Map<string, TaxLot[]>();

    for (const buy of buys) {
      const symbol = buy.SymbolProfile?.symbol ?? 'UNKNOWN';
      if (!buyLotsBySymbol.has(symbol)) {
        buyLotsBySymbol.set(symbol, []);
      }
      buyLotsBySymbol.get(symbol).push({
        symbol,
        buyDate: new Date(buy.date).toISOString(),
        quantity: buy.quantity,
        costBasis: buy.unitPrice * buy.quantity
      });
    }

    // Sort buy lots by date (FIFO)
    for (const lots of buyLotsBySymbol.values()) {
      lots.sort(
        (a, b) =>
          new Date(a.buyDate).getTime() - new Date(b.buyDate).getTime()
      );
    }

    const realizedLots: TaxLot[] = [];
    let totalRealizedGain = 0;
    let shortTermGain = 0;
    let longTermGain = 0;

    for (const sell of sells) {
      const symbol = sell.SymbolProfile?.symbol ?? 'UNKNOWN';
      const lots = buyLotsBySymbol.get(symbol) ?? [];
      let remainingQty = sell.quantity;
      const sellDate = new Date(sell.date);
      const proceeds = sell.unitPrice * sell.quantity;

      while (remainingQty > 0 && lots.length > 0) {
        const lot = lots[0];
        const matchQty = Math.min(remainingQty, lot.quantity);
        const costBasisPerUnit = lot.costBasis / lot.quantity;
        const lotCostBasis = costBasisPerUnit * matchQty;
        const lotProceeds = (proceeds / sell.quantity) * matchQty;
        const gainLoss = lotProceeds - lotCostBasis;

        const buyDate = new Date(lot.buyDate);
        const holdingDays =
          (sellDate.getTime() - buyDate.getTime()) / (1000 * 60 * 60 * 24);
        const isLongTerm = holdingDays > 365;

        realizedLots.push({
          symbol,
          buyDate: lot.buyDate,
          quantity: matchQty,
          costBasis: lotCostBasis,
          sellDate: sellDate.toISOString(),
          proceeds: lotProceeds,
          gainLoss,
          isLongTerm
        });

        totalRealizedGain += gainLoss;
        if (isLongTerm) {
          longTermGain += gainLoss;
        } else {
          shortTermGain += gainLoss;
        }

        lot.quantity -= matchQty;
        lot.costBasis -= lotCostBasis;
        remainingQty -= matchQty;

        if (lot.quantity <= 0.0001) {
          lots.shift();
        }
      }
    }

    // Unrealized: remaining lots
    let totalUnrealizedCostBasis = 0;
    for (const lots of buyLotsBySymbol.values()) {
      for (const lot of lots) {
        totalUnrealizedCostBasis += lot.costBasis;
      }
    }

    return {
      taxYear,
      lotMethod,
      currency: userCurrency,
      realizedGains: {
        total: Math.round(totalRealizedGain * 100) / 100,
        shortTerm: Math.round(shortTermGain * 100) / 100,
        longTerm: Math.round(longTermGain * 100) / 100,
        transactionCount: realizedLots.length
      },
      unrealizedCostBasis:
        Math.round(totalUnrealizedCostBasis * 100) / 100,
      lots: realizedLots.slice(0, 50),
      note: 'This is an estimate based on FIFO lot matching. Consult a tax professional for accurate tax filing.'
    };
  }
}
