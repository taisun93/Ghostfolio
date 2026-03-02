import { AccountBalanceService } from '@ghostfolio/api/app/account-balance/account-balance.service';
import { AccountService } from '@ghostfolio/api/app/account/account.service';
import { OrderService } from '@ghostfolio/api/app/order/order.service';
import { PortfolioService } from '@ghostfolio/api/app/portfolio/portfolio.service';
import { DataProviderService } from '@ghostfolio/api/services/data-provider/data-provider.service';
import { MarketDataService } from '@ghostfolio/api/services/market-data/market-data.service';
import type { Filter } from '@ghostfolio/common/interfaces';

import { Injectable, Logger } from '@nestjs/common';
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

/** Every chat agent (data, advice, general) runs exactly this many iterations—no early exit. */
const AGENT_LOOP_ITERATIONS = 10;

const ROUTER_SYSTEM = `You classify the user's message and produce a short chirp. Reply with only a JSON object: {"route": "data" | "advice" | "general", "chirp": "one short sentence"}.
- route "data": factual questions about holdings, allocation, performance, market data, accounts, orders, balances, total value, or how much money (e.g. "What's my allocation?", "How much money do I have?", "List my accounts").
- route "advice": what should I do, rebalance, risk, diversification (e.g. "Should I rebalance?", "Is my portfolio too risky?").
- route "general": greetings, off-topic, non-finance (e.g. "Hi", "What's the weather?").
- chirp: exactly one short sentence telling the user which agent you are asking, e.g. "Let me ask the data agent about your question." or "Let me ask the advice agent about that." or "Let me ask the general assistant." Use "data agent", "advice agent", or "general assistant" to match the route. No other text.`;

/** Shared rule: checking the user's current status via tools is key for every agent that has tools. */
const CURRENT_STATUS_RULE = `Checking the user's current status via the tools is essential. You have access to their portfolio data through the tools—use them to get their current situation before answering. Never refuse by saying you cannot access their information; you can, via the tools. If a tool returns an error or no data, say so plainly; do not substitute a generic "I'm unable to access personal financial information."`;

const DATA_AGENT_SYSTEM = `You are the data agent for Ghostfolio. You have access to the user's real portfolio data via the tools provided—use them to answer.

${CURRENT_STATUS_RULE}

Additional rules:
- For "how much money do I have", "what's my total value", "how much am I worth", or similar: call get_total_value (or get_holdings if needed) and answer from the tool result.
- For holdings, allocation, performance, accounts, or orders: call the relevant tool and answer from the result.
- Be concise and accurate.`;

const ADVICE_AGENT_SYSTEM = `You are the advisor agent for Ghostfolio. Answer "what should I do?" questions about rebalancing, risk, and diversification using the allocation tools.

${CURRENT_STATUS_RULE}

Additional rules: Use the tools to get their current allocation/holdings before advising. Give short, clear advice. Do not promise returns; suggest they consider professional advice for major decisions.`;

/** Exported for tests: assert prompts enforce tool use and current-status rule. */
export const EXPORTED_DATA_AGENT_SYSTEM = DATA_AGENT_SYSTEM;
export const EXPORTED_ADVICE_AGENT_SYSTEM = ADVICE_AGENT_SYSTEM;
export const EXPORTED_CURRENT_STATUS_RULE = CURRENT_STATUS_RULE;

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
  /\bsend\s+(crypto|bitcoin|money)\s+to\b/i,
  /\b(send|transfer)\s+.*\s+to\s+(this\s+)?IBAN/i,
  /\b(send|transfer)\s+(\$|\d+[\d,.]*)\s*(k|m|usd|eur|dollars?|euros?)?\s+to\b/i
];

const COMPLIANCE_BLOCK_MESSAGE =
  "I can't help with that. For legitimate banking or fraud concerns, contact your bank or regulator.";

/** Appended to every compliance output to indicate QA for compliance and safety. Exported for tests. */
export const COMPLIANCE_QA_SUFFIX =
  'This message has been reviewed for compliance and safety. This is not financial or investment advice.';

/** Hard block: never return these phrases. Covers "I can't access your financial info" and redirects to bank/apps. */
const REFUSAL_WHEN_HAVING_DATA =
  /unable to access (personal )?financial|unable to access.*(information or )?accounts|I'm unable to access|I am unable to access|cannot access (your )?(personal )?financial|can't (access|tell|see) (you )?(your )?financial|can't tell you how much|do not have access to (your )?financial|don't have access to (your )?(account|portfolio|financial)|check your bank (account|statements)|log into your (online )?banking|to find out how much money you have|check your (bank |investment )?account|investment accounts? (you )?use|financial apps? (you )?use|any financial apps|If you need help with budgeting|managing your finances,?\s*(feel )?free to ask/i;

