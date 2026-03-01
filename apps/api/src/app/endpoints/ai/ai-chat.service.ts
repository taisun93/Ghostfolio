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

/** Stream chunk: chirp first (after router), then content (after compliance). */
export type ChatStreamChunk = { chirp?: string; content?: string };

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
  }): Promise<{ chirp?: string; content: string }> {
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
      const { chirp, content } = await this.aiChatGraphService.run({
        filters,
        impersonationId,
        messages: langchainMessages,
        openAiKey,
        userCurrency,
        userId
      });
      return chirp != null && chirp !== '' ? { chirp, content } : { content };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'OpenAI request failed';
      throw new Error(
        `AI chat (OpenAI) failed: ${message}. Check API_KEY_OPENAI in Ghostfolio settings and network access to api.openai.com.`
      );
    }
  }

  /**
   * Stream chat: yields { chirp } after router, then { content } after compliance.
   * Throws if no API key or empty messages; errors during stream are thrown from the async generator.
   */
  public async *chatStream({
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
  }): AsyncGenerator<ChatStreamChunk> {
    const openAiKey = await this.propertyService.getByKey<string>(
      PROPERTY_API_KEY_OPENAI
    );
    if (!openAiKey?.trim()) {
      yield {
        content:
          'AI chat is not configured. An administrator must set the OpenAI API key (API_KEY_OPENAI) in the Ghostfolio settings.'
      };
      return;
    }
    const langchainMessages = this.toLangChainMessages(messages);
    if (langchainMessages.length === 0) {
      yield { content: 'Please send a message.' };
      return;
    }
    try {
      for await (const chunk of this.aiChatGraphService.runStream({
        filters,
        impersonationId,
        messages: langchainMessages,
        openAiKey,
        userCurrency,
        userId
      })) {
        yield chunk;
      }
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
