// Stands in for api.resend.com during an e2e run.
//
// Same shape, and the same reasoning, as meta-sink.mjs next door: a SEPARATE
// process, because the runner drives Playwright with spawnSync and its event
// loop is blocked for the whole run — a server started in there accepts sockets
// and never reads them.
//
// Why an email needs a sink at all: with no RESEND_API_KEY the sender logs and
// returns `delivered:false`, so nothing about the message can be checked; with a
// real key it emails a real person. Neither is testable. The backend takes
// RESEND_ORIGIN for exactly this, so the run can read what would have been sent —
// recipient, subject, headers, HTML and the plain-text alternative — off the wire.
//
// Every send is appended to the JSONL file named by argv[3], which
// e2e/abandoned-cart.spec.ts reads back.
//
//   node e2e/setup/email-sink.mjs <port> <file>
import http from "http";
import { appendFileSync, rmSync } from "fs";

const port = Number(process.argv[2]);
const file = process.argv[3];
if (!port || !file) throw new Error("usage: email-sink.mjs <port> <file>");

rmSync(file, { force: true });

const server = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => { raw += c; });
  req.on("end", () => {
    let body = null;
    try { body = JSON.parse(raw); } catch { /* record it as unparseable rather than losing it */ }
    appendFileSync(file, JSON.stringify({ url: req.url, at: new Date().toISOString(), body }) + "\n");
    console.log(`[email-sink] → ${body?.to ?? "?"} · ${body?.subject ?? "(no subject)"}`);
    res.writeHead(200, { "Content-Type": "application/json" });
    // Resend's own success shape, so the sender's result handling is exercised
    // rather than bypassed.
    res.end(JSON.stringify({ id: `e2e-sink-${Date.now()}` }));
  });
});

server.on("error", (err) => { console.error("[email-sink]", err.message); process.exit(1); });
server.listen(port, "127.0.0.1", () => console.log(`[email-sink] listening on ${port} → ${file}`));
