import type { GfEnvironment } from '@ghostfolio/ui/environment';

/** Set apiBaseUrl at build time (e.g. to your Nest backend URL) so AI and API calls go there instead of same origin. */
export const environment: GfEnvironment = {
  apiBaseUrl: undefined,
  lastPublish: '{BUILD_TIMESTAMP}',
  production: true
};
