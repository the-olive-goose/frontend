import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer, AreaChart, Area, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";
import {
  getAdminAnalytics, getAdminAnalyticsLive,
  getAnalyticsSessions, setAnalyticsInternalVisitor,
  type AnalyticsOverview, type AnalyticsLive, type AnalyticsSession,
} from "@/lib/api";

// ── Chart colors ────────────────────────────────────────────────────────────────
// Validated with the dataviz palette checker against the admin card surface
// (#f9f4ec): categorical slots pass CVD separation; the funnel ramp is a single
// blue hue, monotone light→dark, light end ≥2:1. Sub-3:1 slots (aqua) are
// relieved by visible labels and table views throughout.
const SERIES = { blue: "#2a78d6", aqua: "#1baf7a", yellow: "#eda100" };
const FUNNEL_RAMP = ["#6da7ec", "#3987e5", "#256abf", "#184f95", "#0d366b"];
const DELTA_GOOD = "#006300";
const DELTA_BAD = "#b3282f";
const STATUS = { good: "#0ca30c", serious: "#ec835a", critical: "#d03b3b" };
const SURFACE = "#f9f4ec"; // bg-card resolved — used for surface rings/gaps
const GRID = "rgba(30,41,24,0.10)";
const INK_MUTED = "rgba(30,41,24,0.55)";

const fmtInt = (n: number) => n.toLocaleString("en-IE");
const fmtEur = (n: number) => `€${n.toLocaleString("en-IE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtCompactEur = (n: number) => (n >= 10000 ? `€${(n / 1000).toFixed(1)}K` : fmtEur(n));
const fmtDay = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-IE", { day: "numeric", month: "short" });
// Durations read as minutes and seconds past a minute — "2m 14s", not "134.0s".
const fmtDuration = (s: number) =>
  s >= 60 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${s.toFixed(s < 10 ? 1 : 0)}s`;

// ── Stat tile ───────────────────────────────────────────────────────────────────
// value + optional delta vs the previous period. `invert` flips delta colouring
// for metrics where an increase is bad (bounce rate).
const StatTile = ({ label, value, prev, invert = false, sub }: {
  label: string; value: string; prev?: { current: number; previous: number }; invert?: boolean; sub?: string;
}) => {
  let delta: { text: string; good: boolean } | null = null;
  // No baseline is stated outright rather than left blank — a missing delta and
  // a flat one must not look the same.
  let noBaseline = false;
  if (prev) {
    if (prev.previous > 0) {
      const pct = ((prev.current - prev.previous) / prev.previous) * 100;
      if (Number.isFinite(pct)) {
        const up = pct >= 0;
        delta = {
          text: `${up ? "↑" : "↓"} ${Math.abs(pct).toFixed(1)}% vs previous period`,
          good: invert ? !up : up,
        };
      }
    } else {
      noBaseline = true;
    }
  }
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="font-sans text-xs text-muted-foreground">{label}</p>
      <p className="font-sans text-2xl font-semibold text-foreground mt-1">{value}</p>
      {delta && (
        <p className="font-sans text-xs mt-1" style={{ color: delta.good ? DELTA_GOOD : DELTA_BAD }}>
          {delta.text}
        </p>
      )}
      {!delta && noBaseline && (
        <p className="font-sans text-xs text-muted-foreground mt-1">
          {prev.current > 0 ? "no activity in the previous period" : "nothing in either period"}
        </p>
      )}
      {!delta && !noBaseline && sub && <p className="font-sans text-xs text-muted-foreground mt-1">{sub}</p>}
    </div>
  );
};

const Card = ({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) => (
  <div className="rounded-xl border border-border bg-card p-4">
    <p className="font-sans text-sm font-semibold text-foreground">{title}</p>
    {desc && <p className="font-sans text-xs text-muted-foreground mt-0.5">{desc}</p>}
    <div className="mt-3">{children}</div>
  </div>
);

const LegendKey = ({ items }: { items: Array<{ label: string; color: string }> }) => (
  <div className="flex items-center gap-4 mt-1">
    {items.map(i => (
      <span key={i.label} className="flex items-center gap-1.5 font-sans text-xs text-muted-foreground">
        <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: i.color }} />
        {i.label}
      </span>
    ))}
  </div>
);

// Recharts tooltip styled to the admin theme; values read from the payload so
// each chart passes its own formatter.
const ChartTooltip = ({ active, payload, label, fmt }: {
  active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string;
  fmt: (v: number) => string;
}) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 shadow-md">
      <p className="font-sans text-xs text-muted-foreground">{label ? fmtDay(label) : ""}</p>
      {payload.map(p => (
        <p key={p.name} className="font-sans text-xs text-foreground flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full inline-block" style={{ background: p.color }} />
          {p.name}: <span className="font-semibold">{fmt(p.value)}</span>
        </p>
      ))}
    </div>
  );
};

const axisProps = {
  tick: { fontSize: 11, fill: INK_MUTED, fontFamily: "Inter, sans-serif" },
  tickLine: false as const,
  axisLine: { stroke: GRID },
};

// ── Funnel ──────────────────────────────────────────────────────────────────────
// Ordered stages → single-hue ordinal ramp; widths scale to the first stage.
// Values sit at the bar tip (never inside a too-small bar) and each stage shows
// its conversion from the previous one.
// The funnel has a variable number of stages — the API omits any whose events
// didn't exist in the window — so colours are interpolated across the ramp
// rather than indexed into it. FUNNEL_RAMP[i] returned undefined (an
// invisible bar) for every stage past the fifth once the funnel grew past five.
const rampColor = (i: number, count: number): string => {
  if (count <= 1) return FUNNEL_RAMP[0];
  const pos = (i / (count - 1)) * (FUNNEL_RAMP.length - 1);
  const lo = Math.floor(pos);
  const hi = Math.min(lo + 1, FUNNEL_RAMP.length - 1);
  const t = pos - lo;
  const channel = (c: number) => {
    const a = parseInt(FUNNEL_RAMP[lo].slice(1 + c * 2, 3 + c * 2), 16);
    const b = parseInt(FUNNEL_RAMP[hi].slice(1 + c * 2, 3 + c * 2), 16);
    return Math.round(a + (b - a) * t);
  };
  return `rgb(${channel(0)}, ${channel(1)}, ${channel(2)})`;
};

const Funnel = ({ stages, conversionRate }: { stages: AnalyticsOverview["funnel"]; conversionRate: number }) => {
  const max = Math.max(stages[0]?.sessions ?? 0, 1);
  return (
    <div className="space-y-3">
      {stages.map((s, i) => {
        const widthPct = Math.max((s.sessions / max) * 100, s.sessions > 0 ? 2 : 0);
        const prev = i > 0 ? stages[i - 1].sessions : 0;
        const stepRate = i > 0 && prev > 0 ? (s.sessions / prev) * 100 : null;
        return (
          <div key={s.stage} className="grid grid-cols-[150px_1fr] items-center gap-3">
            <div>
              <p className="font-sans text-xs text-foreground">{s.stage}</p>
              {stepRate !== null && (
                <p className="font-sans text-[11px] text-muted-foreground">{stepRate.toFixed(1)}% of previous</p>
              )}
            </div>
            <div className="flex items-center gap-2">
              <div
                className="h-5"
                style={{
                  width: `${widthPct}%`,
                  background: rampColor(i, stages.length),
                  borderRadius: "0 4px 4px 0", // rounded data-end, square at the baseline
                }}
              />
              <span className="font-sans text-xs text-foreground font-semibold whitespace-nowrap">
                {fmtInt(s.sessions)}
              </span>
            </div>
          </div>
        );
      })}
      {/* Reads the API's own conversion figure rather than recomputing it, so
          this and the Session conversion tile can never disagree. */}
      <p className="font-sans text-[11px] text-muted-foreground pt-1">
        Sessions reaching each stage or any later one. Overall conversion:{" "}
        <span className="font-semibold text-foreground">{conversionRate}%</span>
      </p>
    </div>
  );
};

// ── Devices — part-to-whole as one stacked horizontal bar + legend ─────────────
const DeviceSplit = ({ devices }: { devices: AnalyticsOverview["devices"] }) => {
  // "unknown" is listed explicitly so it sorts last and keeps a stable colour —
  // with indexOf alone it scored -1 and jumped to the front of the bar.
  const order = ["desktop", "mobile", "tablet", "unknown"];
  const colors = [SERIES.blue, SERIES.aqua, SERIES.yellow, INK_MUTED];
  const rank = (d: string) => { const i = order.indexOf(d); return i === -1 ? order.length : i; };
  const sorted = [...devices].sort((a, b) => rank(a.device) - rank(b.device));
  const total = sorted.reduce((s, d) => s + d.sessions, 0);
  if (!total) return <p className="font-sans text-xs text-muted-foreground">No sessions yet.</p>;
  return (
    <div>
      <div className="flex h-5 rounded overflow-hidden" style={{ gap: 2, background: SURFACE }}>
        {sorted.map((d, i) => (
          <div key={d.device} style={{ width: `${(d.sessions / total) * 100}%`, background: colors[i % colors.length] }} />
        ))}
      </div>
      <div className="flex items-center gap-4 mt-2 flex-wrap">
        {sorted.map((d, i) => (
          <span key={d.device} className="flex items-center gap-1.5 font-sans text-xs text-muted-foreground capitalize">
            <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: colors[i % colors.length] }} />
            {d.device} — <span className="font-semibold text-foreground">{((d.sessions / total) * 100).toFixed(0)}%</span> ({fmtInt(d.sessions)})
          </span>
        ))}
      </div>
    </div>
  );
};

