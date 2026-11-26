import { z } from 'zod';

/** A compound as stored and returned by this API. */
export interface Compound {
  cid: number;
  name: string;
  iupacName: string | null;
  formula: string | null;
  molWeight: number | null;
  canonicalSmiles: string | null;
  inchikey: string | null;
  xlogp: number | null;
}

/** PUG-REST property names requested for every compound (order irrelevant). */
export const PROPERTY_LIST = [
  'Title',
  'IUPACName',
  'MolecularFormula',
  'MolecularWeight',
  'ConnectivitySMILES',
  'InChIKey',
  'XLogP',
] as const;

const cidListSchema = z.object({
  IdentifierList: z.object({ CID: z.array(z.number().int().positive()) }),
});

const propertyRowSchema = z.object({
  CID: z.number().int().positive(),
  Title: z.string().optional(),
  IUPACName: z.string().optional(),
  MolecularFormula: z.string().optional(),
  // PubChem returns MolecularWeight as a string ("180.16").
  MolecularWeight: z.union([z.string(), z.number()]).optional(),
  // "ConnectivitySMILES" is PubChem's current name for the old CanonicalSMILES (no stereo).
  ConnectivitySMILES: z.string().optional(),
  InChIKey: z.string().optional(),
  XLogP: z.number().optional(),
});

const propertyTableSchema = z.object({
  PropertyTable: z.object({ Properties: z.array(propertyRowSchema) }),
});

const synonymsSchema = z.object({
  InformationList: z.object({
    Information: z.array(
      z.object({ CID: z.number().int().positive(), Synonym: z.array(z.string()).optional() }),
    ),
  }),
});

export class PubChemParseError extends Error {
  constructor(what: string, cause: unknown) {
    super(`Unexpected PubChem ${what} response shape`, { cause });
    this.name = 'PubChemParseError';
  }
}

export function parseCidList(json: unknown): number[] {
  const r = cidListSchema.safeParse(json);
  if (!r.success) throw new PubChemParseError('CID list', r.error);
  return r.data.IdentifierList.CID;
}

export function parseProperties(json: unknown): Compound[] {
  const r = propertyTableSchema.safeParse(json);
  if (!r.success) throw new PubChemParseError('property table', r.error);
  return r.data.PropertyTable.Properties.map((p) => {
    const mw = p.MolecularWeight === undefined ? NaN : Number(p.MolecularWeight);
    return {
      cid: p.CID,
      name: p.Title ?? p.IUPACName ?? `CID ${p.CID}`,
      iupacName: p.IUPACName ?? null,
      formula: p.MolecularFormula ?? null,
      molWeight: Number.isFinite(mw) ? mw : null,
      canonicalSmiles: p.ConnectivitySMILES ?? null,
      inchikey: p.InChIKey ?? null,
      xlogp: p.XLogP ?? null,
    };
  });
}

export function parseSynonyms(json: unknown, limit: number): string[] {
  const r = synonymsSchema.safeParse(json);
  if (!r.success) throw new PubChemParseError('synonyms', r.error);
  const first = r.data.InformationList.Information[0];
  return (first?.Synonym ?? []).slice(0, limit);
}

/**
 * PubChem's X-Throttling-Control header looks like:
 *   "Request Count status: Green (0%), Request Time status: Green (0%), Service status: Green (43%)"
 * Returns how long to pause outbound requests based on the worst status reported.
 */
export function throttlePauseMs(header: string | null | undefined): number {
  if (!header) return 0;
  const statuses = [...header.matchAll(/status:\s*(Green|Yellow|Red|Black)/gi)].map((m) =>
    m[1]!.toLowerCase(),
  );
  if (statuses.includes('black')) return 15_000;
  if (statuses.includes('red')) return 5_000;
  if (statuses.includes('yellow')) return 1_000;
  return 0;
}
