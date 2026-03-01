export interface GfEnvironment {
  /** When set, API requests (including AI chat stream) are sent here instead of same origin. Use for Vercel frontend + separate Nest backend. */
  apiBaseUrl?: string;
  lastPublish: string | null;
  production: boolean;
}
