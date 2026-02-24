import { PortfolioService } from '@ghostfolio/api/app/portfolio/portfolio.service';
import { PropertyService } from '@ghostfolio/api/services/property/property.service';
import { PROPERTY_API_KEY_OPENAI } from '@ghostfolio/common/config';
import { Filter } from '@ghostfolio/common/interfaces';

import { Injectable } from '@nestjs/common';
import type { BaseMessage } from '@langchain/core/messages';
import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import {
  Annotation,
  END,
  messagesStateReducer,
  StateGraph,
  START
} from '@langchain/langgraph';
import { ChatOpenAI } from '@langchain/openai';

const ROUTER_SYSTEM = `You are a router. Given the user message and whether portfolio data is available, reply with exactly one word: "portfolio" if the user is asking about their holdings, allocation, investments, or portfolio; otherwise reply "general".`;

const PORTFOLIO_SYSTEM_PREFIX = `You are a helpful, neutral financial portfolio assistant. Answer only based on the portfolio data provided. Be concise and clear. Base currency is provided.`;

const GENERAL_SYSTEM = `You are a helpful assistant for Ghostfolio, a personal finance and portfolio tracking app. Answer general questions briefly. If the user asks about portfolio-specific data, suggest they ask about "my portfolio" in this chat.`;

export interface ChatMessageInput {
  role: 'user' | 'assistant';
  content: string;
}

@Injectable()
export class AiChatService {
  public constructor(
    private readonly portfolioService: PortfolioService,
    private readonly propertyService: PropertyService
  ) {}

  public async chat({
    filters,
    impersonationId,
    messages,
    userCurrency,
    userId
  }: {
    filters?: Filter[];
    impersonationId?: string;
    messages: ChatMessageInput[];
    userCurrency: string;
    userId: string;
  }): Promise<{ content: string }> {
    const openAiKey = await this.propertyService.getByKey<string>(
      PROPERTY_API_KEY_OPENAI
    );
    if (!openAiKey?.trim()) {
      return {
        content:
          'AI chat is not configured. An administrator must set the OpenAI API key (API_KEY_OPENAI) in the Ghostfolio settings.'
      };
    }

    const portfolioContext = await this.getPortfolioContext({
      filters,
      impersonationId,
      userCurrency,
      userId
    });

    const langchainMessages = this.toLangChainMessages(messages);
    if (langchainMessages.length === 0) {
      return { content: 'Please send a message.' };
    }

    const graph = this.buildGraph(openAiKey);
    const input = {
      messages: langchainMessages,
      portfolioContext: portfolioContext ?? undefined
    };
    const result = await graph.invoke(
      input as Parameters<typeof graph.invoke>[0]
    );

    const lastMessage = result.messages[result.messages.length - 1];
    const content =
      lastMessage && typeof lastMessage.content === 'string'
        ? lastMessage.content
        : '';

    return { content };
  }

  private async getPortfolioContext({
    filters,
    impersonationId,
    userCurrency,
    userId
  }: {
    filters?: Filter[];
    impersonationId?: string;
    userCurrency: string;
    userId: string;
  }): Promise<string | null> {
    try {
      const { holdings } = await this.portfolioService.getDetails({
        filters,
        impersonationId,
        userId
      });
      const rows = Object.values(holdings)
        .sort((a, b) => b.allocationInPercentage - a.allocationInPercentage)
        .map(
          (h) =>
            `${h.name} (${h.symbol}) ${h.currency} ${((h.allocationInPercentage ?? 0) * 100).toFixed(2)}% ${h.assetClass ?? ''} ${h.assetSubClass ?? ''}`
        );
      if (rows.length === 0) return null;
      return `Portfolio (base currency ${userCurrency}):\n${rows.join('\n')}`;
    } catch {
      return null;
    }
  }

  private toLangChainMessages(messages: ChatMessageInput[]): BaseMessage[] {
    return messages.map((m) =>
      m.role === 'user'
        ? new HumanMessage(m.content)
        : new AIMessage(m.content)
    );
  }

  private buildGraph(apiKey: string) {
    const model = new ChatOpenAI({
      apiKey,
      model: 'gpt-4o-mini',
      temperature: 0.2
    });

    const StateWithRoute = Annotation.Root({
      messages: Annotation<BaseMessage[]>({
        reducer: messagesStateReducer,
        default: () => []
      }),
      portfolioContext: Annotation<string | undefined>({
        value: (
          left: string | undefined,
          right: string | undefined
        ): string | undefined =>
          right !== undefined ? right : left,
        default: () => undefined
      }),
      route: Annotation<string>({
        value: (left: string, right: string): string =>
          right !== undefined && right !== '' ? right : left,
        default: () => 'general'
      })
    });

    const graphWithRoute = new StateGraph(StateWithRoute);

    const routerNodeWithRoute = async (
      state: typeof StateWithRoute.State
    ): Promise<Partial<typeof StateWithRoute.State>> => {
      const lastMsg = state.messages[state.messages.length - 1];
      const content =
        lastMsg && typeof lastMsg.content === 'string'
          ? lastMsg.content
          : '';
      const hasPortfolio = !!state.portfolioContext?.trim();
      const routerPrompt = hasPortfolio
        ? `User message: "${content.slice(0, 500)}"\nPortfolio available: yes.\nReply with exactly: portfolio or general`
        : `User message: "${content.slice(0, 500)}"\nPortfolio available: no.\nReply with exactly: portfolio or general`;
      const response = await model.invoke([
        new SystemMessage(ROUTER_SYSTEM),
        new HumanMessage(routerPrompt)
      ]);
      const decision =
        typeof response.content === 'string'
          ? response.content.trim().toLowerCase()
          : '';
      const route = decision.startsWith('portfolio') ? 'portfolio' : 'general';
      return { route };
    };

    const portfolioAgentNode = async (
      state: typeof StateWithRoute.State
    ): Promise<Partial<typeof StateWithRoute.State>> => {
      const systemContent = state.portfolioContext
        ? `${PORTFOLIO_SYSTEM_PREFIX}\n\n${state.portfolioContext}`
        : PORTFOLIO_SYSTEM_PREFIX + '\n\nNo portfolio data available. Say so briefly.';
      const response = await model.invoke([
        new SystemMessage(systemContent),
        ...state.messages
      ]);
      return { messages: [response] };
    };

    const generalAgentNode = async (
      state: typeof StateWithRoute.State
    ): Promise<Partial<typeof StateWithRoute.State>> => {
      const response = await model.invoke([
        new SystemMessage(GENERAL_SYSTEM),
        ...state.messages
      ]);
      return { messages: [response] };
    };

    graphWithRoute.addNode('router', routerNodeWithRoute);
    graphWithRoute.addNode('portfolio_agent', portfolioAgentNode);
    graphWithRoute.addNode('general_agent', generalAgentNode);

    // LangGraph typings over-narrow node names; use cast so we can wire the graph as intended
    const g = graphWithRoute as {
      addEdge: (a: string, b: string) => void;
      addConditionalEdges: (
        source: string,
        route: (state: typeof StateWithRoute.State) => string,
        paths: Record<string, string>
      ) => void;
      compile: () => ReturnType<typeof graphWithRoute.compile>;
    };
    g.addEdge(START, 'router');
    g.addConditionalEdges('router', (state) => state.route, {
      portfolio: 'portfolio_agent',
      general: 'general_agent'
    });
    g.addEdge('portfolio_agent', END);
    g.addEdge('general_agent', END);

    return g.compile();
  }
}