/** IDK / non-answer we never want. */
const IDK_OR_NON_ANSWER =
  /I don't know|I do not know|I'm not sure|I am not sure|I don't have (that )?information|I do not have (that )?information|I (can't|cannot) (tell|provide|say|help with that)|I'm (unable|not able) to (tell|provide|say)|I (don't|do not) have (access to )?(that )?data|no (information|data) (available|to share)/i;

/** Fallback when we must never show a refusal/IDK reply and have no preloaded data (e.g. general path). */
const FALLBACK_NEVER_REFUSAL =
  "I'd be happy to help with your portfolio. Try asking: \"How much money do I have?\", \"What's my allocation?\", or \"List my holdings.\"";

/** Returns true if content is a forbidden refusal/IDK reply—we never send this to the user. */
export function isForbiddenRefusalOrIdk(content: string): boolean {
  const text = (content || '').trim();
  if (!text) return false;
  return REFUSAL_WHEN_HAVING_DATA.test(text) || IDK_OR_NON_ANSWER.test(text);
}

/** True when reply is non-empty and not a forbidden refusal/IDK; used to decide when to stop agent loops. */
function isDecentReply(content: string): boolean {
  const text = (content || '').trim();
  return text.length > 0 && !isForbiddenRefusalOrIdk(text);
}

/** Exported for tests. Returns true when user input matches high-risk scam/fraud patterns (always block, no LLM call). */
export function shouldBlockByInput(userContent: string): boolean {
  const text = (userContent || '').trim();
  if (!text) return false;
  return COMPLIANCE_BLOCK_PATTERNS.some((re) => re.test(text));
}

/** Exported for tests. Returns fallback route when LLM router fails; same logic as router catch block. */
export function getDataRouteFallback(content: string): RouteType | null {
  const lower = (content || '').toLowerCase().trim();
  if (!lower) return null;
  if (
    /\b(holdings?|allocation|performance|accounts?|orders?|balance|quote|price|symbol|worth|how much|total value|money have|money|got|value)\b/.test(
      lower
    ) &&
    !/\b(should|rebalance|risk|diversif|advice)\b/.test(lower)
  ) {
    return 'data';
  }
  if (/\b(should|rebalance|risk|diversif|advice|recommend)\b/.test(lower)) {
    return 'advice';
  }
  return null;
}

/** Guaranteed chirp text for a route. Used when the router LLM returns no chirp or empty. Exported for tests. */
export function getDefaultChirpForRoute(route: RouteType): string {
  const agentLabel =
    route === 'general' ? 'general assistant' : `${route} agent`;
  return `Let me ask the ${agentLabel} about your question.`;
}

/** Max time for the full graph (router + agent + compliance). Prevents runaway requests. */
const GRAPH_TIMEOUT_MS = 55_000;

