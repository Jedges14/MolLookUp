/** Normalize a search query: Unicode NFKC, trim, lowercase, collapse internal whitespace. */
export function normalizeQuery(raw: string): string {
  return raw.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
}

/** True when the normalized query is a bare PubChem CID (e.g. "2244"). */
export function asCid(normalized: string): number | null {
  if (!/^\d{1,10}$/.test(normalized)) return null;
  const n = Number(normalized);
  return Number.isSafeInteger(n) && n > 0 && n <= 2_147_483_647 ? n : null;
}
