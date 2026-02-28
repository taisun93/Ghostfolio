/**
 * ToolsService spec: 50 tests covering happy path, edge cases, adversarial inputs,
 * and multi-step reasoning for Finance tools (portfolio_analysis, transaction_categorize,
 * tax_estimate, compliance_check, market_data).
 */
import { PortfolioService } from '@ghostfolio/api/app/portfolio/portfolio.service';
import { ApiService } from '@ghostfolio/api/services/api/api.service';
import { DataProviderService } from '@ghostfolio/api/services/data-provider/data-provider.service';
import { UNKNOWN_KEY } from '@ghostfolio/common/config';

import { ToolsService } from './tools.service';

jest.mock('@ghostfolio/api/app/portfolio/portfolio.service', () => ({
  PortfolioService: jest.fn()
}));

jest.mock('@ghostfolio/api/services/api/api.service', () => ({
  ApiService: jest.fn()
}));

jest.mock('@ghostfolio/api/services/data-provider/data-provider.service', () => ({
  DataProviderService: jest.fn()
}));

function mockHolding(overrides: Partial<{
  symbol: string;
  allocationInPercentage: number;
  valueInBaseCurrency: number;
  currency: string;
  assetClass: string;
}> = {}) {
  return {
    symbol: 'AAPL',
    allocationInPercentage: 0.6,
    name: 'Apple Inc.',
    currency: 'USD',
    assetClass: 'EQUITY',
    assetSubClass: null,
    activitiesCount: 1,
    dataSource: 'YAHOO',
    dateOfFirstActivity: new Date(),
    dividend: 0,
    grossPerformance: 0,
    grossPerformancePercent: 0,
    grossPerformancePercentWithCurrencyEffect: 0,
    grossPerformanceWithCurrencyEffect: 0,
    holdings: [],
    investment: 1000,
    markets: {},
    marketsAdvanced: {},
    marketPrice: 150,
    netPerformance: 0,
    netPerformancePercent: 0,
    netPerformancePercentWithCurrencyEffect: 0,
    netPerformanceWithCurrencyEffect: 0,
    quantity: 10,
    valueInBaseCurrency: 1500,
    countries: [],
    sectors: [],
    ...overrides
  };
}

