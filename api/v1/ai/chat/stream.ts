/**
 * POST: streaming chat — SSE with chirp then content.
 * Used when the full Nest API is not deployed (e.g. Vercel frontend-only).
 * Body: { messages: { role: 'user'|'assistant', content: string }[] }
 * Response: text/event-stream — event "chirp" (which agent) then event "content" (and "error" on failure).
 * Requires Bearer token in Authorization. Set OPENAI_API_KEY or API_KEY_OPENAI in Vercel env.
 *
 * Pipeline: router call to get chirp (data/advice/general agent), then one OpenAI completion.
 */
export const config = { runtime: 'edge' };

const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions';
const MODEL = 'gpt-4o-mini';
const REQUEST_TIMEOUT_MS = 55_000;
const ROUTER_TIMEOUT_MS = 10_000;
const MAX_MESSAGES = 20;

const ROUTER_SYSTEM = `You classify the user's message and produce a short chirp. Reply with only a JSON object: {"route": "data" | "advice" | "general", "chirp": "one short sentence"}.
- route "data": factual questions about holdings, allocation, performance, market data, accounts, orders, balances, total value, or how much money (e.g. "What's my allocation?", "How much money do I have?", "List my accounts").
- route "advice": what should I do, rebalance, risk, diversification (e.g. "Should I rebalance?", "Is my portfolio too risky?").
- route "general": greetings, off-topic, non-finance (e.g. "Hi", "What's the weather?").
- chirp: exactly one short sentence telling the user which agent you are asking, e.g. "Let me ask the data agent about your question." or "Let me ask the advice agent about that." or "Let me ask the general assistant." Use "data agent", "advice agent", or "general assistant" to match the route. No other text.`;

type RouteType = 'data' | 'advice' | 'general';

function getDefaultChirpForRoute(route: RouteType): string {
  const agentLabel =
    route === 'general' ? 'general assistant' : `${route} agent`;
  return `Let me ask the ${agentLabel} about your question.`;
}

/** Keyword fallback when router LLM fails (match Nest getDataRouteFallback). */
function routeFromContent(content: string): RouteType {
  const lower = (content || '').toLowerCase().trim();
  if (!lower) return 'general';
  if (
    /\b(holdings?|allocation|performance|accounts?|orders?|balance|quote|price|symbol|worth|how much|total value|money have|money|got|value)\b/.test(
      lower
    ) &&
    !/\b(should|rebalance|risk|diversif|advice)\b/.test(lower)
  ) {
    return 'data';
  }
  if (/\b(should|rebalance|risk|diversif|advice|recommend)\b/.test(lower)) {
    return 'advice';
  }
  return 'general';
}

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

  const lastUserContent =
    [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';

  const stream = new ReadableStream({
    async start(controller) {
      try {
        let route: RouteType = 'general';
        let routerChirp = '';

        const routerAbort = new AbortController();
        const routerTimeoutId = setTimeout(
          () => routerAbort.abort(),
          ROUTER_TIMEOUT_MS
        );
        try {
          const routerRes = await fetch(OPENAI_CHAT_URL, {
            method: 'POST',
            signal: routerAbort.signal,
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiKey}`
            },
            body: JSON.stringify({
              model: MODEL,
              messages: [
                { role: 'system', content: ROUTER_SYSTEM },
                { role: 'user', content: lastUserContent || 'Hi' }
              ],
              max_tokens: 150,
              temperature: 0
            })
          });
          clearTimeout(routerTimeoutId);
          if (routerRes.ok) {
            const routerData = (await routerRes.json()) as {
              choices?: Array<{ message?: { content?: string } }>;
            };
            const text =
              routerData.choices?.[0]?.message?.content?.trim() ?? '';
            const routeMatch = text.match(
              /\{\s*"route"\s*:\s*"(data|advice|general)"/
            );
            if (routeMatch) {
              route = routeMatch[1] as RouteType;
            }
            const chirpMatch = text.match(
              /"chirp"\s*:\s*"((?:[^"\\]|\\.)*)"/
            );
            if (chirpMatch && chirpMatch[1].trim().length > 0) {
              routerChirp = chirpMatch[1].replace(/\\"/g, '"').trim();
            }
          }
        } catch {
          clearTimeout(routerTimeoutId);
          route = routeFromContent(lastUserContent);
        }
        if (!routerChirp?.trim()) {
          routerChirp = getDefaultChirpForRoute(route);
        }
        sendSSE(controller, 'chirp', { chirp: routerChirp });

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
