// Table geometry and limits shared by client (rendering) and server (validation/placement).
// 1 world unit = 1 inch, so a piece's synced w/h match its Kit Forge size directly.

export const MAX_PLAYERS = 8;
/** Point counter columns (SCORE, HP, GOLD…) every player gets. */
export const MAX_COUNTERS = 6;
export const ROOM_NAME = 'kit_table';

export const TABLE_W = 60; // inches — room for a 24x24" board plus scattered pieces around it
export const TABLE_D = 44;
export const TABLE_HALF_W = TABLE_W / 2;
export const TABLE_HALF_D = TABLE_D / 2;
export const PIECE_THICKNESS = 0.08;

export const SEAT_COLORS = ['#e0533d', '#3d8ee0', '#3dbf6b', '#e0b23d', '#8e5de0', '#e05dbb', '#4fd1c5', '#f97362'] as const;

/** Seats are just a facing direction, evenly spaced — there's no per-seat deck/discard/hand
 * here (see PieceKind), so a seat only matters for the camera's "home" view and player color. */
export function seatAngle(seat: number): number {
  return (360 / MAX_PLAYERS) * seat;
}

/** Quick felt colors for the table-look picker. First one is the default (LBCC teal). */
export const FELT_PRESETS = [
  { name: 'Viking teal', color: '#184554' },
  { name: 'Classic green', color: '#1f6b4f' },
  { name: 'Oak', color: '#6b4a2b' },
  { name: 'Midnight', color: '#1a1f3a' },
  { name: 'Slate', color: '#3a3f47' },
  { name: 'Crimson', color: '#5a1414' },
] as const;
export const DEFAULT_FELT = FELT_PRESETS[0].color;

// ---------------------------------------------------------------- backdrop (behind the table)

export const BACKDROP_MODES = ['solid', 'gradient', 'space', 'nebula', 'image'] as const;
export type BackdropMode = typeof BACKDROP_MODES[number];
export const BACKDROP_EFFECTS = ['none', 'wave', 'kaleido'] as const;
export type BackdropEffect = typeof BACKDROP_EFFECTS[number];

/** Everything behind the table. Shared by the whole table, like the felt. */
export interface Backdrop {
  mode: BackdropMode;
  /** Up to three colors: gradient top→bottom, or a nebula's deep/mid/bright tones. */
  colors: string[];
  image: string;
  effect: BackdropEffect;
}
export const DEFAULT_BACKDROP: Backdrop = { mode: 'solid', colors: ['#0e0e16'], image: '', effect: 'none' };

export const BACKDROP_PRESETS: { group: 'Space' | 'Nebula' | 'Gradient'; name: string; look: Omit<Backdrop, 'image' | 'effect'> }[] = [
  { group: 'Space', name: 'Deep space', look: { mode: 'space', colors: ['#02030a', '#0b1030', '#3a4a9a'] } },
  { group: 'Space', name: 'Star field', look: { mode: 'space', colors: ['#000000', '#05070f', '#20263a'] } },
  { group: 'Space', name: 'Red giant', look: { mode: 'space', colors: ['#050102', '#2a0606', '#da291c'] } },
  { group: 'Nebula', name: 'Viking nebula', look: { mode: 'nebula', colors: ['#020608', '#184554', '#5fd3c8'] } },
  { group: 'Nebula', name: 'Crimson nebula', look: { mode: 'nebula', colors: ['#050103', '#6e0a1a', '#ff7a4a'] } },
  { group: 'Nebula', name: 'Violet nebula', look: { mode: 'nebula', colors: ['#04020a', '#3a1466', '#e07bff'] } },
  { group: 'Nebula', name: 'Aurora', look: { mode: 'nebula', colors: ['#010507', '#0c5a3c', '#7dffb0'] } },
  { group: 'Gradient', name: 'LBCC', look: { mode: 'gradient', colors: ['#da291c', '#2a0808', '#000000'] } },
  { group: 'Gradient', name: 'Sunset', look: { mode: 'gradient', colors: ['#2b1055', '#d53369', '#ffb86b'] } },
  { group: 'Gradient', name: 'Ocean', look: { mode: 'gradient', colors: ['#0f2027', '#203a43', '#2c5364'] } },
  { group: 'Gradient', name: 'Dusk', look: { mode: 'gradient', colors: ['#141e30', '#243b55', '#6a7fa0'] } },
];

// ---------------------------------------------------------------- atmosphere (weather over the table)

export const ATMOSPHERE_KINDS = ['none', 'fog', 'dust', 'rain', 'snow', 'embers'] as const;
export type AtmosphereKind = typeof ATMOSPHERE_KINDS[number];
export interface Atmosphere { kind: AtmosphereKind; /** 0.1–1 */ strength: number }
export const DEFAULT_ATMOSPHERE: Atmosphere = { kind: 'none', strength: 0.6 };
export function parseAtmosphere(json: string): Atmosphere {
  try {
    const a = JSON.parse(json) as Partial<Atmosphere>;
    const kind = ATMOSPHERE_KINDS.includes(a.kind as AtmosphereKind) ? a.kind as AtmosphereKind : 'none';
    const strength = typeof a.strength === 'number' && Number.isFinite(a.strength) ? Math.min(1, Math.max(0.1, a.strength)) : DEFAULT_ATMOSPHERE.strength;
    return { kind, strength };
  } catch { return DEFAULT_ATMOSPHERE; }
}

/** Parses the synced backdrop JSON, falling back to the default for anything missing or odd. */
export function parseBackdrop(json: string): Backdrop {
  try {
    const b = JSON.parse(json) as Partial<Backdrop>;
    return {
      mode: BACKDROP_MODES.includes(b.mode as BackdropMode) ? b.mode as BackdropMode : DEFAULT_BACKDROP.mode,
      colors: Array.isArray(b.colors) && b.colors.length ? b.colors.slice(0, 3) : DEFAULT_BACKDROP.colors,
      image: typeof b.image === 'string' ? b.image : '',
      effect: BACKDROP_EFFECTS.includes(b.effect as BackdropEffect) ? b.effect as BackdropEffect : 'none',
    };
  } catch { return DEFAULT_BACKDROP; }
}

export interface Point2 { x: number; z: number }

/** Keeps a piece's center within the table surface, accounting for its own footprint and
 * (roughly) its rotation — a conservative half-diagonal keeps rotated pieces on the felt too. */
export function clampToTable(x: number, z: number, w = 1, h = 1): Point2 {
  const half = Math.hypot(w, h) / 2;
  const mx = Math.max(0, TABLE_HALF_W - half), mz = Math.max(0, TABLE_HALF_D - half);
  return { x: Math.min(mx, Math.max(-mx, x)), z: Math.min(mz, Math.max(-mz, z)) };
}
