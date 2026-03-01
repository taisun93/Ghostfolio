/**
 * Test suite 3 of 3: AI chat graph & reliability — routing fallbacks, compliance blocking,
 * tools in isolation, and service error handling. All tests are CI-safe (no API key required).
 *
 * Other suites: ai-chat.service.spec.ts (Golden set), ai-chat-chirp.spec.ts (chirping).
 */
import { AccountBalanceService } from '@ghostfolio/api/app/account-balance/account-balance.service';
import { AccountService } from '@ghostfolio/api/app/account/account.service';
import { OrderService } from '@ghostfolio/api/app/order/order.service';
import { PortfolioService } from '@ghostfolio/api/app/portfolio/portfolio.service';
import { DataProviderService } from '@ghostfolio/api/services/data-provider/data-provider.service';
import { MarketDataService } from '@ghostfolio/api/services/market-data/market-data.service';
import { PropertyService } from '@ghostfolio/api/services/property/property.service';

import { createAdvisorAgentTools } from './langgraph/tools/advisor-agent.tools';
import { createDataAgentTools } from './langgraph/tools/data-agent.tools';
import {
  AiChatGraphService,
  getDataRouteFallback,
  shouldBlockByInput
} from './langgraph/ai-chat-graph.service';
import { AiChatService } from './ai-chat.service';

jest.mock('@ghostfolio/api/app/account-balance/account-balance.service', () => ({
  AccountBalanceService: jest.fn()
}));
jest.mock('@ghostfolio/api/app/account/account.service', () => ({
  AccountService: jest.fn()
}));
jest.mock('@ghostfolio/api/app/order/order.service', () => ({
  OrderService: jest.fn()
}));
jest.mock('@ghostfolio/api/app/portfolio/portfolio.service', () => ({
  PortfolioService: jest.fn()
}));
jest.mock('@ghostfolio/api/services/data-provider/data-provider.service', () => ({
  DataProviderService: jest.fn()
}));
jest.mock('@ghostfolio/api/services/market-data/market-data.service', () => ({
  MarketDataService: jest.fn()
}));
jest.mock('@ghostfolio/api/services/property/property.service', () => ({
  PropertyService: jest.fn()
}));

const BASE_PARAMS = {
  userId: 'eval-user',
  userCurrency: 'USD',
  filters: undefined as undefined,
  impersonationId: undefined as undefined,
  messages: [] as { role: 'user' | 'assistant'; content: string }[]
};

