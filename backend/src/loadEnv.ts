import { existsSync } from 'node:fs';
import { config } from 'dotenv';

// Prefer .env; fall back to the git-ignored .env.local. Real environment variables always win.
const envFile = ['.env', '.env.local'].find((file) => existsSync(file));
if (envFile) config({ path: envFile });
