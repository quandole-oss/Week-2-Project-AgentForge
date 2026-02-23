import { ComplianceCheckerTool } from '../compliance-checker.tool';

describe('ComplianceCheckerTool', () => {
  let tool: ComplianceCheckerTool;
  let mockPortfolioService: {
    getDetails: jest.Mock;
  };

  const makeHolding = (overrides: Record<string, unknown> = {}) => ({
    name: 'Apple Inc.',
    symbol: 'AAPL',
    currency: 'USD',
    assetClass: 'EQUITY',
    assetSubClass: 'STOCK',
    allocationInPercentage: 0.1,
    valueInBaseCurrency: 10000,
    netPerformancePercentWithCurrencyEffect: 0.1,
    marketPrice: 175,
    quantity: 57,
    sectors: [],
    countries: [],
    ...overrides
  });

  beforeEach(() => {
    mockPortfolioService = {
      getDetails: jest.fn()
    };
    tool = new ComplianceCheckerTool(mockPortfolioService as any);
  });

  it('should detect concentration violation when a holding exceeds 25%', async () => {
    mockPortfolioService.getDetails.mockResolvedValue({
      holdings: {
        AAPL: makeHolding({
          name: 'Apple Inc.',
          symbol: 'AAPL',
          allocationInPercentage: 0.35
        }),
        MSFT: makeHolding({
          name: 'Microsoft Corp.',
          symbol: 'MSFT',
          allocationInPercentage: 0.2
        }),
        GOOGL: makeHolding({
          name: 'Alphabet Inc.',
          symbol: 'GOOGL',
          allocationInPercentage: 0.15
        }),
        AMZN: makeHolding({
          name: 'Amazon.com Inc.',
          symbol: 'AMZN',
          allocationInPercentage: 0.15
        }),
        VTI: makeHolding({
          name: 'Vanguard Total Stock Market ETF',
          symbol: 'VTI',
          allocationInPercentage: 0.15
        })
      },
      hasErrors: false
    });

    const result = await tool.execute({
      impersonationId: '',
      userId: 'user-1',
      ruleSet: ['concentration']
    });

    expect(result.violations.length).toBe(1);
    expect(result.violations[0].rule).toBe('Single Position Concentration');
    expect(result.violations[0].severity).toBe('violation');
    expect(result.violations[0].affectedPositions).toContain('AAPL');
    expect(result.violations[0].value).toBe(0.35);
    expect(result.violations[0].threshold).toBe(0.25);
  });

  it('should detect concentration warning when a holding is between 15%-25%', async () => {
    mockPortfolioService.getDetails.mockResolvedValue({
      holdings: {
        AAPL: makeHolding({
          name: 'Apple Inc.',
          symbol: 'AAPL',
          allocationInPercentage: 0.2
        }),
        MSFT: makeHolding({
          name: 'Microsoft Corp.',
          symbol: 'MSFT',
          allocationInPercentage: 0.2
        }),
        GOOGL: makeHolding({
          name: 'Alphabet Inc.',
          symbol: 'GOOGL',
          allocationInPercentage: 0.2
        }),
        AMZN: makeHolding({
          name: 'Amazon.com Inc.',
          symbol: 'AMZN',
          allocationInPercentage: 0.2
        }),
        VTI: makeHolding({
          name: 'Vanguard Total Stock Market ETF',
          symbol: 'VTI',
          allocationInPercentage: 0.2
        })
      },
      hasErrors: false
    });

    const result = await tool.execute({
      impersonationId: '',
      userId: 'user-1',
      ruleSet: ['concentration']
    });

    expect(result.violations.length).toBe(0);
    expect(result.warnings.length).toBe(5);
    for (const warning of result.warnings) {
      expect(warning.rule).toBe('Single Position Concentration');
      expect(warning.severity).toBe('warning');
    }
  });

  it('should detect diversification violation when single asset class exceeds 80%', async () => {
    mockPortfolioService.getDetails.mockResolvedValue({
      holdings: {
        AAPL: makeHolding({
          symbol: 'AAPL',
          assetClass: 'EQUITY',
          allocationInPercentage: 0.3
        }),
        MSFT: makeHolding({
          symbol: 'MSFT',
          assetClass: 'EQUITY',
          allocationInPercentage: 0.3
        }),
        GOOGL: makeHolding({
          symbol: 'GOOGL',
          assetClass: 'EQUITY',
          allocationInPercentage: 0.25
        }),
        BND: makeHolding({
          symbol: 'BND',
          assetClass: 'FIXED_INCOME',
          allocationInPercentage: 0.1
        }),
        GLD: makeHolding({
          symbol: 'GLD',
          assetClass: 'COMMODITY',
          allocationInPercentage: 0.05
        })
      },
      hasErrors: false
    });

    const result = await tool.execute({
      impersonationId: '',
      userId: 'user-1',
      ruleSet: ['diversification']
    });

    const assetClassViolations = result.violations.filter(
      (v: any) => v.rule === 'Asset Class Diversification'
    );
    expect(assetClassViolations.length).toBe(1);
    expect(assetClassViolations[0].value).toBeCloseTo(0.85, 2);
    expect(assetClassViolations[0].affectedPositions).toEqual(
      expect.arrayContaining(['AAPL', 'MSFT', 'GOOGL'])
    );
  });

  it('should detect minimum holdings warning when portfolio has fewer than 5 holdings', async () => {
    mockPortfolioService.getDetails.mockResolvedValue({
      holdings: {
        AAPL: makeHolding({ symbol: 'AAPL', allocationInPercentage: 0.5 }),
        MSFT: makeHolding({ symbol: 'MSFT', allocationInPercentage: 0.3 }),
        BND: makeHolding({ symbol: 'BND', allocationInPercentage: 0.2 })
      },
      hasErrors: false
    });

    const result = await tool.execute({
      impersonationId: '',
      userId: 'user-1',
      ruleSet: ['diversification']
    });

    const minHoldingsWarnings = result.warnings.filter(
      (w: any) => w.rule === 'Minimum Holdings'
    );
    expect(minHoldingsWarnings.length).toBe(1);
    expect(minHoldingsWarnings[0].value).toBe(3);
    expect(minHoldingsWarnings[0].threshold).toBe(5);
    expect(minHoldingsWarnings[0].description).toContain('only 3 holdings');
  });

  it('should detect currency concentration warning when currency exceeds 70%', async () => {
    mockPortfolioService.getDetails.mockResolvedValue({
      holdings: {
        AAPL: makeHolding({
          symbol: 'AAPL',
          currency: 'USD',
          allocationInPercentage: 0.3
        }),
        MSFT: makeHolding({
          symbol: 'MSFT',
          currency: 'USD',
          allocationInPercentage: 0.25
        }),
        GOOGL: makeHolding({
          symbol: 'GOOGL',
          currency: 'USD',
          allocationInPercentage: 0.25
        }),
        SAP: makeHolding({
          symbol: 'SAP',
          currency: 'EUR',
          allocationInPercentage: 0.1
        }),
        NESN: makeHolding({
          symbol: 'NESN',
          currency: 'CHF',
          allocationInPercentage: 0.1
        })
      },
      hasErrors: false
    });

    const result = await tool.execute({
      impersonationId: '',
      userId: 'user-1',
      ruleSet: ['currency']
    });

    const currencyWarnings = result.warnings.filter(
      (w: any) => w.rule === 'Currency Concentration'
    );
    expect(currencyWarnings.length).toBe(1);
    expect(currencyWarnings[0].value).toBeCloseTo(0.8, 2);
    expect(currencyWarnings[0].description).toContain('USD');
    expect(currencyWarnings[0].affectedPositions).toEqual(
      expect.arrayContaining(['AAPL', 'MSFT', 'GOOGL'])
    );
  });

  it('should report fully compliant for a well-diversified portfolio', async () => {
    mockPortfolioService.getDetails.mockResolvedValue({
      holdings: {
        AAPL: makeHolding({
          symbol: 'AAPL',
          currency: 'USD',
          assetClass: 'EQUITY',
          allocationInPercentage: 0.12
        }),
        MSFT: makeHolding({
          symbol: 'MSFT',
          currency: 'USD',
          assetClass: 'EQUITY',
          allocationInPercentage: 0.12
        }),
        SAP: makeHolding({
          symbol: 'SAP',
          currency: 'EUR',
          assetClass: 'EQUITY',
          allocationInPercentage: 0.12
        }),
        NESN: makeHolding({
          symbol: 'NESN',
          currency: 'CHF',
          assetClass: 'EQUITY',
          allocationInPercentage: 0.12
        }),
        BND: makeHolding({
          symbol: 'BND',
          currency: 'USD',
          assetClass: 'FIXED_INCOME',
          allocationInPercentage: 0.14
        }),
        GLD: makeHolding({
          symbol: 'GLD',
          currency: 'USD',
          assetClass: 'COMMODITY',
          allocationInPercentage: 0.14
        }),
        VNQ: makeHolding({
          symbol: 'VNQ',
          currency: 'EUR',
          assetClass: 'REAL_ESTATE',
          allocationInPercentage: 0.12
        }),
        TIP: makeHolding({
          symbol: 'TIP',
          currency: 'CHF',
          assetClass: 'FIXED_INCOME',
          allocationInPercentage: 0.12
        })
      },
      hasErrors: false
    });

    const result = await tool.execute({
      impersonationId: '',
      userId: 'user-1',
      ruleSet: ['concentration', 'diversification', 'currency']
    });

    expect(result.summary.isCompliant).toBe(true);
    expect(result.summary.violationCount).toBe(0);
    expect(result.violations.length).toBe(0);
  });

  it('should detect multiple violations across different rule sets', async () => {
    mockPortfolioService.getDetails.mockResolvedValue({
      holdings: {
        AAPL: makeHolding({
          name: 'Apple Inc.',
          symbol: 'AAPL',
          currency: 'USD',
          assetClass: 'EQUITY',
          allocationInPercentage: 0.5
        }),
        MSFT: makeHolding({
          name: 'Microsoft Corp.',
          symbol: 'MSFT',
          currency: 'USD',
          assetClass: 'EQUITY',
          allocationInPercentage: 0.5
        })
      },
      hasErrors: false
    });

    const result = await tool.execute({
      impersonationId: '',
      userId: 'user-1',
      ruleSet: ['concentration', 'diversification', 'currency']
    });

    // Concentration: both AAPL and MSFT exceed 25% -> 2 violations
    // Diversification: EQUITY at 100% > 80% -> 1 violation; <5 holdings -> 1 warning
    // Currency: USD at 100% > 70% -> 1 warning
    expect(result.violations.length).toBeGreaterThanOrEqual(3);
    expect(result.warnings.length).toBeGreaterThanOrEqual(2);
    expect(result.summary.isCompliant).toBe(false);
  });

  it('should only check the requested rule sets', async () => {
    mockPortfolioService.getDetails.mockResolvedValue({
      holdings: {
        AAPL: makeHolding({
          name: 'Apple Inc.',
          symbol: 'AAPL',
          currency: 'USD',
          assetClass: 'EQUITY',
          allocationInPercentage: 0.5
        }),
        MSFT: makeHolding({
          name: 'Microsoft Corp.',
          symbol: 'MSFT',
          currency: 'USD',
          assetClass: 'EQUITY',
          allocationInPercentage: 0.5
        })
      },
      hasErrors: false
    });

    const result = await tool.execute({
      impersonationId: '',
      userId: 'user-1',
      ruleSet: ['currency']
    });

    // Only currency rules should be checked, no concentration/diversification
    expect(result.rulesChecked).toEqual(['currency']);
    const concentrationIssues = [
      ...result.violations,
      ...result.warnings
    ].filter(
      (v: any) =>
        v.rule === 'Single Position Concentration' ||
        v.rule === 'Asset Class Diversification' ||
        v.rule === 'Minimum Holdings'
    );
    expect(concentrationIssues.length).toBe(0);
  });

  it('should return the correct totalHoldings count', async () => {
    mockPortfolioService.getDetails.mockResolvedValue({
      holdings: {
        AAPL: makeHolding({ symbol: 'AAPL', allocationInPercentage: 0.1 }),
        MSFT: makeHolding({ symbol: 'MSFT', allocationInPercentage: 0.1 }),
        GOOGL: makeHolding({ symbol: 'GOOGL', allocationInPercentage: 0.1 }),
        AMZN: makeHolding({ symbol: 'AMZN', allocationInPercentage: 0.1 }),
        VTI: makeHolding({ symbol: 'VTI', allocationInPercentage: 0.1 }),
        BND: makeHolding({ symbol: 'BND', allocationInPercentage: 0.1 }),
        GLD: makeHolding({ symbol: 'GLD', allocationInPercentage: 0.1 })
      },
      hasErrors: false
    });

    const result = await tool.execute({
      impersonationId: '',
      userId: 'user-1'
    });

    expect(result.totalHoldings).toBe(7);
  });

  it('should pass correct parameters to PortfolioService.getDetails', async () => {
    mockPortfolioService.getDetails.mockResolvedValue({
      holdings: {},
      hasErrors: false
    });

    await tool.execute({
      impersonationId: 'imp-99',
      userId: 'user-99'
    });

    expect(mockPortfolioService.getDetails).toHaveBeenCalledWith({
      impersonationId: 'imp-99',
      userId: 'user-99',
      withSummary: true
    });
  });

  it('should handle holdings with null/undefined assetClass as UNKNOWN', async () => {
    mockPortfolioService.getDetails.mockResolvedValue({
      holdings: {
        MYSTERY: makeHolding({
          symbol: 'MYSTERY',
          assetClass: undefined,
          allocationInPercentage: 0.9
        }),
        BND: makeHolding({
          symbol: 'BND',
          assetClass: 'FIXED_INCOME',
          allocationInPercentage: 0.1
        })
      },
      hasErrors: false
    });

    const result = await tool.execute({
      impersonationId: '',
      userId: 'user-1',
      ruleSet: ['diversification']
    });

    const unknownViolation = result.violations.find(
      (v: any) => v.description.includes('UNKNOWN')
    );
    expect(unknownViolation).toBeDefined();
    expect(unknownViolation.value).toBeCloseTo(0.9, 2);
  });
});
