/**
 * Use UTC for all date formatting in tests so snapshot and date assertions
 * are stable across environments.
 */
process.env.TZ = 'UTC';

// Load repo root .env so OPENAI_API_KEY / API_KEY_OPENAI are available for AI chat golden tests
import * as path from 'path';
import { config } from 'dotenv';

const repoRoot = path.resolve(__dirname, '..', '..', '..');
config({ path: path.join(repoRoot, '.env') });
