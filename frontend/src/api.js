// All network access goes through the MolLookUp backend; the browser never calls PubChem or RapidAPI.
const BASE = import.meta.env.VITE_API_URL ?? '';

async function getJson(path) {
  const res = await fetch(`${BASE}${path}`);
  let body = null;
  try {
    body = await res.json();
  } catch {
    // non-JSON (e.g. proxy error page)
  }
  if (!res.ok) {
    throw new Error(body?.error?.message ?? `Request failed (HTTP ${res.status})`);
  }
  return body;
}

/** @returns {Promise<{query: string, results: {cid: number, name: string, formula: string|null, mw: number|null}[]}>} */
export function searchCompounds(query) {
  return getJson(`/api/compounds/search?q=${encodeURIComponent(query)}`);
}

export async function getDailyFact() {
  return (await getJson('/api/fact')).fact;
}

export function structureImageUrl(cid) {
  return `${BASE}/api/compounds/${cid}/image`;
}
