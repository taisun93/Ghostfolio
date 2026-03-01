import { AccountBalanceService } from '@ghostfolio/api/app/account-balance/account-balance.service';
import { AccountService } from '@ghostfolio/api/app/account/account.service';
import { OrderService } from '@ghostfolio/api/app/order/order.service';
import { PortfolioService } from '@ghostfolio/api/app/portfolio/portfolio.service';
import { DataProviderService } from '@ghostfolio/api/services/data-provider/data-provider.service';
import { MarketDataService } from '@ghostfolio/api/services/market-data/market-data.service';
import type { Filter } from '@ghostfolio/common/interfaces';

import { Injectable } from '@nestjs/common';
import type { BaseMessage } from '@langchain/core/messages';
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage
} from '@langchain/core/messages';
import type { StructuredToolInterface } from '@langchain/core/tools';
import { ChatOpenAI } from '@langchain/openai';
import { StateGraph } from '@langchain/langgraph';

import {
  ChatGraphStateAnnotation,
  type ChatGraphState,
  type ComplianceDecision,
  type RouteType,
  type ToolCallRecord
} from './chat-graph-state';
import { createAdvisorAgentTools } from './tools/advisor-agent.tools';
import { createDataAgentTools } from './tools/data-agent.tools';

const MAX_TOOL_ITERATIONS = 10;

const ROUTER_SYSTEM = `You classify the user's message into exactly one category. Reply with only a JSON object: {"route": "data" | "advice" | "general"}.
- data: factual questions about holdings, allocation, performance, market data, accounts, orders, balances, total value, or how much money (e.g. "What's my allocation?", "How much money do I have?", "List my accounts", "What's my portfolio worth?").
- advice: what should I do, rebalance, risk, diversification (e.g. "Should I rebalance?", "Is my portfolio too risky?").
- general: greetings, off-topic, non-finance (e.g. "Hi", "What's the weather?").`;

const DATA_AGENT_SYSTEM = `You are the data agent for Ghostfolio. Answer factual questions about the user's portfolio, holdings, allocation, performance, market data, accounts, and orders using the tools provided. Be concise and accurate. If data is missing, say so.`;

const ADVICE_AGENT_SYSTEM = `You are the advisor agent for Ghostfolio. Answer "what should I do?" questions about rebalancing, risk, and diversification using the allocation tools. Give short, clear advice. Do not promise returns; suggest they consider professional advice for major decisions.`;

const GENERAL_AGENT_SYSTEM = `You are a friendly Ghostfolio assistant. Answer briefly. For portfolio or investment questions, suggest they ask about their holdings or allocation.`;

const COMPLIANCE_SYSTEM = `You are a compliance checker. You only output a JSON object with: "decision" ("approve" | "warn" | "block"), optional "reason", optional "overrideMessage".
- approve: the reply is fine to show.
- warn: the reply is useful but add a short safety disclaimer in overrideMessage (e.g. "This is not professional advice.").
- block: do not show the reply; set overrideMessage to a neutral refusal (e.g. "I can't help with that. For legitimate banking or fraud concerns, contact your bank or regulator.")
Look for: money laundering, scams (e.g. "prince", "urgent wire", "send crypto"), or user being misled.`;

/** High-risk phrases in user input: always block and return refusal (no LLM compliance call). */
const COMPLIANCE_BLOCK_PATTERNS = [
  /\b(prince|nigeria|wire\s+money|wire\s+funds)\b/i,
  /\b(wire|transfer|send)\s+(money|funds|crypto|bitcoin)\s+(urgently|immediately|asap|now)\b/i,
  /\burgent(ly)?\s+(wire|transfer|payment|send)\b/i,
  /\b(wire|transfer)\s+.*\s+(urgently|secure\s+account)\b/i,
  /\bsend\s+(crypto|bitcoin|money)\s+to\b/i
];

const COMPLIANCE_BLOCK_MESSAGE =
  "I can't help with that. For legitimate banking or fraud concerns, contact your bank or regulator.";

