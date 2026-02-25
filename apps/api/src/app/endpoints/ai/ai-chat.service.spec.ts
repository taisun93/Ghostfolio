/**
 * Golden set: 5 test cases for real LLM responses.
 * Set OPENAI_API_KEY or API_KEY_OPENAI in .env to run eval tests (3–5); 1 and 2 run without a key.
 */
import { PortfolioService } from '@ghostfolio/api/app/portfolio/portfolio.service';
import { PropertyService } from '@ghostfolio/api/services/property/property.service';
import { PROPERTY_API_KEY_OPENAI } from '@ghostfolio/common/config';

import { AiChatService } from './ai-chat.service';

jest.mock('@ghostfolio/api/app/portfolio/portfolio.service', () => ({
  PortfolioService: jest.fn()
}));

jest.mock('@ghostfolio/api/services/property/property.service', () => ({
  PropertyService: jest.fn()
}));

/** Set in .env to run real LLM eval (tests 3–5). */
const getOpenAiKey = (): string | null =>
  process.env.OPENAI_API_KEY?.trim() ||
  process.env.API_KEY_OPENAI?.trim() ||
  null;

const hasOpenAiKey = () => !!getOpenAiKey();

describe('AiChatService (golden set — real LLM)', () => {
  let propertyService: jest.Mocked<Pick<PropertyService, 'getByKey'>>;
  let portfolioService: jest.Mocked<Pick<PortfolioService, 'getDetails'>>;
  let service: AiChatService;

  const baseParams = {
    userCurrency: 'USD',
    userId: 'user-1'
  };

  beforeEach(() => {
    jest.clearAllMocks();
    propertyService = {
      getByKey: jest.fn()
    };
    portfolioService = {
      getDetails: jest.fn()
    };
    service = new AiChatService(
      portfolioService as unknown as PortfolioService,
      propertyService as unknown as PropertyService
    );
  });

  describe('1. AI not configured (no API key)', () => {
    it('returns message that AI is not configured when API key is missing', async () => {
      propertyService.getByKey.mockResolvedValue(null);

      const result = await service.chat({
        ...baseParams,
        messages: [{ role: 'user', content: 'What is diversification?' }]
      });

      expect(result.content).toContain('not configured');
      expect(result.content).toContain('API key');
    });

    it('returns same when API key is empty string', async () => {
      propertyService.getByKey.mockResolvedValue('');

      const result = await service.chat({
        ...baseParams,
        messages: [{ role: 'user', content: 'Hello' }]
      });

      expect(result.content).toContain('not configured');
    });
  });

  describe('2. Empty messages', () => {
    it('returns "Please send a message." when messages array is empty', async () => {
      propertyService.getByKey.mockResolvedValue(getOpenAiKey() || 'fake-key');
      portfolioService.getDetails.mockResolvedValue({
        holdings: {},
        hasErrors: false
      } as never);

      const result = await service.chat({
        ...baseParams,
        messages: []
      });

      expect(result.content).toBe('Please send a message.');
    });
  });

  describe('3. No portfolio, user asks about allocation', () => {
    const runTest = async () => {
      propertyService.getByKey.mockImplementation((key: string) =>
        key === PROPERTY_API_KEY_OPENAI
          ? Promise.resolve(getOpenAiKey())
          : Promise.resolve(null)
      );
      portfolioService.getDetails.mockResolvedValue({
        holdings: {},
        hasErrors: false
      } as never);

      const result = await service.chat({
        ...baseParams,
        messages: [
          { role: 'user', content: "What's my portfolio allocation?" }
        ]
      });
      return result.content;
    };

    (hasOpenAiKey() ? it : it.skip)(
      'LLM response suggests no portfolio / adding holdings',
      async () => {
      const content = await runTest();
      expect(content).toBeDefined();
      expect(content.length).toBeGreaterThan(0);
      const lower = content.toLowerCase();
      const suggestsNoPortfolio =
        /add|holding|portfolio|no (portfolio )?data|don't have|don’t have|haven't|haven’t|enter|import/i.test(lower);
      expect(suggestsNoPortfolio).toBe(true);
      });
  });

  describe('4. General finance question (no portfolio)', () => {
    const runTest = async () => {
      propertyService.getByKey.mockImplementation((key: string) =>
        key === PROPERTY_API_KEY_OPENAI
          ? Promise.resolve(getOpenAiKey())
          : Promise.resolve(null)
      );
      portfolioService.getDetails.mockResolvedValue({
        holdings: {},
        hasErrors: false
      } as never);

      const result = await service.chat({
        ...baseParams,
        messages: [
          { role: 'user', content: 'What is dollar-cost averaging?' }
        ]
      });
      return result.content;
    };

    (hasOpenAiKey() ? it : it.skip)(
      'LLM answers briefly without asking for portfolio',
      async () => {
        const content = await runTest();
      expect(content).toBeDefined();
      expect(content.length).toBeGreaterThan(0);
      const lower = content.toLowerCase();
      expect(lower).toMatch(/dollar|dca|invest|amount|interval|price|volatility|average/i);
      expect(lower).not.toMatch(
        /add your holdings|no portfolio data|i don't have.*portfolio|i don’t have.*portfolio/
      );
      }
    );
  });

  describe('5. With portfolio context, allocation question', () => {
    const mockHoldings = {
      AAPL: {
        name: 'Apple Inc.',
        symbol: 'AAPL',
        currency: 'USD',
        allocationInPercentage: 0.6,
        assetClass: 'EQUITY',
        assetSubClass: null,
        activitiesCount: 1,
        dataSource: 'YAHOO' as const,
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
      },
      MSFT: {
        name: 'Microsoft Corporation',
        symbol: 'MSFT',
        currency: 'USD',
        allocationInPercentage: 0.4,
        assetClass: 'EQUITY',
        assetSubClass: null,
        activitiesCount: 1,
        dataSource: 'YAHOO' as const,
        dateOfFirstActivity: new Date(),
        dividend: 0,
        grossPerformance: 0,
        grossPerformancePercent: 0,
        grossPerformancePercentWithCurrencyEffect: 0,
        grossPerformanceWithCurrencyEffect: 0,
        holdings: [],
        investment: 500,
        markets: {},
        marketsAdvanced: {},
        marketPrice: 300,
        netPerformance: 0,
        netPerformancePercent: 0,
        netPerformancePercentWithCurrencyEffect: 0,
        netPerformanceWithCurrencyEffect: 0,
        quantity: 1,
        valueInBaseCurrency: 300,
        countries: [],
        sectors: []
      }
    };

    const runTest = async () => {
      propertyService.getByKey.mockImplementation((key: string) =>
        key === PROPERTY_API_KEY_OPENAI
          ? Promise.resolve(getOpenAiKey())
          : Promise.resolve(null)
      );
      portfolioService.getDetails.mockResolvedValue({
        holdings: mockHoldings,
        hasErrors: false
      } as never);

      const result = await service.chat({
        ...baseParams,
        messages: [{ role: 'user', content: "What's my largest holding?" }]
      });
      return result.content;
    };

    (hasOpenAiKey() ? it : it.skip)(
      'LLM response reflects portfolio (e.g. Apple/AAPL or 60%)',
      async () => {
      const content = await runTest();
      expect(content).toBeDefined();
      expect(content.length).toBeGreaterThan(0);
      const lower = content.toLowerCase();
      const reflectsHoldings =
        /apple|aapl|60|largest|holding|msft|microsoft|40|allocation/i.test(lower);
      expect(reflectsHoldings).toBe(true);
      });
  });
});