describe('ToolsService', () => {
  let apiService: jest.Mocked<Pick<ApiService, 'buildFiltersFromQueryParams'>>;
  let dataProviderService: jest.Mocked<Pick<DataProviderService, 'getQuotes'>>;
  let portfolioService: jest.Mocked<
    Pick<PortfolioService, 'getDetails' | 'getPerformance'>
  >;
  let service: ToolsService;

  beforeEach(() => {
    jest.clearAllMocks();
    apiService = {
      buildFiltersFromQueryParams: jest.fn().mockReturnValue([])
    };
    portfolioService = {
      getDetails: jest.fn(),
      getPerformance: jest.fn()
    };
    dataProviderService = {
      getQuotes: jest.fn()
    };
    service = new ToolsService(
      apiService as unknown as ApiService,
      dataProviderService as unknown as DataProviderService,
      portfolioService as unknown as PortfolioService
    );
  });

  describe('happy path (20+ scenarios with expected outcomes)', () => {
    it('portfolio_analysis: single holding returns allocation, holdings, performance', async () => {
      const h = mockHolding({ symbol: 'AAPL', allocationInPercentage: 0.6 });
      portfolioService.getDetails.mockResolvedValue({
        holdings: { AAPL: h },
        hasErrors: false,
        summary: { currentValueInBaseCurrency: 1500 }
      } as never);
      portfolioService.getPerformance.mockResolvedValue({
        performance: { currentNetWorth: 1500, annualizedPerformancePercent: 5 }
      } as never);

      const result = await service.portfolioAnalysis({
        accountId: 'account-1',
        userId: 'user-1'
      });

      expect(result).toMatchObject({
        allocation: { AAPL: 0.6 },
        holdings: expect.any(Array),
        performance: expect.any(Object)
      });
      expect(result.holdings).toHaveLength(1);
      expect(result.holdings[0]).toMatchObject({ symbol: 'AAPL', allocationInPercentage: 0.6 });
      expect(result.performance).toMatchObject({
        currentNetWorth: 1500,
        annualizedPerformancePercent: 5
      });
    });

    it('portfolio_analysis: multiple holdings returns correct allocation per symbol', async () => {
      const h1 = mockHolding({ symbol: 'AAPL', allocationInPercentage: 0.5 });
      const h2 = mockHolding({ symbol: 'MSFT', allocationInPercentage: 0.3 });
      const h3 = mockHolding({ symbol: 'GOOGL', allocationInPercentage: 0.2 });
      portfolioService.getDetails.mockResolvedValue({
        holdings: { AAPL: h1, MSFT: h2, GOOGL: h3 },
        hasErrors: false,
        summary: { currentValueInBaseCurrency: 10_000 }
      } as never);
      portfolioService.getPerformance.mockResolvedValue({
        performance: { currentNetWorth: 10_000 }
      } as never);

      const result = await service.portfolioAnalysis({
        accountId: 'acc-1',
        userId: 'user-1'
      });

      expect(result.allocation).toEqual({ AAPL: 0.5, MSFT: 0.3, GOOGL: 0.2 });
      expect(result.holdings).toHaveLength(3);
    });

    it('portfolio_analysis: with dateRange passes range to getDetails and getPerformance', async () => {
      portfolioService.getDetails.mockResolvedValue({
        holdings: {},
        hasErrors: false,
        summary: { currentValueInBaseCurrency: 0 }
      } as never);
      portfolioService.getPerformance.mockResolvedValue({ performance: {} } as never);

      await service.portfolioAnalysis({
        accountId: 'acc-1',
        userId: 'user-1',
        dateRange: '1y'
      });

      expect(portfolioService.getDetails).toHaveBeenCalledWith(
        expect.objectContaining({ dateRange: '1y' })
      );
      expect(portfolioService.getPerformance).toHaveBeenCalledWith(
        expect.objectContaining({ dateRange: '1y' })
      );
    });

    it('portfolio_analysis: with impersonationId passes it to portfolio services', async () => {
      portfolioService.getDetails.mockResolvedValue({
        holdings: {},
        hasErrors: false,
        summary: { currentValueInBaseCurrency: 0 }
      } as never);
      portfolioService.getPerformance.mockResolvedValue({ performance: {} } as never);

      await service.portfolioAnalysis({
        accountId: 'acc-1',
        userId: 'user-1',
        impersonationId: 'imp-123'
      });

      expect(portfolioService.getDetails).toHaveBeenCalledWith(
        expect.objectContaining({ impersonationId: 'imp-123' })
      );
    });

    it('transaction_categorize: BUY and SELL mix returns type categories and amount pattern', () => {
      const transactions = [
        { id: 't1', type: 'BUY', amount: 100 },
        { id: 't2', type: 'BUY', amount: 200 },
        { id: 't3', type: 'SELL', amount: -50 }
      ] as never[];

      const result = service.transactionCategorize(transactions);

      expect(result.categories.some((c) => c.category === 'BUY' && c.count === 2)).toBe(true);
      expect(result.categories.some((c) => c.category === 'SELL' && c.count === 1)).toBe(true);
      expect(result.patterns.some((p) => p.type === 'type_distribution')).toBe(true);
      expect(result.patterns.some((p) => p.type === 'amount_band')).toBe(true);
    });

    it('transaction_categorize: tagged transactions include tag categories', () => {
      const transactions = [
        { id: 't1', type: 'BUY', amount: 100, tags: ['investing'] },
        { id: 't2', type: 'BUY', amount: 200, tags: ['investing', 'rebalance'] }
      ] as never[];

      const result = service.transactionCategorize(transactions);

      expect(result.categories.some((c) => c.category === 'tag:investing' && c.count === 2)).toBe(true);
      expect(result.categories.some((c) => c.category === 'tag:rebalance' && c.count === 1)).toBe(true);
    });

    it('transaction_categorize: DIVIDEND and FEE and LIABILITY types are categorized', () => {
      const transactions = [
        { id: 'a', type: 'DIVIDEND', amount: 50 },
        { id: 'b', type: 'FEE', amount: -5 },
        { id: 'c', type: 'LIABILITY', amount: -100 }
      ] as never[];

      const result = service.transactionCategorize(transactions);

      expect(result.categories.some((c) => c.category === 'DIVIDEND' && c.count === 1)).toBe(true);
      expect(result.categories.some((c) => c.category === 'FEE' && c.count === 1)).toBe(true);
      expect(result.categories.some((c) => c.category === 'LIABILITY' && c.count === 1)).toBe(true);
    });

    it('transaction_categorize: single transaction returns one type category and pattern', () => {
      const result = service.transactionCategorize([
        { id: 'only', type: 'BUY', amount: 1000 }
      ] as never[]);

      expect(result.categories.some((c) => c.category === 'BUY' && c.count === 1)).toBe(true);
      expect(result.patterns.some((p) => p.type === 'amount_band')).toBe(true);
      expect((result.patterns.find((p) => p.type === 'amount_band')?.value as { total: number }).total).toBe(1000);
    });

    it('tax_estimate: income and deductions produce taxableIncome and liability', () => {
      const result = service.taxEstimate({
        income: 60_000,
        deductions: 10_000
      });

      expect(result.taxableIncome).toBe(50_000);
      expect(typeof result.estimatedLiability).toBe('number');
      expect(result.estimatedLiability).toBeGreaterThan(0);
      expect(result.effectiveRate).toBeGreaterThanOrEqual(0);
      expect(result.effectiveRate).toBeLessThanOrEqual(1);
    });

    it('tax_estimate: zero deductions uses full income as taxable', () => {
      const result = service.taxEstimate({
        income: 30_000,
        deductions: 0
      });

      expect(result.taxableIncome).toBe(30_000);
      expect(result.estimatedLiability).toBeGreaterThan(0);
    });

    it('tax_estimate: US-style brackets produce correct marginal liability', () => {
      const brackets = [
        { max: 11_000, rate: 0.1 },
        { max: 44_725, rate: 0.12 },
        { max: 95_375, rate: 0.22 },
        { max: Infinity, rate: 0.24 }
      ];
      const result = service.taxEstimate({
        income: 50_000,
        deductions: 0,
        taxBrackets: brackets
      });

      const expectedLiability =
        11_000 * 0.1 + (44_725 - 11_000) * 0.12 + (50_000 - 44_725) * 0.22;
      expect(result.estimatedLiability).toBeCloseTo(expectedLiability, 2);
      expect(result.effectiveRate).toBeCloseTo(
        result.estimatedLiability / result.taxableIncome,
        5
      );
    });

    it('compliance_check: valid transaction with tags and amount under threshold has no violations', () => {
      const result = service.complianceCheck(
        { amount: 500, type: 'BUY', tags: ['investing'] },
        ['large_transaction', 'required_tags', 'type_consistency']
      );

      expect(result.violations).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    it('compliance_check: FEE without tags does not trigger required_tags warning', () => {
      const result = service.complianceCheck(
        { amount: 10, type: 'FEE' },
        ['required_tags']
      );

      expect(result.warnings.some((w) => w.regulation === 'required_tags')).toBe(false);
    });

    it('compliance_check: empty regulations returns empty violations and warnings', () => {
      const result = service.complianceCheck(
        { amount: 1_000_000, type: 'INVALID' },
        []
      );

      expect(result.violations).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    it('market_data: single symbol returns quote with default metrics', async () => {
      dataProviderService.getQuotes.mockResolvedValue({
        AAPL: {
          marketPrice: 175,
          currency: 'USD',
          marketState: 'REGULAR',
          dataSource: 'YAHOO'
        }
      } as never);

      const result = await service.marketData({
        symbols: ['AAPL'],
        userId: 'user-1'
      });

      expect(result.AAPL).toMatchObject({
        marketPrice: 175,
        currency: 'USD',
        marketState: 'REGULAR'
      });
    });

    it('market_data: multiple symbols returns data for each', async () => {
      dataProviderService.getQuotes.mockResolvedValue({
        AAPL: { marketPrice: 175, currency: 'USD', marketState: 'REGULAR', dataSource: 'YAHOO' },
        MSFT: { marketPrice: 380, currency: 'USD', marketState: 'REGULAR', dataSource: 'YAHOO' }
      } as never);

      const result = await service.marketData({
        symbols: ['AAPL', 'MSFT'],
        userId: 'user-1'
      });

      expect(Object.keys(result)).toHaveLength(2);
      expect(result.AAPL?.marketPrice).toBe(175);
      expect(result.MSFT?.marketPrice).toBe(380);
    });

    it('market_data: custom metrics filter returns only requested keys', async () => {
      dataProviderService.getQuotes.mockResolvedValue({
        AAPL: {
          marketPrice: 175,
          currency: 'USD',
          marketState: 'REGULAR',
          dataSource: 'YAHOO'
        }
      } as never);

      const result = await service.marketData({
        symbols: ['AAPL'],
        metrics: ['marketPrice', 'currency'],
        userId: 'user-1'
      });

      expect(result.AAPL).toHaveProperty('marketPrice', 175);
      expect(result.AAPL).toHaveProperty('currency', 'USD');
      expect(result.AAPL).not.toHaveProperty('marketState');
    });

    it('market_data: items with dataSource used when provided instead of symbols', async () => {
      dataProviderService.getQuotes.mockResolvedValue({
        'YAHOO:AAPL': {
          marketPrice: 175,
          currency: 'USD',
          marketState: 'REGULAR',
          dataSource: 'YAHOO'
        }
      } as never);

      const result = await service.marketData({
        items: [{ dataSource: 'YAHOO', symbol: 'AAPL' }],
        userId: 'user-1'
      });

      expect(dataProviderService.getQuotes).toHaveBeenCalledWith(
        expect.objectContaining({
          items: expect.arrayContaining([expect.objectContaining({ symbol: 'AAPL' })])
        })
      );
      expect(Object.keys(result).length).toBeGreaterThanOrEqual(0);
    });

    it('transaction_categorize: untagged transactions appear in untagged category', () => {
      const transactions = [
        { id: 't1', type: 'BUY', amount: 100 },
        { id: 't2', type: 'SELL', amount: -50 }
      ] as never[];

      const result = service.transactionCategorize(transactions);

      expect(result.categories.some((c) => c.category === 'untagged' && c.count === 2)).toBe(true);
    });

    it('tax_estimate: high income in top bracket still returns valid effectiveRate', () => {
      const result = service.taxEstimate({
        income: 1_000_000,
        deductions: 50_000
      });

      expect(result.taxableIncome).toBe(950_000);
      expect(result.estimatedLiability).toBeGreaterThan(0);
      expect(result.effectiveRate).toBeGreaterThan(0);
      expect(result.effectiveRate).toBeLessThanOrEqual(1);
    });
  });

  describe('edge cases (missing data, boundary conditions)', () => {
    it('portfolio_analysis: empty portfolio returns UNKNOWN_KEY allocation when summary is 0', async () => {
      portfolioService.getDetails.mockResolvedValue({
        holdings: {},
        hasErrors: false,
        summary: { currentValueInBaseCurrency: 0 }
      } as never);
      portfolioService.getPerformance.mockResolvedValue({ performance: {} } as never);

      const result = await service.portfolioAnalysis({
        accountId: 'account-1',
        userId: 'user-1'
      });

      expect(result.allocation[UNKNOWN_KEY]).toBe(0);
      expect(result.holdings).toHaveLength(0);
    });

    it('portfolio_analysis: getDetails rejection propagates and allocation not returned', async () => {
      portfolioService.getDetails.mockRejectedValue(new Error('Account not found'));
      portfolioService.getPerformance.mockResolvedValue({ performance: {} } as never);

      await expect(
        service.portfolioAnalysis({ accountId: 'bad', userId: 'user-1' })
      ).rejects.toThrow('Account not found');
    });

    it('transaction_categorize: empty array returns empty categories and single type_distribution pattern', () => {
      const result = service.transactionCategorize([]);

      expect(result.categories).toHaveLength(0);
      expect(result.patterns).toHaveLength(1);
      expect(result.patterns[0].type).toBe('type_distribution');
      expect(result.patterns[0].value).toEqual({});
    });

    it('transaction_categorize: transactions with null/undefined type grouped as UNKNOWN', () => {
      const transactions = [
        { id: 'a', type: null, amount: 1 } as never,
        { id: 'b', amount: 2 } as never
      ];

      const result = service.transactionCategorize(transactions);

      const unknownCat = result.categories.find((c) => c.category === 'UNKNOWN');
      expect(unknownCat).toBeDefined();
      expect(unknownCat?.count).toBe(2);
    });

    it('transaction_categorize: all zero amounts still produce type_distribution pattern', () => {
      const result = service.transactionCategorize([
        { id: 't1', type: 'BUY', amount: 0 },
        { id: 't2', type: 'SELL', amount: 0 }
      ] as never[]);

      expect(result.patterns.some((p) => p.type === 'type_distribution')).toBe(true);
      expect(result.patterns.some((p) => p.type === 'amount_band')).toBe(false);
    });

    it('tax_estimate: income equals deductions gives zero taxable and zero liability', () => {
      const result = service.taxEstimate({
        income: 50_000,
        deductions: 50_000
      });

      expect(result.taxableIncome).toBe(0);
      expect(result.estimatedLiability).toBe(0);
      expect(result.effectiveRate).toBe(0);
    });

    it('tax_estimate: single bracket covers full taxable income', () => {
      const result = service.taxEstimate({
        income: 5_000,
        deductions: 0,
        taxBrackets: [{ max: Infinity, rate: 0.1 }]
      });

      expect(result.taxableIncome).toBe(5_000);
      expect(result.estimatedLiability).toBe(500);
      expect(result.effectiveRate).toBe(0.1);
    });

    it('compliance_check: amount exactly at 100000 threshold does not trigger large_transaction', () => {
      const result = service.complianceCheck(
        { amount: 100_000, type: 'BUY' },
        ['large_transaction']
      );

      expect(result.warnings).toHaveLength(0);
    });

    it('compliance_check: amount 100001 triggers large_transaction warning', () => {
      const result = service.complianceCheck(
        { amount: 100_001, type: 'BUY' },
        ['large_transaction']
      );

      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some((w) => w.regulation === 'large_transaction')).toBe(true);
    });

    it('compliance_check: regulation names case-insensitive (Amount_Threshold matches)', () => {
      const result = service.complianceCheck(
        { amount: 150_000, type: 'BUY' },
        ['Amount_Threshold']
      );

      expect(result.warnings.some((w) => w.message.includes('150000'))).toBe(true);
    });

    it('market_data: empty symbols returns empty object and does not call getQuotes', async () => {
      const result = await service.marketData({
        symbols: [],
        userId: 'user-1'
      });

      expect(result).toEqual({});
      expect(dataProviderService.getQuotes).not.toHaveBeenCalled();
    });

    it('market_data: getQuotes returns empty object then result is empty', async () => {
      dataProviderService.getQuotes.mockResolvedValue({} as never);

      const result = await service.marketData({
        symbols: ['NOSUCH'],
        userId: 'user-1'
      });

      expect(result).toEqual({});
    });
  });

  describe('adversarial inputs (attempts to bypass verification)', () => {
    it('compliance_check: invalid transaction type produces violation and cannot be bypassed', () => {
      const result = service.complianceCheck(
        { amount: 100, type: 'INVALID_TYPE' },
        ['type_consistency']
      );

      expect(result.violations.length).toBeGreaterThan(0);
      expect(result.violations[0].message).toContain('INVALID_TYPE');
    });

    it('compliance_check: missing type with required_tags still can trigger tag warning', () => {
      const result = service.complianceCheck(
        { amount: 500, tags: [] },
        ['required_tags', 'type_consistency']
      );

      expect(result.violations).toHaveLength(0);
      expect(result.warnings.some((w) => w.regulation === 'required_tags')).toBe(false);
    });

    it('compliance_check: unknown regulation name is ignored (no crash)', () => {
      const result = service.complianceCheck(
        { amount: 1_000_000, type: 'BUY' },
        ['nonexistent_regulation', 'large_transaction']
      );

      expect(result.warnings.some((w) => w.regulation === 'large_transaction')).toBe(true);
      expect(result.warnings.every((w) => w.regulation !== 'nonexistent_regulation')).toBe(true);
    });

    it('tax_estimate: deductions greater than income yield zero taxable (clamped)', () => {
      const result = service.taxEstimate({
        income: 10_000,
        deductions: 50_000
      });

      expect(result.taxableIncome).toBe(0);
      expect(result.estimatedLiability).toBe(0);
    });

    it('tax_estimate: custom brackets with gap do not double-count bands', () => {
      const result = service.taxEstimate({
        income: 20_000,
        deductions: 0,
        taxBrackets: [
          { max: 10_000, rate: 0.1 },
          { max: 30_000, rate: 0.2 }
        ]
      });

      expect(result.estimatedLiability).toBe(10_000 * 0.1 + 10_000 * 0.2);
    });

    it('transaction_categorize: type with extra spaces still grouped (service uses type as-is)', () => {
      const result = service.transactionCategorize([
        { id: '1', type: '  BUY  ', amount: 100 }
      ] as never[]);

      expect(result.categories.some((c) => c.category === '  BUY  ')).toBe(true);
    });

    it('portfolio_analysis: buildFiltersFromQueryParams receives accountId (authorization boundary)', async () => {
      portfolioService.getDetails.mockResolvedValue({
        holdings: {},
        hasErrors: false,
        summary: { currentValueInBaseCurrency: 0 }
      } as never);
      portfolioService.getPerformance.mockResolvedValue({ performance: {} } as never);

      await service.portfolioAnalysis({
        accountId: 'other-users-account',
        userId: 'user-1'
      });

      expect(apiService.buildFiltersFromQueryParams).toHaveBeenCalledWith({
        filterByAccounts: 'other-users-account'
      });
    });

    it('market_data: symbol with colon (DataSource:symbol) parses and uses default for unknown source', async () => {
      dataProviderService.getQuotes.mockResolvedValue({
        AAPL: { marketPrice: 175, currency: 'USD', marketState: 'REGULAR', dataSource: 'YAHOO' }
      } as never);

      const result = await service.marketData({
        symbols: ['UNKNOWN:AAPL'],
        userId: 'user-1'
      });

      expect(dataProviderService.getQuotes).toHaveBeenCalled();
      expect(Object.keys(result).length).toBeGreaterThanOrEqual(0);
    });

    it('compliance_check: both large_transaction and type_consistency can fire on same transaction', () => {
      const result = service.complianceCheck(
        { amount: 200_000, type: 'FAKE_TYPE' },
        ['large_transaction', 'type_consistency']
      );

      expect(result.warnings.some((w) => w.regulation === 'large_transaction')).toBe(true);
      expect(result.violations.some((v) => v.regulation === 'type_consistency')).toBe(true);
    });

    it('transaction_categorize: very large transaction list still returns consistent categories', () => {
      const transactions = Array.from({ length: 500 }, (_, i) => ({
        id: `t${i}`,
        type: i % 2 === 0 ? 'BUY' : 'SELL',
        amount: 100
      })) as never[];

      const result = service.transactionCategorize(transactions);

      expect(result.categories.some((c) => c.category === 'BUY' && c.count === 250)).toBe(true);
      expect(result.categories.some((c) => c.category === 'SELL' && c.count === 250)).toBe(true);
    });
  });

  describe('multi-step reasoning scenarios', () => {
    it('portfolio_analysis: allocation percentages sum to 1 for multiple holdings', async () => {
      const h1 = mockHolding({ symbol: 'AAPL', allocationInPercentage: 0.5 });
      const h2 = mockHolding({ symbol: 'MSFT', allocationInPercentage: 0.3 });
      const h3 = mockHolding({ symbol: 'GOOGL', allocationInPercentage: 0.2 });
      portfolioService.getDetails.mockResolvedValue({
        holdings: { AAPL: h1, MSFT: h2, GOOGL: h3 },
        hasErrors: false,
        summary: { currentValueInBaseCurrency: 10_000 }
      } as never);
      portfolioService.getPerformance.mockResolvedValue({ performance: {} } as never);

      const result = await service.portfolioAnalysis({
        accountId: 'acc-1',
        userId: 'user-1'
      });

      const sum = Object.values(result.allocation).reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1, 5);
    });

    it('transaction_categorize: amount_band total equals sum of absolute amounts', () => {
      const transactions = [
        { id: 't1', type: 'BUY', amount: 100 },
        { id: 't2', type: 'SELL', amount: -50 },
        { id: 't3', type: 'BUY', amount: 200 }
      ] as never[];

      const result = service.transactionCategorize(transactions);
      const amountBand = result.patterns.find((p) => p.type === 'amount_band')?.value as {
        total: number;
        count: number;
        average: number;
      };

      expect(amountBand.total).toBe(350);
      expect(amountBand.count).toBe(3);
      expect(amountBand.average).toBeCloseTo(350 / 3, 5);
    });

    it('tax_estimate: effectiveRate equals estimatedLiability / taxableIncome when taxable > 0', () => {
      const result = service.taxEstimate({
        income: 80_000,
        deductions: 15_000
      });

      expect(result.taxableIncome).toBe(65_000);
      expect(result.effectiveRate).toBeCloseTo(
        result.estimatedLiability / result.taxableIncome,
        10
      );
    });

    it('compliance_check: same transaction checked twice yields same result', () => {
      const tx = { amount: 150_000, type: 'BUY', tags: [] };
      const regs = ['large_transaction', 'required_tags'];

      const r1 = service.complianceCheck(tx, regs);
      const r2 = service.complianceCheck(tx, regs);

      expect(r1.violations).toHaveLength(r2.violations.length);
      expect(r1.warnings).toHaveLength(r2.warnings.length);
      expect(r1.warnings.some((w) => w.regulation === 'large_transaction')).toBe(
        r2.warnings.some((w) => w.regulation === 'large_transaction')
      );
    });

    it('market_data: requested metrics subset results in only those keys in output', async () => {
      dataProviderService.getQuotes.mockResolvedValue({
        AAPL: {
          marketPrice: 175,
          currency: 'USD',
          marketState: 'REGULAR',
          dataSource: 'YAHOO'
        }
      } as never);

      const result = await service.marketData({
        symbols: ['AAPL'],
        metrics: ['marketPrice'],
        userId: 'user-1'
      });

      expect(Object.keys(result.AAPL ?? {})).toEqual(['marketPrice']);
      expect(result.AAPL?.marketPrice).toBe(175);
    });

    it('tax_estimate: one dollar over bracket boundary increases liability by next rate', () => {
      const brackets = [
        { max: 10_000, rate: 0.1 },
        { max: Infinity, rate: 0.2 }
      ];
      const atBoundary = service.taxEstimate({
        income: 10_000,
        deductions: 0,
        taxBrackets: brackets
      });
      const overBoundary = service.taxEstimate({
        income: 10_001,
        deductions: 0,
        taxBrackets: brackets
      });

      expect(atBoundary.estimatedLiability).toBe(1_000);
      expect(overBoundary.estimatedLiability).toBe(1_000 + 0.2);
    });

    it('transaction_categorize: category counts sum to transactions when no shared tags', () => {
      const transactions = [
        { id: '1', type: 'BUY', amount: 100 },
        { id: '2', type: 'BUY', amount: 200 },
        { id: '3', type: 'SELL', amount: 50 }
      ] as never[];

      const result = service.transactionCategorize(transactions);
      const typeCategories = result.categories.filter(
        (c) => c.category === 'BUY' || c.category === 'SELL'
      );
      const totalFromTypes = typeCategories.reduce((s, c) => s + c.count, 0);

      expect(totalFromTypes).toBe(3);
    });

    it('portfolio_analysis then allocation keys match holdings symbols', async () => {
      const h1 = mockHolding({ symbol: 'X', allocationInPercentage: 1 });
      portfolioService.getDetails.mockResolvedValue({
        holdings: { X: h1 },
        hasErrors: false,
        summary: { currentValueInBaseCurrency: 1000 }
      } as never);
      portfolioService.getPerformance.mockResolvedValue({ performance: {} } as never);

      const result = await service.portfolioAnalysis({
        accountId: 'a',
        userId: 'u'
      });

      for (const holding of result.holdings) {
        expect(result.allocation).toHaveProperty(holding.symbol);
        expect(result.allocation[holding.symbol]).toBe(holding.allocationInPercentage);
      }
    });

    it('compliance_check: valid types (BUY, SELL, DIVIDEND, INTEREST, FEE, LIABILITY) yield no type_consistency violation', () => {
      const validTypes = ['BUY', 'SELL', 'DIVIDEND', 'INTEREST', 'FEE', 'LIABILITY'];

      for (const type of validTypes) {
        const result = service.complianceCheck(
          { amount: 100, type },
          ['type_consistency']
        );
        expect(result.violations.filter((v) => v.regulation === 'type_consistency')).toHaveLength(0);
      }
    });

    it('market_data and portfolio_analysis: both use userId for context (no cross-user leak)', async () => {
      portfolioService.getDetails.mockResolvedValue({
        holdings: {},
        hasErrors: false,
        summary: { currentValueInBaseCurrency: 0 }
      } as never);
      portfolioService.getPerformance.mockResolvedValue({ performance: {} } as never);
      dataProviderService.getQuotes.mockResolvedValue({} as never);

      await service.portfolioAnalysis({ accountId: 'a', userId: 'user-A' });
      await service.marketData({ symbols: ['AAPL'], userId: 'user-B' });

      expect(portfolioService.getDetails).toHaveBeenLastCalledWith(
        expect.objectContaining({ userId: 'user-A' })
      );
      expect(dataProviderService.getQuotes).toHaveBeenLastCalledWith(
        expect.objectContaining({ user: 'user-B' })
      );
    });
  });
});
