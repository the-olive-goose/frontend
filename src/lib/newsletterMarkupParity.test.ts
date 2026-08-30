import { describe, expect, it, vi } from "vitest";
import * as backend from "../../backend/email.js";
import { parseNewsletterBody } from "./newsletterMarkup";

/**
 * The newsletter's markup exists twice — once in TypeScript for the admin's live
 * preview, once in plain JS for the API, which builds the email that is actually
 * sent and cannot import the app's TS.
 *
 * Duplication like this drifts silently, and here the drift has a nasty shape:
 * the preview is the only thing standing between a typo and an email that cannot
 * be recalled. A preview that renders differently from the send is worse than no
 * preview, because it turns "I checked it" into false confidence.
 *
 * So every case below is parsed by both and the trees must match exactly.
 */

const CASES: string[] = [
  // Plain
  "Hello there.",
  "One paragraph.\n\nAnd a second one.",
  "A line\nwith a soft break.",
  // Each mark on its own
  "Some **bold** text.",
  "Some *italic* text.",
  "Some __underlined__ text.",
  // Nesting, and marks meeting each other
  "**bold with *italic* inside**",
  "__underlined with **bold** inside__",
  "***bold italic***",
  "**bold**, *italic* and __under__ in one line.",
  // Whole-paragraph marks
  "**Everything here is bold.**",
  // The literal cases that must NOT become formatting
  "snake_case_word stays literal",
  "an_email_like@example.com",
  "5 * 3 = 15",
  "unclosed **bold",
  "unclosed *italic",
  "a ** b ** c",
  // Escaping is the emitter's job, but the parse must carry the text through
  "<script>alert(1)</script>",
  "Ampersands & angle < brackets >",
  "Quotes \"double\" and 'single'",
  // Images
  "![](https://res.cloudinary.com/asravqmm/image/fetch/w_600/https://example.com/a.jpg)",
  "![A lit candle](https://res.cloudinary.com/asravqmm/image/upload/v1/candle.jpg)",
  "Text above.\n\n![](https://example.com/a.jpg)\n\nText below.",
  // Not images: wrong scheme, relative path, not alone on its line
  "![](http://example.com/a.jpg)",
  "![](/uploads/a.jpg)",
  "look ![](https://example.com/a.jpg) inline",
  "![unclosed](https://example.com/a.jpg",
  // Image alt carrying characters that need escaping later
  "![Sarah's \"favourite\" & best](https://example.com/a.jpg)",
  // Whitespace and emptiness
  "",
  "   ",
  "\n\n\n",
  "  leading and trailing spaces  ",
  "Para one.\n\n\n\n\nPara two after many blank lines.",
  // Emoji and non-ASCII, which the shop's copy is full of
  "New scent 🫒 — café vibes, **hand-poured** in Dublin",
  // A realistic whole newsletter
  "Hi there,\n\nWe just poured something new: the **Iced Matcha Latte** candle.\n\n" +
    "![Iced matcha candle](https://res.cloudinary.com/asravqmm/image/upload/v1/matcha.jpg)\n\n" +
    "It's *limited* — only 40 of them. __Free delivery over €45__.\n\nSee you soon,\nThe Olive Goose",
];

describe("newsletter markup parity: storefront preview vs the email the API sends", () => {
  it.each(CASES.map((c, i) => [i, c] as const))("case %i: %j", (_i, body) => {
    expect(parseNewsletterBody(body)).toEqual(backend.parseNewsletterBody(body));
  });

  it("agrees on every case at once, so a new case cannot be quietly skipped", () => {
    const mine = CASES.map(parseNewsletterBody);
    const theirs = CASES.map(backend.parseNewsletterBody);
    expect(mine).toEqual(theirs);
  });
});

