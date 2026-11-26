import { describe, expect, it, vi } from 'vitest';
import { getDailyFact, searchCompounds, structureImageUrl } from './api.js';

const respond = (status, body, type = 'application/json') =>
  vi.fn(() => Promise.resolve(new Response(body, { status, headers: { 'content-type': type } })));

describe('api client', () => {
  it('URL-encodes the search query and returns the JSON body', async () => {
    const fetchMock = respond(200, JSON.stringify({ query: 'a b', results: [] }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(searchCompounds('a b&c=1')).resolves.toEqual({ query: 'a b', results: [] });
    expect(fetchMock).toHaveBeenCalledWith('/api/compounds/search?q=a%20b%26c%3D1');
  });

  it('throws the API error message for JSON errors', async () => {
    vi.stubGlobal('fetch', respond(400, JSON.stringify({ error: { code: 'INVALID_INPUT', message: 'q must not be empty' } })));
    await expect(searchCompounds('')).rejects.toThrow('q must not be empty');
  });

  it('throws a generic message when the error body is not JSON (e.g. proxy error page)', async () => {
    vi.stubGlobal('fetch', respond(502, '<html>Bad gateway</html>', 'text/html'));
    await expect(searchCompounds('x')).rejects.toThrow('Request failed (HTTP 502)');
  });

  it('getDailyFact unwraps the fact', async () => {
    vi.stubGlobal('fetch', respond(200, JSON.stringify({ fact: 'F' })));
    await expect(getDailyFact()).resolves.toBe('F');
  });

  it('builds backend image URLs', () => {
    expect(structureImageUrl(2244)).toBe('/api/compounds/2244/image');
  });
});
