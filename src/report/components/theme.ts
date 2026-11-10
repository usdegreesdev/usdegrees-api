/**
 * Shared design tokens for the College Decision Report.
 *
 * Every report component imports colors/fonts from here instead of hardcoding
 * hex values. The palette is a cream / navy / gold editorial system:
 *   - warm cream page backgrounds
 *   - deep navy for the cover, headers, and primary brand ink
 *   - a single muted gold accent for rules, badges, and highlight numerals
 *   - muted forest-green / brick-red for positive / risk states (never neon)
 */
export const theme = {
  color: {
    // Base surfaces
    pageBg: "#FBF8F1", // warm cream — page background
    panelBg: "#F4EFE3", // slightly deeper cream for card/panel backgrounds
    panelBgAlt: "#FFFFFF", // white panel for contrast within cream pages
    coverBg: "#152238", // deep navy — Cover page background

    // Text
    ink: "#20262F", // primary text
    inkMuted: "#5B6472", // secondary text
    inkFaint: "#8B93A1", // tertiary/footnote text

    // Brand
    navy: "#1B2A4A", // headers, primary brand ink
    navyDeep: "#101A30",
    gold: "#B08D2E", // accent — rules, badges, highlight numerals
    goldSoft: "#E8DCB8", // gold-tinted panel border/background

    // Semantic
    positive: "#3E6B4F", // muted forest green
    positiveBg: "#EEF3EC",
    warning: "#8A5A22", // muted amber/brown
    warningBg: "#F6EDDD",
    risk: "#8C3A32", // muted brick red
    riskBg: "#F5E9E7",

    hairline: "#DCD3BE", // borders/rules on cream
    hairlineOnNavy: "#33415C",

    white: "#FFFFFF",
  },
  font: {
    // Serif-leaning stack for headers/titles
    family: "Georgia, 'Times New Roman', system-ui, -apple-system, serif",
    // Sans stack for body/UI
    sans: "system-ui, -apple-system, 'Segoe UI', sans-serif",
    mono: "ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace",
  },
  // SAT score positioning section
  sat: {
    band: "#C7DDF7",
    bandBorder: "#8DB4E2",
    track: "#E6E9EF",
    grid: "#E9E4D6",
    marker: "#13234A",
    markerText: "#FFFFFF",
    stem: "#D4A23A",
    above: "#115E59",
    within: "#1E3A8A",
    below: "#9A3412",
    neutral: "#5B6472",
  },
  // Disclosure badge palettes, keyed by admission_disclosure_categories.badge_color.
  // Unknown colors fall back to `neutral`.
  badge: {
    green: { fg: "#2F5D3F", bg: "#E4F0E6", border: "#9CC3A6" },
    teal: { fg: "#0F5F63", bg: "#DDF0F0", border: "#8CC5C7" },
    slate_blue_gray: { fg: "#3F4B63", bg: "#E5E9F1", border: "#A9B3C7" },
    amber_outline: { fg: "#8A5A22", bg: "#FFFFFF", border: "#D9A441" },
    coral: { fg: "#9A3F2E", bg: "#FBE6E0", border: "#E3A494" },
    gray: { fg: "#5B6472", bg: "#EEF0F3", border: "#C3C8D1" },
    neutral: { fg: "#5B6472", bg: "#EEF0F3", border: "#C3C8D1" },
  } as Record<string, { fg: string; bg: string; border: string }>,
};

export type Theme = typeof theme;
