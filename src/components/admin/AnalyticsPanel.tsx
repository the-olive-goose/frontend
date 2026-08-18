import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer, AreaChart, Area, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";
import {
  getAdminAnalytics, getAdminAnalyticsLive,
  getAnalyticsInternal, saveAnalyticsInternal, setAnalyticsInternalBrowser,
  type AnalyticsOverview, type AnalyticsLive, type AnalyticsInternal,
} from "@/lib/api";
import { getVisitorId, isInternalBrowser, setInternalBrowser } from "@/lib/analytics";

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
// The honest caveat on every visitor number: a "visitor" is an id in a browser's
// localStorage, so the same person is a new visitor on a new device, in a private
// window, or after clearing site data — and testing the shop means doing all
// three. Without a way to say "that was me", an hour of the owner's own testing
// reads as a small rush of shoppers.
//
// Both controls key on the visitor, so switching either on removes what that
// browser or account already sent, not just what it sends next.
const InternalTraffic = () => {
  const [state, setState] = useState<AnalyticsInternal | null>(null);
  const [thisBrowser, setThisBrowser] = useState(isInternalBrowser);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => {
    getAnalyticsInternal().then(setState).catch(() => setNote("Couldn't load these settings."));
  }, []);

  // The patch shape is the API function's, not a narrower copy of it: this had
  // dropped `visitor_id`, which the call below passes and the API and backend
  // both honour. It reached the server anyway — an excess property survives at
  // runtime — so the only symptom was a type error saying the field could not
  // be sent when in fact it was.
  const save = async (patch: Parameters<typeof saveAnalyticsInternal>[0], message: string) => {
    setBusy(true);
    try {
      const saved = await saveAnalyticsInternal(patch);
      setState(s => (s ? {
        ...s, emails: saved.emails, networks: saved.networks,
        current_ip_excluded: saved.networks.includes(s.current_ip),
      } : s));
      setNote(message);
    } catch {
      setNote("Couldn't save that.");
    } finally { setBusy(false); }
  };

  const saveEmails = (emails: string[]) =>
    save({ emails }, "Saved. Reload to see the numbers without them.");

  const toggleBrowser = async () => {
    const next = !thisBrowser;
    setBusy(true);
    try {
      // Server first: the flag below only stops FUTURE batches, while this is
      // what retires the events this browser has already sent.
      await setAnalyticsInternalBrowser(getVisitorId(), next);
      setInternalBrowser(next);
      setThisBrowser(next);
      setNote(next
        ? "This browser no longer counts as a shopper, including what it recorded before now."
        : "This browser counts as a shopper again.");
    } catch {
      setNote("Couldn't update this browser.");
    } finally { setBusy(false); }
  };

  const strayOrigins = (state?.origins_seen ?? []).filter(
    o => o.origin !== "(not recorded)" && !state?.counted_origins.includes(o.origin)
  );

  return (
    <Card title="Whose visits count" desc="Keep the shop's own testing out of the numbers">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="max-w-md">
          <p className="font-sans text-sm font-semibold text-foreground">This browser</p>
          <p className="font-sans text-[11px] text-muted-foreground mt-1">
            {thisBrowser
              ? "Not counted. Anything it browses is treated as your own testing."
              : "Counted as a shopper. Turn this on for any browser you test the shop in."}
            {" "}Clearing this browser's site data forgets the setting.
          </p>
        </div>
        <button
          type="button"
          onClick={toggleBrowser}
          disabled={busy}
          className="font-sans text-xs px-3 py-2 rounded-md border border-border bg-background hover:bg-muted disabled:opacity-50 min-h-[44px]"
        >
          {thisBrowser ? "Count this browser again" : "Don't count this browser"}
        </button>
      </div>

      {/* The broadest signal, and the only one that covers someone else in the
          house: a home connection is one address for every device on it, so this
          catches phones and tablets that never sign in and never open admin. */}
      <div className="mt-5 pt-5 border-t border-border">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="max-w-md">
            <p className="font-sans text-sm font-semibold text-foreground">Your network</p>
            <p className="font-sans text-[11px] text-muted-foreground mt-1">
              {/* Blank means the request didn't come through the live site's edge,
                  which is the only thing that can tell one visitor's network from
                  another. Saying so beats offering a button that would store a
                  loopback or proxy address and quietly protect nothing. */}
              {!state?.current_ip
                ? <>Your network can't be identified from here — this only works on the live shop at its real address, not on a local or preview copy. Open the admin there to exclude your wifi.</>
                : state.current_ip_excluded
                  ? <>You're on <span className="font-mono">{state.current_ip}</span>, which is already excluded — every device on it, for everyone in the house.</>
                  : <>You're on <span className="font-mono">{state.current_ip}</span>. Excluding it covers every device on this wifi without anyone having to sign in. Each device drops out, and loses the visits it already recorded, the next time it loads the shop.</>}
              {!!state?.current_ip && <>{" "}Home broadband addresses change from time to time; if visits from home start counting again, add the new one here.</>}
            </p>
          </div>
          {state?.current_ip && (
            <button
              type="button"
              disabled={busy}
              // The visitor id goes with it so this browser's own past visits
              // clear immediately; other devices on the wifi clear theirs the
              // next time they load the shop.
              onClick={() => (state.current_ip_excluded
                ? save({ networks: state.networks.filter(n => n !== state.current_ip) }, "This network counts as shopper traffic again.")
                : save({ networks: [...new Set([...state.networks, state.current_ip])], visitor_id: getVisitorId() },
                       "Excluded. Other devices on this wifi drop out as each one next loads the shop."))}
              className="font-sans text-xs px-3 py-2 rounded-md border border-border bg-background hover:bg-muted disabled:opacity-50 min-h-[44px]"
            >
              {state.current_ip_excluded ? "Count this network again" : "Don't count this network"}
            </button>
          )}
        </div>
        {!!state?.networks.length && (
          <ul className="mt-3 space-y-1">
            {state.networks.map(net => (
              <li key={net} className="flex items-center justify-between gap-3">
                <span className="font-mono text-xs text-foreground break-all">
                  {net}{net === state.current_ip && <span className="font-sans text-muted-foreground"> — you're on this one</span>}
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => save({ networks: state.networks.filter(n => n !== net) }, "Removed.")}
                  className="font-sans text-[11px] text-muted-foreground hover:text-foreground underline shrink-0"
                >
                  remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="font-sans text-[11px] text-muted-foreground mt-2">
          No visitor's IP address is ever stored — an address is checked against this list as
          the visit arrives and then discarded.
        </p>
      </div>

      <div className="mt-5 pt-5 border-t border-border">
        <p className="font-sans text-sm font-semibold text-foreground">Your own accounts</p>
        <p className="font-sans text-[11px] text-muted-foreground mt-1">
          Signing in with one of these marks that browser as yours — which is why a test
          checkout stops counting from its first page view, not from the sign-in.
        </p>
        <ul className="mt-3 space-y-1">
          {(state?.emails ?? []).map(email => (
            <li key={email} className="flex items-center justify-between gap-3">
              <span className="font-sans text-xs text-foreground break-all">{email}</span>
              <button
                type="button"
                disabled={busy}
                onClick={() => saveEmails((state?.emails ?? []).filter(e => e !== email))}
                className="font-sans text-[11px] text-muted-foreground hover:text-foreground underline shrink-0"
              >
                remove
              </button>
            </li>
          ))}
          {state && !state.emails.length && (
            <li className="font-sans text-xs text-muted-foreground">No accounts excluded.</li>
          )}
        </ul>
        <div className="flex gap-2 mt-3">
          <input
            type="email"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            placeholder="you@example.com"
            className="flex-1 min-w-0 font-sans text-base sm:text-xs px-3 py-2 rounded-md border border-border bg-background"
          />
          <button
            type="button"
            disabled={busy || !draft.includes("@")}
            onClick={() => { saveEmails([...new Set([...(state?.emails ?? []), draft.toLowerCase().trim()])]); setDraft(""); }}
            className="font-sans text-xs px-3 py-2 rounded-md border border-border bg-background hover:bg-muted disabled:opacity-50 shrink-0 min-h-[44px]"
          >
            Add
          </button>
        </div>
      </div>

      {/* The other way one person becomes several: localStorage is per-origin, so
          the same shop on a second hostname mints a second visitor for everyone
          who opens it. Ingestion already refuses those, but seeing them is what
          explains a historic count that looks too high. */}
      {!!strayOrigins.length && (
        <div className="mt-5 pt-5 border-t border-border">
          <p className="font-sans text-sm font-semibold text-foreground">Other addresses seen</p>
          <p className="font-sans text-[11px] text-muted-foreground mt-1">
            Events arrived from these in the last 90 days. They're no longer counted — only{" "}
            {state?.counted_origins.join(" and ")} is. Each one gave every person who used it a
            separate visitor id, so older totals include those duplicates.
          </p>
          <ul className="mt-2 space-y-1">
            {strayOrigins.map(o => (
              <li key={o.origin} className="font-sans text-xs text-muted-foreground break-all">
                {o.origin} — {fmtInt(o.visitors)} visitor{o.visitors === 1 ? "" : "s"}, {fmtInt(o.events)} events
              </li>
            ))}
          </ul>
        </div>
      )}

      {note && <p className="font-sans text-[11px] text-muted-foreground mt-4">{note}</p>}
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
  const [attr, setAttr] = useState<"source" | "medium" | "campaign">("source");
  const [customOpen, setCustomOpen] = useState(false);
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [sourceOptions, setSourceOptions] = useState<string[]>([]);
  const [live, setLive] = useState<AnalyticsLive | null>(null);
  const [data, setData] = useState<AnalyticsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // Bumped by "Try again" — a failed load clears the screen, so there has to be
  // a way back that doesn't mean picking a different period and picking back.
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getAdminAnalytics({ start: period.start, end: period.end, device: device || undefined, source: source || undefined, attr })
      .then(d => {
        if (cancelled) return;
        setData(d);
        setError("");
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
  }, [period, device, source, attr, reloadKey]);

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
  const carriedOverSessions = Math.max((data?.traffic.sessions ?? 0) - sourceSessions, 0);

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
        ["Bounce rate %", data.traffic.bounce_rate, ""],
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
    if (carriedOverSessions > 0) {
      section("Caveat", ["note"], [[
        `Attribution covers ${sourceSessions} of ${data.traffic.sessions} sessions — the other ${carriedOverSessions} began before this period and have no source inside it. Their orders are on the "(visit began before this period)" row.`,
      ]]);
    }
    section("Caveat", ["note"], [[
      "Daily rows count each day's own unique visitors and sessions, so they add up to more than the period totals above.",
    ]]);
    section("Funnel", ["stage", "sessions"], data.funnel.map(f => [f.stage, f.sessions]));
    section("Daily", ["day", "visitors", "sessions", "pageviews", "orders", "revenue"], data.daily.map(r => [r.day, r.visitors, r.sessions, r.pageviews, r.orders, r.revenue]));
    section(
      "Top products (revenue after discount, excl. shipping)",
      ["product", "views", "sessions_adding", "view_to_cart_pct", "cart_to_buy_pct", "units", "revenue"],
      data.top_products.map(p => [
        p.name, p.views, p.add_to_carts,
        p.view_to_cart_pct ?? "", p.cart_to_buy_pct ?? "",
        p.units, p.revenue,
      ]),
    );
    section(`Attribution by ${data.filters.attr}`, [data.filters.attr, "sessions", "orders", "revenue"], data.sources.map(s => [s.source, s.sessions, s.orders, s.revenue]));
    section("Top pages", ["path", "views", "sessions"], data.top_pages.map(p => [p.path, p.views, p.sessions]));
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
        {(device || source) && (
          <button onClick={() => { setDevice(""); setSource(""); }}
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
            <StatTile label="Bounce rate" value={`${data.traffic.bounce_rate}%`} invert sub={`${data.traffic.pages_per_session} pages / session`} />
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
                  { label: "View→cart", align: "right" },
                  { label: "Cart→buy", align: "right" },
                  { label: "Revenue", align: "right" },
                ]}
                rows={data.top_products.map(p => [
                  p.name,
                  fmtInt(p.views),
                  fmtInt(p.add_to_carts),
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
              {/* A session is attributed to where it LANDED, so a visit that
                  began before this period has no source inside it. Its orders
                  are still in the table (see the row for them) but its session
                  is not, which leaves this column short of the Sessions tile by
                  exactly that many. Printing the difference is the only way a
                  reader can tell that apart from a table that lost rows. */}
              {carriedOverSessions > 0 && (
                <p className="font-sans text-[11px] text-muted-foreground mt-3">
                  Adds up to {fmtInt(sourceSessions)} of the {fmtInt(data.traffic.sessions)} sessions —
                  the other {fmtInt(carriedOverSessions)} began before this period, so they have no source
                  inside it. Anything they bought is still counted, on its own row.
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
                  rows={data.top_pages.map(p => [p.path || "/", fmtInt(p.views), fmtInt(p.sessions)])}
                  empty="No page views recorded in this period yet."
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
          <InternalTraffic />
        </div>
      )}
    </div>
  );
};

export default AnalyticsPanel;
