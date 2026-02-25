import { MarketContextTool } from '../market-context.tool';

describe('MarketContextTool', () => {
  let tool: MarketContextTool;
  let mockDataProviderService: {
    getQuotes: jest.Mock;
  };
  let mockMarketDataService: {
    getRange: jest.Mock;
  };

  beforeEach(() => {
    mockDataProviderService = {
      getQuotes: jest.fn()
    };
    mockMarketDataService = {
      getRange: jest.fn().mockResolvedValue([])
    };
    tool = new MarketContextTool(
      mockDataProviderService as any,
      mockMarketDataService as any
    );
  });

  it('should return quotes for requested symbols', async () => {
    mockDataProviderService.getQuotes.mockResolvedValue({
      AAPL: {
        currency: 'USD',
        marketPrice: 175.5,
        marketState: 'open',
        dataSource: 'YAHOO'
      }
    });

    const result = await tool.execute({
      symbols: [{ symbol: 'AAPL', dataSource: 'YAHOO' }]
    });

    expect(result.quotes).toHaveLength(1);
    expect(result.quotes[0].symbol).toBe('AAPL');
    expect(result.quotes[0].currency).toBe('USD');
    expect(result.quotes[0].marketPrice).toBe(175.5);
    expect(result.quotes[0].marketState).toBe('open');
    expect(result.quotes[0].dataSource).toBe('YAHOO');
  });

  it('should return quotes for multiple symbols', async () => {
    mockDataProviderService.getQuotes.mockResolvedValue({
      AAPL: {
        currency: 'USD',
        marketPrice: 175.5,
        marketState: 'open',
        dataSource: 'YAHOO'
      },
      MSFT: {
        currency: 'USD',
        marketPrice: 380.25,
        marketState: 'open',
        dataSource: 'YAHOO'
      },
      BTC: {
        currency: 'USD',
        marketPrice: 45000,
        marketState: 'open',
        dataSource: 'COINGECKO'
      }
    });

    const result = await tool.execute({
      symbols: [
        { symbol: 'AAPL', dataSource: 'YAHOO' },
        { symbol: 'MSFT', dataSource: 'YAHOO' },
        { symbol: 'BTC', dataSource: 'COINGECKO' }
      ]
    });

    expect(result.quotes).toHaveLength(3);
    const symbols = result.quotes.map((q: any) => q.symbol);
    expect(symbols).toContain('AAPL');
    expect(symbols).toContain('MSFT');
    expect(symbols).toContain('BTC');
  });

  it('should include a timestamp in the result', async () => {
    mockDataProviderService.getQuotes.mockResolvedValue({});

    const result = await tool.execute({ symbols: [] });

    expect(result.timestamp).toBeDefined();
    expect(new Date(result.timestamp).getTime()).not.toBeNaN();
  });

  it('should pass items with correct dataSource type to getQuotes', async () => {
    mockDataProviderService.getQuotes.mockResolvedValue({});

    await tool.execute({
      symbols: [
        { symbol: 'AAPL', dataSource: 'YAHOO' },
        { symbol: 'BTC', dataSource: 'COINGECKO' }
      ]
    });

    expect(mockDataProviderService.getQuotes).toHaveBeenCalledWith({
      items: [
        { symbol: 'AAPL', dataSource: 'YAHOO' },
        { symbol: 'BTC', dataSource: 'COINGECKO' }
      ],
      useCache: true
    });
  });

  it('should handle empty symbols array', async () => {
    mockDataProviderService.getQuotes.mockResolvedValue({});

    const result = await tool.execute({ symbols: [] });

    expect(result.quotes).toEqual([]);
  });

  it('should handle market closed state', async () => {
    mockDataProviderService.getQuotes.mockResolvedValue({
      AAPL: {
        currency: 'USD',
        marketPrice: 175.5,
        marketState: 'closed',
        dataSource: 'YAHOO'
      }
    });

    const result = await tool.execute({
      symbols: [{ symbol: 'AAPL', dataSource: 'YAHOO' }]
    });

    expect(result.quotes[0].marketState).toBe('closed');
  });

  it('should handle non-USD currencies', async () => {
    mockDataProviderService.getQuotes.mockResolvedValue({
      NESN: {
        currency: 'CHF',
        marketPrice: 95.5,
        marketState: 'open',
        dataSource: 'YAHOO'
      }
    });

    const result = await tool.execute({
      symbols: [{ symbol: 'NESN', dataSource: 'YAHOO' }]
    });

    expect(result.quotes[0].currency).toBe('CHF');
    expect(result.quotes[0].marketPrice).toBe(95.5);
  });

  it('should always request with useCache: true', async () => {
    mockDataProviderService.getQuotes.mockResolvedValue({});

    await tool.execute({
      symbols: [{ symbol: 'AAPL', dataSource: 'YAHOO' }]
    });

    expect(mockDataProviderService.getQuotes).toHaveBeenCalledWith(
      expect.objectContaining({ useCache: true })
    );
  });
});
