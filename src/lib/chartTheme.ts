// Shared chart tokens for every recharts instance in the app — one place to
// keep chart color usage consistent instead of each page picking its own hues.
//
// The categorical order below is brand-navy-led but otherwise the dataviz
// skill's validated default order (references/palette.md), re-validated with
// slot 1 swapped for our brand navy via `validate_palette.js` — both light
// and dark pass every hard gate (lightness band, chroma floor, CVD adjacent
// separation, normal-vision floor). Do not reorder these without re-running
// the validator: the order itself is the CVD-safety mechanism, not cosmetic.
export const CHART_CATEGORICAL = [
  '#34499a', // 1 brand navy   (brand-500)
  '#eb6834', // 2 orange
  '#1baf7a', // 3 aqua/green
  '#eda100', // 4 yellow
  '#e87ba4', // 5 magenta
  '#008300', // 6 green
  '#4a3aa7', // 7 violet
  '#e34948', // 8 red
] as const;

// Single-hue sequential ramp (magnitude, light -> dark) built from the app's
// own brand-* navy scale in globals.css, so a one-series chart reads as
// on-brand rather than the skill's generic default blue.
export const CHART_SEQUENTIAL = [
  '#eef1f9', '#d5dcf0', '#adb9e1', '#8494cc', '#5a6db3',
  '#34499a', '#1a3080', '#0b1d5e', '#081548', '#050e32',
] as const;

// Fixed, never themed — reserved for state, never reused as a categorical slot.
export const CHART_STATUS = {
  good: '#0ca30c',
  warning: '#d4a820', // stepped down from the skill's #fab219 for 3:1+ on white
  serious: '#ec835a',
  critical: '#d03b3b',
} as const;

// Chart chrome (grid/axis/ink) — the skill's neutral values, not swapped, since
// these are UI chrome rather than brand identity.
export const CHART_INK = {
  primary: '#0b0b0b',
  secondary: '#52514e',
  muted: '#898781',
  grid: '#e1e0d9',
  axis: '#c3c2b7',
} as const;

/** className-free style props shared by every <CartesianGrid>. */
export const chartGridProps = {
  stroke: CHART_INK.grid,
  strokeDasharray: '3 3',
  vertical: false,
} as const;

/** Shared axis tick styling — small, muted, never bold (data carries the weight). */
export const chartAxisProps = {
  stroke: CHART_INK.axis,
  tick: { fill: CHART_INK.muted, fontSize: 12 },
  tickLine: false,
  axisLine: { stroke: CHART_INK.axis },
} as const;

/** Shared tooltip container style — matches the app's card treatment (white, rounded, bordered). */
export const chartTooltipStyle = {
  contentStyle: {
    background: '#ffffff',
    border: '1px solid #e5e7eb',
    borderRadius: '0.5rem',
    boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)',
    fontSize: '0.8125rem',
    padding: '0.5rem 0.75rem',
  },
  labelStyle: { color: CHART_INK.primary, fontWeight: 600, marginBottom: 4 },
  cursor: { fill: 'rgba(52,73,154,0.06)' },
} as const;
