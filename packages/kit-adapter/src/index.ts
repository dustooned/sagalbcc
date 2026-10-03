// Reads a Kit Forge "Send to Table" export (.kittable.json): every card/piece/board already
// rasterized to a PNG data: URL by Kit Forge itself, plus its physical size in inches. Also reads
// a LOL, FIGHT TIEM! Card Forge "Send to playtest" deck (.lftdeck.json), which carries each
// card's finished art as a JPEG data: URL. These are the only formats the table understands.
import type { NormalizedKit, PieceDefinition, PieceKind } from '@kitforge/shared-types';
import { KitParseError, type ParsedKitFile } from './types.ts';

const DATA_IMAGE = /^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/i;
const KINDS: PieceKind[] = ['card', 'piece', 'board'];

function str(v: unknown, max: number): string {
  return typeof v === 'string' ? v.trim().slice(0, max) : '';
}
function num(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function readPiece(raw: unknown): { def: PieceDefinition; count: number } | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const id = str(r.id, 64);
  const kind = KINDS.includes(r.kind as PieceKind) ? (r.kind as PieceKind) : null;
  const image = typeof r.frontImage === 'string' && DATA_IMAGE.test(r.frontImage) ? r.frontImage : '';
  if (!id || !kind || !image) return null;
  const def: PieceDefinition = {
    id, kind, frontImage: image,
    name: str(r.name, 60) || 'Untitled',
    w: num(r.w, 0.25, 60, 1),
    h: num(r.h, 0.25, 60, 1),
  };
  const backImage = typeof r.backImage === 'string' && DATA_IMAGE.test(r.backImage) ? r.backImage : '';
  if (backImage) def.backImage = backImage;
  return { def, count: Math.round(num(r.count, 1, 200, 1)) };
}

// LOL, FIGHT TIEM! cards are poker size (63 × 88 mm); the table's unit is one inch.
const LFT_CARD = { w: 2.5, h: 3.5 };

/** A Card Forge "Send to playtest" deck: one card piece per card id, `quantity` = how many of the
 *  file's decks hold it (so a Red + Blue file with a shared card spawns two copies). */
function parseLftDeck(raw: Record<string, unknown>, fileName: string): ParsedKitFile {
  const images = typeof raw.images === 'object' && raw.images !== null ? (raw.images as Record<string, unknown>) : {};
  const back = typeof raw.back === 'string' && DATA_IMAGE.test(raw.back) ? raw.back : '';
  const names = new Map<string, string>();
  for (const c of Array.isArray(raw.cards) ? raw.cards : []) {
    const r = (typeof c === 'object' && c !== null ? c : {}) as Record<string, unknown>;
    const id = str(r.id, 64);
    if (id) names.set(id, str(r.name, 60) || 'Untitled');
  }
  const decks = (Array.isArray(raw.decks) ? raw.decks : []).map(d => (typeof d === 'object' && d !== null ? d : {}) as Record<string, unknown>);
  const quantity = new Map<string, number>();
  for (const d of decks) for (const id of Array.isArray(d.cards) ? d.cards : []) {
    if (typeof id === 'string' && names.has(id)) quantity.set(id, (quantity.get(id) ?? 0) + 1);
  }
  const definitions: PieceDefinition[] = [];
  const pieces: NormalizedKit['pieces'] = [];
  let noArt = 0;
  for (const [id, count] of quantity) {
    const image = images[id];
    if (typeof image !== 'string' || !DATA_IMAGE.test(image)) { noArt++; continue; }
    const def: PieceDefinition = { id: `lft-${id}`, kind: 'card', name: names.get(id) ?? id, frontImage: image, ...LFT_CARD };
    if (back) def.backImage = back;
    definitions.push(def);
    pieces.push({ pieceId: def.id, quantity: Math.min(count, 200) });
  }
  if (!definitions.length) throw new KitParseError('That LOL, FIGHT TIEM! deck has no card art in it. In Card Forge use “Send to playtest” (not Save) so the art comes along.');
  const name = decks.length === 1 ? str(decks[0].name, 80) : str(raw.setName, 80);
  const warnings = noArt ? [`${noArt} card${noArt === 1 ? ' was' : 's were'} left out because they have no art.`] : [];
  return { source: 'lft-deck', kit: { name: name || fileName, pieces }, definitions, warnings };
}

/** Parses a `.kittable.json` or `.lftdeck.json` file's already-decoded JSON content. */
export function parseKitFile(input: unknown, fileName = 'kit'): ParsedKitFile {
  if (typeof input !== 'object' || input === null) throw new KitParseError('That file is not a Kit Forge table export.');
  const raw = input as Record<string, unknown>;
  if (raw.format === 'lft-deck') return parseLftDeck(raw, fileName);
  if (raw.format !== 'kit-table') throw new KitParseError('That file is not something the table can load (drag a .kittable.json from Kit Forge’s "Send to Table", or a .lftdeck.json from Card Forge’s "Send to playtest").');
  const list = Array.isArray(raw.pieces) ? raw.pieces.slice(0, 2000) : [];
  const read = list.map(readPiece).filter((p): p is NonNullable<typeof p> => !!p);
  if (!read.length) throw new KitParseError('That kit has no usable cards, pieces or boards in it.');
  const definitions = read.map(p => p.def);
  const kit: NormalizedKit = {
    name: str(raw.kitTitle, 80) || fileName,
    pieces: read.map(p => ({ pieceId: p.def.id, quantity: p.count })),
  };
  return { source: 'kit-table', kit, definitions };
}

export { KitParseError };
export type { ParsedKitFile };
