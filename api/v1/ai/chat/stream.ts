/**
 * POST: streaming chat — SSE with chirp then content.
 * Body: { messages: { role: 'user'|'assistant', content: string }[] }
 * Response: text/event-stream — event "chirp" then event "content" (and "error" on failure).
 *
 * This route is not allowed to be inconclusive. It must use tools and the full pipeline.
 * - If GHOSTFOLIO_API_URL is set: proxy the request to the Nest backend (which has tools and
 *   runs the agent loop until a good answer). Stream the backend response. No fallbacks.
 * - If GHOSTFOLIO_API_URL is not set: return 503. We do not run a tool-less OpenAI path here;
 *   that would be inconclusive for portfolio questions.
 *
 * Response header X-Ghostfolio-AI-Source: nest when proxied, or 503 when backend not configured.
 */
export const config = { runtime: 'edge' };

const STREAM_PATH = '/api/ai/chat/stream';

function getBearerToken(req: Request): string | null {
  const auth = req.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ') || auth.length < 10) return null;
  return auth.slice(7).trim();
}

function getBackendStreamUrl(): string | null {
  const base = (
    process.env.GHOSTFOLIO_API_URL ??
    process.env.API_URL
  )?.trim();
  if (!base) return null;
  const url = base.replace(/\/$/, '');
  return `${url}${STREAM_PATH}`;
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

  const streamUrl = getBackendStreamUrl();
  if (!streamUrl) {
    return new Response(
      JSON.stringify({
        message:
          'AI chat requires the API backend (with tools). Set GHOSTFOLIO_API_URL or API_URL to your Ghostfolio API origin.'
      }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ message: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  const token = getBearerToken(req);
  const backendRes = await fetch(streamUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(body)
  });

  if (!backendRes.ok) {
    const text = await backendRes.text();
    return new Response(
      JSON.stringify({
        message: backendRes.status === 401 ? 'Unauthorized' : backendRes.status === 502 || backendRes.status === 503 ? 'API backend unavailable' : `Backend error: ${backendRes.status}`,
        details: text.slice(0, 500)
      }),
      {
        status: backendRes.status === 401 ? 401 : 502,
        headers: { 'Content-Type': 'application/json' }
      }
    );
  }

  return new Response(backendRes.body, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Ghostfolio-AI-Source': 'nest'
    }
  });
}
