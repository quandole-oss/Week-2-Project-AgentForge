import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ── Stable UUIDs for idempotent seeding ──────────────────────────────────────
const DEMO_USER_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

const PLATFORM_IBKR_ID = 'p0000001-0000-4000-a000-000000000001';
const PLATFORM_COINBASE_ID = 'p0000002-0000-4000-a000-000000000002';

const ACCOUNT_BROKERAGE_ID = 'ac000001-0000-4000-a000-000000000001';
const ACCOUNT_RETIREMENT_ID = 'ac000002-0000-4000-a000-000000000002';
const ACCOUNT_CRYPTO_ID = 'ac000003-0000-4000-a000-000000000003';

const SP_AAPL = 'sp000001-0000-4000-a000-000000000001';
const SP_MSFT = 'sp000002-0000-4000-a000-000000000002';
const SP_VTI = 'sp000003-0000-4000-a000-000000000003';
const SP_VXUS = 'sp000004-0000-4000-a000-000000000004';
const SP_BND = 'sp000005-0000-4000-a000-000000000005';
const SP_GLD = 'sp000006-0000-4000-a000-000000000006';
const SP_BTC = 'sp000007-0000-4000-a000-000000000007';
const SP_CASH = 'sp000008-0000-4000-a000-000000000008';

async function main() {
  // ── Global Tags ──────────────────────────────────────────────────────────
  await prisma.tag.createMany({
    data: [
      {
        id: '4452656d-9fa4-4bd0-ba38-70492e31d180',
        name: 'EMERGENCY_FUND'
      },
      {
        id: 'f2e868af-8333-459f-b161-cbc6544c24bd',
        name: 'EXCLUDE_FROM_ANALYSIS'
      }
    ],
    skipDuplicates: true
  });

  // ── Demo User ────────────────────────────────────────────────────────────
  await prisma.user.upsert({
    where: { id: DEMO_USER_ID },
    update: {},
    create: {
      id: DEMO_USER_ID,
      provider: 'ANONYMOUS',
      role: 'ADMIN'
    }
  });

  await prisma.settings.upsert({
    where: { userId: DEMO_USER_ID },
    update: {},
    create: {
      userId: DEMO_USER_ID,
      settings: {
        baseCurrency: 'USD',
        locale: 'en-US',
        viewMode: 'DEFAULT'
      }
    }
  });

  await prisma.analytics.upsert({
    where: { userId: DEMO_USER_ID },
    update: { activityCount: 42 },
    create: {
      userId: DEMO_USER_ID,
      activityCount: 42
    }
  });

  // ── Platforms ────────────────────────────────────────────────────────────
  await prisma.platform.upsert({
    where: { url: 'https://www.interactivebrokers.com' },
    update: {},
    create: {
      id: PLATFORM_IBKR_ID,
      name: 'Interactive Brokers',
      url: 'https://www.interactivebrokers.com'
    }
  });

  await prisma.platform.upsert({
    where: { url: 'https://www.coinbase.com' },
    update: {},
    create: {
      id: PLATFORM_COINBASE_ID,
      name: 'Coinbase',
      url: 'https://www.coinbase.com'
    }
  });

  // ── Symbol Profiles ──────────────────────────────────────────────────────
  const symbolProfiles = [
    {
      id: SP_AAPL,
      symbol: 'AAPL',
      name: 'Apple Inc.',
      currency: 'USD',
      dataSource: 'YAHOO' as const,
      assetClass: 'EQUITY' as const,
      assetSubClass: 'STOCK' as const,
      countries: [
        { code: 'US', name: 'United States', continent: 'North America', weight: 1 }
      ],
      sectors: [{ name: 'Technology', weight: 1 }],
      isin: 'US0378331005'
    },
    {
      id: SP_MSFT,
      symbol: 'MSFT',
      name: 'Microsoft Corporation',
      currency: 'USD',
      dataSource: 'YAHOO' as const,
      assetClass: 'EQUITY' as const,
      assetSubClass: 'STOCK' as const,
      countries: [
        { code: 'US', name: 'United States', continent: 'North America', weight: 1 }
      ],
      sectors: [{ name: 'Technology', weight: 1 }],
      isin: 'US5949181045'
    },
    {
      id: SP_VTI,
      symbol: 'VTI',
      name: 'Vanguard Total Stock Market ETF',
      currency: 'USD',
      dataSource: 'YAHOO' as const,
      assetClass: 'EQUITY' as const,
      assetSubClass: 'ETF' as const,
      countries: [
        { code: 'US', name: 'United States', continent: 'North America', weight: 1 }
      ],
      sectors: [
        { name: 'Technology', weight: 0.30 },
        { name: 'Healthcare', weight: 0.13 },
        { name: 'Financials', weight: 0.13 },
        { name: 'Consumer Discretionary', weight: 0.10 },
        { name: 'Industrials', weight: 0.10 },
        { name: 'Other', weight: 0.24 }
      ],
      isin: 'US9229087690'
    },
    {
      id: SP_VXUS,
      symbol: 'VXUS',
      name: 'Vanguard Total International Stock ETF',
      currency: 'USD',
      dataSource: 'YAHOO' as const,
      assetClass: 'EQUITY' as const,
      assetSubClass: 'ETF' as const,
      countries: [
        { code: 'JP', name: 'Japan', continent: 'Asia', weight: 0.15 },
        { code: 'GB', name: 'United Kingdom', continent: 'Europe', weight: 0.10 },
        { code: 'CN', name: 'China', continent: 'Asia', weight: 0.08 },
        { code: 'CA', name: 'Canada', continent: 'North America', weight: 0.07 },
        { code: 'FR', name: 'France', continent: 'Europe', weight: 0.07 },
        { code: 'DE', name: 'Germany', continent: 'Europe', weight: 0.06 },
        { code: 'OTHER', name: 'Other', continent: 'Other', weight: 0.47 }
      ],
      sectors: [
        { name: 'Financials', weight: 0.22 },
        { name: 'Technology', weight: 0.14 },
        { name: 'Industrials', weight: 0.13 },
        { name: 'Consumer Discretionary', weight: 0.11 },
        { name: 'Other', weight: 0.40 }
      ],
      isin: 'US9219097683'
    },
    {
      id: SP_BND,
      symbol: 'BND',
      name: 'Vanguard Total Bond Market ETF',
      currency: 'USD',
      dataSource: 'YAHOO' as const,
      assetClass: 'FIXED_INCOME' as const,
      assetSubClass: 'ETF' as const,
      countries: [
        { code: 'US', name: 'United States', continent: 'North America', weight: 1 }
      ],
      sectors: [
        { name: 'Government', weight: 0.46 },
        { name: 'Corporate', weight: 0.27 },
        { name: 'Securitized', weight: 0.27 }
      ],
      isin: 'US9219378356'
    },
    {
      id: SP_GLD,
      symbol: 'GLD',
      name: 'SPDR Gold Shares',
      currency: 'USD',
      dataSource: 'YAHOO' as const,
      assetClass: 'COMMODITY' as const,
      assetSubClass: 'ETF' as const,
      countries: [
        { code: 'US', name: 'United States', continent: 'North America', weight: 1 }
      ],
      sectors: [{ name: 'Precious Metals', weight: 1 }],
      isin: 'US78463V1070'
    },
    {
      id: SP_BTC,
      symbol: 'BTC-USD',
      name: 'Bitcoin',
      currency: 'USD',
      dataSource: 'COINGECKO' as const,
      assetClass: 'EQUITY' as const,
      assetSubClass: 'CRYPTOCURRENCY' as const,
      countries: [],
      sectors: [{ name: 'Cryptocurrency', weight: 1 }],
      isin: null
    },
    {
      id: SP_CASH,
      symbol: 'USD',
      name: 'US Dollar Cash',
      currency: 'USD',
      dataSource: 'MANUAL' as const,
      assetClass: 'LIQUIDITY' as const,
      assetSubClass: 'CASH' as const,
      countries: [
        { code: 'US', name: 'United States', continent: 'North America', weight: 1 }
      ],
      sectors: [],
      isin: null
    }
  ];

  for (const sp of symbolProfiles) {
    await prisma.symbolProfile.upsert({
      where: {
        dataSource_symbol: { dataSource: sp.dataSource, symbol: sp.symbol }
      },
      update: {
        name: sp.name,
        assetClass: sp.assetClass,
        assetSubClass: sp.assetSubClass,
        countries: sp.countries,
        sectors: sp.sectors
      },
      create: {
        id: sp.id,
        symbol: sp.symbol,
        name: sp.name,
        currency: sp.currency,
        dataSource: sp.dataSource,
        assetClass: sp.assetClass,
        assetSubClass: sp.assetSubClass,
        countries: sp.countries,
        sectors: sp.sectors,
        isin: sp.isin
      }
    });
  }

  // ── MarketData (latest prices for market_context tool) ───────────────────
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const marketPrices = [
    { dataSource: 'YAHOO' as const, symbol: 'AAPL', marketPrice: 189.84 },
    { dataSource: 'YAHOO' as const, symbol: 'MSFT', marketPrice: 415.60 },
    { dataSource: 'YAHOO' as const, symbol: 'VTI', marketPrice: 272.35 },
    { dataSource: 'YAHOO' as const, symbol: 'VXUS', marketPrice: 60.18 },
    { dataSource: 'YAHOO' as const, symbol: 'BND', marketPrice: 72.45 },
    { dataSource: 'YAHOO' as const, symbol: 'GLD', marketPrice: 188.92 },
    { dataSource: 'COINGECKO' as const, symbol: 'BTC-USD', marketPrice: 51234.00 },
    { dataSource: 'MANUAL' as const, symbol: 'USD', marketPrice: 1.00 }
  ];

  for (const mp of marketPrices) {
    await prisma.marketData.upsert({
      where: {
        dataSource_date_symbol: {
          dataSource: mp.dataSource,
          date: today,
          symbol: mp.symbol
        }
      },
      update: { marketPrice: mp.marketPrice },
      create: {
        dataSource: mp.dataSource,
        date: today,
        symbol: mp.symbol,
        marketPrice: mp.marketPrice,
        state: 'CLOSE'
      }
    });
  }

  // ── Accounts ─────────────────────────────────────────────────────────────
  const accounts = [
    {
      id: ACCOUNT_BROKERAGE_ID,
      userId: DEMO_USER_ID,
      name: 'Interactive Brokers Brokerage',
      currency: 'USD',
      balance: 4200,
      platformId: PLATFORM_IBKR_ID,
      isExcluded: false
    },
    {
      id: ACCOUNT_RETIREMENT_ID,
      userId: DEMO_USER_ID,
      name: 'IRA Retirement',
      currency: 'USD',
      balance: 1800,
      platformId: PLATFORM_IBKR_ID,
      isExcluded: false
    },
    {
      id: ACCOUNT_CRYPTO_ID,
      userId: DEMO_USER_ID,
      name: 'Coinbase Crypto',
      currency: 'USD',
      balance: 0,
      platformId: PLATFORM_COINBASE_ID,
      isExcluded: false
    }
  ];

  for (const acct of accounts) {
    // Upsert via raw query since Account has composite PK
    const existing = await prisma.account.findFirst({
      where: { id: acct.id, userId: acct.userId }
    });

    if (!existing) {
      await prisma.account.create({ data: acct });
    }
  }

  // ── Orders (Transactions) ────────────────────────────────────────────────
  // Delete existing demo orders to allow re-seeding cleanly
  await prisma.order.deleteMany({ where: { userId: DEMO_USER_ID } });

  const d = (y: number, m: number, day: number) =>
    new Date(Date.UTC(y, m - 1, day));

  // We resolve symbol profile IDs dynamically in case upsert used existing rows
  const resolveSpId = async (dataSource: string, symbol: string) => {
    const sp = await prisma.symbolProfile.findUnique({
      where: {
        dataSource_symbol: {
          dataSource: dataSource as any,
          symbol
        }
      }
    });
    return sp!.id;
  };

  const aaplId = await resolveSpId('YAHOO', 'AAPL');
  const msftId = await resolveSpId('YAHOO', 'MSFT');
  const vtiId = await resolveSpId('YAHOO', 'VTI');
  const vxusId = await resolveSpId('YAHOO', 'VXUS');
  const bndId = await resolveSpId('YAHOO', 'BND');
  const gldId = await resolveSpId('YAHOO', 'GLD');
  const btcId = await resolveSpId('COINGECKO', 'BTC-USD');
  const cashId = await resolveSpId('MANUAL', 'USD');

  const orders = [
    // ── 2024 Q1: Initial portfolio setup ──────────────────────────────────
    { date: d(2024, 1, 15), type: 'BUY' as const, symbol: vtiId, qty: 50,  price: 232.10, fee: 0,    accountId: ACCOUNT_BROKERAGE_ID, currency: 'USD' },
    { date: d(2024, 1, 15), type: 'BUY' as const, symbol: vxusId, qty: 100, price: 53.20,  fee: 0,    accountId: ACCOUNT_BROKERAGE_ID, currency: 'USD' },
    { date: d(2024, 1, 18), type: 'BUY' as const, symbol: aaplId, qty: 30,  price: 185.92, fee: 1.00, accountId: ACCOUNT_BROKERAGE_ID, currency: 'USD' },
    { date: d(2024, 1, 22), type: 'BUY' as const, symbol: bndId,  qty: 100, price: 73.85,  fee: 0,    accountId: ACCOUNT_RETIREMENT_ID, currency: 'USD' },
    { date: d(2024, 1, 25), type: 'BUY' as const, symbol: btcId,  qty: 0.15, price: 39800, fee: 14.93, accountId: ACCOUNT_CRYPTO_ID, currency: 'USD' },
    { date: d(2024, 2, 5),  type: 'BUY' as const, symbol: msftId, qty: 15,  price: 404.87, fee: 1.00, accountId: ACCOUNT_BROKERAGE_ID, currency: 'USD' },
    { date: d(2024, 2, 12), type: 'BUY' as const, symbol: gldId,  qty: 20,  price: 185.40, fee: 0,    accountId: ACCOUNT_RETIREMENT_ID, currency: 'USD' },

    // ── 2024 Q1 Dividends ──────────────────────────────────────────────────
    { date: d(2024, 2, 9),  type: 'DIVIDEND' as const, symbol: aaplId, qty: 30,  price: 0.24, fee: 0, accountId: ACCOUNT_BROKERAGE_ID, currency: 'USD' },
    { date: d(2024, 3, 11), type: 'DIVIDEND' as const, symbol: vtiId,  qty: 50,  price: 0.87, fee: 0, accountId: ACCOUNT_BROKERAGE_ID, currency: 'USD' },

    // ── 2024 Q2: DCA and rebalancing ──────────────────────────────────────
    { date: d(2024, 4, 8),  type: 'BUY' as const, symbol: vtiId,  qty: 20,  price: 245.30, fee: 0,    accountId: ACCOUNT_BROKERAGE_ID, currency: 'USD' },
    { date: d(2024, 4, 15), type: 'BUY' as const, symbol: aaplId, qty: 10,  price: 167.04, fee: 1.00, accountId: ACCOUNT_BROKERAGE_ID, currency: 'USD' },
    { date: d(2024, 5, 3),  type: 'BUY' as const, symbol: bndId,  qty: 50,  price: 71.90,  fee: 0,    accountId: ACCOUNT_RETIREMENT_ID, currency: 'USD' },
    { date: d(2024, 5, 10), type: 'DIVIDEND' as const, symbol: aaplId, qty: 40,  price: 0.25, fee: 0, accountId: ACCOUNT_BROKERAGE_ID, currency: 'USD' },
    { date: d(2024, 5, 20), type: 'BUY' as const, symbol: vxusId, qty: 60,  price: 56.42,  fee: 0,    accountId: ACCOUNT_BROKERAGE_ID, currency: 'USD' },
    { date: d(2024, 6, 10), type: 'DIVIDEND' as const, symbol: vtiId, qty: 70, price: 0.92, fee: 0, accountId: ACCOUNT_BROKERAGE_ID, currency: 'USD' },
    { date: d(2024, 6, 14), type: 'SELL' as const, symbol: aaplId, qty: 10, price: 214.29, fee: 1.00, accountId: ACCOUNT_BROKERAGE_ID, currency: 'USD' },

    // ── 2024 Q3: More accumulation ────────────────────────────────────────
    { date: d(2024, 7, 12), type: 'BUY' as const, symbol: msftId, qty: 10,  price: 453.55, fee: 1.00, accountId: ACCOUNT_BROKERAGE_ID, currency: 'USD' },
    { date: d(2024, 7, 22), type: 'BUY' as const, symbol: vtiId,  qty: 15,  price: 268.10, fee: 0,    accountId: ACCOUNT_BROKERAGE_ID, currency: 'USD' },
    { date: d(2024, 8, 9),  type: 'DIVIDEND' as const, symbol: aaplId, qty: 30, price: 0.25, fee: 0, accountId: ACCOUNT_BROKERAGE_ID, currency: 'USD' },
    { date: d(2024, 8, 15), type: 'BUY' as const, symbol: btcId,  qty: 0.05, price: 58300, fee: 7.29, accountId: ACCOUNT_CRYPTO_ID, currency: 'USD' },
    { date: d(2024, 9, 5),  type: 'BUY' as const, symbol: gldId,  qty: 10,  price: 235.20, fee: 0,    accountId: ACCOUNT_RETIREMENT_ID, currency: 'USD' },
    { date: d(2024, 9, 16), type: 'DIVIDEND' as const, symbol: vtiId, qty: 85, price: 0.89, fee: 0, accountId: ACCOUNT_BROKERAGE_ID, currency: 'USD' },

    // ── 2024 Q4: Year-end activity ────────────────────────────────────────
    { date: d(2024, 10, 7),  type: 'BUY' as const, symbol: vxusId, qty: 40,  price: 57.80, fee: 0,    accountId: ACCOUNT_BROKERAGE_ID, currency: 'USD' },
    { date: d(2024, 10, 18), type: 'SELL' as const, symbol: msftId, qty: 5,   price: 418.92, fee: 1.00, accountId: ACCOUNT_BROKERAGE_ID, currency: 'USD' },
    { date: d(2024, 11, 8),  type: 'DIVIDEND' as const, symbol: aaplId, qty: 30, price: 0.25, fee: 0, accountId: ACCOUNT_BROKERAGE_ID, currency: 'USD' },
    { date: d(2024, 11, 15), type: 'BUY' as const, symbol: bndId,  qty: 30,  price: 72.10, fee: 0,    accountId: ACCOUNT_RETIREMENT_ID, currency: 'USD' },
    { date: d(2024, 12, 9),  type: 'DIVIDEND' as const, symbol: vtiId, qty: 85, price: 1.02, fee: 0, accountId: ACCOUNT_BROKERAGE_ID, currency: 'USD' },
    { date: d(2024, 12, 15), type: 'FEE' as const, symbol: cashId, qty: 1,    price: 12.00, fee: 12.00, accountId: ACCOUNT_BROKERAGE_ID, currency: 'USD' },

    // ── 2025 Q1: New year DCA ─────────────────────────────────────────────
    { date: d(2025, 1, 10), type: 'BUY' as const, symbol: vtiId,  qty: 10,  price: 265.40, fee: 0,    accountId: ACCOUNT_BROKERAGE_ID, currency: 'USD' },
    { date: d(2025, 1, 15), type: 'BUY' as const, symbol: aaplId, qty: 15,  price: 236.00, fee: 1.00, accountId: ACCOUNT_BROKERAGE_ID, currency: 'USD' },
    { date: d(2025, 2, 7),  type: 'DIVIDEND' as const, symbol: aaplId, qty: 45, price: 0.25, fee: 0, accountId: ACCOUNT_BROKERAGE_ID, currency: 'USD' },
    { date: d(2025, 2, 14), type: 'BUY' as const, symbol: msftId, qty: 5,   price: 409.30, fee: 1.00, accountId: ACCOUNT_BROKERAGE_ID, currency: 'USD' },
    { date: d(2025, 3, 12), type: 'DIVIDEND' as const, symbol: vtiId, qty: 95, price: 0.95, fee: 0, accountId: ACCOUNT_BROKERAGE_ID, currency: 'USD' },
    { date: d(2025, 3, 20), type: 'BUY' as const, symbol: btcId,  qty: 0.03, price: 84100, fee: 6.31, accountId: ACCOUNT_CRYPTO_ID, currency: 'USD' },

    // ── 2025 Q2–current: Recent activity ──────────────────────────────────
    { date: d(2025, 4, 14), type: 'BUY' as const, symbol: vxusId, qty: 30,  price: 58.95,  fee: 0,    accountId: ACCOUNT_BROKERAGE_ID, currency: 'USD' },
    { date: d(2025, 5, 9),  type: 'DIVIDEND' as const, symbol: aaplId, qty: 45, price: 0.26, fee: 0, accountId: ACCOUNT_BROKERAGE_ID, currency: 'USD' },
    { date: d(2025, 6, 10), type: 'BUY' as const, symbol: vtiId,  qty: 10,  price: 270.15, fee: 0,    accountId: ACCOUNT_BROKERAGE_ID, currency: 'USD' },
    { date: d(2025, 7, 15), type: 'SELL' as const, symbol: vxusId, qty: 30,  price: 61.40,  fee: 0,    accountId: ACCOUNT_BROKERAGE_ID, currency: 'USD' },
    { date: d(2025, 8, 11), type: 'DIVIDEND' as const, symbol: aaplId, qty: 45, price: 0.26, fee: 0, accountId: ACCOUNT_BROKERAGE_ID, currency: 'USD' },
    { date: d(2025, 9, 15), type: 'BUY' as const, symbol: bndId,  qty: 20,  price: 73.10,  fee: 0,    accountId: ACCOUNT_RETIREMENT_ID, currency: 'USD' },
    { date: d(2025, 10, 8), type: 'INTEREST' as const, symbol: cashId, qty: 1, price: 48.50, fee: 0, accountId: ACCOUNT_RETIREMENT_ID, currency: 'USD' },
  ];

  const orderData = orders.map((o) => ({
    userId: DEMO_USER_ID,
    accountId: o.accountId,
    accountUserId: DEMO_USER_ID,
    symbolProfileId: o.symbol,
    type: o.type,
    date: o.date,
    quantity: o.qty,
    unitPrice: o.price,
    fee: o.fee,
    currency: o.currency,
    isDraft: false
  }));

  await prisma.order.createMany({ data: orderData });

  // ── Summary ──────────────────────────────────────────────────────────────
  const orderCount = await prisma.order.count({
    where: { userId: DEMO_USER_ID }
  });

  console.log(`✓ Demo seed complete:`);
  console.log(`  User:     ${DEMO_USER_ID} (ADMIN)`);
  console.log(`  Accounts: 3 (Brokerage, IRA, Crypto)`);
  console.log(`  Holdings: 8 (AAPL, MSFT, VTI, VXUS, BND, GLD, BTC, Cash)`);
  console.log(`  Orders:   ${orderCount} transactions (2024-01 → 2025-10)`);
  console.log(`  Market:   ${marketPrices.length} price entries for today`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
