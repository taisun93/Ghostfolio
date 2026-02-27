#!/usr/bin/env node
/**
 * Use as Vercel "Ignored Build Step" to avoid deploying on every push.
 * In Vercel: Project → Settings → Git → Ignored Build Step:
 *   node scripts/vercel-ignore-build.mjs
 *
 * Build runs only when DEPLOY_VERCEL=1 (set in Vercel env vars for a one-off
 * or in the dashboard). Otherwise every push is ignored (no build).
 */
const shouldBuild = process.env.DEPLOY_VERCEL === '1';
process.exit(shouldBuild ? 1 : 0);