/** Exported for tests. Returns true when user input matches high-risk scam/fraud patterns (always block, no LLM call). */
export function shouldBlockByInput(userContent: string): boolean {
  const text = (userContent || '').trim();
  if (!text) return false;
  return COMPLIANCE_BLOCK_PATTERNS.some((re) => re.test(text));
}

/** Max time for the full graph (router + agent + compliance). Prevents runaway requests. */
const GRAPH_TIMEOUT_MS = 55_000;

@Injectable()
export class AiChatGraphService {
  public constructor(
    private readonly accountBalanceService: AccountBalanceService,
    private readonly accountService: AccountService,
    private readonly dataProviderService: DataProviderService,
    private readonly marketDataService: MarketDataService,
    private readonly orderService: OrderService,
    private readonly portfolioService: PortfolioService
  ) {}

  public async run({
    filters,
    impersonationId,
    messages,
    openAiKey,
    userCurrency,
    userId
  }: {
    filters?: Filter[];
    impersonationId?: string;
    messages: BaseMessage[];
    openAiKey: string;
    userCurrency: string;
    userId: string;
  }): Promise<string> {
    const result = await this.invokeGraph({
      filters,
      impersonationId,
      messages,
      openAiKey,
      userCurrency,
      userId
    });
    return result.finalContent ?? '';
  }

  /**
   * Run the chat graph and return content plus trace (route, tool calls).
   * Use for eval and tests that assert on tool selection/execution.
   */
  public async runWithTrace({
    filters,
    impersonationId,
    messages,
    openAiKey,
    userCurrency,
    userId
  }: {
    filters?: Filter[];
    impersonationId?: string;
    messages: BaseMessage[];
    openAiKey: string;
    userCurrency: string;
    userId: string;
  }): Promise<{
    content: string;
    route: RouteType;
    toolCalls: ToolCallRecord[];
  }> {
    const result = await this.invokeGraph({
      filters,
      impersonationId,
      messages,
      openAiKey,
      userCurrency,
      userId
    });
    return {
      content: result.finalContent ?? '',
      route: result.route ?? 'general',
      toolCalls: result.toolCalls ?? []
    };
  }

