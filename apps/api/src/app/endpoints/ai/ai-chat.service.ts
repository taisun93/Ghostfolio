import { PortfolioService } from '@ghostfolio/api/app/portfolio/portfolio.service';
import { PropertyService } from '@ghostfolio/api/services/property/property.service';
import { PROPERTY_API_KEY_OPENAI } from '@ghostfolio/common/config';
import { Filter } from '@ghostfolio/common/interfaces';

import { Injectable } from '@nestjs/common';
import type { BaseMessage } from '@langchain/core/messages';
import { AIMessage, HumanMessage, SystemMessage } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';

/** Single-prompt system: no router, one LLM call per turn for lower latency. */
const COMBINED_SYSTEM_PREFIX = `You are a helpful assistant for Ghostfolio, a personal finance and portfolio tracking app.
- If portfolio data is provided below, use it only when the user asks about their holdings, allocation, or investments; be concise and neutral.
- For other questions, answer briefly. If they ask for portfolio-specific data but none is provided, say so and suggest they add holdings.`;

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

    const model = new ChatOpenAI({
      apiKey: openAiKey,
      model: 'gpt-4o-mini',
      temperature: 0.2
    });
    const systemContent = portfolioContext?.trim()
      ? `${COMBINED_SYSTEM_PREFIX}\n\nPortfolio (use only for allocation/holdings questions):\n${portfolioContext}`
      : `${COMBINED_SYSTEM_PREFIX}\n\nNo portfolio data available.`;
    const prompt: BaseMessage[] = [
      new SystemMessage(systemContent),
      ...langchainMessages
    ];

    let response: Awaited<ReturnType<ChatOpenAI['invoke']>>;
    try {
      response = await model.invoke(prompt);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'OpenAI request failed';
      throw new Error(
        `AI chat (OpenAI) failed: ${message}. Check API_KEY_OPENAI in Ghostfolio settings and network access to api.openai.com.`
      );
    }

    const content =
      typeof response.content === 'string' ? response.content : '';
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
}
