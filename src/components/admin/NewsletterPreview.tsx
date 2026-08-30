import { Fragment } from "react";
import { parseNewsletterBody, type NewsletterSpan } from "@/lib/newsletterMarkup";

/**
 * What the newsletter will look like in an inbox.
 *
 * Rendered from the same block tree the server builds the email from — see
 * src/lib/newsletterMarkup.ts and the parity test that keeps the two identical.
 * Not an iframe: the site's Content-Security-Policy allowlists `frame-src` to a
 * handful of video hosts, so an embedded frame would need that policy loosened
 * in three files to preview an email. React elements are safer anyway — nothing
 * here is set as raw HTML, so a typed `<script>` renders as visible text exactly
 * as it will in the email.
 *
 * The chrome around the body (header line, unsubscribe footer) is shown too,
 * because those are part of what goes out and an admin should be able to see
 * that the unsubscribe link exists without sending themselves a copy. There is
 * no sign-off here: the email adds none, so anything below the last paragraph —
 * a closing line, a name — is whatever the admin typed into the body.
 */

const Span = ({ span }: { span: NewsletterSpan }) => {
  // Soft line breaks live inside a span's text; the email emits <br> for them.
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
  body: string;
}

const NewsletterPreview = ({ subject, body }: Props) => {
  const blocks = parseNewsletterBody(body);

  return (
    <div className="rounded-xl border border-border overflow-hidden">
      {/* Inbox line — the first thing a subscriber actually judges. */}
      <div className="px-4 py-2.5 border-b border-border bg-muted/50">
        <p className="font-sans text-[11px] uppercase tracking-wide text-muted-foreground">
          Inbox preview
        </p>
        <p className="font-sans text-sm font-semibold text-foreground truncate">
          {subject.trim() || <span className="font-normal text-muted-foreground">(no subject yet)</span>}
        </p>
        <p className="font-sans text-xs text-muted-foreground">The Olive Goose</p>
      </div>

      {/* The email body itself, at roughly the width it is sent at. */}
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
            The Olive Goose
          </p>

          {blocks.length === 0 && (
            <p style={{ fontSize: 15, lineHeight: 1.6, margin: "0 0 16px", color: "#9a9a90" }}>
              Your message will appear here as you type.
            </p>
          )}

          {blocks.map((block, i) =>
            block.type === "image" ? (
              <img
                key={i}
                src={block.url}
                alt={block.alt}
                style={{ display: "block", width: "100%", maxWidth: 472, height: "auto", borderRadius: 10, margin: "0 0 16px" }}
              />
            ) : (
              <p key={i} style={{ fontSize: 15, lineHeight: 1.6, margin: "0 0 16px" }}>
                {block.spans.map((span, j) => <Span key={j} span={span} />)}
              </p>
            ),
          )}

          <hr style={{ border: "none", borderTop: "1px solid #e0d8ce", margin: "28px 0 14px" }} />
          <p style={{ fontSize: 12, lineHeight: 1.5, color: "#6b7a5e", margin: 0 }}>
            You're getting this because you signed up at theolivegoose.ie.{" "}
            <span style={{ color: "#6b7a5e", textDecoration: "underline" }}>Unsubscribe</span> any time — no hard feelings.
          </p>
        </div>
      </div>
    </div>
  );
};

export default NewsletterPreview;
