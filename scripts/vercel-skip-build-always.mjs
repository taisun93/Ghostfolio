#!/usr/bin/env node
/**
 * Use this as Vercel "Ignored Build Step" to STOP all builds and avoid charges.
 *
 * In Vercel: Project → Settings → Git → Ignored Build Step:
 *   node scripts/vercel-skip-build-always.mjs
 *
 * This script always exits 0, so Vercel will never run a build.
 * To deploy again: remove the Ignored Build Step or switch it to
 *   node scripts/vercel-ignore-build.mjs
 * and set env DEPLOY_VERCEL=1 when you want a one-off deploy.
 */
process.exit(0);
