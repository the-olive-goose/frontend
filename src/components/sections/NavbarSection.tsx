import { useState, useEffect, useRef } from "react";
import { NavbarContent, AnnouncementBarContent } from "@/lib/defaults";
import logo from "@/assets/logo.png";

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
      // show → exit
      setPhase("exit");
      timerRef.current = setTimeout(() => {
        setCurrent((c) => (c + 1) % messages.length);
        setPhase("enter");
        timerRef.current = setTimeout(() => {
          setPhase("show");
          timerRef.current = setTimeout(cycle, interval - 650); // subtract transition time
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
      className="w-full py-2.5 px-4 flex items-center justify-center overflow-hidden"
      style={{ background: "#899d6b", minHeight: "38px" }}
    >
      <p
        key={current}
        className={`font-sans text-xs font-medium tracking-wide text-center ${cls}`}
        style={{ color: "#fff" }}
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
      {/* Announcement bar */}
      <AnnouncementBar data={announcement} />

      {/* Nav */}
      <nav style={{ background: "#a5ba85" }}>
        <div className="max-w-7xl mx-auto px-6 py-3 flex items-center justify-between">

          {/* Logo — goose icon + "olive goose" two-line bubbly text */}
          <a href="/" className="flex items-center gap-3 shrink-0 group">
            <img
              src={logo}
              alt="The Olive Goose"
              className="transition-transform group-hover:rotate-6 duration-300"
              style={{ width: 64, height: 64, objectFit: "contain" }}
            />
            <div className="flex flex-col leading-none" style={{ gap: "1px" }}>
              <span
                className="font-display block"
                style={{
                  fontSize: "1.85rem",
                  color: "#ffffff",
                  WebkitTextStroke: "1.8px #1D2B1B",
                  paintOrder: "stroke fill",
                  letterSpacing: "0.03em",
                  lineHeight: 1,
                }}
              >
                olive
              </span>
              <span
                className="font-display block"
                style={{
                  fontSize: "1.85rem",
                  color: "#ffffff",
                  WebkitTextStroke: "1.8px #1D2B1B",
                  paintOrder: "stroke fill",
                  letterSpacing: "0.03em",
                  lineHeight: 1,
                }}
              >
                goose
              </span>
            </div>
          </a>

          {/* Desktop links */}
          <div className="hidden md:flex items-center gap-7">
            {links.map((link, i) => (
              <a
                key={`${link.label}-${i}`}
                href={link.href}
                className="font-sans text-sm font-medium tracking-wide transition-all hover:opacity-60 relative group"
                style={{ color: "#1D2B1B" }}
              >
                {link.label}
                <span
                  className="absolute -bottom-0.5 left-0 w-0 h-px transition-all duration-300 group-hover:w-full"
                  style={{ background: "#1D2B1B" }}
                />
              </a>
            ))}
          </div>

          {/* Desktop actions */}
          <div className="hidden md:flex items-center gap-3">
            {/* Search */}
            <button
              aria-label="Search"
              className="p-1.5 rounded-full transition-all hover:opacity-60"
              style={{ color: "#1D2B1B" }}
            >
              <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <circle cx="8" cy="8" r="5.5"/>
                <line x1="12.5" y1="12.5" x2="17" y2="17"/>
              </svg>
            </button>

            {/* Cart pill */}
            <a
              href={data.cta_href || "#"}
              className="inline-flex items-center gap-2 px-5 py-2 rounded-full font-sans text-sm font-semibold transition-all hover:scale-105 active:scale-95"
              style={{ background: "#F2EDE3", color: "#1D2B1B" }}
            >
              <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
                <path d="M1.5 1.5h1.3l1.7 7.8h7.2l1.3-5.6H4.7"/>
                <circle cx="7.5" cy="13" r="1"/>
                <circle cx="11.2" cy="13" r="1"/>
              </svg>
              {data.cta_text}
              <span
                className="inline-flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold"
                style={{ background: "#1D2B1B", color: "#F5EFE6" }}
              >
                2
              </span>
            </a>
          </div>

          {/* Mobile hamburger */}
          <button
            onClick={() => setOpen(!open)}
            className="md:hidden p-1 rounded transition-opacity hover:opacity-60"
            style={{ color: "#1D2B1B" }}
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
            style={{ background: "#a5ba85", borderColor: "rgba(29,43,27,0.15)" }}
          >
            {links.map((link, i) => (
              <a
                key={`${link.label}-${i}`}
                href={link.href}
                onClick={() => setOpen(false)}
                className="block font-sans text-sm font-medium tracking-wide transition-opacity hover:opacity-60"
                style={{ color: "#1D2B1B" }}
              >
                {link.label}
              </a>
            ))}
            <a
              href={data.cta_href || "#"}
              onClick={() => setOpen(false)}
              className="block text-center px-5 py-2.5 rounded-full font-sans text-sm font-semibold mt-2"
              style={{ background: "#F2EDE3", color: "#1D2B1B" }}
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
