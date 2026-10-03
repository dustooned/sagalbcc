import type { NormalizedKit, PieceDefinition } from '@kitforge/shared-types';

export interface ParsedKitFile {
  source: string;
  kit: NormalizedKit;
  definitions: PieceDefinition[];
  /** Things the user should know after loading, e.g. cards that were skipped. */
  warnings?: string[];
}

export class KitParseError extends Error {}
