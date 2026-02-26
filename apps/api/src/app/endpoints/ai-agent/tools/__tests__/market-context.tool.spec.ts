import {
  CRYPTO_SYMBOL_MAP,
  MarketContextTool,
  resolveSymbol
} from '../market-context.tool';

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
        { symbol: 'bitcoin', dataSource: 'COINGECKO' }
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

  it('should auto-resolve BTC to bitcoin with COINGECKO', async () => {
    mockDataProviderService.getQuotes.mockResolvedValue({
      bitcoin: {
        currency: 'USD',
        marketPrice: 65000,
        marketState: 'open',
        dataSource: 'COINGECKO'
      }
    });

    await tool.execute({
      symbols: [{ symbol: 'BTC', dataSource: 'COINGECKO' }]
    });

    expect(mockDataProviderService.getQuotes).toHaveBeenCalledWith({
      items: [{ symbol: 'bitcoin', dataSource: 'COINGECKO' }],
      useCache: true
    });
  });

  it('should auto-resolve ETH to ethereum with COINGECKO', async () => {
    mockDataProviderService.getQuotes.mockResolvedValue({});

    await tool.execute({
      symbols: [{ symbol: 'ETH', dataSource: 'YAHOO' }]
    });

    expect(mockDataProviderService.getQuotes).toHaveBeenCalledWith({
      items: [{ symbol: 'ethereum', dataSource: 'COINGECKO' }],
      useCache: true
    });
  });

  it('should not alter stock symbols like AAPL', async () => {
    mockDataProviderService.getQuotes.mockResolvedValue({});

    await tool.execute({
      symbols: [{ symbol: 'AAPL', dataSource: 'YAHOO' }]
    });

    expect(mockDataProviderService.getQuotes).toHaveBeenCalledWith({
      items: [{ symbol: 'AAPL', dataSource: 'YAHOO' }],
      useCache: true
    });
  });
});

describe('resolveSymbol', () => {
  it('should resolve BTC to bitcoin with COINGECKO', () => {
    expect(resolveSymbol({ symbol: 'BTC', dataSource: 'YAHOO' })).toEqual({
      symbol: 'bitcoin',
      dataSource: 'COINGECKO'
    });
  });

  it('should resolve case-insensitively', () => {
    expect(resolveSymbol({ symbol: 'btc', dataSource: 'YAHOO' })).toEqual({
      symbol: 'bitcoin',
      dataSource: 'COINGECKO'
    });

    expect(resolveSymbol({ symbol: 'Eth', dataSource: 'YAHOO' })).toEqual({
      symbol: 'ethereum',
      dataSource: 'COINGECKO'
    });
  });

  it('should pass through stock symbols unchanged', () => {
    expect(resolveSymbol({ symbol: 'AAPL', dataSource: 'YAHOO' })).toEqual({
      symbol: 'AAPL',
      dataSource: 'YAHOO'
    });

    expect(resolveSymbol({ symbol: 'MSFT', dataSource: 'YAHOO' })).toEqual({
      symbol: 'MSFT',
      dataSource: 'YAHOO'
    });
  });

  it('should resolve full crypto names', () => {
    expect(
      resolveSymbol({ symbol: 'ETHEREUM', dataSource: 'COINGECKO' })
    ).toEqual({
      symbol: 'ethereum',
      dataSource: 'COINGECKO'
    });

    expect(
      resolveSymbol({ symbol: 'BITCOIN', dataSource: 'COINGECKO' })
    ).toEqual({
      symbol: 'bitcoin',
      dataSource: 'COINGECKO'
    });

    expect(
      resolveSymbol({ symbol: 'SOLANA', dataSource: 'COINGECKO' })
    ).toEqual({
      symbol: 'solana',
      dataSource: 'COINGECKO'
    });
  });

  it('should resolve all mapped tickers', () => {
    const expectedMappings: Record<string, string> = {
      BTC: 'bitcoin',
      ETH: 'ethereum',
      SOL: 'solana',
      BNB: 'binancecoin',
      XRP: 'ripple',
      ADA: 'cardano',
      DOGE: 'dogecoin',
      AVAX: 'avalanche-2',
      LINK: 'chainlink',
      LTC: 'litecoin',
      DOT: 'polkadot',
      MATIC: 'matic-network',
      SHIB: 'shiba-inu',
      UNI: 'uniswap',
      ATOM: 'cosmos',
      XLM: 'stellar',
      ALGO: 'algorand',
      FTM: 'fantom',
      NEAR: 'near'
    };

    for (const [ticker, expectedId] of Object.entries(expectedMappings)) {
      const result = resolveSymbol({ symbol: ticker, dataSource: 'YAHOO' });
      expect(result).toEqual({
        symbol: expectedId,
        dataSource: 'COINGECKO'
      });
    }
  });

  it('should have consistent map entries', () => {
    expect(Object.keys(CRYPTO_SYMBOL_MAP).length).toBeGreaterThan(15);

    for (const [key, value] of Object.entries(CRYPTO_SYMBOL_MAP)) {
      expect(key).toBe(key.toUpperCase());
      expect(value).toBe(value.toLowerCase());
    }
  });
});
