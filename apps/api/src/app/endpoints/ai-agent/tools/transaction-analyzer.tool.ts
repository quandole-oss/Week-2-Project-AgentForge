import { OrderService } from '@ghostfolio/api/app/order/order.service';

import { Injectable } from '@nestjs/common';
import { Type as ActivityType } from '@prisma/client';

@Injectable()
export class TransactionAnalyzerTool {
  public constructor(private readonly orderService: OrderService) {}

  public async execute({
    endDate,
    startDate,
    types,
    userCurrency,
    userId
  }: {
    endDate?: string;
    startDate?: string;
    types?: string[];
    userCurrency: string;
    userId: string;
  }) {
    const { activities, count } = await this.orderService.getOrders({
      userId,
      userCurrency,
      endDate: endDate ? new Date(endDate) : undefined,
      startDate: startDate ? new Date(startDate) : undefined,
      types: types as ActivityType[]
    });

    const byType: Record<string, number> = {};
    const byMonth: Record<string, number> = {};
    let totalFees = 0;
    let earliestDate: Date | undefined;
    let latestDate: Date | undefined;

    for (const activity of activities) {
      const type = activity.type;
      byType[type] = (byType[type] ?? 0) + 1;

      const month = new Date(activity.date).toISOString().slice(0, 7);
      byMonth[month] = (byMonth[month] ?? 0) + 1;

      totalFees += activity.fee ?? 0;

      const actDate = new Date(activity.date);
      if (!earliestDate || actDate < earliestDate) {
        earliestDate = actDate;
      }
      if (!latestDate || actDate > latestDate) {
        latestDate = actDate;
      }
    }

    return {
      totalActivities: count,
      byType,
      byMonth,
      totalFees,
      dateRange: {
        earliest: earliestDate?.toISOString() ?? null,
        latest: latestDate?.toISOString() ?? null
      },
      userCurrency
    };
  }
}