describe("the grammar itself", () => {
  const parse = parseNewsletterBody;

  it("splits paragraphs on blank lines and keeps soft breaks inside one", () => {
    const blocks = parse("One\ntwo\n\nthree");
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({
      type: "paragraph",
      spans: [{ text: "One\ntwo", bold: false, italic: false, underline: false }],
    });
  });

  it("carries nested marks on the innermost span", () => {
    const blocks = parse("**bold *and italic* here**");
    const spans = blocks[0].type === "paragraph" ? blocks[0].spans : [];
    expect(spans.map(s => [s.text, s.bold, s.italic])).toEqual([
      ["bold ", true, false],
      ["and italic", true, true],
      [" here", true, false],
    ]);
  });

  it("leaves snake_case alone — single underscores are not underline", () => {
    const blocks = parse("utm_source and utm_medium");
    const spans = blocks[0].type === "paragraph" ? blocks[0].spans : [];
    expect(spans).toEqual([
      { text: "utm_source and utm_medium", bold: false, italic: false, underline: false },
    ]);
  });

  // The rule that keeps a dead image out of every subscriber's inbox.
  it("treats a non-https image as literal text, not an image", () => {
    expect(parse("![](/uploads/a.jpg)")[0].type).toBe("paragraph");
    expect(parse("![](http://example.com/a.jpg)")[0].type).toBe("paragraph");
    expect(parse("![](https://example.com/a.jpg)")[0].type).toBe("image");
  });

  it("only treats an image as a block when it is alone on its line", () => {
    expect(parse("![](https://example.com/a.jpg)")[0].type).toBe("image");
    expect(parse("see ![](https://example.com/a.jpg)")[0].type).toBe("paragraph");
  });

  it("drops empty blocks rather than emitting blank paragraphs", () => {
    expect(parse("")).toEqual([]);
    expect(parse("   \n\n  \n\n ")).toEqual([]);
  });
});

describe("the email HTML the API actually builds", () => {
  const html = (body: string): string => backend.newsletterBodyHtml(body);

  // The single most important property here. Everything an admin types is data;
  // nothing they type may become markup in someone else's mailbox.
  it("escapes typed HTML rather than emitting it", () => {
    const out = html("<script>alert(1)</script>");
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;script&gt;");
  });

  it("escapes angle brackets and ampersands in ordinary prose", () => {
    expect(html("Tom & Jerry <3")).toContain("Tom &amp; Jerry &lt;3");
  });

  it("emits the marks as real tags", () => {
    expect(html("**b**")).toContain("<strong>b</strong>");
    expect(html("*i*")).toContain("<em>i</em>");
    expect(html("__u__")).toContain("<u>u</u>");
  });

  // Each span is emitted with its own tags rather than one tag spanning several.
  // That is the flat-span model showing through: it produces slightly wordier
  // HTML that renders identically, and it is what lets the preview and the email
  // be compared with a plain deep-equal instead of a tree diff.
  it("carries an inherited mark onto every span it covers", () => {
    expect(html("**bold *and italic* here**")).toContain(
      "<strong>bold </strong><strong><em>and italic</em></strong><strong> here</strong>",
    );
  });

  // Pinned rather than fixed. `***x***` is genuinely ambiguous and the non-greedy
  // match closes the bold at the first `**`, leaving a stray `*` as text. That is
  // exactly what the storefront's richtext.tsx has always done, so the newsletter
  // matches it — one surprising behaviour shared beats two different ones.
  it("resolves a triple marker the same way the storefront does", () => {
    expect(html("**bold *and italic***")).toContain("<strong>bold *and italic</strong>*");
  });

  it("turns a soft break into <br> and a blank line into a new paragraph", () => {
    expect(html("a\nb")).toContain("a<br>b");
    expect(html("a\n\nb").match(/<p /g)).toHaveLength(2);
  });

  it("gives images an explicit width, because Outlook ignores CSS-only sizing", () => {
    const out = html("![A candle](https://example.com/a.jpg)");
    expect(out).toContain('width="472"');
    expect(out).toContain('src="https://example.com/a.jpg"');
    expect(out).toContain('alt="A candle"');
    expect(out).toContain("display:block");
  });

  it("escapes the alt text and the url it puts in attributes", () => {
    const out = html('![Sarah\'s "best" & favourite](https://example.com/a.jpg?a=1&b=2)');
    expect(out).toContain("&amp;b=2");
    expect(out).not.toMatch(/alt="[^"]*"[^>]*"best"/);
    expect(out).toContain("&quot;best&quot;");
  });

  it("never emits an image for a url an inbox could not load", () => {
    expect(html("![](/uploads/a.jpg)")).not.toContain("<img");
    expect(html("![](http://example.com/a.jpg)")).not.toContain("<img");
    expect(html("![](https://example.com/a.jpg)")).toContain("<img");
  });

  it("produces nothing at all for an empty body", () => {
    expect(html("")).toBe("");
    expect(html("   \n\n  ")).toBe("");
  });
});

