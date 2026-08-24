// Archive — and only then, optionally, clear — the analytics_events table.
//
//   node scripts/analytics-archive.mjs                    # export only, touches nothing
//   node scripts/analytics-archive.mjs --clear-internal   # export, then drop only what was never a customer
//   node scripts/analytics-archive.mjs --clear-all        # export, then drop EVERY row
//
// WHY THIS EXISTS RATHER THAN A ONE-LINE DELETE. `DELETE FROM analytics_events`
// on production is unrecoverable: every visit, order attribution, funnel step,
// search term and Web Vitals sample the shop has ever recorded, gone, and with
// them every previous-period comparison on the dashboard — which is most of what
// makes a figure mean anything to someone reading it for the first time.
//
// So the export happens first, is COUNTED BACK against the table before anything
// is removed, and a mismatch aborts. Deleting on the assumption that a write
// succeeded is how a backup turns out to be empty on the day it is needed.
//
// Reads DATABASE_URL from the environment and never guesses at one. For the live
// database: railway variables --kv | grep DATABASE_URL
import { createWriteStream } from "fs";
import { mkdirSync } from "fs";
import path from "path";
import readline from "readline";
import pgpkg from "pg";

const { Pool } = pgpkg;
const DB = process.env.DATABASE_URL;
if (!DB) {
  console.error("DATABASE_URL is not set. Refusing to guess which database you mean.");
  process.exit(1);
}

const clearAll = process.argv.includes("--clear-all");
const clearInternal = process.argv.includes("--clear-internal");

// Rows we can say with evidence were never a customer: a visitor already marked
// as the shop's own, an event from a hostname ingestion no longer accepts, or
// the server-side sentinel that is not a browsing session at all. Deliberately
// NOT "everything that looks odd" — this deletes, so it only covers cases the
// dashboard already has a recorded reason for.
const NOT_A_CUSTOMER = `
  EXISTS (SELECT 1 FROM analytics_internal_visitors iv WHERE iv.visitor_id = analytics_events.visitor_id)
  OR session_id = 'server'
  OR (origin <> '' AND origin <> ALL($1::text[]))`;

const ask = (q) => new Promise((res) => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.question(q, (a) => { rl.close(); res(a.trim()); });
});

const pool = new Pool({ connectionString: DB, ssl: DB.includes("localhost") ? false : { rejectUnauthorized: false } });

try {
  const counted = (await pool.query(`SELECT COUNT(*)::int AS n FROM analytics_events`)).rows[0].n;
  const origins = (process.env.ANALYTICS_ORIGINS || "").split(",").map((o) => o.trim()).filter(Boolean);
  console.log(`analytics_events holds ${counted.toLocaleString()} rows.`);

  mkdirSync("analytics-archive", { recursive: true });
  const file = path.join("analytics-archive", `analytics_events-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`);
  const out = createWriteStream(file);

  // Streamed in pages rather than loaded whole: this table is the largest the
  // shop has, and an out-of-memory crash midway through would leave a truncated
  // file that still looks like a backup.
  let written = 0;
  const PAGE = 5000;
  for (let after = 0; ; ) {
    const { rows } = await pool.query(
      `SELECT * FROM analytics_events WHERE id > $1 ORDER BY id LIMIT ${PAGE}`, [after]);
    if (!rows.length) break;
    for (const r of rows) { out.write(JSON.stringify(r) + "\n"); written++; }
    after = rows[rows.length - 1].id;
    process.stdout.write(`\r  exported ${written.toLocaleString()} / ${counted.toLocaleString()}`);
  }
  await new Promise((res, rej) => { out.end(); out.on("finish", res); out.on("error", rej); });
  console.log(`\n  written to ${file}`);

  if (written !== counted) {
    console.error(`\nABORTING: exported ${written} rows but the table holds ${counted}. Nothing deleted.`);
    process.exit(1);
  }
  if (!clearAll && !clearInternal) {
    console.log("\nExport only — nothing was deleted. Re-run with --clear-internal or --clear-all to remove rows.");
    process.exit(0);
  }

  const { rows: [{ n: doomed }] } = clearAll
    ? await pool.query(`SELECT COUNT(*)::int AS n FROM analytics_events`)
    : await pool.query(`SELECT COUNT(*)::int AS n FROM analytics_events WHERE ${NOT_A_CUSTOMER}`, [origins]);

  console.log(`\nAbout to delete ${doomed.toLocaleString()} of ${counted.toLocaleString()} rows${clearAll ? " (EVERYTHING)" : " (traffic that was never a customer)"}.`);
  if (clearAll) {
    console.log("Every previous-period comparison on the dashboard will read 'nothing in either period' afterwards.");
  }
  // Typed in full, not y/n: a keystroke is too cheap for something with no undo.
  if ((await ask(`Type DELETE to proceed, anything else to stop: `)) !== "DELETE") {
    console.log("Stopped. Nothing was deleted.");
    process.exit(0);
  }

  const res = clearAll
    ? await pool.query(`DELETE FROM analytics_events`)
    : await pool.query(`DELETE FROM analytics_events WHERE ${NOT_A_CUSTOMER}`, [origins]);
  console.log(`Deleted ${res.rowCount.toLocaleString()} rows. Archive kept at ${file}`);
} catch (err) {
  console.error("Failed:", err.message, "\nNothing was deleted.");
  process.exit(1);
} finally {
  await pool.end();
}
