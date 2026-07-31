// ── Where the About page's "Meet the maker" block gets its words ───────────────
// The block can either mirror the home page's Welcome Club section (the shipped
// default, and what /about did before this section existed) or stand on its own.
//
// Only the *content* mirrors. The label, the two button labels and the button
// links always come from the About section: the Welcome Club has no label field
// at all, and its button points at "#story" — an anchor that exists on the home
// page and means nothing on /about.

import type { AboutFounderContent, WelcomeClubContent } from "@/lib/defaults";

export interface ResolvedAboutFounder {
  label: string;
  headline: string;
  photo_url: string;
  name_line: string;
  bio: string;
  cta_text: string;
  cta_href: string;
  jump_cta_text: string;
  /** True when the copy above is the home page's, not this page's own. */
  mirrored: boolean;
}

export function resolveAboutFounder(
  about: AboutFounderContent,
  home: WelcomeClubContent,
): ResolvedAboutFounder {
  // Absent means mirror, so content saved before this section existed keeps
  // rendering the home-page block it used to render.
  const mirrored = about.use_home_content !== false;
  const source = mirrored ? home : about;

  return {
    label: about.label,
    headline: source.headline,
    photo_url: source.photo_url,
    name_line: source.name_line,
    bio: source.bio,
    cta_text: about.cta_text,
    cta_href: about.cta_href,
    jump_cta_text: about.jump_cta_text,
    mirrored,
  };
}
