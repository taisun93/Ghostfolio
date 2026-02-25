/**
 * Use UTC for all date formatting in tests so snapshot and date assertions
 * are stable across environments.
 */
process.env.TZ = 'UTC';
