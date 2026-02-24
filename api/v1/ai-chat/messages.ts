/**
 * GET: return AI chat message history for the authenticated user.
 * POST: append one message (body: { role: 'user'|'assistant', content: string }).
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
    CREATE TABLE IF NOT EXISTS ai_chat_messages (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id text NOT NULL,
      role text NOT NULL,
      content text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS idx_ai_chat_messages_user_created
    ON ai_chat_messages (user_id, created_at)
  `;
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
      SELECT id, role, content, created_at
      FROM ai_chat_messages
      WHERE user_id = ${userId}
      ORDER BY created_at ASC
    `;
    const messages = rows.map((r: { id: string; role: string; content: string; created_at: string }) => ({
      id: r.id,
      role: r.role,
      text: r.content,
      at: r.created_at
    }));
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
    const inserted = await sql`
      INSERT INTO ai_chat_messages (user_id, role, content)
      VALUES (${userId}, ${role}, ${content})
      RETURNING id, role, content, created_at
    `;
    const row = Array.isArray(inserted) ? inserted[0] : inserted;
    return new Response(
      JSON.stringify({
        id: (row as { id: string }).id,
        role: (row as { role: string }).role,
        text: (row as { content: string }).content,
        at: (row as { created_at: string }).created_at
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