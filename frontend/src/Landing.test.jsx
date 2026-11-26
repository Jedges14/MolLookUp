import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import LandingPage from './Landing.jsx';

const json = (status, body) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

const aspirin = { cid: 2244, name: 'Aspirin', formula: 'C9H8O4', mw: 180.16 };

/**
 * Stub fetch by URL. `search` decides the search response; `fact` the fact response.
 * Returns the mock so tests can inspect calls.
 */
function stubApi({ search = () => json(200, { query: 'aspirin', results: [aspirin] }), fact } = {}) {
  const fetchMock = vi.fn((url) => {
    const u = String(url);
    if (u.startsWith('/api/fact')) return fact ? fact() : json(200, { fact: 'Octopuses have three hearts.' });
    if (u.startsWith('/api/compounds/search')) return search(u);
    return Promise.reject(new Error(`unexpected fetch ${u}`));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const searchBox = () => screen.getByRole('textbox', { name: /find chemical compounds/i });
const searchButton = () => screen.getByRole('button', { name: /search/i });

async function searchFor(text) {
  const user = userEvent.setup();
  await user.type(searchBox(), text);
  await user.click(searchButton());
  return user;
}

describe('LandingPage', () => {
  it('shows the daily fact from the backend and caches it for the day', async () => {
    const fetchMock = stubApi();
    render(<LandingPage />);
    expect(await screen.findByText('Octopuses have three hearts.')).toBeInTheDocument();
    expect(localStorage.getItem('fact')).toBe('Octopuses have three hearts.');

    // A second visit the same day uses the stored fact; no new request.
    const callsBefore = fetchMock.mock.calls.length;
    render(<LandingPage />);
    expect(fetchMock.mock.calls.length).toBe(callsBefore);
  });

  it('falls back gracefully when the fact endpoint is unavailable', async () => {
    stubApi({ fact: () => json(503, { error: { code: 'FACT_UNAVAILABLE', message: 'not configured' } }) });
    render(<LandingPage />);
    expect(await screen.findByText('Sorry, no fact today.')).toBeInTheDocument();
  });

  it('loads the molecule-of-the-day structure through the backend, not PubChem', () => {
    stubApi();
    localStorage.setItem('mol', JSON.stringify({ name: 'Caffeine', cid: 2519, formula: 'C8H10N4O2', weight: 194.19 }));
    localStorage.setItem('molupdateTime', String(Date.now()));
    render(<LandingPage />);
    const img = screen.getByRole('img', { name: '2D structure of Caffeine' });
    expect(img).toHaveAttribute('src', '/api/compounds/2519/image');
  });

  it('searches and renders name, formula, molecular weight and structure image', async () => {
    const fetchMock = stubApi();
    render(<LandingPage />);
    await searchFor('  Aspirin ');

    expect(await screen.findByRole('heading', { name: 'Aspirin' })).toBeInTheDocument();
    expect(screen.getByText('Formula: C9H8O4')).toBeInTheDocument();
    expect(screen.getByText('Molecular weight: 180.16 g/mol')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '2D structure of Aspirin' })).toHaveAttribute(
      'src',
      '/api/compounds/2244/image',
    );
    expect(fetchMock).toHaveBeenCalledWith('/api/compounds/search?q=Aspirin');
  });

  it('shows a loading state and disables the button while searching', async () => {
    let resolve;
    stubApi({ search: () => new Promise((r) => (resolve = r)) });
    render(<LandingPage />);
    await searchFor('aspirin');

    expect(screen.getByText(/Searching for “aspirin”/)).toBeInTheDocument();
    expect(searchButton()).toBeDisabled();

    resolve(new Response(JSON.stringify({ query: 'aspirin', results: [aspirin] }), { status: 200 }));
    expect(await screen.findByRole('heading', { name: 'Aspirin' })).toBeInTheDocument();
    expect(searchButton()).toBeEnabled();
  });

  it('shows an empty state when nothing matches', async () => {
    stubApi({ search: () => json(200, { query: 'asprinnn', results: [] }) });
    render(<LandingPage />);
    await searchFor('asprinnn');
    expect(await screen.findByText(/No compounds found for “asprinnn”/)).toBeInTheDocument();
  });

  it('shows the API error message when the search fails', async () => {
    stubApi({
      search: () => json(503, { error: { code: 'UPSTREAM_BUSY', message: 'PubChem is busy; please try again shortly' } }),
    });
    render(<LandingPage />);
    await searchFor('aspirin');
    expect(await screen.findByRole('alert')).toHaveTextContent('PubChem is busy; please try again shortly');
  });

  it('does not search for whitespace-only input', async () => {
    const fetchMock = stubApi();
    render(<LandingPage />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1)); // the fact request
    await searchFor('   ');
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/search'))).toBe(false);
  });

  it('shows "n/a" for missing formula or weight', async () => {
    stubApi({ search: () => json(200, { query: 'x', results: [{ cid: 1, name: 'Mystery', formula: null, mw: null }] }) });
    render(<LandingPage />);
    await searchFor('mystery');
    expect(await screen.findByText('Formula: n/a')).toBeInTheDocument();
    expect(screen.getByText('Molecular weight: n/a')).toBeInTheDocument();
  });
});
