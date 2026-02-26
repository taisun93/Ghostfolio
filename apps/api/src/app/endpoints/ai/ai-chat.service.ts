import { AiChatGraphService } from '@ghostfolio/api/app/endpoints/ai/langgraph/ai-chat-graph.service';
import { PropertyService } from '@ghostfolio/api/services/property/property.service';
import { PROPERTY_API_KEY_OPENAI } from '@ghostfolio/common/config';
import { Filter } from '@ghostfolio/common/interfaces';

import { Injectable } from '@nestjs/common';
import type { BaseMessage } from '@langchain/core/messages';
import { AIMessage, HumanMessage } from '@langchain/core/messages';

export interface ChatMessageInput {
  role: 'user' | 'assistant';
  content: string;
}

@Injectable()
export class AiChatService {
  public constructor(
    private readonly aiChatGraphService: AiChatGraphService,
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

    const langchainMessages = this.toLangChainMessages(messages);
    if (langchainMessages.length === 0) {
      return { content: 'Please send a message.' };
    }

    try {
      const finalContent = await this.aiChatGraphService.run({
        filters,
        impersonationId,
        messages: langchainMessages,
        openAiKey,
        userCurrency,
        userId
      });
      return { content: finalContent };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'OpenAI request failed';
      throw new Error(
        `AI chat (OpenAI) failed: ${message}. Check API_KEY_OPENAI in Ghostfolio settings and network access to api.openai.com.`
      );
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
