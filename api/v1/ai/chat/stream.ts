/**
 * POST: streaming chat — SSE with chirp then content.
 * Used when the full Nest API is not deployed (e.g. Vercel frontend-only).
 * Body: { messages: { role: 'user'|'assistant', content: string }[] }
 * Response: text/event-stream — event "chirp" (which agent) then event "content" (and "error" on failure).
 * Requires Bearer token in Authorization. Set OPENAI_API_KEY or API_KEY_OPENAI in Vercel env.
 *
 * Pipeline: router call to get chirp (data/advice/general agent), then one OpenAI completion.
 * NOTE: This edge route has NO portfolio tools, NO data agent, and NO compliance gate. For "how much
 * money do I have" etc. the model has no account data, so it often refuses; we replace that with a
 * short fallback. To get real portfolio answers: in vercel.json add a rewrite so /api/* goes to your
 * Nest backend (e.g. "destination": "https://your-ghostfolio-api.up.railway.app/api/:path*").
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

/** Refusal phrases we never show (match Nest REFUSAL_WHEN_HAVING_DATA + IDK_OR_NON_ANSWER). */
const REFUSAL_OR_IDK =
  /unable to access (personal )?financial|unable to access.*(information or )?accounts|I'm unable to access|I am unable to access|cannot access (your )?(personal )?financial|can't (access|tell|see) (you )?(your )?financial|can't tell you how much|do not have access to (your )?(personal )?financial|don't have access to (your )?(personal )?(account|portfolio|financial)|(I'm sorry,?\s*)?(I don't have|I do not have) access to (personal )?financial(\s+information)?|check your bank (account|statements)|log into your (online )?banking|to find out how much money you have|check your (bank |investment )?account|managing your finances|If you need help with budgeting|I don't know|I do not know|I'm not sure|I am not sure|I don't have (that )?information|I (can't|cannot) (tell|provide|say|help with that)|I'm (unable|not able) to (tell|provide|say)|I (don't|do not) have (access to )?(that )?data|no (information|data) (available|to share)/i;

const EDGE_FALLBACK_NO_DATA =
  "Portfolio data isn't available on this deployment. Use Ghostfolio with the API backend for balance, allocation, and holdings—or ask a general question here.";

function getBearerToken(req: Request): string | null {
  const auth = req.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ') || auth.length < 10) return null;
  return auth.slice(7).trim();
}

export async function POST(req: Request) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ message: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (!getBearerToken(req)) {
    return new Response(JSON.stringify({ message: 'Unauthorized' }), {
      status: 401,
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
            console.log('[OpenAI] router response', JSON.stringify(routerData));
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
          } else {
            const errText = await routerRes.text();
            console.log('[OpenAI] router error response', routerRes.status, errText.slice(0, 500));
          }
        } catch (routerErr) {
          clearTimeout(routerTimeoutId);
          console.log('[OpenAI] router error', routerErr);
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
          console.log('[OpenAI] completion error', res.status, err.slice(0, 500));
          sendSSE(controller, 'error', {
            error: `OpenAI API error: ${res.status}. ${err.slice(0, 200)}`
          });
          controller.close();
          return;
        }

        const data = (await res.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        console.log('[OpenAI] completion response', JSON.stringify(data));
        let content =
          data.choices?.[0]?.message?.content?.trim() ?? '';
        if (REFUSAL_OR_IDK.test(content)) {
          content = EDGE_FALLBACK_NO_DATA;
        } else if (
          (route === 'data' || route === 'advice') &&
          content.length > 0
        ) {
          content = `${content}\n\n_For portfolio data and compliance review, use Ghostfolio with the API backend._`;
        }

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
