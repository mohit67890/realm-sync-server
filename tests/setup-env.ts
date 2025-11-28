import fs from "fs";
import path from "path";
import dotenv from "dotenv";

// Determine candidate env files in priority order.
const candidates = [
  process.env.ENV_FILE, // explicit override
  ".env.test", // per-test env
  ".env.local", // local developer overrides
  ".env", // base environment
].filter(Boolean) as string[];

for (const file of candidates) {
  const full = path.resolve(__dirname, "..", file);
  if (fs.existsSync(full)) {
    dotenv.config({ path: full });
    // Lightweight notice so we know which env loaded if debugging.
    // eslint-disable-next-line no-console
    console.log(`[env] Loaded environment file: ${file}`);
    break;
  }
}

// If none existed, still attempt default .env load (dotenv will silently ignore).
if (!process.env.MONGODB_URI) {
  dotenv.config();
}
