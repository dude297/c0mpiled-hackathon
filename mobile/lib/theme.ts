// Design tokens shared by every screen. Calm neutral palette matching the web app,
// tuned for older adults: high contrast, large type, big tap targets.

export const colors = {
  bg: '#f7f7f2', // warm off-white page
  surface: '#ffffff', // cards, sheets
  text: '#1a1a1a', // primary text (~17:1 on bg)
  textMuted: '#4a4a44', // secondary text — still >= 7:1 on bg
  border: '#d6d6cc',
  primary: '#252525', // main buttons
  onPrimary: '#ffffff',
  tile: '#efefe6', // Connections-style tile (unselected)
  tileSelected: '#5a594e', // Connections-style tile (selected)
  onTileSelected: '#ffffff',
  like: '#1f6f43', // swipe right / yes — always paired with an icon + word
  soft: '#8a5a00', // amber: soft barrier text/icon
  softBg: '#fdf3d8',
  softBorder: '#e8c56a',
  hard: '#b3261e', // red: blocked
  hardBg: '#fde8e6',
  hardBorder: '#f0a8a2',
  focus: '#1d4ed8',
} as const;

// Body >= 18, titles >= 28. Line heights keep long words readable.
export const type = {
  display: { fontSize: 34, lineHeight: 40, fontWeight: '700' },
  title: { fontSize: 28, lineHeight: 34, fontWeight: '700' },
  heading: { fontSize: 22, lineHeight: 28, fontWeight: '600' },
  body: { fontSize: 18, lineHeight: 26, fontWeight: '400' },
  bodyStrong: { fontSize: 18, lineHeight: 26, fontWeight: '600' },
  label: { fontSize: 18, lineHeight: 22, fontWeight: '600' },
  button: { fontSize: 20, lineHeight: 24, fontWeight: '700' },
} as const;

export const space = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 } as const;

export const radius = { sm: 8, md: 12, lg: 20, pill: 999 } as const;

export const tap = { min: 56 } as const; // minimum touch target (pt)

export const shadow = {
  card: { shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 3 },
} as const;

export const theme = { colors, type, space, radius, tap, shadow };
