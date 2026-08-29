// Stands in for graph.facebook.com during an e2e run.
//
// A SEPARATE PROCESS, and that is the whole point of the file. It lived inside
// run-e2e.mjs first, and could never answer a single request: that process drives
// Playwright with spawnSync, which blocks its event loop for the entire run, so
// the socket was accepted by the OS and then simply never read. The backend's
// Conversions API call timed out twice and gave up, the sink file stayed empty,
// and the revenue assertions in e2e/__meta-purchase.spec.ts skipped themselves —
// a green run that had checked nothing.
//
// Every call is appended to the JSONL file named by argv[3], which the spec reads
// back to reconcile the reported revenue against what Stripe actually charged.
//
//   node e2e/setup/meta-sink.mjs <port> <file>
import http from "http";
import { appendFileSync, rmSync } from "fs";

const port = Number(process.argv[2]);
const file = process.argv[3];
if (!port || !file) throw new Error("usage: meta-sink.mjs <port> <file>");

rmSync(file, { force: true });

const server = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => { raw += c; });
  req.on("end", () => {
    let body = null;
    try { body = JSON.parse(raw); } catch { /* record it as unparseable rather than losing it */ }
    appendFileSync(file, JSON.stringify({ url: req.url, body }) + "\n");
    for (const e of body?.data ?? []) console.log(`[meta-sink] ${e.event_name} ${e.event_id ?? ""}`);
    res.writeHead(200, { "Content-Type": "application/json" });
    // Meta's own success shape, so the backend's result parsing is exercised
    // rather than bypassed.
    res.end(JSON.stringify({
      events_received: body?.data?.length ?? 0, messages: [], fbtrace_id: "e2e-sink",
    }));
  });
});

server.on("error", (err) => { console.error("[meta-sink]", err.message); process.exit(1); });
server.listen(port, "127.0.0.1", () => console.log(`[meta-sink] listening on ${port} → ${file}`));
