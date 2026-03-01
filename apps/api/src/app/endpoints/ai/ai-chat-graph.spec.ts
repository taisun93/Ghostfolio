/**
 * Test suite 3 of 3: AI chat graph & reliability — routing fallbacks, compliance blocking,
 * tools in isolation, tool invocation through the graph (CI-safe, mocked LLM), and service
 * error handling. All tests are CI-safe (no API key required).
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

import type { BaseMessage } from '@langchain/core/messages';
import { HumanMessage } from '@langchain/core/messages';

import { createAdvisorAgentTools } from './langgraph/tools/advisor-agent.tools';
import { createDataAgentTools } from './langgraph/tools/data-agent.tools';
import {
  AiChatGraphService,
  COMPLIANCE_QA_SUFFIX,
  getDataRouteFallback,
  isForbiddenRefusalOrIdk,
  shouldBlockByInput,
  EXPORTED_CURRENT_STATUS_RULE,
  EXPORTED_DATA_AGENT_SYSTEM,
  EXPORTED_ADVICE_AGENT_SYSTEM
} from './langgraph/ai-chat-graph.service';
import { AiChatService } from './ai-chat.service';

/** CI-safe mock: when set, ChatOpenAI returns fake invoke/bindTools so the graph runs without an API key. */
const MOCK_FLAG = '__AI_CHAT_GRAPH_USE_MOCK_LLM__';
const MOCK_ROUTE = '__AI_CHAT_GRAPH_MOCK_ROUTE__';
function setUseMockChatOpenAI(value: boolean, route: 'data' | 'advice' = 'data') {
  (global as unknown as Record<string, boolean | string>)[MOCK_FLAG] = value;
  (global as unknown as Record<string, boolean | string>)[MOCK_ROUTE] = route;
}

