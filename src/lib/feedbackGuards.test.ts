// The "Share Your Experience" form on the homepage is the only place on the site
// where an anonymous visitor writes a row into the database, so its guards are
// the ones most worth pinning down. They live in backend/index.js, which the
// unit suite does not execute — so this test reads the source and asserts the
// guards are still wired to the route, the way csp.test.ts checks the deployed
// CSP header. It cannot prove the guards behave correctly (the isolated e2e
// backend does that), only that nobody has quietly removed one.
import { readFileSync } from "fs";
import path from "path";
import { describe, it, expect } from "vitest";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const backend = readFileSync(path.join(REPO_ROOT, "backend", "index.js"), "utf8");

/** Source of the route handler registered for a given path, up to the next route. */
const routeSource = (method: string, route: string): string => {
  const start = backend.indexOf(`app.${method}('${route}'`);
  if (start === -1) throw new Error(`no ${method.toUpperCase()} ${route} route in backend/index.js`);
  const next = backend.indexOf("\napp.", start + 1);
  return backend.slice(start, next === -1 ? undefined : next);
};

describe("public feedback endpoint guards", () => {
  const submit = () => routeSource("post", "/api/feedback");

  it("is rate limited", () => {
    expect(submit()).toContain("feedbackLimiter");
  });

  it("drops honeypot submissions before touching the database", () => {
    const src = submit();
    const honeypot = src.indexOf("req.body.website");
    const insert = src.indexOf("INSERT INTO feedback");
    expect(honeypot).toBeGreaterThan(-1);
    expect(honeypot).toBeLessThan(insert);
  });

  it("bounds every free-text field", () => {
    const src = submit();
    expect(src).toMatch(/safeText\(req\.body\.name,\s*\d+\)/);
    expect(src).toMatch(/safeText\(req\.body\.email,\s*\d+\)/);
    expect(src).toMatch(/safeText\(req\.body\.message,/);
    expect(src).toMatch(/safeText\(req\.body\.photo_url,\s*\d+\)/);
  });

  it("strips control characters from text that gets rendered back", () => {
    const src = submit();
    expect(src).toContain("stripControlChars(safeText(req.body.name");
    expect(src).toContain("stripControlChars(safeText(req.body.message");
  });

  it("validates rating, email and message length", () => {
    const src = submit();
    expect(src).toContain("Number.isInteger(rating)");
    expect(src).toContain("EMAIL_RE.test(email)");
    expect(src).toContain("FEEDBACK_MAX_LEN");
  });

  it("only stores photo paths this server issued", () => {
    expect(submit()).toContain("isOwnUploadPath(photoUrl)");
    // …and that check must not accept an absolute URL to somewhere else.
    expect(backend).toMatch(/const isOwnUploadPath[^\n]*\/\^\\\/uploads\\\//);
  });

  it("de-dupes a repeat submission instead of storing it twice", () => {
    const src = submit();
    expect(src).toContain("SELECT 1 FROM feedback");
    expect(src).toContain("409");
  });

  it("records the submitter's IP only as a hash", () => {
    const src = submit();
    expect(src).toContain("hashIp(req.ip)");
    expect(src).not.toMatch(/\[[^\]]*\breq\.ip\b[^\]]*\]/); // never a raw bind param
  });
});

describe("public feedback photo upload", () => {
  const upload = () => routeSource("post", "/api/feedback/photo");

  it("is rate limited separately from the review itself", () => {
    expect(upload()).toContain("feedbackPhotoLimiter");
  });

  it("uses the small-cap uploader, not the admin one", () => {
    expect(upload()).toContain("uploadFeedbackPhoto");
    expect(upload()).not.toContain("uploadImage");
  });

  it("caps review photos well below the admin uploader's limit", () => {
    const decl = backend.slice(backend.indexOf("const uploadFeedbackPhoto"));
    const mb = Number(decl.match(/fileSize:\s*(\d+)\s*\*\s*1024\s*\*\s*1024/)?.[1]);
    expect(mb).toBeGreaterThan(0);
    expect(mb).toBeLessThanOrEqual(10);
  });

  it("allows only image extensions — a .svg or .html would be script-in-uploads", () => {
    const decl = backend.slice(backend.indexOf("const uploadFeedbackPhoto"));
    expect(decl).toContain("makeUploadFilter('image/', IMAGE_EXTS");
    expect(backend).toMatch(/const IMAGE_EXTS[^\n]*/);
    const exts = backend.match(/const IMAGE_EXTS = new Set\(\[([^\]]*)\]\)/)?.[1] ?? "";
    expect(exts).not.toContain("svg");
    expect(exts).not.toContain("html");
  });
});

describe("admin feedback routes", () => {
  it("require an admin token", () => {
    expect(routeSource("get", "/api/admin/feedback")).toContain("requireAuth");
    expect(routeSource("patch", "/api/admin/feedback/:id")).toContain("requireAuth");
    expect(routeSource("delete", "/api/admin/feedback/:id")).toContain("requireAuth");
  });

  it("never send the stored IP hash to the browser", () => {
    const src = routeSource("get", "/api/admin/feedback");
    expect(src).not.toContain("SELECT *"); // would leak ip_hash to the admin bundle
    const columns = src.match(/SELECT ([\s\S]*?)\s+FROM feedback/)?.[1] ?? "";
    expect(columns).toBeTruthy();
    expect(columns).not.toContain("ip_hash");
  });

  it("can be reached cross-origin in dev — PATCH must be in the CORS allowlist", () => {
    const cors = backend.slice(backend.indexOf("app.use(cors("), backend.indexOf("app.use(cors(") + 600);
    expect(cors).toContain("'PATCH'");
  });
});
