import { PrismaService } from '@ghostfolio/api/services/prisma/prisma.service';
import { Prisma } from '@prisma/client';

import { Injectable } from '@nestjs/common';

export interface ChatMessageRow {
  id: string;
  role: string;
  text: string;
  at: string;
}

function parseMessages(messages: unknown): ChatMessageRow[] {
  if (!Array.isArray(messages)) return [];
  return messages.filter(
    (m): m is ChatMessageRow =>
      m != null &&
      typeof m === 'object' &&
      typeof (m as ChatMessageRow).id === 'string' &&
      typeof (m as ChatMessageRow).role === 'string' &&
      typeof (m as ChatMessageRow).text === 'string' &&
      typeof (m as ChatMessageRow).at === 'string'
  );
}

@Injectable()
export class AiChatConversationService {
  public constructor(private readonly prisma: PrismaService) {}

  public async getLatestMessages(userId: string): Promise<ChatMessageRow[]> {
    const row = await this.prisma.aiChatConversation.findFirst({
      where: { userId },
      orderBy: { updatedAt: 'desc' }
    });
    if (!row) return [];
    return parseMessages(row.messages);
  }

  public async appendMessage(
    userId: string,
    role: 'user' | 'assistant',
    content: string
  ): Promise<ChatMessageRow> {
    const now = new Date().toISOString();
    const newMessage: ChatMessageRow = {
      id: crypto.randomUUID(),
      role,
      text: content,
      at: now
    };

    const existing = await this.prisma.aiChatConversation.findFirst({
      where: { userId },
      orderBy: { updatedAt: 'desc' }
    });

    if (existing) {
      const current = parseMessages(existing.messages);
      const updated = [...current, newMessage];
      await this.prisma.aiChatConversation.update({
        where: { id: existing.id },
        data: {
          messages: updated as unknown as Prisma.InputJsonValue,
          updatedAt: new Date()
        }
      });
    } else {
      await this.prisma.aiChatConversation.create({
        data: {
          userId,
          messages: [newMessage] as unknown as Prisma.InputJsonValue,
          updatedAt: new Date()
        }
      });
    }

    return newMessage;
  }

  public async createNewConversation(userId: string): Promise<void> {
    await this.prisma.aiChatConversation.create({
      data: {
        userId,
        messages: [] as unknown as Prisma.InputJsonValue,
        updatedAt: new Date()
      }
    });
  }
}