describe("sendNewsletterEmail", () => {
  it("refuses to send without an unsubscribe url — there is no such call path", async () => {
    await expect(
      backend.sendNewsletterEmail("a@b.com", { subject: "S", body: "B", unsubscribeUrl: "", oneClickUrl: "x" }),
    ).rejects.toThrow(/unsubscribeUrl/);
  });

  // The second address, and the one that is easy to forget because nothing on
  // screen shows it. List-Unsubscribe-Post promises the mail provider it may
  // POST the List-Unsubscribe URL and consider the person removed — so that URL
  // has to be a route that answers a POST, not the storefront page, where a POST
  // is a 404 and the one-click button reports a success that never happened.
  it("refuses to send without a one-click url, which the header depends on", async () => {
    await expect(
      backend.sendNewsletterEmail("a@b.com", { subject: "S", body: "B", unsubscribeUrl: "https://x/y", oneClickUrl: "" }),
    ).rejects.toThrow(/oneClickUrl/);
  });

  // Read off the wire rather than off the function's arguments: the header is
  // built inside the sender, and the whole bug this pins was a correct-looking
  // call site handing the wrong URL to a header nobody had ever read back.
  //
  // The module caches RESEND_API_KEY at import, so the key has to be in the
  // environment BEFORE a fresh copy is imported — setting it afterwards leaves
  // the sender in its dev-mode path, which logs and never calls fetch.
  it("puts the one-click url in the header and the page url in the body", async () => {
    const sent: Array<{ headers?: Record<string, string>; html: string; text: string }> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: { body: string }) => {
      sent.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ id: "x" }), { status: 200 });
    }));
    const prevKey = process.env.RESEND_API_KEY;
    process.env.RESEND_API_KEY = "test-key";
    vi.resetModules();
    try {
      const fresh = await import("../../backend/email.js?one-click");
      await fresh.sendNewsletterEmail("a@b.com", {
        subject: "S", body: "B",
        unsubscribeUrl: "https://shop.example/unsubscribe?token=abc",
        oneClickUrl: "https://shop.example/api/unsubscribe/one-click/abc",
      });
    } finally {
      if (prevKey === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = prevKey;
      // Put the SAFETY stub back, rather than unstubbing to the real fetch.
      // src/test/setup.ts installs that stub so no test can reach a server —
      // the guard added after `npm test` wrote 6,950 fixture rows into the
      // production analytics table. A bare vi.unstubAllGlobals() here restores
      // Node's real fetch for the rest of the file, quietly removing that guard
      // for whatever test is added below this one.
      vi.unstubAllGlobals();
      vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
    }
    expect(sent).toHaveLength(1);
    expect(sent[0].headers?.["List-Unsubscribe"]).toBe(
      "<https://shop.example/api/unsubscribe/one-click/abc>",
    );
    expect(sent[0].headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    // The visible link stays the page a person can read and change their mind on.
    expect(sent[0].html).toContain("https://shop.example/unsubscribe?token=abc");
    expect(sent[0].text).toContain("https://shop.example/unsubscribe?token=abc");
  });
});
