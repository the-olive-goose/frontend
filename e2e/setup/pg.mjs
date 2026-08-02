// Start/stop an ephemeral embedded Postgres for the e2e stack.
// Usage: `node e2e/setup/pg.mjs start` (stays up) / `node e2e/setup/pg.mjs stop`.
import { existsSync } from "fs";
import path from "path";
import EmbeddedPostgres from "embedded-postgres";
import { PG_PORT, PG_DATA_DIR, PG_DATABASE, PG_USER, PG_PASSWORD } from "./config.mjs";

// initdb refuses to run against a non-empty directory, so a persistent data dir
// makes every run after the first fail. PG_VERSION is written once initdb has
// finished, which makes it the marker for "this cluster is already built" —
// checked directly rather than by matching initdb's error text, which varies by
// Postgres version and has been wrong here before.
const isInitialised = () => existsSync(path.join(PG_DATA_DIR, "PG_VERSION"));

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
  // Reuse an existing cluster; only build one when there isn't one. A failure
  // here is now a real failure — a directory that is non-empty but has no
  // PG_VERSION is a half-written cluster, and starting it would fail anyway.
  if (!isInitialised()) await pg.initialise();
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
