#!/usr/bin/env node
/**
 * Use as Vercel "Ignored Build Step" to avoid deploying on every push.
 *
 * TO STOP CHARGES: In Vercel Dashboard → Project → Settings → Git →
 * "Ignored Build Step" set to:  node scripts/vercel-ignore-build.mjs
 * Then ensure DEPLOY_VERCEL is NOT set to "1" (or leave it unset).
 * To never build at all, use:   node scripts/vercel-skip-build-always.mjs
 *
 * With this script: build runs only when DEPLOY_VERCEL=1 (set in Vercel
 * env for a one-off deploy). Otherwise every push is ignored (no build).
 */
const shouldBuild = process.env.DEPLOY_VERCEL === '1';
process.exit(shouldBuild ? 1 : 0);
