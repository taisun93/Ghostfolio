/**
 * Test suite for chirping: the router message that tells the user which agent
 * is being asked (data / advice / general). Ensures the graph and service
 * always return a non-empty, meaningful chirp.
 */
import { AccountBalanceService } from '@ghostfolio/api/app/account-balance/account-balance.service';
import { AccountService } from '@ghostfolio/api/app/account/account.service';
import { OrderService } from '@ghostfolio/api/app/order/order.service';
import { PortfolioService } from '@ghostfolio/api/app/portfolio/portfolio.service';
import { DataProviderService } from '@ghostfolio/api/services/data-provider/data-provider.service';
import { MarketDataService } from '@ghostfolio/api/services/market-data/market-data.service';
import { PropertyService } from '@ghostfolio/api/services/property/property.service';
import { AssetClass, DataSource } from '@prisma/client';
import type { PortfolioPosition } from '@ghostfolio/common/interfaces';

import { HumanMessage } from '@langchain/core/messages';

import {
  AiChatGraphService,
  getDefaultChirpForRoute
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

function getOpenAiKey(): string | null {
  const v =
    process.env.OPENAI_API_KEY?.trim() || process.env.API_KEY_OPENAI?.trim();
  return v || null;
}

const hasOpenAiKey = (): boolean => !!getOpenAiKey();
const AI_CHAT_TEST_TIMEOUT_MS = 30_000;
const itWithKey = (
  name: string,
  fn: () => Promise<void>,
  timeoutMs = AI_CHAT_TEST_TIMEOUT_MS
) => (hasOpenAiKey() ? it(name, fn, timeoutMs) : it.skip(name, fn));

const BASE_PARAMS = {
  userId: 'eval-user',
  userCurrency: 'USD',
  filters: undefined as undefined,
  impersonationId: undefined as undefined,
  messages: [] as { role: 'user' | 'assistant'; content: string }[]
};

function makeHolding(
  symbol: string,
  name: string,
  allocationInPercentage: number
): PortfolioPosition {
  return {
    symbol,
    name,
    currency: 'USD',
    allocationInPercentage,
    assetClass: AssetClass.EQUITY,
    assetSubClass: null,
    activitiesCount: 1,
    dataSource: DataSource.YAHOO,
    dateOfFirstActivity: new Date(),
    dividend: 0,
    grossPerformance: 0,
    grossPerformancePercent: 0,
    grossPerformancePercentWithCurrencyEffect: 0,
    grossPerformanceWithCurrencyEffect: 0,
    holdings: [],
    investment: 1000,
    markets: {} as PortfolioPosition['markets'],
    marketsAdvanced: {} as PortfolioPosition['marketsAdvanced'],
    marketPrice: 150,
    netPerformance: 0,
    netPerformancePercent: 0,
    netPerformancePercentWithCurrencyEffect: 0,
    netPerformanceWithCurrencyEffect: 0,
    quantity: 10,
    valueInBaseCurrency: 1500,
    countries: [],
    sectors: []
  };
}

const EMPTY_PORTFOLIO = {
  holdings: {} as Record<string, PortfolioPosition>,
  hasErrors: false
};

const PORTFOLIO_FIXTURE = {
  holdings: {
    AAPL: makeHolding('AAPL', 'Apple Inc.', 0.6),
    MSFT: makeHolding('MSFT', 'Microsoft Corporation', 0.4)
  },
  hasErrors: false,
  summary: { currentValueInBaseCurrency: 1800 }
};

/** Chirp must mention which agent/assistant; used to fail tests if chirp is missing or meaningless. */
const CHIRP_MUST_MENTION_AGENT = /(data|advice|general)\s+agent|general\s+assistant/i;

describe('Chirping', () => {
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
      getDetails: jest.fn().mockResolvedValue(EMPTY_PORTFOLIO),
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

  describe('getDefaultChirpForRoute (fallback text)', () => {
    it('returns exact string for data route', () => {
      expect(getDefaultChirpForRoute('data')).toBe(
        'Let me ask the data agent about your question.'
      );
    });

    it('returns exact string for advice route', () => {
      expect(getDefaultChirpForRoute('advice')).toBe(
        'Let me ask the advice agent about your question.'
      );
    });

    it('returns "general assistant" for general route (not "general agent")', () => {
      expect(getDefaultChirpForRoute('general')).toBe(
        'Let me ask the general assistant about your question.'
      );
    });

    it('every route chirp matches CHIRP_MUST_MENTION_AGENT', () => {
      expect(getDefaultChirpForRoute('data')).toMatch(CHIRP_MUST_MENTION_AGENT);
      expect(getDefaultChirpForRoute('advice')).toMatch(CHIRP_MUST_MENTION_AGENT);
      expect(getDefaultChirpForRoute('general')).toMatch(CHIRP_MUST_MENTION_AGENT);
    });

    it('every route chirp is non-empty and has no leading/trailing whitespace', () => {
      for (const route of ['data', 'advice', 'general'] as const) {
        const chirp = getDefaultChirpForRoute(route);
        expect(chirp.length).toBeGreaterThan(0);
        expect(chirp).toBe(chirp.trim());
      }
    });
  });

  describe('run() — chirp always present', () => {
    itWithKey(
      'returns non-empty chirp for data-route question (allocation)',
      async () => {
        portfolioService.getDetails.mockResolvedValue({
          ...EMPTY_PORTFOLIO
        } as never);

        const result = await aiChatGraphService.run({
          filters: BASE_PARAMS.filters,
          impersonationId: BASE_PARAMS.impersonationId,
          messages: [new HumanMessage("What's my portfolio allocation?")],
          openAiKey: getOpenAiKey()!,
          userCurrency: BASE_PARAMS.userCurrency,
          userId: BASE_PARAMS.userId
        });

        expect(result.chirp).toBeDefined();
        expect(typeof result.chirp).toBe('string');
        expect(result.chirp!.trim().length).toBeGreaterThan(0);
        expect(result.chirp).toMatch(CHIRP_MUST_MENTION_AGENT);
        expect(result.content).toBeDefined();
        expect(result.content.length).toBeGreaterThan(0);
      }
    );

    itWithKey(
      'returns non-empty chirp for advice route (rebalance)',
      async () => {
        portfolioService.getDetails.mockResolvedValue({
          ...PORTFOLIO_FIXTURE
        } as never);

        const result = await aiChatGraphService.run({
          filters: BASE_PARAMS.filters,
          impersonationId: BASE_PARAMS.impersonationId,
          messages: [new HumanMessage('Should I rebalance my portfolio?')],
          openAiKey: getOpenAiKey()!,
          userCurrency: BASE_PARAMS.userCurrency,
          userId: BASE_PARAMS.userId
        });

        expect(result.chirp).toBeDefined();
        expect(typeof result.chirp).toBe('string');
        expect(result.chirp!.trim().length).toBeGreaterThan(0);
        expect(result.chirp).toMatch(/advice\s+agent|general\s+assistant/i);
        expect(result.content).toBeDefined();
      }
    );

    itWithKey(
      'returns non-empty chirp for general route (greeting)',
      async () => {
        const result = await aiChatGraphService.run({
          filters: BASE_PARAMS.filters,
          impersonationId: BASE_PARAMS.impersonationId,
          messages: [new HumanMessage('Hello')],
          openAiKey: getOpenAiKey()!,
          userCurrency: BASE_PARAMS.userCurrency,
          userId: BASE_PARAMS.userId
        });

        expect(result.chirp).toBeDefined();
        expect(typeof result.chirp).toBe('string');
        expect(result.chirp!.trim().length).toBeGreaterThan(0);
        expect(result.chirp).toMatch(CHIRP_MUST_MENTION_AGENT);
        expect(result.content).toBeDefined();
        expect(result.content.length).toBeGreaterThan(0);
      }
    );
  });

  describe('runWithTrace() — routerChirp always present', () => {
    itWithKey(
      'includes routerChirp for data route; fails if chirp missing',
      async () => {
        const trace = await aiChatGraphService.runWithTrace({
          filters: BASE_PARAMS.filters,
          impersonationId: BASE_PARAMS.impersonationId,
          messages: [new HumanMessage('How much money do I have?')],
          openAiKey: getOpenAiKey()!,
          userCurrency: BASE_PARAMS.userCurrency,
          userId: BASE_PARAMS.userId
        });

        expect(trace.route).toBe('data');
        expect(trace.routerChirp).toBeDefined();
        expect(typeof trace.routerChirp).toBe('string');
        expect(trace.routerChirp!.trim().length).toBeGreaterThan(0);
        expect(trace.routerChirp).toMatch(CHIRP_MUST_MENTION_AGENT);
      }
    );
  });

  describe('runStream() — chirp chunk before content chunk', () => {
    itWithKey(
      'yields at least one chirp chunk then at least one content chunk; chirp mentions agent',
      async () => {
        const chunks: { chirp?: string; content?: string }[] = [];
        for await (const chunk of aiChatGraphService.runStream({
          filters: BASE_PARAMS.filters,
          impersonationId: BASE_PARAMS.impersonationId,
          messages: [new HumanMessage('Hi')],
          openAiKey: getOpenAiKey()!,
          userCurrency: BASE_PARAMS.userCurrency,
          userId: BASE_PARAMS.userId
        })) {
          chunks.push(chunk);
        }

        const chirpChunks = chunks.filter((c) => c.chirp != null && c.chirp !== '');
        const contentChunks = chunks.filter((c) => c.content != null);

        expect(chirpChunks.length).toBeGreaterThanOrEqual(1);
        expect(contentChunks.length).toBeGreaterThanOrEqual(1);
        const firstChirpIndex = chunks.findIndex((c) => c.chirp != null && c.chirp !== '');
        const firstContentIndex = chunks.findIndex((c) => c.content != null);
        expect(firstChirpIndex).toBeLessThan(firstContentIndex);

        const chirpText = chirpChunks[0].chirp!;
        expect(chirpText.trim().length).toBeGreaterThan(0);
        expect(chirpText).toMatch(CHIRP_MUST_MENTION_AGENT);
      }
    );
  });

  describe('AiChatService.chat() — chirp in response', () => {
    itWithKey(
      'returns chirp and content for data-style message when API key is set',
      async () => {
        propertyService.getByKey.mockResolvedValue(getOpenAiKey()!);

        const result = await aiChatService.chat({
          ...BASE_PARAMS,
          messages: [{ role: 'user', content: 'how much money i got' }]
        });

        expect(result.chirp).toBeDefined();
        expect(result.chirp).toMatch(/data agent/i);
        expect(result.content).toBeDefined();
        expect(result.content.length).toBeGreaterThan(0);
      }
    );
  });
});
