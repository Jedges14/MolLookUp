import { describe, expect, it } from 'vitest';
import { asCid, normalizeQuery } from '../../src/lib/normalize.js';

describe('normalizeQuery', () => {
  it.each([
    ['  Aspirin ', 'aspirin'],
    ['ACETYLSALICYLIC   ACID', 'acetylsalicylic acid'],
    ['vitamin\tC\n', 'vitamin c'],
    ['ｃａｆｆｅｉｎｅ', 'caffeine'], // full-width letters (NFKC)
    ['', ''],
  ])('%j → %j', (input, expected) => {
    expect(normalizeQuery(input)).toBe(expected);
  });
});

describe('asCid', () => {
  it('accepts positive integers', () => {
    expect(asCid('2244')).toBe(2244);
  });
  it.each(['0', '-1', '12a', '1.5', '99999999999', ''])('rejects %j', (input) => {
    expect(asCid(input)).toBeNull();
  });
});
