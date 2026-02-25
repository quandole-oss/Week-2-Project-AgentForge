import { PortfolioSummaryTool } from '../portfolio-summary.tool';

describe('PortfolioSummaryTool', () => {
  let tool: PortfolioSummaryTool;
  let mockPortfolioService: {
    getDetails: jest.Mock;
  };
  let mockMarketDataService: {
    getRange: jest.Mock;
  };
  let mockExchangeRateDataService: {
    toCurrency: jest.Mock;
  };

  const makeHolding = (overrides: Record<string, unknown> = {}) => ({
    name: 'Apple Inc.',
    symbol: 'AAPL',
    currency: 'USD',
    dataSource: 'YAHOO',
    assetClass: 'EQUITY',
    assetSubClass: 'STOCK',
    allocationInPercentage: 0.35,
    valueInBaseCurrency: 35000,
    netPerformancePercentWithCurrencyEffect: 0.15,
    marketPrice: 175,
    quantity: 200,
    sectors: [{ name: 'Technology', weight: 1 }],
    countries: [{ code: 'US', weight: 1 }],
    ...overrides
  });

  const makeSummary = (overrides: Record<string, unknown> = {}) => ({
    cash: 5000,
    currentValueInBaseCurrency: 100000,
    totalInvestment: 80000,
    dividendInBaseCurrency: 1200,
    fees: 350,
    netPerformance: 20000,
    netPerformancePercentage: 0.25,
    ...overrides
  });

  const mockPortfolioDetails = {
    holdings: {
      AAPL: makeHolding(),
      MSFT: makeHolding({
        name: 'Microsoft Corp.',
        symbol: 'MSFT',
        allocationInPercentage: 0.25,
        valueInBaseCurrency: 25000,
        netPerformancePercentWithCurrencyEffect: 0.22,
        marketPrice: 380,
        quantity: 65
      }),
      GOOGL: makeHolding({
        name: 'Alphabet Inc.',
        symbol: 'GOOGL',
        allocationInPercentage: 0.2,
        valueInBaseCurrency: 20000,
        netPerformancePercentWithCurrencyEffect: 0.1,
        marketPrice: 140,
        quantity: 143
      }),
      VTI: makeHolding({
        name: 'Vanguard Total Stock Market ETF',
        symbol: 'VTI',
        assetSubClass: 'ETF',
        allocationInPercentage: 0.15,
        valueInBaseCurrency: 15000,
        netPerformancePercentWithCurrencyEffect: 0.08,
        marketPrice: 230,
        quantity: 65
      }),
      BND: makeHolding({
        name: 'Vanguard Total Bond Market ETF',
        symbol: 'BND',
        assetClass: 'FIXED_INCOME',
        assetSubClass: 'ETF',
        allocationInPercentage: 0.05,
        valueInBaseCurrency: 5000,
        netPerformancePercentWithCurrencyEffect: 0.02,
        marketPrice: 72,
        quantity: 69
      })
    },
    summary: makeSummary(),
    hasErrors: false
  };

  beforeEach(() => {
    mockPortfolioService = {
      getDetails: jest.fn()
    };
    mockMarketDataService = {
      getRange: jest.fn().mockResolvedValue([])
    };
    mockExchangeRateDataService = {
      toCurrency: jest.fn().mockImplementation((value) => value)
    };
    tool = new PortfolioSummaryTool(
      mockExchangeRateDataService as any,
      mockMarketDataService as any,
      mockPortfolioService as any
    );
  });

  it('should return holdings sorted by allocation in descending order', async () => {
    mockPortfolioService.getDetails.mockResolvedValue(mockPortfolioDetails);

    const result = await tool.execute({
      impersonationId: '',
      userId: 'user-1'
    });

    const holdings = result.holdings as any[];
    expect(holdings.length).toBe(5);
    expect(holdings[0].symbol).toBe('AAPL');
    expect(holdings[0].allocationInPercentage).toBe(0.35);
    expect(holdings[1].symbol).toBe('MSFT');
    expect(holdings[1].allocationInPercentage).toBe(0.25);
    expect(holdings[2].symbol).toBe('GOOGL');
    expect(holdings[2].allocationInPercentage).toBe(0.2);
    expect(holdings[3].symbol).toBe('VTI');
    expect(holdings[3].allocationInPercentage).toBe(0.15);
    expect(holdings[4].symbol).toBe('BND');
    expect(holdings[4].allocationInPercentage).toBe(0.05);
  });

  it('should include summary when withSummary is true', async () => {
    mockPortfolioService.getDetails.mockResolvedValue(mockPortfolioDetails);

    const result = await tool.execute({
      impersonationId: '',
      userId: 'user-1',
      withSummary: true
    });

    expect(result.summary).toBeDefined();
    const summary = result.summary as any;
    expect(summary.cash).toBe(5000);
    expect(summary.currentValueInBaseCurrency).toBe(100000);
    expect(summary.totalInvestment).toBe(80000);
    expect(summary.dividendInBaseCurrency).toBe(1200);
    expect(summary.feesInBaseCurrency).toBe(350);
    expect(summary.netPerformance).toBe(20000);
    expect(summary.netPerformancePercentage).toBe(0.25);
  });

  it('should not include summary when details.summary is undefined', async () => {
    mockPortfolioService.getDetails.mockResolvedValue({
      ...mockPortfolioDetails,
      summary: undefined
    });

    const result = await tool.execute({
      impersonationId: '',
      userId: 'user-1',
      withSummary: true
    });

    expect(result.summary).toBeUndefined();
  });

  it('should handle an empty portfolio with zero holdings', async () => {
    mockPortfolioService.getDetails.mockResolvedValue({
      holdings: {},
      summary: makeSummary({ currentValueInBaseCurrency: 0 }),
      hasErrors: false
    });

    const result = await tool.execute({
      impersonationId: '',
      userId: 'user-1'
    });

    expect(result.holdingsCount).toBe(0);
    expect(result.holdings).toEqual([]);
  });

  it('should include warnings when hasErrors is true', async () => {
    mockPortfolioService.getDetails.mockResolvedValue({
      ...mockPortfolioDetails,
      hasErrors: true
    });

    const result = await tool.execute({
      impersonationId: '',
      userId: 'user-1'
    });

    expect(result.warnings).toBeDefined();
    expect((result.warnings as string[])[0]).toContain(
      'Some portfolio data may be incomplete'
    );
  });

  it('should not include warnings when hasErrors is false', async () => {
    mockPortfolioService.getDetails.mockResolvedValue(mockPortfolioDetails);

    const result = await tool.execute({
      impersonationId: '',
      userId: 'user-1'
    });

    expect(result.warnings).toBeUndefined();
  });

  it('should correctly map all fields from PortfolioService response', async () => {
    mockPortfolioService.getDetails.mockResolvedValue({
      holdings: {
        TSLA: makeHolding({
          name: 'Tesla Inc.',
          symbol: 'TSLA',
          currency: 'USD',
          assetClass: 'EQUITY',
          assetSubClass: 'STOCK',
          allocationInPercentage: 1.0,
          valueInBaseCurrency: 50000,
          netPerformancePercentWithCurrencyEffect: 0.45,
          marketPrice: 250,
          quantity: 200,
          sectors: [{ name: 'Consumer Cyclical', weight: 1 }],
          countries: [{ code: 'US', weight: 1 }]
        })
      },
      hasErrors: false
    });

    const result = await tool.execute({
      impersonationId: '',
      userId: 'user-1'
    });

    const holding = (result.holdings as any[])[0];
    expect(holding.name).toBe('Tesla Inc.');
    expect(holding.symbol).toBe('TSLA');
    expect(holding.currency).toBe('USD');
    expect(holding.assetClass).toBe('EQUITY');
    expect(holding.assetSubClass).toBe('STOCK');
    expect(holding.allocationInPercentage).toBe(1.0);
    expect(holding.valueInBaseCurrency).toBe(50000);
    expect(holding.netPerformancePercentWithCurrencyEffect).toBe(0.45);
    expect(holding.marketPrice).toBe(250);
    expect(holding.quantity).toBe(200);
    expect(holding.sectors).toEqual([{ name: 'Consumer Cyclical', weight: 1 }]);
    expect(holding.countries).toEqual([{ code: 'US', weight: 1 }]);
  });

  it('should pass the correct parameters to PortfolioService.getDetails', async () => {
    mockPortfolioService.getDetails.mockResolvedValue({
      holdings: {},
      hasErrors: false
    });

    await tool.execute({
      impersonationId: 'imp-123',
      userId: 'user-42',
      withMarkets: false,
      withSummary: false
    });

    expect(mockPortfolioService.getDetails).toHaveBeenCalledWith({
      impersonationId: 'imp-123',
      userId: 'user-42',
      withMarkets: false,
      withSummary: false
    });
  });

  it('should default withMarkets and withSummary to true', async () => {
    mockPortfolioService.getDetails.mockResolvedValue({
      holdings: {},
      hasErrors: false
    });

    await tool.execute({
      impersonationId: '',
      userId: 'user-1'
    });

    expect(mockPortfolioService.getDetails).toHaveBeenCalledWith(
      expect.objectContaining({
        withMarkets: true,
        withSummary: true
      })
    );
  });

  it('should return the correct holdingsCount', async () => {
    mockPortfolioService.getDetails.mockResolvedValue(mockPortfolioDetails);

    const result = await tool.execute({
      impersonationId: '',
      userId: 'user-1'
    });

    expect(result.holdingsCount).toBe(5);
  });

  it('should expose a definition with name and parameters', () => {
    const def = tool.definition;
    expect(def.name).toBe('portfolio_summary');
    expect(def.description).toBeTruthy();
    expect(def.parameters.properties).toHaveProperty('withMarkets');
    expect(def.parameters.properties).toHaveProperty('withSummary');
  });

  it('should map feesInBaseCurrency from summary.fees', async () => {
    mockPortfolioService.getDetails.mockResolvedValue({
      ...mockPortfolioDetails,
      summary: makeSummary({ fees: 999 })
    });

    const result = await tool.execute({
      impersonationId: '',
      userId: 'user-1'
    });

    expect((result.summary as any).feesInBaseCurrency).toBe(999);
  });
});
