/**
 * GET: return messages from the user's latest conversation (one-to-many: user -> conversations).
 * POST: append one message to the latest conversation (or create one); entire conversation stored as JSON. Processing on server.
 * Requires Bearer token. Uses POSTGRES_URL or DATABASE_URL (Neon/Vercel Postgres).
 */
import { neon } from '@neondatabase/serverless';

export const config = { runtime: 'edge' };

type MessageRow = { id: string; role: string; text: string; at: string };

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

export async function GET(req: Request) {
  const userId = getUserId(req);
  if (!userId) {
    return new Response(JSON.stringify({ message: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    return new Response(
      JSON.stringify({ message: 'Postgres not configured (set POSTGRES_URL or DATABASE_URL)' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    const sql = neon(connectionString);
    await ensureTable(sql);
    const rows = await sql`
      SELECT messages
      FROM ai_chat_conversations
      WHERE user_id = ${userId}
      ORDER BY updated_at DESC
      LIMIT 1
    `;
    const row = Array.isArray(rows) ? rows[0] : rows;
    const messages = row ? parseMessages((row as { messages: unknown }).messages) : [];
    return new Response(JSON.stringify(messages), {
      headers: { 'Content-Type': 'application/json' },
      status: 200
    });
  } catch (err) {
    console.error('AI chat GET', err);
    return new Response(
      JSON.stringify({ message: err instanceof Error ? err.message : 'Database error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
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

  const connectionString = process.env.POSTGRES_URL || process.env.DATABASE_URL;
  if (!connectionString) {
    return new Response(
      JSON.stringify({ message: 'Postgres not configured' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    const sql = neon(connectionString);
    await ensureTable(sql);
    const now = new Date().toISOString();
    const newMessage: MessageRow = {
      id: crypto.randomUUID(),
      role,
      text: content,
      at: now
    };

    const existing = await sql`
      SELECT id, messages
      FROM ai_chat_conversations
      WHERE user_id = ${userId}
      ORDER BY updated_at DESC
      LIMIT 1
    `;
    const row = Array.isArray(existing) ? existing[0] : existing;

    if (row) {
      const current = parseMessages((row as { messages: unknown }).messages);
      const updated = [...current, newMessage];
      await sql`
        UPDATE ai_chat_conversations
        SET messages = ${JSON.stringify(updated)}::jsonb, updated_at = ${now}::timestamptz
        WHERE id = ${(row as { id: string }).id}
      `;
    } else {
      await sql`
        INSERT INTO ai_chat_conversations (user_id, messages, updated_at)
        VALUES (${userId}, ${JSON.stringify([newMessage])}::jsonb, ${now}::timestamptz)
      `;
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
  } catch (err) {
    console.error('AI chat POST', err);
    return new Response(
      JSON.stringify({ message: err instanceof Error ? err.message : 'Database error' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
