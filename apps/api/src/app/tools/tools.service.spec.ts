/**
 * ToolsService spec: tool calls execute successfully and return structured results,
 * with at least one domain-specific verification check (tax brackets, compliance rules).
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

  describe('tool calls return structured results', () => {
    it('portfolioAnalysis returns allocation, holdings, performance', async () => {
      const mockHoldings = [
        {
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
          sectors: []
        }
      ];
      portfolioService.getDetails.mockResolvedValue({
        holdings: Object.fromEntries(mockHoldings.map((h) => [h.symbol, h])),
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

    it('transactionCategorize returns categories and patterns', () => {
      const transactions = [
        { id: 't1', type: 'BUY', amount: 100 },
        { id: 't2', type: 'BUY', amount: 200 },
        { id: 't3', type: 'SELL', amount: -50 }
      ] as never[];

      const result = service.transactionCategorize(transactions);

      expect(result).toMatchObject({
        categories: expect.any(Array),
        patterns: expect.any(Array)
      });
      expect(result.categories.length).toBeGreaterThan(0);
      expect(result.categories.some((c) => c.category === 'BUY' && c.count === 2)).toBe(true);
      expect(result.categories.some((c) => c.category === 'SELL' && c.count === 1)).toBe(true);
      expect(result.patterns.some((p) => p.type === 'type_distribution')).toBe(true);
      expect(result.patterns.some((p) => p.type === 'amount_band')).toBe(true);
    });

    it('taxEstimate returns estimatedLiability, effectiveRate, taxableIncome', () => {
      const result = service.taxEstimate({
        income: 60_000,
        deductions: 10_000
      });

      expect(result).toMatchObject({
        estimatedLiability: expect.any(Number),
        effectiveRate: expect.any(Number),
        taxableIncome: 50_000
      });
      expect(typeof result.estimatedLiability).toBe('number');
      expect(typeof result.effectiveRate).toBe('number');
      expect(result.effectiveRate).toBeGreaterThanOrEqual(0);
      expect(result.effectiveRate).toBeLessThanOrEqual(1);
    });

    it('complianceCheck returns violations and warnings arrays', () => {
      const result = service.complianceCheck(
        { amount: 500, type: 'BUY', tags: ['investing'] },
        ['large_transaction', 'required_tags']
      );

      expect(result).toMatchObject({
        violations: expect.any(Array),
        warnings: expect.any(Array)
      });
      expect(Array.isArray(result.violations)).toBe(true);
      expect(Array.isArray(result.warnings)).toBe(true);
    });

    it('marketData returns symbol-keyed object with requested metrics', async () => {
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

      expect(result).toMatchObject({
        AAPL: expect.objectContaining({
          marketPrice: 175,
          currency: 'USD',
          marketState: 'REGULAR'
        })
      });
    });
  });

  describe('domain-specific verification', () => {
    it('tax_estimate: US-style brackets produce correct marginal liability for known income', () => {
      // 2023 US single brackets (simplified): 11k@10%, 44.725k@12%, etc.
      // taxableIncome = 50_000 → 11000*0.1 + (44725-11000)*0.12 + (50000-44725)*0.22
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

      expect(result.taxableIncome).toBe(50_000);
      const expectedLiability =
        11_000 * 0.1 + (44_725 - 11_000) * 0.12 + (50_000 - 44_725) * 0.22;
      expect(result.estimatedLiability).toBeCloseTo(expectedLiability, 2);
      expect(result.effectiveRate).toBeCloseTo(
        result.estimatedLiability / result.taxableIncome,
        5
      );
    });

    it('compliance_check: large_transaction regulation produces warning over threshold', () => {
      const result = service.complianceCheck(
        { amount: 150_000, type: 'BUY' },
        ['large_transaction']
      );

      expect(result.warnings.length).toBeGreaterThan(0);
      const largeTxWarning = result.warnings.find(
        (w) => w.regulation === 'large_transaction' && w.message.includes('150000')
      );
      expect(largeTxWarning).toBeDefined();
      expect(largeTxWarning?.severity).toBe('warning');
    });

    it('compliance_check: type_consistency flags invalid transaction type as violation', () => {
      const result = service.complianceCheck(
        { amount: 100, type: 'INVALID_TYPE' },
        ['type_consistency']
      );

      expect(result.violations.length).toBeGreaterThan(0);
      const typeViolation = result.violations.find(
        (v) => v.regulation === 'type_consistency' && v.message.includes('INVALID_TYPE')
      );
      expect(typeViolation).toBeDefined();
      expect(typeViolation?.severity).toBe('violation');
    });

    it('portfolio_analysis: empty portfolio returns UNKNOWN_KEY allocation when summary value is 0', async () => {
      portfolioService.getDetails.mockResolvedValue({
        holdings: {},
        hasErrors: false,
        summary: { currentValueInBaseCurrency: 0 }
      } as never);
      portfolioService.getPerformance.mockResolvedValue({
        performance: {}
      } as never);

      const result = await service.portfolioAnalysis({
        accountId: 'account-1',
        userId: 'user-1'
      });

      expect(result.allocation[UNKNOWN_KEY]).toBe(0);
      expect(result.holdings).toHaveLength(0);
    });
  });
});
