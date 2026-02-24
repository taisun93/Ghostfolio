/**
 * Stub for /api/v1/auth/google. Redirects to the client auth callback with a
 * fake JWT so "Log in with Google" works without a real backend.
 * Remove when using a real Ghostfolio API.
 */
export const config = { runtime: 'edge' };

const DEMO_TOKEN = 'demo-token';

export function GET(req: Request) {
  const url = new URL(req.url);
  const origin = url.origin;
  const locale = 'en';
  const redirectUrl = `${origin}/${locale}/auth/${DEMO_TOKEN}`;
  return Response.redirect(redirectUrl, 302);
}
