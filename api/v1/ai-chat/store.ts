/**
 * In-memory store for AI chat messages. Used so GET/POST can respond immediately;
 * Postgres is updated in the background to avoid blocking the chat UI.
 */
export type MessageRow = { id: string; role: string; text: string; at: string };

const inMemoryMessages = new Map<string, MessageRow[]>();

export function getMessages(userId: string): MessageRow[] | undefined {
  return inMemoryMessages.get(userId);
}

export function setMessages(userId: string, messages: MessageRow[]): void {
  inMemoryMessages.set(userId, [...messages]);
}

export function appendMessage(userId: string, message: MessageRow): void {
  const current = inMemoryMessages.get(userId) ?? [];
  inMemoryMessages.set(userId, [...current, message]);
}

export function clearMessages(userId: string): void {
  inMemoryMessages.set(userId, []);
}
