/**
 * POST: start a new conversation (insert empty conversation for user).
 * Next GET /api/v1/ai-chat/messages returns []; next POST appends to this conversation.
 * Requires Bearer token. Uses POSTGRES_URL or DATABASE_URL (Neon/Vercel Postgres).
 */
import { neon } from '@neondatabase/serverless';

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

export async function POST(req: Request) {
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
      JSON.stringify({
        message: 'Postgres not configured (set POSTGRES_URL or DATABASE_URL)'
      }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    const sql = neon(connectionString);
    await ensureTable(sql);
    const now = new Date().toISOString();
    await sql`
      INSERT INTO ai_chat_conversations (user_id, messages, updated_at)
      VALUES (${userId}, '[]'::jsonb, ${now}::timestamptz)
    `;
    return new Response(JSON.stringify({ ok: true }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    console.error('AI chat new', err);
    return new Response(
      JSON.stringify({
        message: err instanceof Error ? err.message : 'Database error'
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
