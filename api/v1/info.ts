/**
 * Stub for /api/v1/info so the client can bootstrap on Vercel without a real backend.
 * When you have a real Ghostfolio API, remove this file and add a rewrite in vercel.json.
 */
export const config = { runtime: 'edge' };

export function GET() {
  const body = {
    baseCurrency: 'USD',
    benchmarks: [],
    currencies: ['USD'],
    globalPermissions: ['enableAuthGoogle', 'createUserAccount']
  };
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    status: 200
  });
}
