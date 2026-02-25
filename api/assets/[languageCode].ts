/**
 * GET: serve site.webmanifest for a locale. Public, no auth.
 * Request: /api/assets/en (or /api/assets/en/site.webmanifest)
 * Set ROOT_URL in Vercel env for production.
 */
export const config = { runtime: 'edge' };

const MANIFEST_TEMPLATE = `{"background_color":"#FFFFFF","categories":["finance","utilities"],"description":"Open Source Wealth Management Software","display":"standalone","icons":[{"sizes":"192x192","src":"/assets/android-chrome-192x192.png","type":"image/png"},{"purpose":"any","sizes":"512x512","src":"/assets/android-chrome-512x512.png","type":"image/png"},{"purpose":"maskable","sizes":"512x512","src":"/assets/android-chrome-512x512.png","type":"image/png"}],"name":"Ghostfolio","orientation":"portrait","short_name":"Ghostfolio","start_url":"/LANG/","theme_color":"#FFFFFF","url":"ROOT"}`;

const SUPPORTED = new Set([
  'ca',
  'de',
  'en',
  'es',
  'fr',
  'it',
  'ko',
  'nl',
  'pl',
  'pt',
  'tr',
  'uk',
  'zh'
]);
const DEFAULT_LANG = 'en';

function getLanguageCodeFromPath(pathname: string): string {
  const match = pathname.match(/^\/api\/assets\/([a-z]{2})(?:\/|$)/i);
  const code = match ? match[1].toLowerCase() : '';
  return SUPPORTED.has(code) ? code : DEFAULT_LANG;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const languageCode = getLanguageCodeFromPath(url.pathname);
  const rootUrl =
    process.env.ROOT_URL ||
    `${url.protocol}//${url.host}`;

  const body = MANIFEST_TEMPLATE.replace(
    '/LANG/',
    `/${languageCode}/`
  ).replace('ROOT', rootUrl);

  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/manifest+json',
      'Cache-Control': 'public, max-age=86400'
    }
  });
}
