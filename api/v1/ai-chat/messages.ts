/**
 * GET: return messages from the user's latest conversation (one-to-many: user -> conversations).
 * POST: append one message to the latest conversation (or create one); entire conversation stored as JSON. Processing on server.
 * Requires Bearer token. Uses in-memory store for fast response; Postgres is updated in the background (POSTGRES_URL or DATABASE_URL).
 */
import { neon } from '@neondatabase/serverless';

import { appendMessage, getMessages, setMessages, type MessageRow } from './store';

export const config = { runtime: 'edge' };

function getUserId(req: Request): string | null {
  const auth = req.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ') || auth.length < 10) return null;
  return auth.slice(7).trim();
}

async function ensureTable(sql: ReturnType<typeof neon>) {
  await sql`
    CREATE TABLE IF NOT EXISTS ai_chat_conversations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id text NOT NULL,
      messages jsonb NOT NULL DEFAULT '[]',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_ai_chat_conversations_user_updated
    ON ai_chat_conversations (user_id, updated_at DESC)
  `;
}

function parseMessages(messages: unknown): MessageRow[] {
  if (!Array.isArray(messages)) return [];
  return messages.filter(
    (m): m is MessageRow =>
      m != null &&
      typeof m === 'object' &&
      typeof (m as MessageRow).id === 'string' &&
      typeof (m as MessageRow).role === 'string' &&
      typeof (m as MessageRow).text === 'string' &&
      typeof (m as MessageRow).at === 'string'
  );
}

/** Persist messages to Postgres in the background. Uses getMessagesSnapshot() when the job runs so we write the latest state (avoids race when multiple POSTs run). */
function persistToPostgresInBackground(
  connectionString: string,
  userId: string,
  getMessagesSnapshot: () => MessageRow[]
): void {
  void (async () => {
    try {
      const messages = getMessagesSnapshot();
      const now = new Date().toISOString();
      const sql = neon(connectionString);
      await ensureTable(sql);
      const rows = await sql`
        SELECT id
        FROM ai_chat_conversations
        WHERE user_id = ${userId}
        ORDER BY updated_at DESC
        LIMIT 1
      `;
      const row = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
      const rowId = row && typeof row === 'object' && 'id' in row ? String((row as { id: unknown }).id) : null;
      if (rowId) {
        await sql`
          UPDATE ai_chat_conversations
          SET messages = ${JSON.stringify(messages)}::jsonb, updated_at = ${now}::timestamptz
          WHERE id = ${rowId}
        `;
      } else {
        await sql`
          INSERT INTO ai_chat_conversations (user_id, messages, updated_at)
          VALUES (${userId}, ${JSON.stringify(messages)}::jsonb, ${now}::timestamptz)
        `;
      }
    } catch (err) {
      console.error('AI chat Postgres persist failed', err);
    }
  })();
}

export async function GET(req: Request) {
  const userId = getUserId(req);
  if (!userId) {
    return new Response(JSON.stringify({ message: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Serve from memory immediately when available (no Postgres wait).
  const cached = getMessages(userId);
  if (cached !== undefined) {
    return new Response(JSON.stringify(cached), {
      headers: { 'Content-Type': 'application/json' },
      status: 200
    });
  }

  const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    setMessages(userId, []);
    return new Response(JSON.stringify([]), {
      headers: { 'Content-Type': 'application/json' },
      status: 200
    });
  }

  try {
    const sql = neon(connectionString);
    // Skip ensureTable on read path: one SELECT only (table is created on first write).
    const rows = await sql`
      SELECT messages
      FROM ai_chat_conversations
      WHERE user_id = ${userId}
      ORDER BY updated_at DESC
      LIMIT 1
    `;
    const row = Array.isArray(rows) ? rows[0] : rows;
    const messages = row ? parseMessages((row as { messages: unknown }).messages) : [];
    setMessages(userId, messages);
    return new Response(JSON.stringify(messages), {
      headers: { 'Content-Type': 'application/json' },
      status: 200
    });
  } catch (err) {
    // Table may not exist yet; return empty. ensureTable runs on first POST.
    console.error('AI chat GET', err);
    setMessages(userId, []);
    return new Response(JSON.stringify([]), {
      headers: { 'Content-Type': 'application/json' },
      status: 200
    });
  }
}

export async function POST(req: Request) {
  const userId = getUserId(req);
  if (!userId) {
    return new Response(JSON.stringify({ message: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  let body: { role?: string; content?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ message: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  const role = body.role === 'user' || body.role === 'assistant' ? body.role : null;
  const content = typeof body.content === 'string' ? body.content.trim() : '';
  if (!role || !content) {
    return new Response(JSON.stringify({ message: 'Missing or invalid role/content' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const now = new Date().toISOString();
  const newMessage: MessageRow = {
    id: crypto.randomUUID(),
    role,
    text: content,
    at: now
  };

  // Use existing in-memory conversation or start fresh (no DB read here; GET hydrates cache).
  if (getMessages(userId) === undefined) {
    setMessages(userId, []);
  }
  appendMessage(userId, newMessage);
  const updated = getMessages(userId)!;

  // Persist to Postgres in the background; pass getter so we write latest state when the job runs.
  const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
  if (connectionString) {
    persistToPostgresInBackground(connectionString, userId, () => getMessages(userId) ?? []);
  }

  return new Response(
    JSON.stringify({
      id: newMessage.id,
      role: newMessage.role,
      text: newMessage.text,
      at: newMessage.at
    }),
    { status: 201, headers: { 'Content-Type': 'application/json' } }
  );
}
