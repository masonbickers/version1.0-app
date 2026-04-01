// ---- SAP GEL shared colours ----
const SAP_PRIMARY = "#E6FF3B";        // neon yellow (best as background/fill)

// UPDATED: neutral “silver” system (less blue) + clearer layer separation
const SAP_BG_LIGHT        = "#EFEFEF"; // app background
const SAP_SECTION_LIGHT   = "#b6b6b6ff"; // section / panel blocks
const SAP_CARD_LIGHT      = "#FAFAFA"; // surface / card
const SAP_SURFACE_ALT     = "#F3F3F3"; // rows / sub-cards

const SAP_TEXT_PRIMARY    = "#0B0B0B";
const SAP_TEXT_SECONDARY  = "#262626";
const SAP_TEXT_MUTED      = "#555555";

const SAP_DIVIDER_LIGHT   = "#D1D1D1";
const SAP_BORDER_LIGHT    = "#BDBDBD";
const SAP_BORDER_STRONG   = "#9E9E9E";

// UPDATED: higher-contrast neon-ink for light mode (don’t use neon as text on white)
const SAP_NEON_INK_LIGHT = "#3F4F00"; // readable on light backgrounds
const SAP_NEON_INK_DARK  = "#E6FF3B"; // in dark mode neon text is fine

// Optional: “ink” surfaces for black-led chips/headers in light mode
const SAP_INK_SURFACE     = "#111111";
const SAP_INK_SURFACE_ALT = "#1A1A1A";
const SAP_ON_INK          = "#FAFAFA";

export const PALETTES = {
  light: {
    // main roles
    bg: SAP_BG_LIGHT,
    card: SAP_CARD_LIGHT,
    text: SAP_TEXT_PRIMARY,
    subtext: SAP_TEXT_MUTED,
    border: SAP_BORDER_LIGHT,

    // extra layer roles (recommended)
    section: SAP_SECTION_LIGHT,
    surfaceAlt: SAP_SURFACE_ALT,
    divider: SAP_DIVIDER_LIGHT,
    borderStrong: SAP_BORDER_STRONG,

    // SAP GEL
    sapPrimary: SAP_PRIMARY,
    sapSilverLight: SAP_SURFACE_ALT,
    sapSilverMedium: SAP_SECTION_LIGHT,
    sapOnPrimary: SAP_TEXT_PRIMARY,

    // accent roles
    accentBg: SAP_PRIMARY,            // buttons/chips fills
    accentText: SAP_NEON_INK_LIGHT,   // links/icons on light bg
    accentBorder: "#BFD82A",          // outline / ring

    // optional ink surfaces (black-led accents in light mode)
    inkSurface: SAP_INK_SURFACE,
    inkSurfaceAlt: SAP_INK_SURFACE_ALT,
    onInk: SAP_ON_INK,
  },

  dark: {
    bg: "#000000",
    card: "#2C2C2C",
    text: "#E5E7EB",
    subtext: "#B7B7B7",
    border: "#404040",

    // SAP GEL
    sapPrimary: SAP_PRIMARY,
    sapSilverLight: "#111217",
    sapSilverMedium: "#E1E3E8",
    sapOnPrimary: "#111111",

    // accent roles
    accentBg: SAP_PRIMARY,
    accentText: SAP_NEON_INK_DARK, // neon is visible on dark
    accentBorder: SAP_PRIMARY,
  },
};
