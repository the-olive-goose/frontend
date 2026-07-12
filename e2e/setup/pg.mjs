// Start/stop an ephemeral embedded Postgres for the e2e stack.
// Usage: `node e2e/setup/pg.mjs start` (stays up) / `node e2e/setup/pg.mjs stop`.
import EmbeddedPostgres from "embedded-postgres";
import { PG_PORT, PG_DATA_DIR, PG_DATABASE, PG_USER, PG_PASSWORD } from "./config.mjs";

export function makePg() {
  return new EmbeddedPostgres({
    databaseDir: PG_DATA_DIR,
    user: PG_USER,
    password: PG_PASSWORD,
    port: PG_PORT,
    persistent: true,
  });
}

export async function startPg() {
  const pg = makePg();
  // initialise() is a no-op-ish if the data dir already exists; guard anyway.
  try {
    await pg.initialise();
  } catch (err) {
    if (!/already exists|non-empty/i.test(String(err?.message))) throw err;
  }
  await pg.start();
  try {
    await pg.createDatabase(PG_DATABASE);
  } catch {
    /* database already exists */
  }
  return pg;
}

// CLI entrypoint — keeps the process alive so a shell can background it.
if (import.meta.url === `file://${process.argv[1]}`) {
  const cmd = process.argv[2] || "start";
  if (cmd === "stop") {
    const pg = makePg();
    await pg.stop().catch(() => {});
    console.log("embedded Postgres stopped");
    process.exit(0);
  }
  const pg = await startPg();
  console.log(`EMBEDDED_PG_READY on ${PG_PORT}`);
  const shutdown = async () => {
    try {
      await pg.stop();
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}