  private async invokeGraph({
    filters,
    impersonationId,
    messages,
    openAiKey,
    userCurrency,
    userId
  }: {
    filters?: Filter[];
    impersonationId?: string;
    messages: BaseMessage[];
    openAiKey: string;
    userCurrency: string;
    userId: string;
  }): Promise<ChatGraphState> {
    const useDummyData =
      process.env['AI_CHAT_DUMMY_DATA'] !== 'false' &&
      process.env['AI_CHAT_DUMMY_DATA'] !== '0';
    const graph = this.buildGraph(openAiKey);
    const initialState: Partial<ChatGraphState> = {
      filters,
      finalContent: '',
      impersonationId,
      messages,
      useDummyData,
      userCurrency,
      userId
    };
    type InvokeInput = Parameters<typeof graph.invoke>[0];
    const invokePromise = graph.invoke(
      initialState as unknown as InvokeInput
    ) as Promise<ChatGraphState>;
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(
        () => reject(new Error('AI request timed out. Please try a shorter question.')),
        GRAPH_TIMEOUT_MS
      );
    });
    return Promise.race([invokePromise, timeoutPromise]);
  }

  private buildGraph(openAiKey: string) {
    const routerModel = new ChatOpenAI({
      apiKey: openAiKey,
      model: 'gpt-4o-mini',
      temperature: 0
    });
    const dataModel = new ChatOpenAI({
      apiKey: openAiKey,
      model: 'gpt-4o-mini',
      temperature: 0.2
    });
    const adviceModel = new ChatOpenAI({
      apiKey: openAiKey,
      model: 'gpt-4o-mini',
      temperature: 0.2
    });
    const generalModel = new ChatOpenAI({
      apiKey: openAiKey,
      model: 'gpt-4o-mini',
      temperature: 0.3
    });
    const complianceModel = new ChatOpenAI({
      apiKey: openAiKey,
      model: 'gpt-4o-mini',
      temperature: 0
    });

    const services = {
      accountBalanceService: this.accountBalanceService,
      accountService: this.accountService,
      dataProviderService: this.dataProviderService,
      marketDataService: this.marketDataService,
      orderService: this.orderService,
      portfolioService: this.portfolioService
    };

    const routerAsync = async (
      state: ChatGraphState
    ): Promise<Partial<ChatGraphState>> => {
      const lastUser = [...state.messages]
        .reverse()
        .find((m) => m._getType() === 'human');
      const content =
        typeof lastUser?.content === 'string' ? lastUser.content : '';
      let route: RouteType = 'general';
      try {
        const prompt = [
          new SystemMessage(ROUTER_SYSTEM),
          new HumanMessage(content || 'Hi')
        ];
        const out = await routerModel.invoke(prompt);
        const text =
          typeof out.content === 'string' ? out.content : String(out.content);
        const match = text.match(/\{\s*"route"\s*:\s*"(data|advice|general)"/);
        if (match) {
          route = match[1] as RouteType;
        }
      } catch {
        const lower = content.toLowerCase();
        if (
          /\b(holdings?|allocation|performance|accounts?|orders?|balance|quote|price|symbol|worth|how much|total value|money have)\b/.test(
            lower
          ) &&
          !/\b(should|rebalance|risk|diversif|advice)\b/.test(lower)
        ) {
          route = 'data';
        } else if (
          /\b(should|rebalance|risk|diversif|advice|recommend)\b/.test(lower)
        ) {
          route = 'advice';
        }
      }
      return { route };
    };

    const dataAgent = async (
      state: ChatGraphState
    ): Promise<Partial<ChatGraphState>> => {
      const tools = createDataAgentTools(services, {
        filters: state.filters,
        impersonationId: state.impersonationId,
        useDummyData: state.useDummyData,
        userCurrency: state.userCurrency,
        userId: state.userId
      });
      const modelWithTools = dataModel.bindTools(tools);
      const { reply: draftReply, toolCalls } = await this.runToolLoop(
        modelWithTools,
        state.messages,
        DATA_AGENT_SYSTEM,
        tools
      );
      return { draftReply, toolCalls };
    };

    const adviceAgent = async (
      state: ChatGraphState
    ): Promise<Partial<ChatGraphState>> => {
      const tools = createAdvisorAgentTools(
        { portfolioService: this.portfolioService },
        {
          filters: state.filters,
          impersonationId: state.impersonationId,
          useDummyData: state.useDummyData,
          userCurrency: state.userCurrency,
          userId: state.userId
        }
      );
      const modelWithTools = adviceModel.bindTools(tools);
      const { reply: draftReply, toolCalls } = await this.runToolLoop(
        modelWithTools,
        state.messages,
        ADVICE_AGENT_SYSTEM,
        tools
      );
      return { draftReply, toolCalls };
    };

    const generalAgent = async (
      state: ChatGraphState
    ): Promise<Partial<ChatGraphState>> => {
      const prompt = [
        new SystemMessage(GENERAL_AGENT_SYSTEM),
        ...state.messages
      ];
      const out = await generalModel.invoke(prompt);
      const draftReply =
        typeof out.content === 'string' ? out.content : String(out.content ?? '');
      return { draftReply, toolCalls: [] };
    };

    const compliance = async (
      state: ChatGraphState
    ): Promise<Partial<ChatGraphState>> => {
      const draftReply = state.draftReply ?? '';
      const lastUser = [...state.messages]
        .reverse()
        .find((m) => m._getType() === 'human');
      const userContent =
        typeof lastUser?.content === 'string' ? lastUser.content : '';

      if (shouldBlockByInput(userContent)) {
        return {
          complianceDecision: 'block',
          complianceMessage: COMPLIANCE_BLOCK_MESSAGE,
          finalContent: COMPLIANCE_BLOCK_MESSAGE
        };
      }

      let decision: ComplianceDecision = 'approve';
      let complianceMessage: string | undefined;
      try {
        const prompt = [
          new SystemMessage(COMPLIANCE_SYSTEM),
          new HumanMessage(
            `User said: ${userContent}\n\nAssistant draft reply: ${draftReply}\n\nOutput JSON: decision, reason?, overrideMessage?`
          )
        ];
        const out = await complianceModel.invoke(prompt);
        const text =
          typeof out.content === 'string' ? out.content : String(out.content);
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            const parsed = JSON.parse(jsonMatch[0]) as {
              decision?: ComplianceDecision;
              overrideMessage?: string;
            };
            if (
              parsed.decision === 'approve' ||
              parsed.decision === 'warn' ||
              parsed.decision === 'block'
            ) {
              decision = parsed.decision;
            }
            if (typeof parsed.overrideMessage === 'string') {
              complianceMessage = parsed.overrideMessage;
            }
          } catch {
            // Fallback regex
            const decisionMatch = text.match(/"decision"\s*:\s*"(approve|warn|block)"/);
            if (decisionMatch) decision = decisionMatch[1] as ComplianceDecision;
          }
        }
      } catch {
        decision = 'approve';
      }
      let finalContent: string;
      if (decision === 'block') {
        finalContent =
          complianceMessage ||
          "I can't help with that. For legitimate banking or fraud concerns, contact your bank or regulator.";
      } else if (decision === 'warn') {
        finalContent = draftReply + (complianceMessage ? `\n\n${complianceMessage}` : '');
      } else {
        finalContent = draftReply;
      }
      return {
        complianceDecision: decision,
        complianceMessage,
        finalContent
      };
    };

    const graph = new StateGraph(ChatGraphStateAnnotation)
      .addNode('router', routerAsync)
      .addNode('data_agent', dataAgent)
      .addNode('advice_agent', adviceAgent)
      .addNode('general_agent', generalAgent)
      .addNode('compliance', compliance);

    graph.addEdge('__start__', 'router');
    graph.addConditionalEdges('router', (state: ChatGraphState) => state.route ?? 'general', {
      data: 'data_agent',
      advice: 'advice_agent',
      general: 'general_agent'
    });
    graph.addEdge('data_agent', 'compliance');
    graph.addEdge('advice_agent', 'compliance');
    graph.addEdge('general_agent', 'compliance');
    graph.addEdge('compliance', '__end__');

    return graph.compile();
  }

  private async runToolLoop(
    model: ReturnType<ChatOpenAI['bindTools']>,
    messages: BaseMessage[],
    systemContent: string,
    tools: StructuredToolInterface[]
  ): Promise<{ reply: string; toolCalls: ToolCallRecord[] }> {
    const system = new SystemMessage(systemContent);
    let current: BaseMessage[] = [system, ...messages];
    const toolCallRecords: ToolCallRecord[] = [];
    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      const response = await model.invoke(current);
      const responseToolCalls = (response as AIMessage).tool_calls ?? [];
      if (responseToolCalls.length === 0) {
        const content = response.content;
        const reply =
          typeof content === 'string' ? content : String(content ?? '');
        return { reply, toolCalls: toolCallRecords };
      }
      current = current.concat([response]);
      for (const tc of responseToolCalls) {
        const tool = tools.find((t) => t.name === tc.name);
        let result: string;
        if (tool) {
          try {
            result = await tool.invoke(tc.args ?? {});
          } catch (err) {
            result = `Error: ${err instanceof Error ? err.message : 'Unknown'}`;
          }
        } else {
          result = 'Tool not found.';
        }
        toolCallRecords.push({
          name: tc.name,
          args: (tc.args ?? {}) as Record<string, unknown>,
          result
        });
        current = current.concat([
          new ToolMessage({
            content: result,
            tool_call_id: tc.id
          })
        ]);
      }
    }
    return {
      reply: 'I hit the iteration limit. Please try a simpler question.',
      toolCalls: toolCallRecords
    };
  }
}
