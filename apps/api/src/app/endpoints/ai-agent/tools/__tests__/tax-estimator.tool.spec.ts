import { TaxEstimatorTool } from '../tax-estimator.tool';

describe('TaxEstimatorTool', () => {
  let tool: TaxEstimatorTool;
  let mockOrderService: {
    getOrders: jest.Mock;
  };

  const makeActivity = (overrides: Record<string, unknown> = {}) => ({
    id: 'act-1',
    type: 'BUY',
    date: new Date('2024-03-15T10:00:00.000Z'),
    fee: 9.99,
    quantity: 10,
    unitPrice: 150,
    SymbolProfile: { symbol: 'AAPL' },
    ...overrides
  });

  beforeEach(() => {
    mockOrderService = {
      getOrders: jest.fn()
    };
    tool = new TaxEstimatorTool(mockOrderService as any);
  });

  it('should calculate realized gains from FIFO matching', async () => {
    mockOrderService.getOrders.mockResolvedValue({
      activities: [
        makeActivity({
          id: 'buy-1',
          type: 'BUY',
          date: new Date('2024-01-10'),
          quantity: 10,
          unitPrice: 100,
          SymbolProfile: { symbol: 'AAPL' }
        }),
        makeActivity({
          id: 'sell-1',
          type: 'SELL',
          date: new Date('2025-06-15'),
          quantity: 10,
          unitPrice: 150,
          SymbolProfile: { symbol: 'AAPL' }
        })
      ],
      count: 2
    });

    const result = await tool.execute({
      taxYear: 2025,
      userId: 'user-1',
      userCurrency: 'USD'
    });

    expect(result.realizedGains.total).toBe(500);
    expect(result.realizedGains.transactionCount).toBe(1);
  });

  it('should distinguish short-term and long-term gains', async () => {
    mockOrderService.getOrders.mockResolvedValue({
      activities: [
        makeActivity({
          id: 'buy-1',
          type: 'BUY',
          date: new Date('2024-01-10'),
          quantity: 10,
          unitPrice: 100,
          SymbolProfile: { symbol: 'AAPL' }
        }),
        makeActivity({
          id: 'buy-2',
          type: 'BUY',
          date: new Date('2025-03-01'),
          quantity: 10,
          unitPrice: 120,
          SymbolProfile: { symbol: 'AAPL' }
        }),
        makeActivity({
          id: 'sell-1',
          type: 'SELL',
          date: new Date('2025-06-15'),
          quantity: 20,
          unitPrice: 150,
          SymbolProfile: { symbol: 'AAPL' }
        })
      ],
      count: 3
    });

    const result = await tool.execute({
      taxYear: 2025,
      userId: 'user-1',
      userCurrency: 'USD'
    });

    // First 10 shares: bought Jan 2024, sold Jun 2025 = >365 days = long-term, gain = (150-100)*10 = 500
    // Next 10 shares: bought Mar 2025, sold Jun 2025 = <365 days = short-term, gain = (150-120)*10 = 300
    expect(result.realizedGains.longTerm).toBe(500);
    expect(result.realizedGains.shortTerm).toBe(300);
    expect(result.realizedGains.total).toBe(800);
  });

  it('should handle no sells in the tax year', async () => {
    mockOrderService.getOrders.mockResolvedValue({
      activities: [
        makeActivity({
          id: 'buy-1',
          type: 'BUY',
          date: new Date('2024-06-15'),
          quantity: 10,
          unitPrice: 100,
          SymbolProfile: { symbol: 'AAPL' }
        })
      ],
      count: 1
    });

    const result = await tool.execute({
      taxYear: 2025,
      userId: 'user-1',
      userCurrency: 'USD'
    });

    expect(result.realizedGains.total).toBe(0);
    expect(result.realizedGains.transactionCount).toBe(0);
  });

  it('should track unrealized cost basis from remaining lots', async () => {
    mockOrderService.getOrders.mockResolvedValue({
      activities: [
        makeActivity({
          id: 'buy-1',
          type: 'BUY',
          date: new Date('2024-01-10'),
          quantity: 20,
          unitPrice: 100,
          SymbolProfile: { symbol: 'AAPL' }
        }),
        makeActivity({
          id: 'sell-1',
          type: 'SELL',
          date: new Date('2025-06-15'),
          quantity: 10,
          unitPrice: 150,
          SymbolProfile: { symbol: 'AAPL' }
        })
      ],
      count: 2
    });

    const result = await tool.execute({
      taxYear: 2025,
      userId: 'user-1',
      userCurrency: 'USD'
    });

    // 10 shares remaining at $100 each = $1000 cost basis
    expect(result.unrealizedCostBasis).toBe(1000);
  });

  it('should return the correct tax year and lot method', async () => {
    mockOrderService.getOrders.mockResolvedValue({
      activities: [],
      count: 0
    });

    const result = await tool.execute({
      taxYear: 2024,
      lotMethod: 'FIFO',
      userId: 'user-1',
      userCurrency: 'EUR'
    });

    expect(result.taxYear).toBe(2024);
    expect(result.lotMethod).toBe('FIFO');
    expect(result.currency).toBe('EUR');
  });

  it('should default lotMethod to FIFO', async () => {
    mockOrderService.getOrders.mockResolvedValue({
      activities: [],
      count: 0
    });

    const result = await tool.execute({
      taxYear: 2025,
      userId: 'user-1',
      userCurrency: 'USD'
    });

    expect(result.lotMethod).toBe('FIFO');
  });

  it('should handle partial lot matching', async () => {
    mockOrderService.getOrders.mockResolvedValue({
      activities: [
        makeActivity({
          id: 'buy-1',
          type: 'BUY',
          date: new Date('2024-01-10'),
          quantity: 20,
          unitPrice: 100,
          SymbolProfile: { symbol: 'AAPL' }
        }),
        makeActivity({
          id: 'sell-1',
          type: 'SELL',
          date: new Date('2025-06-15'),
          quantity: 5,
          unitPrice: 200,
          SymbolProfile: { symbol: 'AAPL' }
        })
      ],
      count: 2
    });

    const result = await tool.execute({
      taxYear: 2025,
      userId: 'user-1',
      userCurrency: 'USD'
    });

    // Sold 5 at $200, cost basis 5*100 = 500, proceeds = 1000, gain = 500
    expect(result.realizedGains.total).toBe(500);
    // 15 shares still held at cost $1500
    expect(result.unrealizedCostBasis).toBe(1500);
  });

  it('should handle losses correctly', async () => {
    mockOrderService.getOrders.mockResolvedValue({
      activities: [
        makeActivity({
          id: 'buy-1',
          type: 'BUY',
          date: new Date('2024-01-10'),
          quantity: 10,
          unitPrice: 200,
          SymbolProfile: { symbol: 'AAPL' }
        }),
        makeActivity({
          id: 'sell-1',
          type: 'SELL',
          date: new Date('2025-06-15'),
          quantity: 10,
          unitPrice: 150,
          SymbolProfile: { symbol: 'AAPL' }
        })
      ],
      count: 2
    });

    const result = await tool.execute({
      taxYear: 2025,
      userId: 'user-1',
      userCurrency: 'USD'
    });

    expect(result.realizedGains.total).toBe(-500);
  });

  it('should include a note about consulting a tax professional', async () => {
    mockOrderService.getOrders.mockResolvedValue({
      activities: [],
      count: 0
    });

    const result = await tool.execute({
      taxYear: 2025,
      userId: 'user-1',
      userCurrency: 'USD'
    });

    expect(result.note).toContain('tax professional');
  });

  it('should handle multiple symbols independently', async () => {
    mockOrderService.getOrders.mockResolvedValue({
      activities: [
        makeActivity({
          id: 'buy-aapl',
          type: 'BUY',
          date: new Date('2024-01-10'),
          quantity: 10,
          unitPrice: 100,
          SymbolProfile: { symbol: 'AAPL' }
        }),
        makeActivity({
          id: 'buy-msft',
          type: 'BUY',
          date: new Date('2024-01-10'),
          quantity: 5,
          unitPrice: 300,
          SymbolProfile: { symbol: 'MSFT' }
        }),
        makeActivity({
          id: 'sell-aapl',
          type: 'SELL',
          date: new Date('2025-06-15'),
          quantity: 10,
          unitPrice: 150,
          SymbolProfile: { symbol: 'AAPL' }
        }),
        makeActivity({
          id: 'sell-msft',
          type: 'SELL',
          date: new Date('2025-06-15'),
          quantity: 5,
          unitPrice: 350,
          SymbolProfile: { symbol: 'MSFT' }
        })
      ],
      count: 4
    });

    const result = await tool.execute({
      taxYear: 2025,
      userId: 'user-1',
      userCurrency: 'USD'
    });

    // AAPL gain: (150-100)*10 = 500
    // MSFT gain: (350-300)*5 = 250
    expect(result.realizedGains.total).toBe(750);
    expect(result.realizedGains.transactionCount).toBe(2);
  });

  it('should limit lots in output to 50', async () => {
    const activities = [];
    for (let i = 0; i < 60; i++) {
      activities.push(
        makeActivity({
          id: `buy-${i}`,
          type: 'BUY',
          date: new Date(`2024-01-${String(10 + (i % 20)).padStart(2, '0')}`),
          quantity: 1,
          unitPrice: 100,
          SymbolProfile: { symbol: `SYM${i}` }
        })
      );
      activities.push(
        makeActivity({
          id: `sell-${i}`,
          type: 'SELL',
          date: new Date(`2025-06-${String(1 + (i % 28)).padStart(2, '0')}`),
          quantity: 1,
          unitPrice: 150,
          SymbolProfile: { symbol: `SYM${i}` }
        })
      );
    }

    mockOrderService.getOrders.mockResolvedValue({
      activities,
      count: activities.length
    });

    const result = await tool.execute({
      taxYear: 2025,
      userId: 'user-1',
      userCurrency: 'USD'
    });

    expect(result.lots.length).toBeLessThanOrEqual(50);
  });
});
