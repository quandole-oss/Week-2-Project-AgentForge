import { TransactionAnalyzerTool } from '../transaction-analyzer.tool';

describe('TransactionAnalyzerTool', () => {
  let tool: TransactionAnalyzerTool;
  let mockOrderService: {
    getOrders: jest.Mock;
  };

  const makeActivity = (overrides: Record<string, unknown> = {}) => ({
    id: 'act-1',
    type: 'BUY',
    date: new Date('2024-06-15T10:00:00.000Z'),
    fee: 9.99,
    quantity: 10,
    unitPrice: 150,
    symbol: 'AAPL',
    ...overrides
  });

  const sampleActivities = [
    makeActivity({
      id: 'act-1',
      type: 'BUY',
      date: new Date('2024-01-10T10:00:00.000Z'),
      fee: 9.99
    }),
    makeActivity({
      id: 'act-2',
      type: 'BUY',
      date: new Date('2024-01-20T10:00:00.000Z'),
      fee: 9.99
    }),
    makeActivity({
      id: 'act-3',
      type: 'SELL',
      date: new Date('2024-03-15T10:00:00.000Z'),
      fee: 12.5
    }),
    makeActivity({
      id: 'act-4',
      type: 'DIVIDEND',
      date: new Date('2024-03-30T10:00:00.000Z'),
      fee: 0
    }),
    makeActivity({
      id: 'act-5',
      type: 'BUY',
      date: new Date('2024-06-01T10:00:00.000Z'),
      fee: 7.5
    }),
    makeActivity({
      id: 'act-6',
      type: 'BUY',
      date: new Date('2024-06-15T10:00:00.000Z'),
      fee: 7.5
    }),
    makeActivity({
      id: 'act-7',
      type: 'SELL',
      date: new Date('2024-09-10T10:00:00.000Z'),
      fee: 15.0
    }),
    makeActivity({
      id: 'act-8',
      type: 'DIVIDEND',
      date: new Date('2024-09-25T10:00:00.000Z'),
      fee: 0
    })
  ];

  beforeEach(() => {
    mockOrderService = {
      getOrders: jest.fn()
    };
    tool = new TransactionAnalyzerTool(mockOrderService as any);
  });

  it('should count activities by type', async () => {
    mockOrderService.getOrders.mockResolvedValue({
      activities: sampleActivities,
      count: sampleActivities.length
    });

    const result = await tool.execute({
      userId: 'user-1',
      userCurrency: 'USD'
    });

    expect(result.byType).toEqual({
      BUY: 4,
      SELL: 2,
      DIVIDEND: 2
    });
  });

  it('should count activities by month', async () => {
    mockOrderService.getOrders.mockResolvedValue({
      activities: sampleActivities,
      count: sampleActivities.length
    });

    const result = await tool.execute({
      userId: 'user-1',
      userCurrency: 'USD'
    });

    expect(result.byMonth['2024-01']).toBe(2);
    expect(result.byMonth['2024-03']).toBe(2);
    expect(result.byMonth['2024-06']).toBe(2);
    expect(result.byMonth['2024-09']).toBe(2);
  });

  it('should calculate total fees correctly', async () => {
    mockOrderService.getOrders.mockResolvedValue({
      activities: sampleActivities,
      count: sampleActivities.length
    });

    const result = await tool.execute({
      userId: 'user-1',
      userCurrency: 'USD'
    });

    // 9.99 + 9.99 + 12.5 + 0 + 7.5 + 7.5 + 15.0 + 0 = 62.48
    expect(result.totalFees).toBeCloseTo(62.48, 2);
  });

  it('should extract earliest and latest dates', async () => {
    mockOrderService.getOrders.mockResolvedValue({
      activities: sampleActivities,
      count: sampleActivities.length
    });

    const result = await tool.execute({
      userId: 'user-1',
      userCurrency: 'USD'
    });

    expect(result.dateRange.earliest).toBe('2024-01-10T10:00:00.000Z');
    expect(result.dateRange.latest).toBe('2024-09-25T10:00:00.000Z');
  });

  it('should pass date filters to OrderService', async () => {
    mockOrderService.getOrders.mockResolvedValue({
      activities: [],
      count: 0
    });

    await tool.execute({
      userId: 'user-1',
      userCurrency: 'USD',
      startDate: '2024-03-01',
      endDate: '2024-06-30'
    });

    expect(mockOrderService.getOrders).toHaveBeenCalledWith(
      expect.objectContaining({
        startDate: new Date('2024-03-01'),
        endDate: new Date('2024-06-30')
      })
    );
  });

  it('should pass type filters to OrderService', async () => {
    mockOrderService.getOrders.mockResolvedValue({
      activities: [],
      count: 0
    });

    await tool.execute({
      userId: 'user-1',
      userCurrency: 'USD',
      types: ['BUY', 'SELL']
    });

    expect(mockOrderService.getOrders).toHaveBeenCalledWith(
      expect.objectContaining({
        types: ['BUY', 'SELL']
      })
    );
  });

  it('should handle empty activity list', async () => {
    mockOrderService.getOrders.mockResolvedValue({
      activities: [],
      count: 0
    });

    const result = await tool.execute({
      userId: 'user-1',
      userCurrency: 'USD'
    });

    expect(result.totalActivities).toBe(0);
    expect(result.byType).toEqual({});
    expect(result.byMonth).toEqual({});
    expect(result.totalFees).toBe(0);
    expect(result.dateRange.earliest).toBeNull();
    expect(result.dateRange.latest).toBeNull();
  });

  it('should return the user currency in the result', async () => {
    mockOrderService.getOrders.mockResolvedValue({
      activities: [],
      count: 0
    });

    const result = await tool.execute({
      userId: 'user-1',
      userCurrency: 'EUR'
    });

    expect(result.userCurrency).toBe('EUR');
  });

  it('should return totalActivities from the count returned by OrderService', async () => {
    mockOrderService.getOrders.mockResolvedValue({
      activities: sampleActivities.slice(0, 3),
      count: 42
    });

    const result = await tool.execute({
      userId: 'user-1',
      userCurrency: 'USD'
    });

    expect(result.totalActivities).toBe(42);
  });

  it('should handle activities with missing fee gracefully', async () => {
    mockOrderService.getOrders.mockResolvedValue({
      activities: [
        makeActivity({ fee: undefined }),
        makeActivity({ fee: null }),
        makeActivity({ fee: 5 })
      ],
      count: 3
    });

    const result = await tool.execute({
      userId: 'user-1',
      userCurrency: 'USD'
    });

    expect(result.totalFees).toBe(5);
  });

  it('should pass undefined for dates when no date filters are provided', async () => {
    mockOrderService.getOrders.mockResolvedValue({
      activities: [],
      count: 0
    });

    await tool.execute({
      userId: 'user-1',
      userCurrency: 'USD'
    });

    expect(mockOrderService.getOrders).toHaveBeenCalledWith(
      expect.objectContaining({
        startDate: undefined,
        endDate: undefined
      })
    );
  });
});
