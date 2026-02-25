/**
 * POST: chat completion (OpenAI). Used when the full Nest API is not deployed (e.g. Vercel frontend-only).
 * Body: { messages: { role: 'user'|'assistant', content: string }[] }
 * Returns: { content: string }
 * Requires Bearer token in Authorization (passed through; optional validation).
 * Set OPENAI_API_KEY or API_KEY_OPENAI in Vercel env.
 */
export const config = { runtime: 'edge' };

const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions';
const MODEL = 'gpt-4o-mini';

interface Message {
  role: string;
  content: string;
}

function isMessage(m: unknown): m is Message {
  return (
    m != null &&
    typeof m === 'object' &&
    typeof (m as Message).role === 'string' &&
    typeof (m as Message).content === 'string'
  );
}

export async function POST(req: Request) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ message: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  // Prefer OPENAI_API_KEY (Vercel convention); fallback to API_KEY_OPENAI (Ghostfolio property name)
  const apiKey = (
    process.env.OPENAI_API_KEY ??
    process.env.API_KEY_OPENAI
  )?.trim();
  if (!apiKey) {
    return new Response(
      JSON.stringify({
        message:
          'AI chat is not configured. Set OPENAI_API_KEY or API_KEY_OPENAI in the project environment.'
      }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }

  let body: { messages?: unknown };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ message: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const raw = Array.isArray(body.messages) ? body.messages : [];
  const messages = raw.filter(isMessage).map((m) => ({
    role: m.role === 'assistant' ? 'assistant' as const : 'user' as const,
    content: m.content
  }));

  if (messages.length === 0) {
    return new Response(
      JSON.stringify({ content: 'Please send a message.' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  }

  try {
    const res = await fetch(OPENAI_CHAT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: MODEL,
        messages,
        max_tokens: 1024,
        temperature: 0.2
      })
    });

    if (!res.ok) {
      const err = await res.text();
      return new Response(
        JSON.stringify({
          message: `OpenAI API error: ${res.status}. ${err.slice(0, 200)}`
        }),
        { status: 502, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content =
      data.choices?.[0]?.message?.content?.trim() ??
      '';

    return new Response(JSON.stringify({ content }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Request failed';
    return new Response(
      JSON.stringify({ message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
}