jest.mock('@langchain/openai', () => {
  return {
    ChatOpenAI: jest.fn().mockImplementation(() => {
      const invokeImpl = async (messages: BaseMessage[]) => {
        const useMock = (global as unknown as Record<string, boolean>)[MOCK_FLAG];
        const route = ((global as unknown as Record<string, string>)[MOCK_ROUTE] ||
          'data') as 'data' | 'advice';
        if (!useMock) {
          return { content: '{}' };
        }
        const first = messages[0];
        const systemContent =
          first && (first as { _getType?: () => string })._getType?.() === 'system'
            ? String((first as { content: unknown }).content ?? '')
            : '';
        if (systemContent.includes('classify') && systemContent.includes('route')) {
          const chirp =
            route === 'data'
              ? 'Let me ask the data agent.'
              : 'Let me ask the advice agent.';
          return {
            content: `{"route": "${route}", "chirp": "${chirp}"}`
          };
        }
        if (systemContent.includes('compliance checker')) {
          return { content: '{"decision": "approve"}' };
        }
        if (systemContent.includes('data agent')) {
          const hasToolMessage = messages.some(
            (m) => (m as { _getType?: () => string })._getType?.() === 'tool'
          );
          if (!hasToolMessage) {
            return {
              content: '',
              tool_calls: [{ id: 'tc-1', name: 'get_holdings', args: {} }]
            };
          }
          return { content: 'Here are your holdings.' };
        }
        if (systemContent.includes('advisor agent')) {
          const hasToolMessage = messages.some(
            (m) => (m as { _getType?: () => string })._getType?.() === 'tool'
          );
          if (!hasToolMessage) {
            return {
              content: '',
              tool_calls: [
                { id: 'tc-1', name: 'get_allocation_summary', args: {} }
              ]
            };
          }
          return { content: 'Here is your allocation advice.' };
        }
        if (systemContent.includes('friendly Ghostfolio assistant')) {
          return { content: 'Hi there!' };
        }
        return { content: '{}' };
      };
      return {
        invoke: invokeImpl,
        bindTools: (_tools: unknown) => ({ invoke: invokeImpl })
      };
    })
  };
});

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

  describe('Tool use enforcement (prompts)', () => {
    it('CURRENT_STATUS_RULE requires checking status via tools and forbids generic refusal', () => {
      expect(EXPORTED_CURRENT_STATUS_RULE).toMatch(/current status/i);
      expect(EXPORTED_CURRENT_STATUS_RULE).toMatch(/essential/i);
      expect(EXPORTED_CURRENT_STATUS_RULE).toMatch(/via the tools/i);
      expect(EXPORTED_CURRENT_STATUS_RULE).toMatch(/Never refuse.*cannot access their information/i);
      expect(EXPORTED_CURRENT_STATUS_RULE).toMatch(/unable to access personal financial information/i);
    });

    it('data agent system prompt includes current-status rule and get_total_value for "how much money"', () => {
      expect(EXPORTED_DATA_AGENT_SYSTEM).toContain(EXPORTED_CURRENT_STATUS_RULE);
      expect(EXPORTED_DATA_AGENT_SYSTEM).toMatch(/get_total_value|get_holdings/i);
      expect(EXPORTED_DATA_AGENT_SYSTEM).toMatch(/how much money|total value|how much am I worth/i);
    });

    it('advice agent system prompt includes current-status rule and using tools before advising', () => {
      expect(EXPORTED_ADVICE_AGENT_SYSTEM).toContain(EXPORTED_CURRENT_STATUS_RULE);
      expect(EXPORTED_ADVICE_AGENT_SYSTEM).toMatch(/allocation|holdings/i);
      expect(EXPORTED_ADVICE_AGENT_SYSTEM).toMatch(/before advising/i);
    });
  });

  describe('isForbiddenRefusalOrIdk', () => {
    const exactRefusalMessage =
      "I'm unable to access personal financial information or accounts. To find out how much money you have, you can check your bank account, investment accounts, or any financial apps you use. If you need help with budgeting or managing your finances, feel free to ask!";

    it('detects the exact refusal message so API never returns it', () => {
      expect(isForbiddenRefusalOrIdk(exactRefusalMessage)).toBe(true);
    });

    it('detects common refusal fragments', () => {
      expect(isForbiddenRefusalOrIdk("I'm unable to access your accounts.")).toBe(true);
      expect(isForbiddenRefusalOrIdk('Check your bank account for balance.')).toBe(true);
      expect(isForbiddenRefusalOrIdk("I don't have access to that data.")).toBe(true);
    });

    it('allows normal portfolio answers', () => {
      expect(isForbiddenRefusalOrIdk('Your total value is 10,000 USD.')).toBe(false);
      expect(isForbiddenRefusalOrIdk('Based on your allocation: 60% stocks.')).toBe(false);
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

  describe('Tool invocation through graph (CI-safe)', () => {
    beforeEach(() => {
      setUseMockChatOpenAI(true, 'data');
      portfolioService.getDetails.mockResolvedValue({
        holdings: {},
        hasErrors: false
      } as never);
    });
    afterEach(() => {
      setUseMockChatOpenAI(false);
      delete (global as unknown as Record<string, unknown>)[MOCK_FLAG];
      delete (global as unknown as Record<string, unknown>)[MOCK_ROUTE];
    });

    it('runWithTrace with mocked LLM (data route) returns toolCalls and tool result', async () => {
      const trace = await aiChatGraphService.runWithTrace({
        filters: BASE_PARAMS.filters,
        impersonationId: BASE_PARAMS.impersonationId,
        messages: [new HumanMessage("What's my allocation?")],
        openAiKey: 'mock-key',
        userCurrency: BASE_PARAMS.userCurrency,
        userId: BASE_PARAMS.userId
      });

      expect(trace.route).toBe('data');
      expect(trace.toolCalls.length).toBeGreaterThanOrEqual(1);
      const getHoldingsCall = trace.toolCalls.find((tc) => tc.name === 'get_holdings');
      expect(getHoldingsCall).toBeDefined();
      expect(getHoldingsCall!.result).not.toBe('Tool not found.');
      expect(trace.content).toBeDefined();
      expect(trace.content.length).toBeGreaterThan(0);
      expect(trace.content).not.toMatch(/unable to access personal financial information/i);
      expect(trace.content).not.toMatch(/I cannot access your (information|data)/i);
      expect(trace.content).toContain(COMPLIANCE_QA_SUFFIX);
    });

    it('data agent always invokes status tools (get_total_value, get_holdings, get_portfolio_performance, list_accounts, get_account_balances)', async () => {
      const trace = await aiChatGraphService.runWithTrace({
        filters: BASE_PARAMS.filters,
        impersonationId: BASE_PARAMS.impersonationId,
        messages: [new HumanMessage('How much money do I have?')],
        openAiKey: 'mock-key',
        userCurrency: BASE_PARAMS.userCurrency,
        userId: BASE_PARAMS.userId
      });

      expect(trace.route).toBe('data');
      const statusToolNames = [
        'get_total_value',
        'get_holdings',
        'get_portfolio_performance',
        'list_accounts',
        'get_account_balances'
      ];
      for (const name of statusToolNames) {
        const call = trace.toolCalls.find((tc) => tc.name === name);
        expect(call).toBeDefined();
        expect(call!.result).not.toBe('Tool not found.');
        expect(typeof call!.result).toBe('string');
        expect(call!.result.length).toBeGreaterThan(0);
      }
    });

    it('data agent status tools actually call backend (getDetails and getPerformance)', async () => {
      portfolioService.getPerformance.mockResolvedValue({
        performance: {
          netPerformance: 100,
          netPerformancePercentage: 5,
          totalInvestment: 2000,
          currentNetWorth: 2100,
          currentValueInBaseCurrency: 2100,
          netPerformancePercentageWithCurrencyEffect: 5,
          netPerformanceWithCurrencyEffect: 100,
          totalInvestmentValueWithCurrencyEffect: 2000
        }
      } as never);

      await aiChatGraphService.runWithTrace({
        filters: BASE_PARAMS.filters,
        impersonationId: BASE_PARAMS.impersonationId,
        messages: [new HumanMessage('What is my total return?')],
        openAiKey: 'mock-key',
        userCurrency: BASE_PARAMS.userCurrency,
        userId: BASE_PARAMS.userId
      });

      expect(portfolioService.getDetails).toHaveBeenCalled();
      expect(portfolioService.getPerformance).toHaveBeenCalled();
    });

    it('data agent tool results reflect backend data', async () => {
      const testValue = 42_500;
      portfolioService.getDetails.mockResolvedValue({
        holdings: {},
        hasErrors: false,
        summary: { currentValueInBaseCurrency: testValue }
      } as never);

      const trace = await aiChatGraphService.runWithTrace({
        filters: BASE_PARAMS.filters,
        impersonationId: BASE_PARAMS.impersonationId,
        messages: [new HumanMessage('How much money do I have?')],
        openAiKey: 'mock-key',
        userCurrency: BASE_PARAMS.userCurrency,
        userId: BASE_PARAMS.userId
      });

      const totalCall = trace.toolCalls.find((tc) => tc.name === 'get_total_value');
      expect(totalCall).toBeDefined();
      expect(totalCall!.result).toContain(String(testValue));
      expect(trace.content).toContain(COMPLIANCE_QA_SUFFIX);
    });

    it('advice agent always invokes status tool (get_allocation_summary)', async () => {
      setUseMockChatOpenAI(true, 'advice');
      portfolioService.getDetails.mockResolvedValue({
        holdings: {},
        hasErrors: false
      } as never);

      const trace = await aiChatGraphService.runWithTrace({
        filters: BASE_PARAMS.filters,
        impersonationId: BASE_PARAMS.impersonationId,
        messages: [new HumanMessage('Should I rebalance?')],
        openAiKey: 'mock-key',
        userCurrency: BASE_PARAMS.userCurrency,
        userId: BASE_PARAMS.userId
      });

      expect(trace.route).toBe('advice');
      const allocCall = trace.toolCalls.find(
        (tc) => tc.name === 'get_allocation_summary'
      );
      expect(allocCall).toBeDefined();
      expect(allocCall!.result).not.toBe('Tool not found.');
      expect(allocCall!.result.length).toBeGreaterThan(0);
    });

    it('advice agent status tool calls backend (getDetails)', async () => {
      setUseMockChatOpenAI(true, 'advice');
      portfolioService.getDetails.mockResolvedValue({
        holdings: {},
        hasErrors: false
      } as never);

      await aiChatGraphService.runWithTrace({
        filters: BASE_PARAMS.filters,
        impersonationId: BASE_PARAMS.impersonationId,
        messages: [new HumanMessage('Am I diversified?')],
        openAiKey: 'mock-key',
        userCurrency: BASE_PARAMS.userCurrency,
        userId: BASE_PARAMS.userId
      });

      expect(portfolioService.getDetails).toHaveBeenCalled();
    });

    it('runWithTrace with mocked LLM (advice route) returns toolCalls and no generic refusal', async () => {
      setUseMockChatOpenAI(true, 'advice');
      portfolioService.getDetails.mockResolvedValue({
        holdings: {},
        hasErrors: false
      } as never);

      const trace = await aiChatGraphService.runWithTrace({
        filters: BASE_PARAMS.filters,
        impersonationId: BASE_PARAMS.impersonationId,
        messages: [new HumanMessage('Should I rebalance?')],
        openAiKey: 'mock-key',
        userCurrency: BASE_PARAMS.userCurrency,
        userId: BASE_PARAMS.userId
      });

      expect(trace.route).toBe('advice');
      expect(trace.toolCalls.length).toBeGreaterThanOrEqual(1);
      const allocCall = trace.toolCalls.find(
        (tc) => tc.name === 'get_allocation_summary'
      );
      expect(allocCall).toBeDefined();
      expect(allocCall!.result).not.toBe('Tool not found.');
      expect(trace.content).not.toMatch(/unable to access personal financial information/i);
      expect(trace.content).toContain(COMPLIANCE_QA_SUFFIX);
    });

    it('chat() with mocked LLM triggers backend (getDetails)', async () => {
      propertyService.getByKey.mockResolvedValue('mock-key');

      await aiChatService.chat({
        ...BASE_PARAMS,
        messages: [{ role: 'user', content: "What's my allocation?" }]
      });

      expect(portfolioService.getDetails).toHaveBeenCalled();
    });

    describe('compliance gate — architecture must hit compliance before returning content', () => {
      it('run() content ends with compliance QA suffix (proves compliance node ran)', async () => {
        setUseMockChatOpenAI(true, 'data');
        const result = await aiChatGraphService.run({
          filters: BASE_PARAMS.filters,
          impersonationId: BASE_PARAMS.impersonationId,
          messages: [new HumanMessage("What's my allocation?")],
          openAiKey: 'mock-key',
          userCurrency: BASE_PARAMS.userCurrency,
          userId: BASE_PARAMS.userId
        });
        expect(result.content).toBeDefined();
        expect(result.content).toContain(COMPLIANCE_QA_SUFFIX);
      });

      it('runStream() content chunk ends with compliance QA suffix (proves compliance node ran)', async () => {
        setUseMockChatOpenAI(true, 'general');
        const chunks: { chirp?: string; content?: string }[] = [];
        for await (const chunk of aiChatGraphService.runStream({
          filters: BASE_PARAMS.filters,
          impersonationId: BASE_PARAMS.impersonationId,
          messages: [new HumanMessage('Hi')],
          openAiKey: 'mock-key',
          userCurrency: BASE_PARAMS.userCurrency,
          userId: BASE_PARAMS.userId
        })) {
          chunks.push(chunk);
        }
        const contentChunks = chunks.filter((c) => c.content != null && c.content !== '');
        expect(contentChunks.length).toBeGreaterThanOrEqual(1);
        expect(contentChunks.some((c) => c.content!.includes(COMPLIANCE_QA_SUFFIX))).toBe(true);
      });

      it('runWithTrace() content ends with compliance QA suffix (proves compliance node ran)', async () => {
        setUseMockChatOpenAI(true, 'data');
        const trace = await aiChatGraphService.runWithTrace({
          filters: BASE_PARAMS.filters,
          impersonationId: BASE_PARAMS.impersonationId,
          messages: [new HumanMessage('How much money do I have?')],
          openAiKey: 'mock-key',
          userCurrency: BASE_PARAMS.userCurrency,
          userId: BASE_PARAMS.userId
        });
        expect(trace.content).toBeDefined();
        expect(trace.content).toContain(COMPLIANCE_QA_SUFFIX);
      });
    });
  });
});
