import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  PubChemParseError,
  parseCidList,
  parseProperties,
  parseSynonyms,
  throttlePauseMs,
} from '../../src/pubchem/parse.js';

// Fixtures are real PubChem PUG-REST responses recorded on 2026-11-25
// (aspirin_synonyms.json trimmed to its first 30 synonyms).
const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8'));

describe('parseCidList', () => {
  it('reads the CID list', () => {
    expect(parseCidList(fixture('aspirin_cids.json'))).toEqual([2244]);
  });
  it('rejects a Fault body', () => {
    expect(() => parseCidList(fixture('notfound_cids.json'))).toThrow(PubChemParseError);
  });
});

describe('parseProperties', () => {
  it('maps PubChem fields onto Compound, converting MolecularWeight to a number', () => {
    const [aspirin, acetaminophen] = parseProperties(fixture('aspirin_properties.json'));
    expect(aspirin).toEqual({
      cid: 2244,
      name: 'Aspirin',
      iupacName: '2-acetyloxybenzoic acid',
      formula: 'C9H8O4',
      molWeight: 180.16,
      canonicalSmiles: 'CC(=O)OC1=CC=CC=C1C(=O)O',
      inchikey: 'BSYNRYMUTXBXSQ-UHFFFAOYSA-N',
      xlogp: 1.2,
    });
    expect(acetaminophen?.cid).toBe(1983);
  });

  it('falls back to IUPAC name, then "CID n", and nulls missing fields', () => {
    const rows = parseProperties({
      PropertyTable: { Properties: [{ CID: 1, IUPACName: 'x' }, { CID: 2, MolecularWeight: 'n/a' }] },
    });
    expect(rows[0]?.name).toBe('x');
    expect(rows[1]).toMatchObject({ name: 'CID 2', molWeight: null, formula: null, xlogp: null });
  });

  it('rejects malformed input', () => {
    expect(() => parseProperties({ PropertyTable: { Properties: [{ CID: 'abc' }] } })).toThrow(
      PubChemParseError,
    );
  });
});

describe('parseSynonyms', () => {
  it('returns at most `limit` synonyms in PubChem order', () => {
    const syn = parseSynonyms(fixture('aspirin_synonyms.json'), 3);
    expect(syn).toEqual(['aspirin', 'ACETYLSALICYLIC ACID', '50-78-2']);
  });
});

describe('throttlePauseMs', () => {
  it('is 0 for all-green or a missing header', () => {
    expect(
      throttlePauseMs(
        'Request Count status: Green (0%), Request Time status: Green (0%), Service status: Green (43%)',
      ),
    ).toBe(0);
    expect(throttlePauseMs(null)).toBe(0);
  });
  it('uses the worst status reported', () => {
    expect(throttlePauseMs('Request Count status: Yellow (60%), Service status: Green (5%)')).toBe(1000);
    expect(throttlePauseMs('Request Count status: Yellow (60%), Request Time status: Red (80%)')).toBe(
      5000,
    );
    expect(throttlePauseMs('Service status: Black (100%)')).toBe(15_000);
  });
});