// ── Simple data table ───────────────────────────────────────────────────────────
const DataTable = ({ cols, rows, empty }: {
  cols: Array<{ label: string; align?: "right" }>; rows: Array<Array<string | number>>; empty: string;
}) => (
  rows.length === 0
    ? <p className="font-sans text-xs text-muted-foreground">{empty}</p>
    : (
      <table className="w-full font-sans text-xs">
        <thead>
          <tr className="text-muted-foreground border-b border-border">
            {cols.map(c => (
              <th key={c.label} className={`py-1.5 font-medium ${c.align === "right" ? "text-right" : "text-left"}`}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-b border-border/50 last:border-0">
              {r.map((cell, j) => (
                <td
                  key={j}
                  className={`py-1.5 text-foreground ${cols[j].align === "right" ? "text-right" : ""}`}
                  style={cols[j].align === "right" ? { fontVariantNumeric: "tabular-nums" } : undefined}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    )
);

// ── Web vitals ──────────────────────────────────────────────────────────────────
// p75 per metric graded against Google's thresholds. Status is icon + label,
// never colour alone.
const VITAL_META: Record<string, { name: string; good: number; poor: number; fmt: (v: number) => string }> = {
  LCP:  { name: "Largest Contentful Paint", good: 2500, poor: 4000, fmt: v => `${(v / 1000).toFixed(2)}s` },
  CLS:  { name: "Cumulative Layout Shift",  good: 0.1,  poor: 0.25, fmt: v => v.toFixed(3) },
  INP:  { name: "Interaction to Next Paint", good: 200, poor: 500,  fmt: v => `${Math.round(v)}ms` },
  TTFB: { name: "Time to First Byte",        good: 800, poor: 1800, fmt: v => `${Math.round(v)}ms` },
};

const rateVital = (key: string, p75: number) => {
  const meta = VITAL_META[key];
  const rating = p75 <= meta.good ? "Good" : p75 <= meta.poor ? "Needs work" : "Poor";
  return {
    rating,
    color: rating === "Good" ? STATUS.good : rating === "Needs work" ? STATUS.serious : STATUS.critical,
    icon: rating === "Good" ? "✓" : rating === "Needs work" ? "△" : "✕",
  };
};

// The metrics Google grades the site on, and — when one of them is failing — the
// pages responsible. A site-wide p75 alone says something is slow without ever
// saying what, and the answer is almost never spread evenly: one heavy page
// routinely drags the whole grade down while everything else is fine.
const WebVitals = ({ vitals, byPage }: {
  vitals: AnalyticsOverview["web_vitals"];
  byPage: AnalyticsOverview["web_vitals_by_page"];
}) => {
  const known = vitals.filter(v => VITAL_META[v.metric]);
  if (!known.length) return <p className="font-sans text-xs text-muted-foreground">No performance samples yet — vitals are collected as real visitors browse.</p>;

  // Worst first, and only for metrics that aren't already passing: a list of
  // pages under a green score is noise that buries the one under a red one.
  const culprits = ["LCP", "INP", "CLS"].flatMap(key => {
    const site = known.find(v => v.metric === key);
    if (!site || rateVital(key, site.p75).rating === "Good") return [];
    const pages = (byPage ?? [])
      .filter(p => p.metric === key && rateVital(key, p.p75).rating !== "Good")
      .sort((a, b) => b.p75 - a.p75)
      .slice(0, 5);
    return pages.length ? [{ key, pages }] : [];
  });

  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {["LCP", "CLS", "INP", "TTFB"].map(key => {
          const v = known.find(x => x.metric === key);
          const meta = VITAL_META[key];
          // A metric with no samples gets a tile saying so rather than vanishing.
          // A missing tile is indistinguishable from a passing one at a glance,
          // and "we are not measuring this" is the more urgent of the two.
          if (!v) {
            return (
              <div key={key} className="rounded-lg border border-border border-dashed p-3">
                <p className="font-sans text-xs text-muted-foreground" title={meta.name}>{key}</p>
                <p className="font-sans text-lg font-semibold text-muted-foreground">—</p>
                <p className="font-sans text-[11px] text-muted-foreground">Not measured in this period</p>
              </div>
            );
          }
          const { rating, color, icon } = rateVital(key, v.p75);
          return (
            <div key={key} className="rounded-lg border border-border p-3">
              <p className="font-sans text-xs text-muted-foreground" title={meta.name}>{key}</p>
              <p className="font-sans text-lg font-semibold text-foreground">{meta.fmt(v.p75)}</p>
              <p className="font-sans text-[11px] text-muted-foreground">
                <span style={{ color }}>{icon} {rating}</span> · p75 of {fmtInt(v.samples)} samples
              </p>
            </div>
          );
        })}
      </div>

      {!!culprits.length && (
        <div className="mt-4 pt-4 border-t border-border">
          <p className="font-sans text-xs font-semibold text-foreground">Where it's coming from</p>
          <p className="font-sans text-[11px] text-muted-foreground mt-1 mb-3">
            Pages scored on the visit that loaded them, worst first. Only pages with at least
            five samples appear — a p75 over three visits is one unlucky phone, not a problem.
          </p>
          <div className="space-y-3">
            {culprits.map(({ key, pages }) => (
              <div key={key}>
                <p className="font-sans text-[11px] text-muted-foreground mb-1">{VITAL_META[key].name}</p>
                <ul className="space-y-1">
                  {pages.map(p => {
                    const { color, icon } = rateVital(key, p.p75);
                    return (
                      <li key={p.path} className="flex items-baseline justify-between gap-3">
                        <span className="font-sans text-xs text-foreground truncate">{p.path}</span>
                        <span className="font-sans text-xs shrink-0" style={{ color }}>
                          {icon} {VITAL_META[key].fmt(p.p75)}
                          <span className="text-muted-foreground"> · {fmtInt(p.samples)}</span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
};

// ── Period presets ──────────────────────────────────────────────────────────────
// Trailing windows as quick pills, calendar periods (months, quarters, years)
// in a dropdown. All resolve to an inclusive {start, end} pair in local time;
// the backend compares each against the equally-sized period before it.

type Period = { key: string; label: string; start: string; end: string };

const isoLocal = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const buildPeriods = (): { pills: Period[]; calendar: Period[] } => {
  const now = new Date();
  const today = isoLocal(now);
  const trailing = (n: number, label: string): Period => ({
    key: `last${n}`, label,
    start: isoLocal(new Date(now.getFullYear(), now.getMonth(), now.getDate() - (n - 1))),
    end: today,
  });
  // Calendar span, capped at today so an in-progress period never asks for the future.
  const span = (key: string, label: string, from: Date, to: Date): Period => ({
    key, label, start: isoLocal(from), end: to > now ? today : isoLocal(to),
  });

  const y = now.getFullYear();
  const q = Math.floor(now.getMonth() / 3);
  const quarter = (year: number, qi: number) =>
    span(`q${qi + 1}-${year}`, `Q${qi + 1} ${year}`, new Date(year, qi * 3, 1), new Date(year, qi * 3 + 3, 0));

  const calendar: Period[] = [
    span("thisMonth", "This month", new Date(y, now.getMonth(), 1), new Date(y, now.getMonth() + 1, 0)),
    span("thisQuarter", "This quarter", new Date(y, q * 3, 1), new Date(y, q * 3 + 3, 0)),
    span("thisYear", "This year", new Date(y, 0, 1), new Date(y, 11, 31)),
    // Current year's quarters up to the one in progress, then all of last year's.
    ...Array.from({ length: q + 1 }, (_, i) => quarter(y, i)).reverse(),
    ...[3, 2, 1, 0].map(i => quarter(y - 1, i)),
    span(`year-${y - 1}`, `Year ${y - 1}`, new Date(y - 1, 0, 1), new Date(y - 1, 11, 31)),
  ];

  return {
    pills: [trailing(7, "Last 7 days"), trailing(30, "Last 30 days"), trailing(90, "Last 90 days")],
    calendar,
  };
};

const fmtRange = (start: string, end: string) => {
  const f = (s: string) => new Date(`${s}T00:00:00`).toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric" });
  return `${f(start)} – ${f(end)}`;
};

// ── Whose visits count ──────────────────────────────────────────────────────────
// One rule, and it is the address bar.
//
// The live shop is the live shop. Every visit to theolivegoose.ie is a real
// visit and every payment taken there is a real sale, whoever was at the
// keyboard. Testing happens on localhost, which is recorded under its own
// hostname and never reaches these figures — the slicer at the top of the panel
// is where the two are told apart.
//
// This card used to hold three controls that guessed instead: exclude my wifi,
// exclude my account, mark this browser. They were wrong in the worst direction
// and silently — the wifi rule hid everyone else in the house, the account rule
// reached backwards through a browser's whole history, and the browser mark
// attached itself to whatever opened the admin panel. Between them they had
// hidden three real card payments and most of the shop's real browsing, which is
// how the dashboard came to report revenue with no purchasing sessions and a 0%
// conversion rate. They are gone rather than merely switched off: a control that
// claims to exclude traffic and doesn't is worse than no control at all.
const InternalTraffic = () => (
  <Card
    title="Whose visits count"
    desc="Everything on the live shop — testing belongs on localhost"
  >
    <p className="font-sans text-sm text-foreground">
      Every visit to <span className="font-semibold">theolivegoose.ie</span> counts, and every
      payment taken there is a sale. Nothing is excluded by guessing who was behind it.
    </p>
    <p className="font-sans text-xs text-muted-foreground mt-3">
      Work on the shop from <span className="font-mono">localhost</span> and it is recorded
      separately — visible from the hostname picker at the top of this panel, and never mixed
      into the numbers above.
    </p>
    <p className="font-sans text-xs text-muted-foreground mt-3">
      If one particular visit really wasn't a shopper — a friend you asked to look, a demo on a
      borrowed laptop — press <span className="font-semibold">This was me</span> on that row in
      Recent visits. That is a decision about one browser, it says so on the row, and pressing
      Count it puts it straight back.
    </p>
    <p className="font-sans text-xs text-muted-foreground mt-3">
      Revenue counts every payment Stripe took and hands back what was refunded or returned, so
      it reconciles with your Stripe dashboard to the cent. To take money out of it, refund it.
    </p>
  </Card>
);

// ── Recent visits ───────────────────────────────────────────────────────────────
// The control every other one leaves a hole under.
//
// A browser is excluded by a flag in its own storage; a network by the address a
// visit arrives from; an account by who is signed in. Each rule decides at the
// moment the visit happens, and none of them can be applied afterwards — so a
// visit that matched nothing at the time is in the numbers permanently, however
// obviously it was the shop's own. That is not an edge case:
//
//   • a VPN puts this laptop on an address in another country, so the home
//     network never matches and the visit lands as a shopper in Stockholm;
//   • testing means private windows and cleared site data, and each one mints a
//     brand-new visitor with no marker on it;
//   • a phone on mobile data has left the wifi the moment it steps outside;
//   • a friend asked to "have a look at the site" is not a customer either.
//
// So this lists what actually arrived, with enough of each visit to recognise it,
// and retires any one of them — backwards, taking that browser's whole history,
// exactly like every other exclusion here.
//
// Excluded visits are listed too, greyed and reversible. An exclusion nobody can
// see is one nobody can undo, and hiding real shoppers is the one error the rest
// of this dashboard has no way to reveal.
// A hostname in the owner's words rather than the ingest layer's.
//
// "production" and "(not recorded)" are the labels the database stores. Neither
// means anything to someone trying to work out whether a figure is their shop or
// their laptop, which is the entire question this slicer exists to answer.
const hostLabel = (host: string): string => {
  if (host === "production") return "The shop (theolivegoose.ie)";
  if (host === "localhost") return "My computer (localhost)";
  if (host === "(not recorded)") return "Not from a browser";
  if (host === "all") return "Everything recorded";
  return host.replace(/^https?:\/\//, "");
};

// Why a visit is out of the numbers, in the owner's own terms.
//
// Without this the Retired tab is a list of visits with no stated cause, and the
// only reading available is "the dashboard has decided these don't count". A real
// €0.50 card payment sitting in there looks like the numbers are simply wrong —
// when in fact it was the shop's own test purchase, made from the shop's own
// network, and excluding it is the whole point of the feature.
//
// So every retirement names itself, and names the thing that would release it.
const RETIRE_REASON: Record<string, string> = {
  "marked from recent visits": "you retired this",
};

const retireReason = (row: AnalyticsSession): string =>
  RETIRE_REASON[row.excluded_reason] ?? (row.excluded_reason || "retired");

const RecentVisits = ({ onChanged }: { onChanged: () => void }) => {
  const [rows, setRows] = useState<AnalyticsSession[] | null>(null);
  const [days, setDays] = useState(7);
  const [only, setOnly] = useState<"all" | "counted" | "excluded">("all");
  // "" is the server's default, PRODUCTION. Same rule as the dashboard above:
  // the storefront on its own unless the reader asks for more.
  const [host, setHost] = useState("");
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setRows(null);
    getAnalyticsSessions({ days, limit: 60, only, host: host || undefined })
      .then(r => { if (!cancelled) { setRows(r.sessions); setError(""); } })
      .catch(() => { if (!cancelled) { setRows([]); setError("Couldn't load recent visits."); } });
    return () => { cancelled = true; };
  }, [days, only, host]);

  const toggle = async (row: AnalyticsSession) => {
    const next = !row.excluded;
    setBusy(row.session_id);
    try {
      await setAnalyticsInternalVisitor(row.visitor_id, next);
      // Every visit from the SAME browser changes with it — the exclusion is by
      // visitor, not by session, so showing only the clicked row updated would
      // misrepresent what just happened.
      setRows(rs => (rs ?? []).map(r => (r.visitor_id === row.visitor_id
        ? { ...r, excluded: next, excluded_reason: next ? "marked from recent visits" : "" }
        : r)));
      setNote(next
        ? "Retired. Everything that browser has ever recorded is out of the numbers, not just this visit."
        : "Counted as a shopper again.");
      // The tiles above were measured before this changed. Refetching them is
      // the difference between a control that works and one the owner has to be
      // told to trust.
      onChanged();
    } catch {
      setNote("Couldn't change that visit.");
    } finally { setBusy(""); }
  };

  const when = (iso: string) => new Date(iso).toLocaleString("en-IE", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });

  const pill = (active: boolean) =>
    `font-sans text-[11px] px-2.5 py-1.5 rounded-md border min-h-[36px] ${
      active ? "border-foreground/40 bg-muted text-foreground" : "border-border bg-background text-muted-foreground hover:bg-muted"}`;

  return (
    <Card
      title="Recent visits"
      desc="Every visit as it arrived — retire any one that was you"
    >
      <div className="flex items-center gap-2 flex-wrap mb-3">
        {([7, 30, 90] as const).map(d => (
          <button key={d} type="button" onClick={() => setDays(d)} className={pill(days === d)}>
            Last {d} days
          </button>
        ))}
        <span className="w-px h-5 bg-border mx-1" />
        {([["all", "All"], ["counted", "Counted"], ["excluded", "Retired"]] as const).map(([v, label]) => (
          <button key={v} type="button" onClick={() => setOnly(v)} className={pill(only === v)}>
            {label}
          </button>
        ))}
        <span className="w-px h-5 bg-border mx-1" />
        {/* Where the visit was made — the shop, or a machine testing it. Kept as
            pills rather than a dropdown because it is the same kind of decision
            as Counted/Retired next to it: which visits am I looking at. */}
        {([["", "The shop"], ["localhost", "My computer"], ["all", "Everywhere"]] as const).map(([v, label]) => (
          <button key={v || "production"} type="button" onClick={() => setHost(v)} className={pill(host === v)}>
            {label}
          </button>
        ))}
      </div>

      {rows === null ? (
        <p className="font-sans text-xs text-muted-foreground">Loading…</p>
      ) : error ? (
        <p className="font-sans text-xs text-muted-foreground">{error}</p>
      ) : rows.length === 0 ? (
        <p className="font-sans text-xs text-muted-foreground">
          {only === "excluded" ? "No visits have been retired."
            : host === "localhost" ? "Nothing recorded from your own machine in this window."
            : "No visits in this window yet."}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full font-sans text-xs min-w-[720px]">
            <thead>
              <tr className="text-muted-foreground border-b border-border">
                <th className="py-1.5 font-medium text-left">When</th>
                <th className="py-1.5 font-medium text-left">Where</th>
                <th className="py-1.5 font-medium text-left">Device</th>
                <th className="py-1.5 font-medium text-left">Came from</th>
                <th className="py-1.5 font-medium text-left">Landed on</th>
                <th className="py-1.5 font-medium text-right">Pages</th>
                <th className="py-1.5 font-medium text-right">Bought</th>
                <th className="py-1.5 font-medium text-right">Counts?</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr
                  key={r.session_id}
                  className="border-b border-border/50 last:border-0"
                  style={r.excluded ? { opacity: 0.55 } : undefined}
                >
                  <td className="py-1.5 text-foreground whitespace-nowrap">{when(r.started_at)}</td>
                  <td className="py-1.5 text-foreground">
                    {r.city}{r.country ? `, ${r.country}` : ""}
                    {/* Only when it isn't the shop. Printing "production" on every
                        row of a table that is production by default is noise; the
                        one row that ISN'T is the whole reason to look. */}
                    {r.host && r.host !== "production" && (
                      <span className="block text-[10px] text-muted-foreground">{hostLabel(r.host)}</span>
                    )}
                    {/* Listed, not hidden. This table is what the figures get
                        checked against, so a visit the dashboard left out has to
                        appear here saying so. */}
                    {r.automated && (
                      <span className="block text-[10px] text-muted-foreground">automated — not counted</span>
                    )}
                  </td>
                  <td className="py-1.5 text-foreground">{r.device}</td>
                  <td className="py-1.5 text-foreground break-all">{r.source}</td>
                  <td className="py-1.5 text-foreground break-all">{r.entry_path || "/"}</td>
                  <td className="py-1.5 text-foreground text-right" style={{ fontVariantNumeric: "tabular-nums" }}>
                    {fmtInt(r.pageviews)}
                  </td>
                  <td className="py-1.5 text-foreground text-right" style={{ fontVariantNumeric: "tabular-nums" }}>
                    {r.orders > 0 ? fmtEur(r.revenue) : "—"}
                  </td>
                  <td className="py-1.5 text-right">
                    {/* An account on the internal list is excluded by the list
                        itself, not by a mark on this visit, so this button
                        cannot release it. Saying so beats a control that
                        silently does nothing. */}
                    {(
                      <div className="flex flex-col items-end gap-1">
                        <button
                          type="button"
                          disabled={busy === r.session_id}
                          onClick={() => toggle(r)}
                          className="font-sans text-[11px] px-2 py-1.5 rounded-md border border-border bg-background hover:bg-muted disabled:opacity-50 whitespace-nowrap min-h-[36px]"
                        >
                          {r.excluded ? "Count it" : "This was me"}
                        </button>
                        {r.excluded && (
                          <span className="font-sans text-[10px] text-muted-foreground whitespace-nowrap">
                            {retireReason(r)}
                          </span>
                        )}
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="font-sans text-[11px] text-muted-foreground mt-3">
        Retiring a visit retires the browser that made it, including everything it recorded before
        now and anything it records later — the same rule the settings below use. Nothing here
        identifies anyone: a visit shows where the connection surfaced, not who was on it.
      </p>
      {note && <p className="font-sans text-[11px] text-muted-foreground mt-2">{note}</p>}
    </Card>
  );
};

// ── Panel ───────────────────────────────────────────────────────────────────────

const AnalyticsPanel = () => {
  const { pills, calendar } = useMemo(buildPeriods, []);
  const todayIso = useMemo(() => isoLocal(new Date()), []);
  const [period, setPeriod] = useState<Period>(pills[1]); // default: last 30 days
  const [device, setDevice] = useState("");
  const [source, setSource] = useState("");
  // "" means the server's default, which is PRODUCTION — the storefront on its
  // own. Deliberately not "all": the reader has to opt in to seeing anything
  // else, because these numbers get screenshotted.
  const [host, setHost] = useState("");
  // "" leaves automated visits out of every figure, which is the default. They
  // are counted and reported either way — see the note under the period caption.
  const [machines, setMachines] = useState("");
  const [attr, setAttr] = useState<"source" | "medium" | "campaign">("source");
  const [customOpen, setCustomOpen] = useState(false);
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [sourceOptions, setSourceOptions] = useState<string[]>([]);
  // Straight from the payload rather than accumulated like sourceOptions: the
  // server builds this list ignoring the host filter, so it is already complete
  // and does not need growing across loads.
  const [hostOptions, setHostOptions] = useState<AnalyticsOverview["hosts"]>([]);
  const [live, setLive] = useState<AnalyticsLive | null>(null);
  const [data, setData] = useState<AnalyticsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // Bumped by "Try again" — a failed load clears the screen, so there has to be
  // a way back that doesn't mean picking a different period and picking back.
  const [reloadKey, setReloadKey] = useState(0);

  // Visits in this window that the shop's view leaves out. Read off the hostname
  // list, which the server builds ignoring the current filter, so this is the
  // real remainder rather than a figure derived from the filtered set.
  const heldBack = useMemo(
    () => (data?.hosts ?? []).filter(h => h.host !== "production").reduce((n, h) => n + h.sessions, 0),
    [data],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getAdminAnalytics({ start: period.start, end: period.end, device: device || undefined, source: source || undefined, attr, host: host || undefined, machines: machines || undefined })
      .then(d => {
        if (cancelled) return;
        setData(d);
        setError("");
        setHostOptions(d.hosts ?? []);
        // Grow the source dropdown from unfiltered loads only, so picking a
        // source doesn't collapse the options to just itself. The table's two
        // synthetic rows — the "+ N more" fold and the carried-over bucket —
        // are not sources anyone can filter by, so they're kept out of it.
        if (!source && d.filters.attr === "source") {
          const real = d.sources.map(s => s.source).filter(s => !/^[(+]/.test(s));
          setSourceOptions(prev => [...new Set([...prev, ...real])].sort());
        }
      })
      .catch(err => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load analytics");
        // Drop what's on screen. It was measured over a DIFFERENT period, and
        // left in place under the newly-picked dates it is not stale data — it
        // is wrong data, indistinguishable from a real answer. A failed load
        // must look like a failed load.
        setData(null);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [period, device, source, attr, host, machines, reloadKey]);

  // Live "who's on the site now" — polled every 30s while the panel is open.
  useEffect(() => {
    let cancelled = false;
    const load = () => getAdminAnalyticsLive().then(l => { if (!cancelled) setLive(l); }).catch(() => {});
    load();
    const t = setInterval(load, 30_000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  // The window the figures on screen were actually measured over. Falls back to
  // the requested one only while the first load is in flight — there is nothing
  // on screen to mislabel then.
  const measured = data ? { start: data.start, end: data.end } : { start: period.start, end: period.end };

  const customInvalid =
    !customStart || !customEnd ? "" :
    customEnd < customStart ? "The end date is before the start date." :
    customStart > todayIso ? "That start date is in the future." : "";

  const applyCustom = () => {
    if (!customStart || !customEnd || customInvalid) return;
    // Never ask for days that haven't happened: an end date in the future adds
    // empty days to the window, which drags every per-day average down.
    const end = customEnd > todayIso ? todayIso : customEnd;
    setPeriod({ key: `custom-${customStart}-${end}`, label: "Custom range", start: customStart, end });
    setCustomOpen(false);
  };

  // Sessions the attribution table can place, and the ones it can't — see the
  // note under that table, and the caveat that ships with the CSV.
  const sourceSessions = data?.sources.reduce((n, s) => n + s.sessions, 0) ?? 0;
  // Sessions this window can see but cannot attribute: a visit that began before
  // it, or a confirmed sale whose browsing was never recorded. They are rows in
  // the table now rather than a hole in it — this is only for the note that
  // explains what those rows mean.
  const unattributedSessions = (data?.sources ?? [])
    .filter(s => /^\(visit began before|^\(source not recorded/.test(s.source))
    .reduce((n, s) => n + s.sessions, 0);

  // Everything currently on screen, as one spreadsheet-friendly CSV.
  const exportCsv = () => {
    if (!data) return;
    const esc = (v: unknown) => { const s = String(v ?? ""); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const lines: string[] = [];
    const section = (title: string, header: string[], rows: Array<Array<string | number>>) => {
      lines.push(title, header.map(esc).join(","));
      rows.forEach(r => lines.push(r.map(esc).join(",")));
      lines.push("");
    };
    const activeFilters = [data.filters.device && `device=${data.filters.device}`, data.filters.source && `source=${data.filters.source}`].filter(Boolean).join(" ") || "none";
    // Previous-period values ship alongside the current ones so the deltas on
    // screen can be re-derived from the file rather than taken on trust.
    section(
      `Olive Goose analytics ${data.start} to ${data.end} (${data.days}-day period, days in ${data.timezone}, filters: ${activeFilters})`,
      ["metric", "value", "previous period"],
      [
        ["Revenue EUR", data.sales.revenue, data.sales.prev.revenue],
        ["Orders", data.sales.orders, data.sales.prev.orders],
        ["Orders linked to a tracked session", data.sales.attributed_orders, ""],
        ["Average order value EUR", data.sales.aov, data.sales.prev.aov],
        ["Session conversion %", data.sales.conversion_rate, ""],
        ["Visitors", data.traffic.visitors, data.traffic.prev.visitors],
        ["Sessions", data.traffic.sessions, data.traffic.prev.sessions],
        ["Page views", data.traffic.pageviews, data.traffic.prev.pageviews],
        ["Engagement rate % (Google definition)", data.traffic.engagement_rate ?? "not measured", ""],
        ["Avg engagement time s (Google definition)", data.traffic.avg_engagement_seconds ?? "not measured", ""],
        ["Single-page no-interaction visits %", data.traffic.bounce_rate, ""],
        ["New visitors", data.traffic.new_visitors, ""], ["Returning visitors", data.traffic.returning_visitors, ""],
        ["Sessions reaching checkout", data.abandoned.checkout_sessions, ""],
        ["Abandoned at checkout", data.abandoned.abandoned_sessions, ""],
        ["Abandoned basket value EUR", data.abandoned.lost_revenue, ""],
        ...(data.signin_wall ? [
          ["Asked to sign in at checkout", data.signin_wall.walled_sessions, ""],
          ["…signed in and carried on", data.signin_wall.walled_continued, ""],
          ["…and bought", data.signin_wall.walled_purchased, ""],
          ["Basket value held up at sign-in EUR", data.signin_wall.blocked_basket_value, ""],
          ["Pressed checkout already signed in", data.signin_wall.passed_sessions, ""],
          ["…and bought", data.signin_wall.passed_purchased, ""],
        ] : []),
        ["Newsletter signups", data.accounts.newsletter_signups, ""],
        ["New accounts", data.accounts.account_signups, ""],
        ["Sign-ins", data.accounts.sign_ins, ""],
        ["Total customers", data.customers.total_customers, ""], ["New customers", data.customers.new_customers, ""],
        ["Avg lifetime value EUR", data.customers.avg_lifetime_value, ""],
      ]
    );
    for (const n of data.measurement_notes) {
      section("Measurement change", ["date", "note"], [[n.date, n.note]]);
    }
    // Every caveat the panel shows travels with the file. A spreadsheet gets
    // forwarded, quoted and totted up long after the screen it came from is
    // closed, so a figure that needs a qualifier has to carry it.
    if (data.sales.orders > data.sales.attributed_orders) {
      section("Caveat", ["note"], [[
        `${data.sales.orders - data.sales.attributed_orders} paid order(s) have no tracked session — funnel, session conversion, attribution and locations cover ${data.sales.attributed_orders} of ${data.sales.orders} orders.`,
      ]]);
    }
    if (data.clamped) {
      section("Caveat", ["note"], [[
        `The requested range was longer than two years, so it was measured from ${data.start} to ${data.end}.`,
      ]]);
    }
    if (unattributedSessions > 0) {
      section("Caveat", ["note"], [[
        `Attribution adds up to all ${data.traffic.sessions} sessions. ${unattributedSessions} of them could not be traced to a source — either the visit began before this period, or it is a confirmed sale with no browsing recorded — and each is on its own named row rather than missing from the table.`,
      ]]);
    }
    section("Caveat", ["note"], [[
      "Daily rows count each day's own unique visitors and sessions, so they add up to more than the period totals above.",
    ]]);
    section("Funnel", ["stage", "sessions"], data.funnel.map(f => [f.stage, f.sessions]));
    section("Daily", ["day", "visitors", "sessions", "pageviews", "orders", "revenue"], data.daily.map(r => [r.day, r.visitors, r.sessions, r.pageviews, r.orders, r.revenue]));
    section(
      "Top products (revenue after discount, excl. shipping)",
      ["product", "views", "sessions_adding", "sessions_removing", "view_to_cart_pct", "cart_to_buy_pct", "units", "revenue"],
      data.top_products.map(p => [
        p.name, p.views, p.add_to_carts, p.removals,
        p.view_to_cart_pct ?? "", p.cart_to_buy_pct ?? "",
        p.units, p.revenue,
      ]),
    );
    section(`Attribution by ${data.filters.attr}`, [data.filters.attr, "sessions", "orders", "revenue"], data.sources.map(s => [s.source, s.sessions, s.orders, s.revenue]));
    section("Top pages", ["path", "views", "sessions"], data.top_pages.map(p => [p.path, p.views, p.sessions]));
    section("Landing pages", ["path", "sessions", "purchased"],
      data.landing_pages.map(p => [p.path, p.sessions, p.purchased]));
    section("Searches", ["term", "searches", "sessions", "found_nothing"],
      data.searches.map(t => [t.term, t.searches, t.sessions, t.no_results]));
    section("Locations", ["city", "country", "sessions", "orders", "revenue"],
      data.locations.map(l => [l.city, l.country, l.sessions, l.orders, l.revenue]));
    section("Devices", ["device", "sessions"], data.devices.map(dv => [dv.device, dv.sessions]));
    section("Web vitals p75", ["metric", "p75", "samples"], data.web_vitals.map(v => [v.metric, v.p75, v.samples]));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" }));
    a.download = `analytics-${data.start}-to-${data.end}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const daily = useMemo(() => data?.daily ?? [], [data]);
  const hasTraffic = (data?.traffic.sessions ?? 0) > 0;

  return (
    <div>
      <div className="mb-8 pb-4 border-b border-border">
        <h2 className="font-serif text-2xl text-foreground">Analytics</h2>
        <p className="font-sans text-sm text-muted-foreground mt-1">
          The full customer journey — traffic, conversion, revenue, customers, and site performance. First-party tracking, no third-party scripts.
        </p>
      </div>

      {/* Filter rows — scope everything below them */}
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        {pills.map(p => (
          <button
            key={p.key}
            onClick={() => setPeriod(p)}
            className={`px-3.5 py-1.5 rounded-full font-sans text-xs font-semibold border transition-colors ${
              period.key === p.key
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-card text-muted-foreground border-border hover:text-foreground"
            }`}
          >
            {p.label}
          </button>
        ))}
        <select
          value={calendar.some(c => c.key === period.key) ? period.key : ""}
          onChange={e => { const p = calendar.find(c => c.key === e.target.value); if (p) setPeriod(p); }}
          className={`px-3 py-1.5 rounded-full font-sans text-xs font-semibold border focus:outline-none focus:ring-2 focus:ring-primary/40 ${
            calendar.some(c => c.key === period.key)
              ? "bg-primary text-primary-foreground border-primary"
              : "bg-card text-muted-foreground border-border"
          }`}
        >
          <option value="" disabled>Calendar period…</option>
          {calendar.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
        <button
          onClick={() => {
            // Open on the period already showing, so the first click gives you
            // something to adjust rather than two empty fields.
            if (!customOpen && !customStart && !customEnd) {
              setCustomStart(period.start);
              setCustomEnd(period.end);
            }
            setCustomOpen(o => !o);
          }}
          className={`px-3.5 py-1.5 rounded-full font-sans text-xs font-semibold border transition-colors ${
            period.key.startsWith("custom-")
              ? "bg-primary text-primary-foreground border-primary"
              : "bg-card text-muted-foreground border-border hover:text-foreground"
          }`}
        >
          Custom…
        </button>
        <span className="ml-auto flex items-center gap-3">
          {live && (
            <span
              className="flex items-center gap-1.5 font-sans text-xs font-semibold text-foreground"
              title={live.top_pages.length ? `Now on: ${live.top_pages.map(p => `${p.path} (${p.sessions})`).join(", ")}` : "No one browsing right now"}
            >
              <span className="w-2 h-2 rounded-full inline-block" style={{ background: live.active_sessions > 0 ? STATUS.good : "rgba(30,41,24,0.3)" }} />
              {live.active_sessions} active now
            </span>
          )}
          <button
            onClick={exportCsv}
            disabled={!data}
            className="px-3.5 py-1.5 rounded-full font-sans text-xs font-semibold border border-border bg-card text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            ⤓ Export CSV
          </button>
        </span>
      </div>

      {customOpen && (
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          {/* Both ends are capped at today. A future date isn't a smaller
              window, it's empty days folded into every average. */}
          <input type="date" aria-label="Start date" value={customStart} max={customEnd || todayIso}
            onChange={e => setCustomStart(e.target.value)}
            className="px-3 py-1.5 rounded-lg border border-border bg-card text-foreground font-sans text-xs focus:outline-none focus:ring-2 focus:ring-primary/40" />
          <span className="font-sans text-xs text-muted-foreground">to</span>
          <input type="date" aria-label="End date" value={customEnd} min={customStart || undefined} max={todayIso}
            onChange={e => setCustomEnd(e.target.value)}
            className="px-3 py-1.5 rounded-lg border border-border bg-card text-foreground font-sans text-xs focus:outline-none focus:ring-2 focus:ring-primary/40" />
          <button
            onClick={applyCustom}
            disabled={!customStart || !customEnd || !!customInvalid}
            className="px-3.5 py-1.5 rounded-full font-sans text-xs font-semibold bg-primary text-primary-foreground disabled:opacity-50"
          >
            Apply
          </button>
          {customInvalid && <span className="font-sans text-xs text-destructive">{customInvalid}</span>}
        </div>
      )}

      <div className="flex items-center gap-2 mb-2 flex-wrap">
        {/* First in the row on purpose: this decides WHOSE numbers the other two
            are slicing. Only rendered once more than one hostname has actually
            been recorded — on a shop that has only ever been visited through the
            storefront it is a control with one option, and a dropdown that
            cannot change anything is worse than no dropdown. */}
        {hostOptions.length > 1 && (
          <select value={host} onChange={e => setHost(e.target.value)}
            className="px-3 py-1.5 rounded-lg border border-border bg-card text-foreground font-sans text-xs focus:outline-none focus:ring-2 focus:ring-primary/40">
            <option value="">The shop (theolivegoose.ie)</option>
            {hostOptions.filter(h => h.host !== "production").map(h => (
              <option key={h.host} value={h.host}>
                {hostLabel(h.host)} — {fmtInt(h.sessions)} visit{h.sessions === 1 ? "" : "s"}
              </option>
            ))}
            <option value="all">Everything recorded</option>
          </select>
        )}
        <select value={device} onChange={e => setDevice(e.target.value)}
          className="px-3 py-1.5 rounded-lg border border-border bg-card text-foreground font-sans text-xs focus:outline-none focus:ring-2 focus:ring-primary/40">
          <option value="">All devices</option>
          <option value="desktop">Desktop</option>
          <option value="mobile">Mobile</option>
          <option value="tablet">Tablet</option>
        </select>
        <select value={source} onChange={e => setSource(e.target.value)}
          className="px-3 py-1.5 rounded-lg border border-border bg-card text-foreground font-sans text-xs focus:outline-none focus:ring-2 focus:ring-primary/40">
          <option value="">All sources</option>
          {sourceOptions.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        {(device || source || host) && (
          <button onClick={() => { setDevice(""); setSource(""); setHost(""); }}
            className="font-sans text-xs text-muted-foreground underline hover:text-foreground">
            Clear filters
          </button>
        )}
        {loading && data && <span className="font-sans text-xs text-muted-foreground ml-2">Updating…</span>}
      </div>

      {/* The dates below are the ones the SERVER measured, never the ones the
          picker is set to. They are usually the same — and on the one occasion
          they aren't (a range past the two-year cap), printing the request
          instead would label a shortened window with the dates the reader
          chose, and the missing months would read as a collapse in trade. */}
      <p className="font-sans text-xs text-muted-foreground mb-6">
        {period.label} · {fmtRange(measured.start, measured.end)}
        {data && <> — compared with the {data.days}-day period before it</>}
        {data?.timezone && <> · days run {data.timezone.replace("_", " ")} time</>}
        {device && <> · device: <span className="font-semibold text-foreground">{device}</span></>}
        {source && <> · source: <span className="font-semibold text-foreground">{source}</span></>}
        {data?.attributed && <> · limited to orders from matching sessions</>}
      </p>

      {/* How much this window is holding back, and why.
          A page that quietly shows 6 visits where the table holds 61 invites the
          reader to assume something is broken — and the one time to be asked that
          is never the time you are being asked it. So the figure says what it
          left out, names the reason, and offers the view that includes it. */}
      {/* Automated traffic, named and counted rather than quietly removed.
          Nine of these arrived on the live shop in three days — every one a
          single page view reporting five seconds of engagement to the
          millisecond, from a "mobile" device in a US city, at three in the
          morning. Left in, they made the shop look four times busier than it
          was and put a device split and a location map underneath it. */}
      {data && data.machine_sessions > 0 && (
        <p className="font-sans text-xs text-muted-foreground mb-6">
          {data.machines_included ? (
            <>
              {fmtInt(data.machine_sessions)} of the visits above {data.machine_sessions === 1 ? "is" : "are"}{" "}
              automated — a page fetched, then nothing: no rendering measurements, no clicks, no
              end of visit.{" "}
              <button type="button" onClick={() => setMachines("")} className="underline hover:text-foreground">
                Leave them out
              </button>
            </>
          ) : (
            <>
              {fmtInt(data.machine_sessions)} automated visit{data.machine_sessions === 1 ? "" : "s"}{" "}
              {data.machine_sessions === 1 ? "was" : "were"} left out — {data.machine_sessions === 1 ? "a page" : "pages"} fetched
              with no rendering measurements, no clicks and no end of visit. Scrapers, not shoppers.{" "}
              <button type="button" onClick={() => setMachines("include")} className="underline hover:text-foreground">
                Count them anyway
              </button>
            </>
          )}
        </p>
      )}

      {data && data.filters.host === "production" && heldBack > 0 && (
        <p className="font-sans text-xs text-muted-foreground mb-6">
          {fmtInt(heldBack)} more visit{heldBack === 1 ? "" : "s"} reached this window from somewhere
          other than the storefront — testing, or something that wasn't a browser — and {heldBack === 1 ? "is" : "are"} not
          counted above.{" "}
          <button type="button" onClick={() => setHost("all")} className="underline hover:text-foreground">
            Show everything recorded
          </button>
        </p>
      )}

      {/* Not a footnote. Every figure below moves when this changes, and a
          screenshot of this page carries no dropdown with it — so a view that is
          NOT the shop has to announce itself in the body of the page, where it
          cannot be cropped out by accident. */}
      {data && data.filters.host !== "production" && (
        <div className="rounded-xl border border-border bg-card p-4 mb-6">
          <p className="font-sans text-sm text-foreground">
            ⚠ These are not the shop's numbers.
          </p>
          <p className="font-sans text-xs text-muted-foreground mt-1">
            You are looking at <span className="font-semibold text-foreground">{hostLabel(data.filters.host)}</span>.
            Testing on your own machine is recorded here too, and it is not trade.
            {" "}
            <button type="button" onClick={() => setHost("")}
              className="underline hover:text-foreground">
              Show the shop only
            </button>
          </p>
        </div>
      )}

      {data?.clamped && (
        <div className="rounded-xl border border-border bg-card p-4 mb-6">
          <p className="font-sans text-sm text-foreground">
            ⓘ That range is longer than two years, so it was measured from {fmtRange(data.start, data.end)}.
          </p>
          <p className="font-sans text-xs text-muted-foreground mt-1">
            The figures below cover that shortened window — the earlier months are not missing trade, they were not asked for.
          </p>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-border bg-card p-4 mb-6">
          <p className="font-sans text-sm text-destructive">{error}</p>
          <p className="font-sans text-xs text-muted-foreground mt-1">
            Nothing is shown for {fmtRange(period.start, period.end)} — the last figures on screen were measured over a
            different period, so they've been cleared rather than left under these dates.
          </p>
          <button
            onClick={() => setReloadKey(k => k + 1)}
            className="mt-3 px-3.5 py-1.5 rounded-full font-sans text-xs font-semibold bg-primary text-primary-foreground"
          >
            Try again
          </button>
        </div>
      )}

      {!data && loading && <p className="font-sans text-sm text-muted-foreground">Loading analytics…</p>}

      {data && (
        // Hold the previous render at reduced opacity while a new range loads —
        // no skeleton flash, no layout jump.
        <div className="space-y-6" style={{ opacity: loading ? 0.55 : 1, transition: "opacity 0.15s" }}>

          {/* A metric whose definition moved mid-window is the one inaccuracy no
              query can fix: the step reads as shopper behaviour when it is only
              a change in what was being counted. Say it plainly, at the top. */}
          {data.measurement_notes.map(n => (
            <div key={n.date} className="rounded-xl border border-border bg-card p-4">
              <p className="font-sans text-sm text-foreground">
                ⓘ How something was measured changed on {n.date}, inside this date range.
              </p>
              <p className="font-sans text-xs text-muted-foreground mt-1">{n.note}</p>
              <p className="font-sans text-xs text-muted-foreground mt-1">
                Compare periods either side of that date with care — pick a range that starts after it for a like-for-like read.
              </p>
            </div>
          ))}

          {/* Every session-derived number (funnel, conversion, attribution) can
              only see orders that carry a tracked session. When some don't, say
              so with the exact count — an ops lead must never read a tracking
              gap as a fall in conversion. */}
          {data.sales.orders > data.sales.attributed_orders && (
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="font-sans text-sm text-foreground">
                ⚠ {fmtInt(data.sales.orders - data.sales.attributed_orders)} of {fmtInt(data.sales.orders)} paid orders
                aren't linked to a browsing session.
              </p>
              <p className="font-sans text-xs text-muted-foreground mt-1">
                Revenue, Orders, AOV and the customer figures are complete — they come from the orders table.
                The funnel, session conversion, attribution and location tables cover the {fmtInt(data.sales.attributed_orders)} linked
                {" "}order{data.sales.attributed_orders === 1 ? "" : "s"} only, so treat them as a floor, not a total.
              </p>
            </div>
          )}

          {!hasTraffic && (
            <div className="rounded-xl border border-border bg-card p-4">
              <p className="font-sans text-sm text-foreground">📡 Tracking is live — waiting for the first visitors.</p>
              <p className="font-sans text-xs text-muted-foreground mt-1">
                Events are recorded as people browse the storefront. Revenue and customer numbers below come from orders, so they're populated even before traffic data accumulates.
              </p>
            </div>
          )}

          {/* ── Sales KPIs ── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatTile label="Revenue" value={fmtCompactEur(data.sales.revenue)} prev={{ current: data.sales.revenue, previous: data.sales.prev.revenue }} sub="Charged total, less refunds and returns" />
            <StatTile label="Orders" value={fmtInt(data.sales.orders)} prev={{ current: data.sales.orders, previous: data.sales.prev.orders }} />
            <StatTile label="Average order value" value={fmtEur(data.sales.aov)} prev={{ current: data.sales.aov, previous: data.sales.prev.aov }} />
            <StatTile label="Session conversion" value={`${data.sales.conversion_rate}%`} sub="Sessions that ended in a purchase" />
          </div>

          {/* ── Traffic KPIs ── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatTile label="Visitors" value={fmtInt(data.traffic.visitors)} prev={{ current: data.traffic.visitors, previous: data.traffic.prev.visitors }} />
            <StatTile label="Sessions" value={fmtInt(data.traffic.sessions)} prev={{ current: data.traffic.sessions, previous: data.traffic.prev.sessions }} />
            <StatTile label="Page views" value={fmtInt(data.traffic.pageviews)} prev={{ current: data.traffic.pageviews, previous: data.traffic.prev.pageviews }} />
            {/* Google's engagement rate, shown in preference to bounce because it
                is the figure every benchmark a reader has seen is quoted in —
                and because bounce here means something narrower (a single page
                with no interaction), which invites a comparison that doesn't
                hold. Falls back to bounce for windows that predate the
                measurement rather than printing a confident 0%. */}
            {data.traffic.engagement_rate !== null ? (
              <StatTile
                label="Engagement rate"
                value={`${data.traffic.engagement_rate}%`}
                sub={`${data.traffic.avg_engagement_seconds !== null
                  ? fmtDuration(data.traffic.avg_engagement_seconds) : "—"} average engagement · ${data.traffic.pages_per_session} pages / session`}
              />
            ) : (
              <StatTile
                label="Bounce rate"
                value={`${data.traffic.bounce_rate}%`}
                invert
                sub={`${data.traffic.pages_per_session} pages / session · engagement not measured this period`}
              />
            )}
          </div>

          {/* ── Trends — two measures, two charts (never a dual axis) ── */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <Card title="Revenue" desc="Paid orders per day">
              <ResponsiveContainer width="100%" height={230}>
                <AreaChart data={daily} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke={GRID} vertical={false} />
                  <XAxis dataKey="day" {...axisProps} tickFormatter={fmtDay} minTickGap={28} />
                  <YAxis {...axisProps} tickFormatter={(v: number) => (v >= 1000 ? `€${(v / 1000).toFixed(1)}K` : `€${v}`)} width={56} />
                  <Tooltip content={<ChartTooltip fmt={fmtEur} />} />
                  <Area type="monotone" dataKey="revenue" name="Revenue" stroke={SERIES.blue} strokeWidth={2}
                    fill={SERIES.blue} fillOpacity={0.1}
                    activeDot={{ r: 4, fill: SERIES.blue, stroke: SURFACE, strokeWidth: 2 }} />
                </AreaChart>
              </ResponsiveContainer>
            </Card>

            <Card title="Traffic" desc="Unique visitors and sessions per day">
              <ResponsiveContainer width="100%" height={230}>
                <LineChart data={daily} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke={GRID} vertical={false} />
                  <XAxis dataKey="day" {...axisProps} tickFormatter={fmtDay} minTickGap={28} />
                  <YAxis {...axisProps} allowDecimals={false} width={40} />
                  <Tooltip content={<ChartTooltip fmt={fmtInt} />} />
                  <Line type="monotone" dataKey="sessions" name="Sessions" stroke={SERIES.blue} strokeWidth={2} dot={false}
                    activeDot={{ r: 4, fill: SERIES.blue, stroke: SURFACE, strokeWidth: 2 }} />
                  <Line type="monotone" dataKey="visitors" name="Visitors" stroke={SERIES.aqua} strokeWidth={2} dot={false}
                    activeDot={{ r: 4, fill: SERIES.aqua, stroke: SURFACE, strokeWidth: 2 }} />
                </LineChart>
              </ResponsiveContainer>
              <LegendKey items={[{ label: "Sessions", color: SERIES.blue }, { label: "Visitors", color: SERIES.aqua }]} />
              {/* Each day counts its own uniques, so the days deliberately add
                  up to more than the period: someone who came back on Tuesday
                  is one visitor in the tile and a visitor on both days here.
                  Without saying so, adding up the chart and finding it exceeds
                  the Visitors tile looks like one of the two is wrong. */}
              <p className="font-sans text-[11px] text-muted-foreground mt-3">
                Each day counts its own unique visitors and sessions, so the days add up to more than the
                period's totals — a visitor who returns is counted once above and on each day here.
              </p>
            </Card>
          </div>

          {/* ── Funnel + customers ── */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <Card title="Conversion funnel" desc="Where sessions drop off between landing and purchase">
              <Funnel stages={data.funnel} conversionRate={data.sales.conversion_rate} />
              <div className="mt-4 pt-4 border-t border-border grid grid-cols-3 gap-3">
                <div>
                  <p className="font-sans text-lg font-semibold text-foreground">{fmtInt(data.abandoned.abandoned_sessions)}</p>
                  <p className="font-sans text-xs text-muted-foreground">Abandoned at checkout</p>
                </div>
                <div>
                  <p className="font-sans text-lg font-semibold text-foreground">
                    {data.abandoned.checkout_sessions ? `${((data.abandoned.abandoned_sessions / data.abandoned.checkout_sessions) * 100).toFixed(1)}%` : "—"}
                  </p>
                  <p className="font-sans text-xs text-muted-foreground">Abandonment rate</p>
                </div>
                <div>
                  <p className="font-sans text-lg font-semibold text-foreground">{fmtEur(data.abandoned.lost_revenue)}</p>
                  <p className="font-sans text-xs text-muted-foreground">Basket value walked away</p>
                </div>
              </div>
              {/* Counted from the same predicate as the funnel's "Reached
                  checkout" stage, so the two can never disagree on screen. */}
              <p className="font-sans text-[11px] text-muted-foreground mt-3">
                Counted from everyone who reached the checkout page — the same sessions as “Reached checkout”
                above. The stages below it show how far into checkout they got before leaving.
              </p>

              {/* The cost of the one gate on the site. Shown only when sessions
                  actually went through it, so a window predating the event shows
                  nothing instead of a row of zeroes that reads as "no problem". */}
              {data.signin_wall && data.signin_wall.walled_sessions > 0 && (
                <div className="mt-4 pt-4 border-t border-border">
                  <p className="font-sans text-xs font-semibold text-foreground mb-2">Sign-in gate</p>
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <p className="font-sans text-lg font-semibold text-foreground">{fmtInt(data.signin_wall.walled_sessions)}</p>
                      <p className="font-sans text-xs text-muted-foreground">Asked to sign in</p>
                    </div>
                    <div>
                      <p className="font-sans text-lg font-semibold text-foreground">
                        {`${((1 - data.signin_wall.walled_continued / data.signin_wall.walled_sessions) * 100).toFixed(1)}%`}
                      </p>
                      <p className="font-sans text-xs text-muted-foreground">Turned back there</p>
                    </div>
                    <div>
                      <p className="font-sans text-lg font-semibold text-foreground">{fmtEur(data.signin_wall.blocked_basket_value)}</p>
                      <p className="font-sans text-xs text-muted-foreground">Basket value held up</p>
                    </div>
                  </div>
                  <p className="font-sans text-[11px] text-muted-foreground mt-3">
                    {fmtInt(data.signin_wall.walled_continued)} of {fmtInt(data.signin_wall.walled_sessions)} guests
                    signed in and carried on; {fmtInt(data.signin_wall.walled_purchased)} bought.
                    {data.signin_wall.passed_sessions > 0 && (
                      <> Shoppers already signed in when they pressed checkout: {fmtInt(data.signin_wall.passed_sessions)},
                      of whom {fmtInt(data.signin_wall.passed_purchased)} bought — the comparison that says whether the
                      gate itself is the obstacle.</>
                    )}
                  </p>
                </div>
              )}
            </Card>

            <Card title="Customers" desc="Lifetime customer base and what happened this period">
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
                {[
                  { label: "Total customers", value: fmtInt(data.customers.total_customers) },
                  { label: "New this period", value: fmtInt(data.customers.new_customers) },
                  { label: "Returning this period", value: fmtInt(data.customers.returning_customers) },
                  {
                    label: "Repeat purchase rate",
                    value: data.customers.total_customers
                      ? `${((data.customers.lifetime_repeat_customers / data.customers.total_customers) * 100).toFixed(1)}%`
                      : "—",
                  },
                  { label: "Avg lifetime value", value: fmtEur(data.customers.avg_lifetime_value) },
                  { label: "Avg orders / customer", value: String(data.customers.avg_orders_per_customer) },
                ].map(t => (
                  <div key={t.label} className="rounded-lg border border-border p-3">
                    <p className="font-sans text-xs text-muted-foreground">{t.label}</p>
                    <p className="font-sans text-lg font-semibold text-foreground mt-0.5">{t.value}</p>
                  </div>
                ))}
              </div>
              <p className="font-sans text-[11px] text-muted-foreground mt-3">
                New vs returning by first paid order; repeat rate is customers with 2+ lifetime orders.
                {data.attributed && " Customer metrics are account-based and ignore the device/source filters."}
              </p>
            </Card>
          </div>

          {/* ── Top products / sources ── */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <Card title="Top products" desc="Views → cart → sale for each product, with revenue after discount">
              <DataTable
                cols={[
                  { label: "Product" },
                  { label: "Views", align: "right" },
                  { label: "Carts", align: "right" },
                  { label: "Put back", align: "right" },
                  { label: "View→cart", align: "right" },
                  { label: "Cart→buy", align: "right" },
                  { label: "Revenue", align: "right" },
                ]}
                rows={data.top_products.map(p => [
                  p.name,
                  fmtInt(p.views),
                  fmtInt(p.add_to_carts),
                  // Sessions that took it back out of the basket. Recorded from
                  // day one and shown nowhere until now — it separates "nobody
                  // wants this" from "they wanted it until they saw the price".
                  p.removals > 0 ? fmtInt(p.removals) : "—",
                  // A null rate means the stage below it had no traffic, so the
                  // rate is unknown — shown as "—". Printing 0% instead would
                  // read as "everyone who looked rejected it", which is a very
                  // different message from "nobody looked".
                  p.view_to_cart_pct == null ? "—" : `${p.view_to_cart_pct}%`,
                  p.cart_to_buy_pct == null ? "—" : `${p.cart_to_buy_pct}%`,
                  fmtEur(p.revenue),
                ])}
                empty="No product views, carts or paid orders in this period yet."
              />
              <p className="font-sans text-[11px] text-muted-foreground mt-3">
                View→cart is the share of sessions that saw the product page and added it; cart→buy is the share
                of those that went on to pay. A low view→cart means the page isn't convincing; a healthy
                view→cart with a low cart→buy means the loss is at checkout, not on the product.
                Carts can exceed views — a product added straight from the shop grid never opens its own page —
                so the rates count only the sessions that did both, and stay shares.
                “Put back” is sessions that removed it from the basket again: a high number next to a healthy
                cart→buy usually means the price or delivery cost, not the product.
                Revenue shares each order's discount across its lines, so it adds up to Revenue minus shipping.
              </p>
            </Card>

            <Card title="Attribution" desc="Where sessions came from, and the revenue each produced">
              <div className="flex items-center gap-1.5 mb-3">
                {(["source", "medium", "campaign"] as const).map(a => (
                  <button
                    key={a}
                    onClick={() => setAttr(a)}
                    className={`px-2.5 py-1 rounded-full font-sans text-[11px] font-semibold border capitalize transition-colors ${
                      attr === a
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-card text-muted-foreground border-border hover:text-foreground"
                    }`}
                  >
                    {a}
                  </button>
                ))}
              </div>
              <DataTable
                cols={[{ label: attr[0].toUpperCase() + attr.slice(1) }, { label: "Sessions", align: "right" }, { label: "Orders", align: "right" }, { label: "Revenue", align: "right" }]}
                rows={data.sources.map(s => [s.source, fmtInt(s.sessions), fmtInt(s.orders), fmtEur(s.revenue)])}
                empty="No sessions recorded in this period yet."
              />
              {/* This column totals to the Sessions tile, including the visits
                  it cannot trace — a visit that began before this period, or a
                  confirmed sale with no browsing recorded. Both are named rows
                  rather than absences. The note explains what those rows are,
                  because "(source not recorded)" sitting in a table of Instagram
                  and Google is otherwise just unexplained. */}
              {unattributedSessions > 0 && (
                <p className="font-sans text-[11px] text-muted-foreground mt-3">
                  Adds up to all {fmtInt(data.traffic.sessions)} sessions.{" "}
                  {fmtInt(unattributedSessions)} of them can't be traced to a source — the visit began
                  before this period, or it's a confirmed sale with no browsing recorded — so each sits
                  on its own row rather than going missing.
                </p>
              )}
            </Card>
          </div>

          {/* ── Pages + devices + audience ── */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="space-y-4">
              <Card title="Top pages" desc="Most-viewed storefront pages">
                <DataTable
                  cols={[{ label: "Page" }, { label: "Views", align: "right" }, { label: "Sessions", align: "right" }]}
                  // A dash on the fold row's Sessions: per-page session counts
                  // overlap (one visitor reads several pages), so they cannot be
                  // added up. Views can, and do, total to the Page views tile.
                  rows={data.top_pages.map(p => [
                    p.path || "/", fmtInt(p.views),
                    p.sessions === null ? "—" : fmtInt(p.sessions),
                  ])}
                  empty="No page views recorded in this period yet."
                />
              </Card>

              {/* Where visits BEGIN — a different question from which pages get
                  looked at most, and routinely a different answer. Top pages is
                  dominated by whatever everyone passes through; this is the front
                  door, and the conversion column is what says a page brings
                  people who buy rather than merely people. */}
              <Card title="Landing pages" desc="Where visits start, and how often they end in a sale">
                <DataTable
                  cols={[{ label: "First page seen" }, { label: "Sessions", align: "right" }, { label: "Bought", align: "right" }, { label: "Converted", align: "right" }]}
                  rows={data.landing_pages.map(p => [
                    p.path || "/", fmtInt(p.sessions), fmtInt(p.purchased),
                    // A dash, not 0%. With no sales from a page the rate is
                    // "none yet", and on a handful of sessions that is not the
                    // same statement as "this page doesn't convert".
                    p.purchased > 0 ? `${((p.purchased / p.sessions) * 100).toFixed(1)}%` : "—",
                  ])}
                  empty="No landing pages recorded in this period yet."
                />
              </Card>

              {/* Where visitors are. Revenue sits beside sessions because the two
                  rankings routinely disagree, and the interesting decisions —
                  where to advertise, which delivery zones to add — hang on the
                  difference between somewhere busy and somewhere that buys. */}
              <Card title="Where visitors are" desc="Sessions and revenue by city">
                <DataTable
                  cols={[{ label: "Location" }, { label: "Sessions", align: "right" }, { label: "Orders", align: "right" }, { label: "Revenue", align: "right" }]}
                  // The country is printed even when the city is unknown. Rows
                  // are grouped by city AND country, so hiding it rendered a
                  // known-country-unknown-city visit as a second row labelled
                  // plain "Unknown" — two rows, the same label, different
                  // numbers, and no way to tell which was which. "Unknown, DE"
                  // says exactly what is and isn't known.
                  rows={data.locations.map(l => [
                    `${l.city}${l.country ? `, ${l.country}` : ""}`,
                    fmtInt(l.sessions), fmtInt(l.orders), fmtEur(l.revenue),
                  ])}
                  empty="No locations recorded in this period yet."
                />
                <p className="font-sans text-[11px] text-muted-foreground mt-3">
                  Worked out at the edge of the network from the connection itself — no visitor's IP
                  address is looked up, sent anywhere or stored. “Unknown” is a visit that reached the
                  shop without passing through it, which includes anything before this was switched on.
                </p>
                {/* The caveat that turns a confusing row into a readable one. A
                    location is where the CONNECTION surfaced, which is not always
                    where the person was — and the commonest cause of a surprising
                    city is the shop's own laptop on a VPN, which also walks past
                    the home-network rule below for exactly the same reason. */}
                <p className="font-sans text-[11px] text-muted-foreground mt-2">
                  This is where the connection surfaced, not necessarily where the person was: a VPN
                  reports the city it exits in. If a city here looks like one of your own visits,
                  retire it in “Recent visits” below — excluding your wifi cannot catch a visit that
                  did not arrive on it.
                </p>
              </Card>

              {/* The only place a shopper says what they wanted in their own
                  words. A term that finds nothing leaves no other trace anywhere
                  on this page: no product row, no lost basket, no funnel step —
                  the visit just ends, and the day reads as normally quiet. */}
              <Card title="What shoppers search for" desc="Terms typed into the search box, and how many found nothing">
                <DataTable
                  cols={[{ label: "Search" }, { label: "Searches", align: "right" }, { label: "Sessions", align: "right" }, { label: "Found nothing", align: "right" }]}
                  rows={data.searches.map(t => [
                    t.term, fmtInt(t.searches),
                    // A dash on the fold row: one visitor searches several
                    // times, so per-term session counts overlap and adding them
                    // would print more searchers than there were people.
                    t.sessions === null ? "—" : fmtInt(t.sessions),
                    // A dash, not a 0. Zero empty searches is the good outcome
                    // and should read as calm rather than as another number to
                    // scan past.
                    t.no_results > 0 ? `${fmtInt(t.no_results)}` : "—",
                  ])}
                  empty="No searches in this period yet."
                />
                {data.searches.some(t => t.no_results > 0) && (
                  <p className="font-sans text-[11px] text-muted-foreground mt-3">
                    A search that finds nothing is either a product to stock or a word your own
                    listings don't use for something you already sell. Both are fixable today.
                  </p>
                )}
              </Card>
            </div>

            <div className="space-y-4">
              <Card title="Devices" desc="Session share by the device the browser reports">
                <DeviceSplit devices={data.devices} />
                <p className="font-sans text-[11px] text-muted-foreground mt-3">
                  Read from each visit's browser identification, not the window size — a desktop
                  browser in a narrow window is a desktop.
                </p>
              </Card>
              {/* Joining the list, opening an account, coming back to sign in.
                  All three were recorded from the first day and lived only
                  inside the bounce rule — used as evidence that SOMETHING
                  deliberate happened, with the number itself discarded. The
                  newsletter one is what a shop can act on when a month is quiet:
                  the audience either kept growing or it didn't. */}
              <Card title="Sign-ups" desc="People joining the list, opening an account, or coming back">
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <p className="font-sans text-lg font-semibold text-foreground">{fmtInt(data.accounts.newsletter_signups)}</p>
                    <p className="font-sans text-xs text-muted-foreground">Joined the list</p>
                  </div>
                  <div>
                    <p className="font-sans text-lg font-semibold text-foreground">{fmtInt(data.accounts.account_signups)}</p>
                    <p className="font-sans text-xs text-muted-foreground">New accounts</p>
                  </div>
                  <div>
                    <p className="font-sans text-lg font-semibold text-foreground">{fmtInt(data.accounts.sign_ins)}</p>
                    <p className="font-sans text-xs text-muted-foreground">Sign-ins</p>
                  </div>
                </div>
                <p className="font-sans text-[11px] text-muted-foreground mt-3">
                  Counted once per visit, so a form submitted twice because the first press didn't look like it
                  worked is one person. Sign-ins count returning customers, not new ones.
                </p>
              </Card>

              <Card title="Audience" desc="Visitor mix in this period">
                <div className="flex items-center gap-6">
                  <div>
                    <p className="font-sans text-lg font-semibold text-foreground">{fmtInt(data.traffic.new_visitors)}</p>
                    <p className="font-sans text-xs text-muted-foreground">New visitors</p>
                  </div>
                  <div>
                    <p className="font-sans text-lg font-semibold text-foreground">{fmtInt(data.traffic.returning_visitors)}</p>
                    <p className="font-sans text-xs text-muted-foreground">Returning visitors</p>
                  </div>
                </div>
                {/* Without this, "Returning visitors" reads as a complete count.
                    It isn't. Recognising someone means finding an id their
                    browser kept, and a browser that refuses to keep one — private
                    mode, storage-blocking extensions — makes the same person new
                    on every visit. This no longer tracks the cookie answer: the
                    id is persistent for everyone, because first-party audience
                    measurement doesn't depend on consent. */}
                {data.traffic.identified_visitor_pct !== null && data.traffic.identified_visitor_pct < 100 && (
                  <p className="font-sans text-[11px] text-muted-foreground mt-3">
                    Only {data.traffic.identified_visitor_pct}% of visitors' browsers kept an id that
                    survives the tab, so the rest count as new every time. “Returning” is a floor and
                    “new” is an over-count.
                  </p>
                )}
              </Card>
            </div>
          </div>

          {/* ── Web performance ── */}
          <Card title="Site performance" desc="Core Web Vitals measured on real visits (p75)">
            <WebVitals vitals={data.web_vitals} byPage={data.web_vitals_by_page} />
          </Card>

          {/* ── What these numbers are counting ── */}
          <RecentVisits onChanged={() => setReloadKey(k => k + 1)} />
          <InternalTraffic />
        </div>
      )}
    </div>
  );
};

export default AnalyticsPanel;
