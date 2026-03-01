/**
 * POST: streaming chat — SSE with chirp then content.
 * Used when the full Nest API is not deployed (e.g. Vercel frontend-only).
 * Body: { messages: { role: 'user'|'assistant', content: string }[] }
 * Response: text/event-stream — event "chirp" then event "content" (and "error" on failure).
 * Requires Bearer token in Authorization. Set OPENAI_API_KEY or API_KEY_OPENAI in Vercel env.
 *
 * Simplified pipeline (no LangGraph/tools): sends a generic chirp, then one OpenAI completion.
 */
export const config = { runtime: 'edge' };

const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions';
const MODEL = 'gpt-4o-mini';
const REQUEST_TIMEOUT_MS = 55_000;
const MAX_MESSAGES = 20;

const DEFAULT_CHIRP = 'Let me look into that.';

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

function sendSSE(
  stream: ReadableStreamDefaultController<Uint8Array>,
  event: string,
  data: Record<string, unknown>
) {
  stream.enqueue(
    new TextEncoder().encode(
      `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
    )
  );
}

export async function POST(req: Request) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ message: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }

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
  const allMessages = raw.filter(isMessage).map((m) => ({
    role: m.role === 'assistant' ? ('assistant' as const) : ('user' as const),
    content: m.content
  }));
  const messages =
    allMessages.length > MAX_MESSAGES
      ? allMessages.slice(-MAX_MESSAGES)
      : allMessages;

  if (messages.length === 0) {
    const stream = new ReadableStream({
      start(controller) {
        sendSSE(controller, 'content', { content: 'Please send a message.' });
        controller.close();
      }
    });
    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive'
      }
    });
  }

  const stream = new ReadableStream({
    async start(controller) {
      try {
        sendSSE(controller, 'chirp', { chirp: DEFAULT_CHIRP });

        const controllerAbort = new AbortController();
        const timeoutId = setTimeout(
          () => controllerAbort.abort(),
          REQUEST_TIMEOUT_MS
        );

        const res = await fetch(OPENAI_CHAT_URL, {
          method: 'POST',
          signal: controllerAbort.signal,
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

        clearTimeout(timeoutId);

        if (!res.ok) {
          const err = await res.text();
          sendSSE(controller, 'error', {
            error: `OpenAI API error: ${res.status}. ${err.slice(0, 200)}`
          });
          controller.close();
          return;
        }

        const data = (await res.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        const content =
          data.choices?.[0]?.message?.content?.trim() ?? '';

        sendSSE(controller, 'content', { content });
        controller.close();
      } catch (err) {
        const isAbort = err instanceof Error && err.name === 'AbortError';
        const message = isAbort
          ? 'Request timed out. Please try again.'
          : err instanceof Error
            ? err.message
            : 'Request failed';
        sendSSE(controller, 'error', { error: message });
        controller.close();
      }
    }
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    }
  });
}
