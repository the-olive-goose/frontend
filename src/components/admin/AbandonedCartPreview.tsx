import { Fragment } from "react";
import type { NewsletterSpan } from "@/lib/newsletterMarkup";
import { parseAbandonedCartBody, type AbandonedCartContext } from "@/lib/abandonedCart";

/**
 * What the abandoned-cart email will look like in an inbox, for one basket.
 *
 * Built from the same block tree the server builds the email from — see
 * src/lib/abandonedCart.ts and abandonedCartParity.test.ts, which holds the two
 * copies of that grammar to each other. Tokens are resolved against the sample
 * context the panel supplies, so what an admin reads here is the shape of what a
 * real shopper gets, with a real basket's worth of rows in the middle.
 *
 * Not an iframe, for the reason NewsletterPreview isn't one: the site's CSP
 * allowlists frame-src to a few video hosts, and nothing here is set as raw HTML
 * anyway, so a product name containing `<script>` renders as visible text
 * exactly as it will in the email.
 */

const Span = ({ span }: { span: NewsletterSpan }) => {
  const lines = span.text.split("\n");
  let node: React.ReactNode = lines.map((line, i) => (
    <Fragment key={i}>
      {i > 0 && <br />}
      {line}
    </Fragment>
  ));
  if (span.italic) node = <em>{node}</em>;
  if (span.underline) node = <u>{node}</u>;
  if (span.bold) node = <strong>{node}</strong>;
  return <>{node}</>;
};

interface Props {
  subject: string;
  preheader: string;
  body: string;
  ctx: AbandonedCartContext;
}

const AbandonedCartPreview = ({ subject, preheader, body, ctx }: Props) => {
  const blocks = parseAbandonedCartBody(body, ctx);

  return (
    // A labelled region rather than a bare div: it names this block for a screen
    // reader, and gives the e2e suite something stable to scope its assertions to
    // (the preview and the real email have to agree, so the suite reads both).
    <section aria-label="Email preview" className="rounded-xl border border-border overflow-hidden">
      {/* Inbox line — subject and preheader are what a shopper judges before
          opening anything, so they are previewed the way the inbox stacks them. */}
      <div className="px-4 py-2.5 border-b border-border bg-muted/50">
        <p className="font-sans text-[11px] uppercase tracking-wide text-muted-foreground">Inbox preview</p>
        <p className="font-sans text-sm font-semibold text-foreground truncate">
          {subject.trim() || <span className="font-normal text-muted-foreground">(no subject yet)</span>}
        </p>
        <p className="font-sans text-xs text-muted-foreground truncate">
          The Olive Goose{preheader.trim() ? ` — ${preheader.trim()}` : ""}
        </p>
      </div>

      <div className="p-5 overflow-x-auto" style={{ background: "#ffffff" }}>
        <div
          style={{
            maxWidth: 472,
            margin: "0 auto",
            fontFamily: "-apple-system, Segoe UI, Helvetica, Arial, sans-serif",
            color: "#1e2918",
          }}
        >
          <p style={{ fontSize: 13, letterSpacing: "0.12em", textTransform: "uppercase", color: "#6b7a5e", margin: "0 0 16px" }}>
            {ctx.shop_name}
          </p>

          {blocks.map((block, i) => {
            if (block.type === "items") {
              return (
                <table key={i} style={{ width: "100%", borderCollapse: "collapse", margin: "0 0 16px" }}>
                  <tbody>
                    {ctx.items.map((item, j) => (
                      <tr key={j}>
                        <td style={{ padding: "10px 0", borderBottom: "1px solid #ece6dd", width: 64, verticalAlign: "top" }}>
                          {item.image_url
                            ? <img src={item.image_url} alt="" width={56}
                                   style={{ display: "block", width: 56, height: 56, objectFit: "cover", borderRadius: 8 }} />
                            : <div style={{ width: 56, height: 56, borderRadius: 8, background: "#f1efe9" }} />}
                        </td>
                        <td style={{ padding: "10px 12px", borderBottom: "1px solid #ece6dd", verticalAlign: "top" }}>
                          <p style={{ fontSize: 15, lineHeight: 1.4, margin: 0 }}>{item.name}</p>
                          <p style={{ fontSize: 13, lineHeight: 1.4, margin: "2px 0 0", color: "#6b7a5e" }}>Qty {item.quantity}</p>
                        </td>
                        <td style={{ padding: "10px 0", borderBottom: "1px solid #ece6dd", textAlign: "right", verticalAlign: "top", whiteSpace: "nowrap" }}>
                          <p style={{ fontSize: 15, lineHeight: 1.4, margin: 0 }}>{item.line_total}</p>
                        </td>
                      </tr>
                    ))}
                    <tr>
                      <td colSpan={2} style={{ padding: "12px 0 0" }}>
                        <p style={{ fontSize: 14, margin: 0, color: "#6b7a5e" }}>Subtotal</p>
                      </td>
                      <td style={{ padding: "12px 0 0", textAlign: "right", whiteSpace: "nowrap" }}>
                        <p style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>{ctx.cart_total}</p>
                      </td>
                    </tr>
                  </tbody>
                </table>
              );
            }

            if (block.type === "button") {
              return (
                <p key={i} style={{ margin: "0 0 20px" }}>
                  <span style={{
                    display: "inline-block", marginTop: 8, padding: "12px 22px", background: "#1e2918",
                    color: "#fff", borderRadius: 8, fontSize: 14, fontWeight: 600,
                  }}>
                    {ctx.cta_label}
                  </span>
                </p>
              );
            }

            if (block.type === "image") {
              return (
                <img key={i} src={block.url} alt={block.alt}
                     style={{ display: "block", width: "100%", maxWidth: 472, height: "auto", borderRadius: 10, margin: "0 0 16px" }} />
              );
            }

            return (
              <p key={i} style={{ fontSize: 15, lineHeight: 1.6, margin: "0 0 16px" }}>
                {block.spans.map((span, j) => <Span key={j} span={span} />)}
              </p>
            );
          })}

          <hr style={{ border: "none", borderTop: "1px solid #e0d8ce", margin: "28px 0 14px" }} />
          <p style={{ fontSize: 12, lineHeight: 1.5, color: "#6b7a5e", margin: 0 }}>
            You're getting this because you left something in your basket at theolivegoose.ie.{" "}
            <span style={{ color: "#6b7a5e", textDecoration: "underline" }}>Stop basket reminders</span> any time.
          </p>
        </div>
      </div>
    </section>
  );
};

export default AbandonedCartPreview;
