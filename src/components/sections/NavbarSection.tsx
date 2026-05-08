import { useState, useEffect, useRef } from "react";
import { NavbarContent, AnnouncementBarContent } from "@/lib/defaults";
import logo from "@/assets/logo.jpg";

interface Props {
  data: NavbarContent;
  announcement: AnnouncementBarContent;
}

// ── Rotating announcement bar ────────────────────────────────────────────────
const AnnouncementBar = ({ data }: { data: AnnouncementBarContent }) => {
  const messages = data.messages?.length ? data.messages : ["Free shipping on orders over $65"];
  const interval = data.interval_ms ?? 1500;

  const [current, setCurrent] = useState(0);
  const [phase, setPhase]   = useState<"enter" | "show" | "exit">("enter");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const cycle = () => {
      setPhase("exit");
      timerRef.current = setTimeout(() => {
        setCurrent((c) => (c + 1) % messages.length);
        setPhase("enter");
        timerRef.current = setTimeout(() => {
          setPhase("show");
          timerRef.current = setTimeout(cycle, interval - 650);
        }, 350);
      }, 300);
    };

    setPhase("enter");
    timerRef.current = setTimeout(() => {
      setPhase("show");
      timerRef.current = setTimeout(cycle, interval - 650);
    }, 350);

    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [messages.length, interval]);

  const cls =
    phase === "enter" ? "announce-enter" :
    phase === "exit"  ? "announce-exit"  : "";

  return (
    <div
      className="w-full py-2 px-4 flex items-center justify-center overflow-hidden"
      style={{ background: "var(--bg-announce)", minHeight: "34px" }}
    >
      <p
        key={current}
        className={`font-display text-xs tracking-wide text-center ${cls}`}
        style={{ color: "var(--color-white)" }}
      >
        {messages[current]}
      </p>
    </div>
  );
};

// ── Main Navbar ───────────────────────────────────────────────────────────────
const NavbarSection = ({ data, announcement }: Props) => {
  const [open, setOpen] = useState(false);
  const links = data.links ?? [];

  return (
    <div className="fixed top-0 left-0 right-0 z-50">
      <AnnouncementBar data={announcement} />

      <nav style={{ background: "var(--bg-nav)" }}>
        <div className="max-w-7xl mx-auto px-8 py-2 flex items-center justify-between">

          {/* Logo */}
          <a href="/" className="shrink-0 group">
            <img
              src={logo}
              alt="The Olive Goose"
              className="transition-transform group-hover:scale-105 duration-300"
              style={{ height: 40, width: "auto", objectFit: "contain" }}
            />
          </a>

          {/* Desktop links — centered */}
          <div className="hidden md:flex items-center gap-10">
            {links.map((link, i) => (
              <a
                key={`${link.label}-${i}`}
                href={link.href}
                className="font-display text-base transition-all hover:opacity-70 relative group"
                style={{ color: "var(--color-white)", letterSpacing: "var(--tracking-nav)" }}
              >
                {link.label}
                <span
                  className="absolute -bottom-0.5 left-0 w-0 h-px transition-all duration-300 group-hover:w-full"
                  style={{ background: "var(--color-white)" }}
                />
              </a>
            ))}
          </div>

          {/* Cart pill */}
          <a
            href={data.cta_href || "#"}
            className="hidden md:inline-flex items-center gap-2 px-5 py-2 rounded-full text-sm font-semibold transition-all hover:scale-105 active:scale-95 shrink-0 font-display"
            style={{
              background: "var(--btn-primary-bg)",
              color: "var(--btn-primary-text)",
              borderRadius: "var(--radius-pill)",
            }}
          >
            <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1.5 1.5h1.3l1.7 7.8h7.2l1.3-5.6H4.7"/>
              <circle cx="7.5" cy="13" r="1"/>
              <circle cx="11.2" cy="13" r="1"/>
            </svg>
            {data.cta_text}
            <span
              className="inline-flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold"
              style={{ background: "var(--btn-dark-bg)", color: "var(--btn-dark-text)" }}
            >
              2
            </span>
          </a>

          {/* Mobile hamburger */}
          <button
            onClick={() => setOpen(!open)}
            className="md:hidden p-1 rounded transition-opacity hover:opacity-60"
            style={{ color: "var(--color-white)" }}
            aria-label="Toggle menu"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.8}
                d={open ? "M6 18L18 6M6 6l12 12" : "M4 6h16M4 12h16M4 18h16"}
              />
            </svg>
          </button>
        </div>

        {/* Mobile menu */}
        {open && (
          <div
            className="md:hidden border-t px-6 py-5 space-y-4"
            style={{ background: "var(--bg-nav)", borderColor: "rgba(255,255,255,0.2)" }}
          >
            {links.map((link, i) => (
              <a
                key={`${link.label}-${i}`}
                href={link.href}
                onClick={() => setOpen(false)}
                className="font-display block text-base transition-opacity hover:opacity-70"
                style={{ color: "var(--color-white)" }}
              >
                {link.label}
              </a>
            ))}
            <a
              href={data.cta_href || "#"}
              onClick={() => setOpen(false)}
              className="font-display block text-center px-5 py-2.5 rounded-full text-sm font-semibold mt-2"
              style={{
                background: "var(--btn-primary-bg)",
                color: "var(--btn-primary-text)",
                borderRadius: "var(--radius-pill)",
              }}
            >
              {data.cta_text}
            </a>
          </div>
        )}
      </nav>
    </div>
  );
};

export default NavbarSection;