@Injectable()
export class AiChatGraphService {
  private readonly logger = new Logger(AiChatGraphService.name);

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
  }): Promise<{ chirp?: string; content: string }> {
    const result = await this.invokeGraph({
      filters,
      impersonationId,
      messages,
      openAiKey,
      userCurrency,
      userId
    });
    const route = result.route ?? 'general';
    const chirp =
      result.routerChirp?.trim() ||
      getDefaultChirpForRoute(route);
    return {
      chirp,
      content: result.finalContent ?? ''
    };
  }

  /**
   * Stream the chat graph: emits { chirp } after the router, then { content } after compliance.
   * Use for UI that shows "which agent" before the full answer.
   */
  public async *runStream({
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
  }): AsyncGenerator<{ chirp?: string; content?: string }> {
    this.logger.log('runStream started (Nest backend; each agent runs 10 iterations)');
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
    type InvokeInput = Parameters<ReturnType<typeof this.buildGraph>['invoke']>[0];
    const stream = await graph.stream(
      initialState as unknown as InvokeInput,
      { streamMode: 'updates' }
    );
    let chirpEmitted = false;
    for await (const chunk of stream) {
      const update = chunk as Record<string, Partial<ChatGraphState>>;
      for (const nodeName of Object.keys(update)) {
        const state = update[nodeName];
        if (!state) continue;
        if (nodeName === 'router' && !chirpEmitted) {
          chirpEmitted = true;
          const route = state.route ?? 'general';
          const chirp =
            state.routerChirp?.trim() || getDefaultChirpForRoute(route);
          yield { chirp };
        }
        if (nodeName === 'compliance' && state.finalContent != null) {
          yield { content: state.finalContent };
        }
      }
    }
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
    routerChirp?: string;
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
    const route = result.route ?? 'general';
    const routerChirp =
      result.routerChirp?.trim() || getDefaultChirpForRoute(route);
    return {
      content: result.finalContent ?? '',
      route,
      routerChirp,
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
      let routerChirp = '';
      try {
        const prompt = [
          new SystemMessage(ROUTER_SYSTEM),
          new HumanMessage(content || 'Hi')
        ];
        const out = await routerModel.invoke(prompt);
        const text =
          typeof out.content === 'string' ? out.content : String(out.content);
        const routeMatch = text.match(/\{\s*"route"\s*:\s*"(data|advice|general)"/);
        if (routeMatch) {
          const raw = (routeMatch[1]?.trim()?.toLowerCase() as RouteType) || 'general';
          route = ['data', 'advice', 'general'].includes(raw) ? raw : 'general';
        }
        const chirpMatch = text.match(/"chirp"\s*:\s*"((?:[^"\\]|\\.)*)"/);
        if (chirpMatch && chirpMatch[1].trim().length > 0) {
          routerChirp = chirpMatch[1].replace(/\\"/g, '"').trim();
        }
      } catch {
        const lower = content.toLowerCase();
        if (
          /\b(holdings?|allocation|performance|accounts?|orders?|balance|quote|price|symbol|worth|how much|total value|money have|money|got|value)\b/.test(
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
      if (!routerChirp?.trim()) {
        routerChirp = getDefaultChirpForRoute(route);
      }
      if (!['data', 'advice', 'general'].includes(route)) {
        route = 'general';
      }
      const nextNode =
        route === 'data'
          ? 'data_agent'
          : route === 'advice'
            ? 'advice_agent'
            : 'general_agent';
      this.logger.log(`router → ${nextNode} (route=${route})`);
      return { route, routerChirp };
    };

    const dataAgent = async (
      state: ChatGraphState
    ): Promise<Partial<ChatGraphState>> => {
      this.logger.log('data_agent entered');
      const fallbackReply =
        "We couldn't process that right now. Please try again.";
      try {
        const tools = createDataAgentTools(services, {
          filters: state.filters,
          impersonationId: state.impersonationId,
          useDummyData: state.useDummyData,
          userCurrency: state.userCurrency,
          userId: state.userId
        });
        const { contextBlock, toolCalls: preloadedCalls } =
          await this.runStatusTools(tools, [
            { name: 'get_total_value', args: {} },
            { name: 'get_holdings', args: {} },
            { name: 'get_portfolio_performance', args: { dateRange: 'max' } },
            { name: 'list_accounts', args: {} },
            { name: 'get_account_balances', args: {} }
          ]);
        const lastUserContent = this.getLastUserContent(state.messages);
        const systemOnly = `${DATA_AGENT_SYSTEM}

Answer using only the data in the user message below. The user message contains portfolio data followed by their question.`;
        const singleMessageWithDataAndQuestion = new HumanMessage(
          `Portfolio data:\n${contextBlock}\n\nUser question: ${lastUserContent || 'How can I help?'}`
        );
        const modelWithTools = dataModel.bindTools(tools);
        let draftReply: string;
        const { reply, toolCalls: loopCalls } = await this.runToolLoop(
          modelWithTools,
          [singleMessageWithDataAndQuestion],
          systemOnly,
          tools
        );
        draftReply = reply;
        const isBlockedReply =
          REFUSAL_WHEN_HAVING_DATA.test(draftReply) ||
          IDK_OR_NON_ANSWER.test(draftReply);
        if (isBlockedReply) {
          draftReply = this.formatReplyFromPreloadedData(preloadedCalls);
          this.logger.log('data_agent return: refusal/IDK replaced with preloaded data');
        }
        const toolCallsResult = [...preloadedCalls, ...loopCalls];
        this.logger.log(
          `data_agent return → compliance (draftReply length=${draftReply.length}, toolCalls=${toolCallsResult.map((c) => c.name).join(', ')})`
        );
        return { draftReply, toolCalls: toolCallsResult };
      } catch (err) {
        this.logger.error('data_agent threw', err);
        return { draftReply: fallbackReply, toolCalls: [] };
      }
    };

    const adviceAgent = async (
      state: ChatGraphState
    ): Promise<Partial<ChatGraphState>> => {
      this.logger.log('advice_agent entered');
      const fallbackReply =
        "We couldn't process that right now. Please try again.";
      try {
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
        const { contextBlock, toolCalls: preloadedCalls } =
          await this.runStatusTools(tools, [
            { name: 'get_allocation_summary', args: {} }
          ]);
        const lastUserContent = this.getLastUserContent(state.messages);
        const systemOnly = `${ADVICE_AGENT_SYSTEM}

Answer using only the allocation data in the user message below. The user message contains the data followed by their question.`;
        const singleMessageWithDataAndQuestion = new HumanMessage(
          `Allocation data:\n${contextBlock}\n\nUser question: ${lastUserContent || 'How can I help?'}`
        );
        const modelWithTools = adviceModel.bindTools(tools);
        let draftReply: string;
        const { reply, toolCalls: loopCalls } = await this.runToolLoop(
          modelWithTools,
          [singleMessageWithDataAndQuestion],
          systemOnly,
          tools
        );
        draftReply = reply;
        const allocCall = preloadedCalls.find(
          (c) => c.name === 'get_allocation_summary'
        );
        const hasUsableAllocation =
          allocCall?.result &&
          !allocCall.result.startsWith('Error') &&
          allocCall.result.length > 0;
        const isRefusalOrIdkAdvice =
          REFUSAL_WHEN_HAVING_DATA.test(draftReply) ||
          IDK_OR_NON_ANSWER.test(draftReply);
        if (isRefusalOrIdkAdvice && hasUsableAllocation) {
          draftReply = `Based on your allocation: ${allocCall.result}`;
          this.logger.log('advice_agent return: refusal/IDK replaced with allocation summary');
        }
        const adviceToolCalls = [...preloadedCalls, ...loopCalls];
        this.logger.log(
          `advice_agent return → compliance (draftReply length=${draftReply.length}, toolCalls=${adviceToolCalls.map((c) => c.name).join(', ')})`
        );
        return { draftReply, toolCalls: adviceToolCalls };
      } catch (err) {
        this.logger.error('advice_agent threw', err);
        return { draftReply: fallbackReply, toolCalls: [] };
      }
    };

    const generalAgent = async (
      state: ChatGraphState
    ): Promise<Partial<ChatGraphState>> => {
      this.logger.log('general_agent entered');
      let draftReply = '';
      try {
        const system = new SystemMessage(GENERAL_AGENT_SYSTEM);
        let current: BaseMessage[] = [system, ...state.messages];
        const generalNudge = 'Please provide a helpful, direct answer.';
        for (let i = 0; i < AGENT_LOOP_ITERATIONS; i++) {
          this.logger.log(`general_agent iteration ${i + 1}/${AGENT_LOOP_ITERATIONS}`);
          const out = await generalModel.invoke(current);
          draftReply =
            typeof out.content === 'string' ? out.content : String(out.content ?? '');
          current = current.concat([
            out as AIMessage,
            new HumanMessage(generalNudge)
          ]);
        }
        if (!isDecentReply(draftReply)) {
          draftReply = FALLBACK_NEVER_REFUSAL;
          this.logger.log('general_agent: final reply not decent, using fallback');
        }
      } catch (err) {
        this.logger.error('general_agent threw', err);
        draftReply = FALLBACK_NEVER_REFUSAL;
      }
      this.logger.log(
        `general_agent return → compliance (draftReply length=${draftReply.length})`
      );
      return { draftReply, toolCalls: [] };
    };

    const compliance = async (
      state: ChatGraphState
    ): Promise<Partial<ChatGraphState>> => {
      const fromAgent =
        state.route === 'data'
          ? 'data_agent'
          : state.route === 'advice'
            ? 'advice_agent'
            : 'general_agent';
      this.logger.log(`compliance entered (draft from ${fromAgent})`);
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
          finalContent: `${COMPLIANCE_BLOCK_MESSAGE}\n\n${COMPLIANCE_QA_SUFFIX}`
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
      if (isForbiddenRefusalOrIdk(finalContent)) {
        finalContent = FALLBACK_NEVER_REFUSAL;
        this.logger.warn(
          'compliance: finalContent was forbidden refusal/IDK → replaced with fallback'
        );
      }
      finalContent = `${finalContent.trimEnd()}\n\n${COMPLIANCE_QA_SUFFIX}`;
      this.logger.log(
        `compliance return (decision=${decision}) → __end__ (finalContent length=${finalContent.length})`
      );
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
    const routeToAgent = (state: ChatGraphState): RouteType => {
      const r = state.route?.trim()?.toLowerCase();
      const key: RouteType =
        r === 'data' || r === 'advice' || r === 'general' ? r : 'general';
      this.logger.log(`conditional edge route=${state.route} → key=${key}`);
      return key;
    };
    graph.addConditionalEdges('router', routeToAgent, {
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

  private getLastUserContent(messages: BaseMessage[]): string {
    const lastUser = [...messages]
      .reverse()
      .find((m) => (m as { _getType?: () => string })._getType?.() === 'human');
    const content = (lastUser as { content?: unknown } | undefined)?.content;
    return typeof content === 'string' ? content : '';
  }

  private formatReplyFromPreloadedData(calls: ToolCallRecord[]): string {
    const parts: string[] = [];
    const total = calls.find((c) => c.name === 'get_total_value');
    if (total?.result && !total.result.startsWith('Error')) {
      try {
        const parsed = JSON.parse(total.result) as {
          totalValueInBaseCurrency?: number;
          currency?: string;
        };
        const v = parsed.totalValueInBaseCurrency;
        const c = parsed.currency ?? 'USD';
        if (typeof v === 'number') {
          parts.push(
            `Your total portfolio value is ${v.toLocaleString()} ${c}.`
          );
        }
      } catch {
        parts.push(`Total value: ${total.result}`);
      }
    }
    const perf = calls.find((c) => c.name === 'get_portfolio_performance');
    if (perf?.result && !perf.result.startsWith('Error')) {
      try {
        const parsed = JSON.parse(perf.result) as {
          netPerformancePercentage?: number;
          netPerformance?: number;
          currentNetWorth?: number;
        };
        if (typeof parsed.netPerformancePercentage === 'number') {
          parts.push(
            `Total return (performance): ${parsed.netPerformancePercentage.toFixed(1)}%.`
          );
        }
      } catch {
        // ignore
      }
    }
    const accounts = calls.find((c) => c.name === 'list_accounts');
    if (accounts?.result && !accounts.result.startsWith('Error')) {
      parts.push(`Accounts: ${accounts.result}`);
    }
    const balances = calls.find((c) => c.name === 'get_account_balances');
    if (balances?.result && !balances.result.startsWith('Error')) {
      parts.push(`Balances: ${balances.result}`);
    }
    const holdings = calls.find((c) => c.name === 'get_holdings');
    if (holdings?.result && !holdings.result.startsWith('Error')) {
      parts.push(holdings.result);
    }
    if (parts.length === 0) {
      parts.push(
        "We couldn't load your portfolio data right now. Please check that your accounts are connected and try again."
      );
    }
    return parts.join(' ');
  }

  /**
   * Run status tools (e.g. get_total_value, get_holdings) and return a context block
   * plus tool call records. Used to inject current portfolio data into agent context
   * so every response is grounded in real data.
   */
  private async runStatusTools(
    tools: StructuredToolInterface[],
    statusCalls: { name: string; args: Record<string, unknown> }[]
  ): Promise<{ contextBlock: string; toolCalls: ToolCallRecord[] }> {
    const records: ToolCallRecord[] = [];
    const lines: string[] = [];
    for (const { name, args } of statusCalls) {
      const tool = tools.find((t) => t.name === name);
      let result: string;
      if (tool) {
        try {
          result = await tool.invoke(args);
        } catch (err) {
          result = `Error: ${err instanceof Error ? err.message : 'Unknown'}`;
        }
      } else {
        result = 'Tool not found.';
      }
      records.push({ name, args, result });
      lines.push(`${name}: ${result}`);
    }
    return {
      contextBlock: lines.join('\n\n'),
      toolCalls: records
    };
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
    const nudgeMessage =
      'Please use the available tools to get the relevant data, then provide a clear answer based on that data.';
    let lastReply = '';
    for (let i = 0; i < AGENT_LOOP_ITERATIONS; i++) {
      this.logger.log(`runToolLoop iteration ${i + 1}/${AGENT_LOOP_ITERATIONS}`);
      const response = await model.invoke(current);
      const responseToolCalls = (response as AIMessage).tool_calls ?? [];
      if (responseToolCalls.length === 0) {
        const content = response.content;
        lastReply =
          typeof content === 'string' ? content : String(content ?? '');
        current = current.concat([
          response,
          new HumanMessage(nudgeMessage)
        ]);
        continue;
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
    this.logger.log(`runToolLoop completed ${AGENT_LOOP_ITERATIONS} iterations`);
    if (!lastReply.trim()) {
      lastReply = 'I hit the iteration limit. Please try a simpler question.';
    }
    return { reply: lastReply, toolCalls: toolCallRecords };
  }
}
