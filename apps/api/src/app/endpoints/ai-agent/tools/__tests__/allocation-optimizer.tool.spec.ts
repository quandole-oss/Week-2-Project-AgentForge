import { AllocationOptimizerTool } from '../allocation-optimizer.tool';

describe('AllocationOptimizerTool', () => {
  let tool: AllocationOptimizerTool;
  let mockPortfolioService: {
    getDetails: jest.Mock;
  };

  const makeHolding = (overrides: Record<string, unknown> = {}) => ({
    name: 'Apple Inc.',
    symbol: 'AAPL',
    currency: 'USD',
    assetClass: 'EQUITY',
    assetSubClass: 'STOCK',
    allocationInPercentage: 0.2,
    valueInBaseCurrency: 20000,
    netPerformancePercentWithCurrencyEffect: 0.15,
    marketPrice: 175,
    quantity: 114,
    sectors: [],
    countries: [],
    ...overrides
  });

  beforeEach(() => {
    mockPortfolioService = {
      getDetails: jest.fn()
    };
    tool = new AllocationOptimizerTool(mockPortfolioService as any);
  });

  it('should detect over-allocation in an asset class', async () => {
    mockPortfolioService.getDetails.mockResolvedValue({
      holdings: {
        AAPL: makeHolding({
          assetClass: 'EQUITY',
          allocationInPercentage: 0.5
        }),
        MSFT: makeHolding({
          symbol: 'MSFT',
          assetClass: 'EQUITY',
          allocationInPercentage: 0.3
        }),
        BND: makeHolding({
          symbol: 'BND',
          assetClass: 'FIXED_INCOME',
          allocationInPercentage: 0.2
        })
      },
      summary: { currentValueInBaseCurrency: 100000 },
      hasErrors: false
    });

    const result = await tool.execute({
      targetAllocation: { EQUITY: 0.6, FIXED_INCOME: 0.4 },
      impersonationId: '',
      userId: 'user-1'
    });

    const equity = result.comparison.find(
      (c: any) => c.assetClass === 'EQUITY'
    );
    expect(equity.driftDirection).toBe('over');
    expect(equity.driftPercent).toBe(20);
  });

  it('should detect under-allocation in an asset class', async () => {
    mockPortfolioService.getDetails.mockResolvedValue({
      holdings: {
        AAPL: makeHolding({
          assetClass: 'EQUITY',
          allocationInPercentage: 0.8
        }),
        BND: makeHolding({
          symbol: 'BND',
          assetClass: 'FIXED_INCOME',
          allocationInPercentage: 0.2
        })
      },
      summary: { currentValueInBaseCurrency: 100000 },
      hasErrors: false
    });

    const result = await tool.execute({
      targetAllocation: { EQUITY: 0.6, FIXED_INCOME: 0.4 },
      impersonationId: '',
      userId: 'user-1'
    });

    const fixedIncome = result.comparison.find(
      (c: any) => c.assetClass === 'FIXED_INCOME'
    );
    expect(fixedIncome.driftDirection).toBe('under');
    expect(fixedIncome.driftPercent).toBe(-20);
  });

  it('should report on-target when drift is less than 1%', async () => {
    mockPortfolioService.getDetails.mockResolvedValue({
      holdings: {
        AAPL: makeHolding({
          assetClass: 'EQUITY',
          allocationInPercentage: 0.605
        }),
        BND: makeHolding({
          symbol: 'BND',
          assetClass: 'FIXED_INCOME',
          allocationInPercentage: 0.395
        })
      },
      summary: { currentValueInBaseCurrency: 100000 },
      hasErrors: false
    });

    const result = await tool.execute({
      targetAllocation: { EQUITY: 0.6, FIXED_INCOME: 0.4 },
      impersonationId: '',
      userId: 'user-1'
    });

    for (const entry of result.comparison) {
      expect(entry.driftDirection).toBe('on-target');
    }
    expect(result.isRebalanceNeeded).toBe(false);
  });

  it('should flag isRebalanceNeeded when total drift > 5%', async () => {
    mockPortfolioService.getDetails.mockResolvedValue({
      holdings: {
        AAPL: makeHolding({
          assetClass: 'EQUITY',
          allocationInPercentage: 0.9
        }),
        BND: makeHolding({
          symbol: 'BND',
          assetClass: 'FIXED_INCOME',
          allocationInPercentage: 0.1
        })
      },
      summary: { currentValueInBaseCurrency: 100000 },
      hasErrors: false
    });

    const result = await tool.execute({
      targetAllocation: { EQUITY: 0.6, FIXED_INCOME: 0.4 },
      impersonationId: '',
      userId: 'user-1'
    });

    expect(result.isRebalanceNeeded).toBe(true);
    expect(result.totalDriftPercent).toBeGreaterThan(5);
  });

  it('should generate suggestions for over-allocated classes', async () => {
    mockPortfolioService.getDetails.mockResolvedValue({
      holdings: {
        AAPL: makeHolding({
          assetClass: 'EQUITY',
          allocationInPercentage: 0.85
        }),
        BND: makeHolding({
          symbol: 'BND',
          assetClass: 'FIXED_INCOME',
          allocationInPercentage: 0.15
        })
      },
      summary: { currentValueInBaseCurrency: 100000 },
      hasErrors: false
    });

    const result = await tool.execute({
      targetAllocation: { EQUITY: 0.6, FIXED_INCOME: 0.4 },
      impersonationId: '',
      userId: 'user-1'
    });

    expect(result.suggestions.some((s: string) => s.includes('reducing'))).toBe(
      true
    );
    expect(
      result.suggestions.some((s: string) => s.includes('increasing'))
    ).toBe(true);
  });

  it('should return well-aligned message when no rebalancing needed', async () => {
    mockPortfolioService.getDetails.mockResolvedValue({
      holdings: {
        AAPL: makeHolding({
          assetClass: 'EQUITY',
          allocationInPercentage: 0.6
        }),
        BND: makeHolding({
          symbol: 'BND',
          assetClass: 'FIXED_INCOME',
          allocationInPercentage: 0.4
        })
      },
      summary: { currentValueInBaseCurrency: 100000 },
      hasErrors: false
    });

    const result = await tool.execute({
      targetAllocation: { EQUITY: 0.6, FIXED_INCOME: 0.4 },
      impersonationId: '',
      userId: 'user-1'
    });

    expect(
      result.suggestions.some((s: string) => s.includes('well-aligned'))
    ).toBe(true);
  });

  it('should include asset classes only in target but not in portfolio', async () => {
    mockPortfolioService.getDetails.mockResolvedValue({
      holdings: {
        AAPL: makeHolding({
          assetClass: 'EQUITY',
          allocationInPercentage: 1.0
        })
      },
      summary: { currentValueInBaseCurrency: 100000 },
      hasErrors: false
    });

    const result = await tool.execute({
      targetAllocation: {
        EQUITY: 0.6,
        FIXED_INCOME: 0.3,
        COMMODITY: 0.1
      },
      impersonationId: '',
      userId: 'user-1'
    });

    const fixedIncome = result.comparison.find(
      (c: any) => c.assetClass === 'FIXED_INCOME'
    );
    expect(fixedIncome).toBeDefined();
    expect(fixedIncome.currentPercent).toBe(0);
    expect(fixedIncome.targetPercent).toBe(30);
    expect(fixedIncome.driftDirection).toBe('under');
  });

  it('should include asset classes only in portfolio but not in target', async () => {
    mockPortfolioService.getDetails.mockResolvedValue({
      holdings: {
        AAPL: makeHolding({
          assetClass: 'EQUITY',
          allocationInPercentage: 0.7
        }),
        GLD: makeHolding({
          symbol: 'GLD',
          assetClass: 'COMMODITY',
          allocationInPercentage: 0.3
        })
      },
      summary: { currentValueInBaseCurrency: 100000 },
      hasErrors: false
    });

    const result = await tool.execute({
      targetAllocation: { EQUITY: 1.0 },
      impersonationId: '',
      userId: 'user-1'
    });

    const commodity = result.comparison.find(
      (c: any) => c.assetClass === 'COMMODITY'
    );
    expect(commodity).toBeDefined();
    expect(commodity.targetPercent).toBe(0);
    expect(commodity.driftDirection).toBe('over');
  });

  it('should sort comparison by absolute drift descending', async () => {
    mockPortfolioService.getDetails.mockResolvedValue({
      holdings: {
        AAPL: makeHolding({
          assetClass: 'EQUITY',
          allocationInPercentage: 0.5
        }),
        BND: makeHolding({
          symbol: 'BND',
          assetClass: 'FIXED_INCOME',
          allocationInPercentage: 0.3
        }),
        GLD: makeHolding({
          symbol: 'GLD',
          assetClass: 'COMMODITY',
          allocationInPercentage: 0.2
        })
      },
      summary: { currentValueInBaseCurrency: 100000 },
      hasErrors: false
    });

    const result = await tool.execute({
      targetAllocation: {
        EQUITY: 0.33,
        FIXED_INCOME: 0.34,
        COMMODITY: 0.33
      },
      impersonationId: '',
      userId: 'user-1'
    });

    for (let i = 1; i < result.comparison.length; i++) {
      expect(Math.abs(result.comparison[i - 1].driftPercent)).toBeGreaterThanOrEqual(
        Math.abs(result.comparison[i].driftPercent)
      );
    }
  });

  it('should return holdingsCount and totalValueInBaseCurrency', async () => {
    mockPortfolioService.getDetails.mockResolvedValue({
      holdings: {
        AAPL: makeHolding({ allocationInPercentage: 0.6 }),
        BND: makeHolding({
          symbol: 'BND',
          allocationInPercentage: 0.4
        })
      },
      summary: { currentValueInBaseCurrency: 150000 },
      hasErrors: false
    });

    const result = await tool.execute({
      targetAllocation: { EQUITY: 0.6, FIXED_INCOME: 0.4 },
      impersonationId: '',
      userId: 'user-1'
    });

    expect(result.holdingsCount).toBe(2);
    expect(result.totalValueInBaseCurrency).toBe(150000);
  });

  it('should handle null summary gracefully', async () => {
    mockPortfolioService.getDetails.mockResolvedValue({
      holdings: {
        AAPL: makeHolding({ allocationInPercentage: 1.0 })
      },
      summary: undefined,
      hasErrors: false
    });

    const result = await tool.execute({
      targetAllocation: { EQUITY: 1.0 },
      impersonationId: '',
      userId: 'user-1'
    });

    expect(result.totalValueInBaseCurrency).toBeNull();
  });
});
