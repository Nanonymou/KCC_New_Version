// ═══════════════════════════════════════════════════════════════════════════
// theme.js — shared design tokens (Claude-inspired warm dark aesthetic).
//
// Palette takes its cues from the Anthropic / claude-starter look: warm
// charcoal surfaces, a clay/coral accent, muted sage/amber signals, an
// editorial serif (Fraunces) for display type over Inter for UI text.
//
// Import anywhere:  import { T } from './theme';
// ═══════════════════════════════════════════════════════════════════════════

export const T = {
  // ── Surfaces ──────────────────────────────────────────────
  bg:          '#262624', // app background (warm charcoal)
  bgDeep:      '#1f1e1c', // deepest layer / nav
  surface:     '#302f2c', // cards
  surfaceAlt:  '#37352f', // raised / hovered card
  surfaceInput:'#211f1d',

  // ── Lines ─────────────────────────────────────────────────
  border:      '#413f3a',
  borderSoft:  '#35332f',
  borderStrong:'#54514a',

  // ── Text ──────────────────────────────────────────────────
  text:        '#ecebe5',
  textMuted:   '#a9a49a',
  textFaint:   '#78746b',

  // ── Brand / accent (Claude clay) ──────────────────────────
  primary:     '#c96442',
  primaryHover:'#d97757',
  primarySoft: 'rgba(201,100,66,0.14)',
  primaryLine: 'rgba(201,100,66,0.40)',

  // ── Signals (muted, warm) ─────────────────────────────────
  success:     '#7fa86a',
  successSoft: 'rgba(127,168,106,0.14)',
  warning:     '#d99a4e',
  warningSoft: 'rgba(217,154,78,0.14)',
  danger:      '#d1685c',
  dangerSoft:  'rgba(209,104,92,0.14)',
  info:        '#6ea3c4',

  // ── Type ──────────────────────────────────────────────────
  fontUI:      "'Inter', 'Segoe UI', system-ui, sans-serif",
  fontDisplay: "'Fraunces', 'Iowan Old Style', Georgia, serif",

  // ── Shape & depth ─────────────────────────────────────────
  radiusSm: 8,
  radius:   12,
  radiusLg: 16,
  radiusXl: 22,
  shadow:   '0 1px 2px rgba(0,0,0,0.28)',
  shadowMd: '0 6px 22px -6px rgba(0,0,0,0.45)',
  shadowLg: '0 18px 48px -12px rgba(0,0,0,0.55)',
};

// Margin percentage → signal color (shared by dashboard/analytics).
export function marginTone(m) {
  if (m >= 50) return T.success;
  if (m >= 35) return '#a9c46a';
  if (m >= 20) return T.warning;
  return T.danger;
}

export default T;
