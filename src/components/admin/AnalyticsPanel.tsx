import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer, AreaChart, Area, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";
import { getAdminAnalytics, getAdminAnalyticsLive, type AnalyticsOverview, type AnalyticsLive } from "@/lib/api";

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
  if (prev && prev.previous > 0) {
    const pct = ((prev.current - prev.previous) / prev.previous) * 100;
    if (Number.isFinite(pct)) {
      const up = pct >= 0;
      delta = {
        text: `${up ? "↑" : "↓"} ${Math.abs(pct).toFixed(1)}% vs previous period`,
        good: invert ? !up : up,
      };
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
      {!delta && sub && <p className="font-sans text-xs text-muted-foreground mt-1">{sub}</p>}
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
const Funnel = ({ stages }: { stages: AnalyticsOverview["funnel"] }) => {
  const max = Math.max(stages[0]?.sessions ?? 0, 1);
  return (
    <div className="space-y-3">
      {stages.map((s, i) => {
        const widthPct = Math.max((s.sessions / max) * 100, s.sessions > 0 ? 2 : 0);
        const prev = i > 0 ? stages[i - 1].sessions : 0;
        const stepRate = i > 0 && prev > 0 ? (s.sessions / prev) * 100 : null;
        return (
          <div key={s.stage} className="grid grid-cols-[130px_1fr] items-center gap-3">
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
                  background: FUNNEL_RAMP[i],
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
      <p className="font-sans text-[11px] text-muted-foreground pt-1">
        Distinct sessions reaching each stage. Overall conversion:{" "}
        <span className="font-semibold text-foreground">
          {max > 0 ? ((stages[4]?.sessions ?? 0) / max * 100).toFixed(2) : "0"}%
        </span>
      </p>
    </div>
  );
};

// ── Devices — part-to-whole as one stacked horizontal bar + legend ─────────────
const DeviceSplit = ({ devices }: { devices: AnalyticsOverview["devices"] }) => {
  const order = ["desktop", "mobile", "tablet"];
  const colors = [SERIES.blue, SERIES.aqua, SERIES.yellow];
  const sorted = [...devices].sort((a, b) => order.indexOf(a.device) - order.indexOf(b.device));
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

const WebVitals = ({ vitals }: { vitals: AnalyticsOverview["web_vitals"] }) => {
  const known = vitals.filter(v => VITAL_META[v.metric]);
  if (!known.length) return <p className="font-sans text-xs text-muted-foreground">No performance samples yet — vitals are collected as real visitors browse.</p>;
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {["LCP", "CLS", "INP", "TTFB"].map(key => {
        const v = known.find(x => x.metric === key);
        if (!v) return null;
        const meta = VITAL_META[key];
        const rating = v.p75 <= meta.good ? "Good" : v.p75 <= meta.poor ? "Needs work" : "Poor";
        const color = rating === "Good" ? STATUS.good : rating === "Needs work" ? STATUS.serious : STATUS.critical;
        const icon = rating === "Good" ? "✓" : rating === "Needs work" ? "△" : "✕";
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

// ── Panel ───────────────────────────────────────────────────────────────────────

const AnalyticsPanel = () => {
  const { pills, calendar } = useMemo(buildPeriods, []);
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

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getAdminAnalytics({ start: period.start, end: period.end, device: device || undefined, source: source || undefined, attr })
      .then(d => {
        if (cancelled) return;
        setData(d);
        setError("");
        // Grow the source dropdown from unfiltered loads only, so picking a
        // source doesn't collapse the options to just itself.
        if (!source && d.filters.attr === "source") {
          setSourceOptions(prev => [...new Set([...prev, ...d.sources.map(s => s.source)])].sort());
        }
      })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load analytics"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [period, device, source, attr]);

  // Live "who's on the site now" — polled every 30s while the panel is open.
  useEffect(() => {
    let cancelled = false;
    const load = () => getAdminAnalyticsLive().then(l => { if (!cancelled) setLive(l); }).catch(() => {});
    load();
    const t = setInterval(load, 30_000);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  const applyCustom = () => {
    if (!customStart || !customEnd || customEnd < customStart) return;
    setPeriod({ key: `custom-${customStart}-${customEnd}`, label: "Custom range", start: customStart, end: customEnd });
  };

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
    section(`Olive Goose analytics ${data.start} to ${data.end} (filters: ${activeFilters})`, ["metric", "value"], [
      ["Revenue EUR", data.sales.revenue], ["Orders", data.sales.orders], ["Average order value EUR", data.sales.aov],
      ["Session conversion %", data.sales.conversion_rate],
      ["Visitors", data.traffic.visitors], ["Sessions", data.traffic.sessions], ["Page views", data.traffic.pageviews],
      ["Bounce rate %", data.traffic.bounce_rate], ["New visitors", data.traffic.new_visitors], ["Returning visitors", data.traffic.returning_visitors],
      ["Checkout sessions", data.abandoned.checkout_sessions], ["Abandoned checkouts", data.abandoned.abandoned_sessions], ["Abandoned basket value EUR", data.abandoned.lost_revenue],
      ["Total customers", data.customers.total_customers], ["New customers", data.customers.new_customers],
      ["Avg lifetime value EUR", data.customers.avg_lifetime_value],
    ]);
    section("Funnel", ["stage", "sessions"], data.funnel.map(f => [f.stage, f.sessions]));
    section("Daily", ["day", "visitors", "sessions", "pageviews", "orders", "revenue"], data.daily.map(r => [r.day, r.visitors, r.sessions, r.pageviews, r.orders, r.revenue]));
    section("Top products", ["product", "units", "revenue", "adds_to_cart"], data.top_products.map(p => [p.name, p.units, p.revenue, p.add_to_carts]));
    section(`Attribution by ${data.filters.attr}`, [data.filters.attr, "sessions", "orders", "revenue"], data.sources.map(s => [s.source, s.sessions, s.orders, s.revenue]));
    section("Top pages", ["path", "views", "sessions"], data.top_pages.map(p => [p.path, p.views, p.sessions]));
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
          onClick={() => setCustomOpen(o => !o)}
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
          <input type="date" value={customStart} max={customEnd || undefined} onChange={e => setCustomStart(e.target.value)}
            className="px-3 py-1.5 rounded-lg border border-border bg-card text-foreground font-sans text-xs focus:outline-none focus:ring-2 focus:ring-primary/40" />
          <span className="font-sans text-xs text-muted-foreground">to</span>
          <input type="date" value={customEnd} min={customStart || undefined} onChange={e => setCustomEnd(e.target.value)}
            className="px-3 py-1.5 rounded-lg border border-border bg-card text-foreground font-sans text-xs focus:outline-none focus:ring-2 focus:ring-primary/40" />
          <button
            onClick={applyCustom}
            disabled={!customStart || !customEnd || customEnd < customStart}
            className="px-3.5 py-1.5 rounded-full font-sans text-xs font-semibold bg-primary text-primary-foreground disabled:opacity-50"
          >
            Apply
          </button>
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

      <p className="font-sans text-xs text-muted-foreground mb-6">
        {period.label} · {fmtRange(period.start, period.end)} — compared with the {data?.days ?? ""}-day period before it
        {device && <> · device: <span className="font-semibold text-foreground">{device}</span></>}
        {source && <> · source: <span className="font-semibold text-foreground">{source}</span></>}
        {data?.attributed && <> · sales attributed via tracked sessions</>}
      </p>

      {error && (
        <div className="rounded-xl border border-border bg-card p-4 mb-6">
          <p className="font-sans text-sm text-destructive">{error}</p>
        </div>
      )}

      {!data && loading && <p className="font-sans text-sm text-muted-foreground">Loading analytics…</p>}

      {data && (
        // Hold the previous render at reduced opacity while a new range loads —
        // no skeleton flash, no layout jump.
        <div className="space-y-6" style={{ opacity: loading ? 0.55 : 1, transition: "opacity 0.15s" }}>

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
            <StatTile label="Revenue" value={fmtCompactEur(data.sales.revenue)} prev={{ current: data.sales.revenue, previous: data.sales.prev.revenue }} />
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
            </Card>
          </div>

          {/* ── Funnel + customers ── */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <Card title="Conversion funnel" desc="Where sessions drop off between landing and purchase">
              <Funnel stages={data.funnel} />
              <div className="mt-4 pt-4 border-t border-border grid grid-cols-3 gap-3">
                <div>
                  <p className="font-sans text-lg font-semibold text-foreground">{fmtInt(data.abandoned.abandoned_sessions)}</p>
                  <p className="font-sans text-xs text-muted-foreground">Abandoned checkouts</p>
                </div>
                <div>
                  <p className="font-sans text-lg font-semibold text-foreground">
                    {data.abandoned.checkout_sessions ? `${((data.abandoned.abandoned_sessions / data.abandoned.checkout_sessions) * 100).toFixed(1)}%` : "—"}
                  </p>
                  <p className="font-sans text-xs text-muted-foreground">Abandonment rate</p>
                </div>
                <div>
                  <p className="font-sans text-lg font-semibold text-foreground">{fmtEur(data.abandoned.lost_revenue)}</p>
                  <p className="font-sans text-xs text-muted-foreground">Value left in baskets</p>
                </div>
              </div>
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
            <Card title="Top products" desc="By revenue from paid orders, with add-to-cart demand">
              <DataTable
                cols={[{ label: "Product" }, { label: "Units", align: "right" }, { label: "Revenue", align: "right" }, { label: "Adds to cart", align: "right" }]}
                rows={data.top_products.map(p => [p.name, fmtInt(p.units), fmtEur(p.revenue), fmtInt(p.add_to_carts)])}
                empty="No paid orders in this period yet."
              />
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
            </Card>
          </div>

          {/* ── Pages + devices + audience ── */}
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <Card title="Top pages" desc="Most-viewed storefront pages">
              <DataTable
                cols={[{ label: "Page" }, { label: "Views", align: "right" }, { label: "Sessions", align: "right" }]}
                rows={data.top_pages.map(p => [p.path || "/", fmtInt(p.views), fmtInt(p.sessions)])}
                empty="No page views recorded in this period yet."
              />
            </Card>

            <div className="space-y-4">
              <Card title="Devices" desc="Session share by device class">
                <DeviceSplit devices={data.devices} />
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
              </Card>
            </div>
          </div>

          {/* ── Web performance ── */}
          <Card title="Site performance" desc="Core Web Vitals measured on real visits (p75)">
            <WebVitals vitals={data.web_vitals} />
          </Card>
        </div>
      )}
    </div>
  );
};

export default AnalyticsPanel;