describe('AI chat graph & reliability', () => {
  let accountBalanceService: jest.Mocked<Pick<AccountBalanceService, 'getAccountBalances'>>;
  let accountService: jest.Mocked<Pick<AccountService, 'getAccounts'>>;
  let dataProviderService: jest.Mocked<Pick<DataProviderService, 'getQuotes'>>;
  let marketDataService: jest.Mocked<Pick<MarketDataService, 'getRange'>>;
  let orderService: jest.Mocked<Pick<OrderService, 'getOrders'>>;
  let portfolioService: jest.Mocked<Pick<PortfolioService, 'getDetails' | 'getPerformance'>>;
  let propertyService: jest.Mocked<Pick<PropertyService, 'getByKey'>>;
  let aiChatGraphService: AiChatGraphService;
  let aiChatService: AiChatService;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.AI_CHAT_DUMMY_DATA = 'false';
    accountBalanceService = {
      getAccountBalances: jest.fn().mockResolvedValue({ balances: [] })
    };
    accountService = {
      getAccounts: jest.fn().mockResolvedValue([])
    };
    dataProviderService = {
      getQuotes: jest.fn().mockResolvedValue({})
    };
    marketDataService = {
      getRange: jest.fn().mockResolvedValue([])
    };
    orderService = {
      getOrders: jest.fn().mockResolvedValue({ activities: [] })
    };
    portfolioService = {
      getDetails: jest.fn().mockResolvedValue({ holdings: {}, hasErrors: false }),
      getPerformance: jest.fn().mockResolvedValue({
        performance: {
          netPerformance: 0,
          netPerformancePercentage: 0,
          totalInvestment: 0,
          currentNetWorth: 0,
          currentValueInBaseCurrency: 0,
          netPerformancePercentageWithCurrencyEffect: 0,
          netPerformanceWithCurrencyEffect: 0,
          totalInvestmentValueWithCurrencyEffect: 0
        }
      })
    };
    propertyService = {
      getByKey: jest.fn()
    };

    aiChatGraphService = new AiChatGraphService(
      accountBalanceService as unknown as AccountBalanceService,
      accountService as unknown as AccountService,
      dataProviderService as unknown as DataProviderService,
      marketDataService as unknown as MarketDataService,
      orderService as unknown as OrderService,
      portfolioService as unknown as PortfolioService
    );
    aiChatService = new AiChatService(
      aiChatGraphService,
      propertyService as unknown as PropertyService
    );
  });

  describe('Compliance input block', () => {
    it('blocks known scam/fraud phrases', () => {
      expect(shouldBlockByInput('wire money to a prince in Nigeria')).toBe(true);
      expect(shouldBlockByInput('Send crypto urgently to this address')).toBe(
        true
      );
      expect(shouldBlockByInput('I need to wire funds immediately')).toBe(
        true
      );
      expect(shouldBlockByInput('Transfer money urgently to secure account')).toBe(
        true
      );
    });

    it('allows normal portfolio questions', () => {
      expect(shouldBlockByInput("What's my allocation?")).toBe(false);
      expect(shouldBlockByInput('Should I rebalance?')).toBe(false);
      expect(shouldBlockByInput('Hi')).toBe(false);
      expect(shouldBlockByInput('')).toBe(false);
    });
  });

  describe('Router fallback', () => {
    it('routes "how much money i got" and similar to data', () => {
      expect(getDataRouteFallback('how much money i got')).toBe('data');
      expect(getDataRouteFallback('How much money do I have?')).toBe('data');
      expect(getDataRouteFallback('what is my total value')).toBe('data');
      expect(getDataRouteFallback('how much am i worth')).toBe('data');
    });
  });

  describe('Data agent tools', () => {
    it('get_total_value with dummy data returns total value and currency', async () => {
      const tools = createDataAgentTools(
        {
          accountBalanceService: accountBalanceService as unknown as AccountBalanceService,
          accountService: accountService as unknown as AccountService,
          dataProviderService: dataProviderService as unknown as DataProviderService,
          marketDataService: marketDataService as unknown as MarketDataService,
          orderService: orderService as unknown as OrderService,
          portfolioService: portfolioService as unknown as PortfolioService
        },
        { userCurrency: 'USD', userId: 'test-user', useDummyData: true }
      );
      const getTotalValue = tools.find((t) => t.name === 'get_total_value');
      expect(getTotalValue).toBeDefined();
      const result = await getTotalValue!.invoke({});
      const parsed = JSON.parse(result) as {
        totalValueInBaseCurrency?: number;
        currency?: string;
      };
      expect(parsed.totalValueInBaseCurrency).toBe(16250);
      expect(parsed.currency).toBe('USD');
    });

    it('get_holdings returns Error string when portfolio service throws', async () => {
      const mockPortfolio = {
        getDetails: jest.fn().mockRejectedValue(new Error('DB unavailable'))
      };
      const tools = createDataAgentTools(
        {
          accountBalanceService: accountBalanceService as unknown as AccountBalanceService,
          accountService: accountService as unknown as AccountService,
          dataProviderService: dataProviderService as unknown as DataProviderService,
          marketDataService: marketDataService as unknown as MarketDataService,
          orderService: orderService as unknown as OrderService,
          portfolioService: mockPortfolio as unknown as PortfolioService
        },
        {
          userCurrency: 'USD',
          userId: 'test-user'
        }
      );
      const getHoldings = tools.find((t) => t.name === 'get_holdings');
      expect(getHoldings).toBeDefined();
      const result = await getHoldings!.invoke({});
      expect(result).toMatch(/^(Error:|Error fetching holdings:)/);
      expect(result).toContain('DB unavailable');
    });
  });

  describe('Advisor agent tools', () => {
    it('get_allocation_summary returns Error string when portfolio service throws', async () => {
      const mockPortfolio = {
        getDetails: jest.fn().mockRejectedValue(new Error('Service down'))
      };
      const tools = createAdvisorAgentTools(
        { portfolioService: mockPortfolio as unknown as PortfolioService },
        { userCurrency: 'USD', userId: 'test-user' }
      );
      const getAlloc = tools.find((t) => t.name === 'get_allocation_summary');
      expect(getAlloc).toBeDefined();
      const result = await getAlloc!.invoke({});
      expect(result).toMatch(/^Error:/);
      expect(result).toContain('Service down');
    });
  });

  describe('AiChatService error handling', () => {
    it('chat throws with clear message when graph fails', async () => {
      propertyService.getByKey.mockResolvedValue('fake-key');
      const runSpy = jest
        .spyOn(aiChatGraphService, 'run')
        .mockRejectedValueOnce(new Error('OpenAI rate limit'));

      await expect(
        aiChatService.chat({
          ...BASE_PARAMS,
          messages: [{ role: 'user', content: 'Hello' }]
        })
      ).rejects.toThrow(/AI chat|failed|OpenAI/);
      runSpy.mockRestore();
    });
  });
});
