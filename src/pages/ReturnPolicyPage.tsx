import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { fetchOrders, submitReturn, fetchReturns, SessionExpiredError, type Order, type ReturnRequest } from "@/lib/userApi";
import { getContent } from "@/lib/api";
import { DEFAULT_CONTENT, type ReturnPolicyContent } from "@/lib/defaults";
import PageSubNav, { ORDERS_NAV } from "@/components/PageSubNav";
import PageHero from "@/components/PageHero";
import FooterSection from "@/components/sections/FooterSection";

const STATUS_LABEL: Record<ReturnRequest["status"], string> = {
  requested: "Requested",
  approved:  "Approved",
  rejected:  "Rejected",
  refunded:  "Refunded",
};
const STATUS_COLOR: Record<ReturnRequest["status"], string> = {
  requested: "#a88734",
  approved:  "#007185",
  rejected:  "#C7511F",
  refunded:  "#007600",
};

const formatDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });

const ReturnPolicyPage = () => {
  const { user, loading: authLoading, openAuthModal, requireAuth } = useAuth();
  const [policy, setPolicy] = useState<ReturnPolicyContent>(DEFAULT_CONTENT.returnPolicy);
  const [orders, setOrders] = useState<Order[]>([]);
  const [returns, setReturns] = useState<ReturnRequest[]>([]);
  const [selection, setSelection] = useState("");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    getContent("returnPolicy", DEFAULT_CONTENT.returnPolicy).then(setPolicy);
  }, []);

  useEffect(() => {
    if (!user) return;
    fetchOrders().then(setOrders);
    fetchReturns().then(setReturns);
  }, [user?.id]);

  const eligibleOptions = orders
    .filter(o => o.tracking.delivered)
    .flatMap(o => o.items.map(item => ({
      value: `${o.id}::${item.product_id}`,
      label: `${(item.product_data?.name as string) || item.product_id} — Order #${o.tracking_number}`,
    })));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selection || !reason.trim()) return;
    const [orderId, productId] = selection.split("::");
    setSubmitting(true);
    setSubmitError("");
    try {
      const created = await submitReturn(orderId, productId, reason.trim());
      setReturns(prev => [created, ...prev]);
      setSelection("");
      setReason("");
      setSubmitted(true);
      setTimeout(() => setSubmitted(false), 3000);
    } catch (err) {
      if (err instanceof SessionExpiredError) {
        requireAuth(() => handleSubmit(e));
      } else {
        setSubmitError(err instanceof Error ? err.message : "Could not submit return request");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="w-full min-h-screen" style={{ background: "var(--bg-page)" }}>
      <div className="pt-[112px]">
        <PageHero eyebrow="Shipping & Returns" title={policy.heading} subtitle={policy.intro} />

        <div className="max-w-3xl mx-auto px-6 sm:px-12 py-12 sm:py-16 space-y-6">
          {user && <PageSubNav items={ORDERS_NAV} />}

          {/* Policy content — CMS managed */}
          <div className="bg-white rounded-2xl p-6 sm:p-8 space-y-6" style={{ border: "1px solid var(--color-border)" }}>
            {policy.sections.map(section => (
              <div key={section.title}>
                <h3 className="font-serif text-lg font-semibold mb-1" style={{ color: "var(--color-forest-dark)" }}>{section.title}</h3>
                <p className="font-sans text-sm leading-relaxed" style={{ color: "rgba(30,41,24,0.72)" }}>{section.body}</p>
              </div>
            ))}
            <p className="font-sans text-xs" style={{ color: "rgba(30,41,24,0.6)" }}>
              Questions? Email us at <a href={`mailto:${policy.contact_email}`} className="hover:underline font-semibold" style={{ color: "var(--color-forest-dark)" }}>{policy.contact_email}</a>
            </p>
          </div>

          {!authLoading && !user && (
            <div className="bg-white rounded-2xl p-8 text-center" style={{ border: "1px solid var(--color-border)" }}>
              <h2 className="font-serif text-xl font-semibold mb-4" style={{ color: "var(--color-forest-dark)" }}>Sign in to start a return</h2>
              <button onClick={openAuthModal}
                className="font-display text-sm font-semibold px-6 py-3 rounded-full transition-all hover:opacity-90 hover:-translate-y-0.5"
                style={{ background: "var(--color-forest-dark)", color: "var(--color-cream-text)" }}>
                Sign in
              </button>
            </div>
          )}

          {user && (
            <div className="bg-white rounded-2xl p-6 sm:p-8" style={{ border: "1px solid var(--color-border)" }}>
              <h2 className="font-serif text-lg font-semibold mb-4" style={{ color: "var(--color-forest-dark)" }}>Start a Return</h2>
              {eligibleOptions.length === 0 ? (
                <p className="font-sans text-sm" style={{ color: "rgba(30,41,24,0.72)" }}>
                  You don't have any delivered orders eligible for return yet.
                </p>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <label className="font-sans text-xs font-semibold block mb-1" style={{ color: "rgba(30,41,24,0.72)" }}>Item to return</label>
                    <select value={selection} onChange={e => setSelection(e.target.value)}
                      className="w-full px-3 py-2 rounded-lg font-sans text-sm outline-none"
                      style={{ border: "1px solid var(--color-border)", background: "#fff", color: "var(--color-forest-dark)" }}>
                      <option value="">Select an item…</option>
                      {eligibleOptions.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="font-sans text-xs font-semibold block mb-1" style={{ color: "rgba(30,41,24,0.72)" }}>Reason for return</label>
                    <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3}
                      placeholder="Tell us what happened…"
                      className="w-full px-3 py-2 rounded-lg font-sans text-sm outline-none resize-none"
                      style={{ border: "1px solid var(--color-border)", background: "#fff", color: "var(--color-forest-dark)" }} />
                  </div>
                  {submitError && <p className="font-sans text-sm" style={{ color: "#C7511F" }}>{submitError}</p>}
                  <div className="flex items-center gap-4">
                    <button type="submit" disabled={submitting || !selection || !reason.trim()}
                      className="font-display text-sm font-semibold px-6 py-3 rounded-full transition-all hover:opacity-90 hover:-translate-y-0.5 disabled:opacity-50 disabled:hover:translate-y-0"
                      style={{ background: "var(--color-forest-dark)", color: "var(--color-cream-text)" }}>
                      {submitting ? "Submitting…" : "Submit return request"}
                    </button>
                    {submitted && <span className="font-sans text-sm font-semibold" style={{ color: "#007600" }}>Request submitted ✓</span>}
                  </div>
                </form>
              )}
            </div>
          )}

          {user && returns.length > 0 && (
            <div className="bg-white rounded-2xl overflow-hidden" style={{ border: "1px solid var(--color-border)" }}>
              <p className="font-sans text-sm font-semibold px-5 py-3" style={{ color: "var(--color-forest-dark)", borderBottom: "1px solid var(--color-border)" }}>
                Your Return Requests
              </p>
              {returns.map((r, i) => (
                <div key={r.id} className="flex items-center justify-between gap-4 px-5 py-4"
                  style={{ borderBottom: i < returns.length - 1 ? "1px solid var(--color-border)" : "none" }}>
                  <div className="min-w-0">
                    <p className="font-sans text-sm font-semibold truncate" style={{ color: "var(--color-forest-dark)" }}>{r.product_name}</p>
                    <p className="font-sans text-xs truncate" style={{ color: "rgba(30,41,24,0.6)" }}>{r.reason}</p>
                    <p className="font-sans text-xs" style={{ color: "rgba(30,41,24,0.45)" }}>{formatDate(r.created_at)}</p>
                  </div>
                  <span className="font-sans text-xs font-semibold px-3 py-1 rounded-full shrink-0"
                    style={{ color: STATUS_COLOR[r.status], background: `${STATUS_COLOR[r.status]}1a` }}>
                    {STATUS_LABEL[r.status]}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <FooterSection data={DEFAULT_CONTENT.footer} />
    </div>
  );
};

export default ReturnPolicyPage;
