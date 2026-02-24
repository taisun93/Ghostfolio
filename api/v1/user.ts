/**
 * Stub for /api/v1/user. Returns a fake user when any Bearer token is present
 * (e.g. after "Log in with Google" stub flow). Remove when using a real API.
 */
export const config = { runtime: 'edge' };

const FAKE_USER = {
  access: [],
  accounts: [],
  activitiesCount: 0,
  dateOfFirstActivity: new Date().toISOString(),
  id: 'demo-user-id',
  permissions: [],
  settings: {
    baseCurrency: 'USD',
    language: 'en',
    viewMode: 'DEFAULT'
  },
  subscription: {
    offer: { price: 0, priceId: '' },
    type: 'Basic'
  },
  tags: []
};

export function GET(req: Request) {
  const auth = req.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ') || auth.length < 10) {
    return new Response(JSON.stringify({ statusCode: 401, message: 'Unauthorized' }), {
      headers: { 'Content-Type': 'application/json' },
      status: 401
    });
  }
  return new Response(JSON.stringify(FAKE_USER), {
    headers: { 'Content-Type': 'application/json' },
    status: 200
  });
}
