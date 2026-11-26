import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  // The browser must only ever talk to the MolLookUp origin.
  page.on('request', (req) => {
    expect(req.url(), `browser called ${req.url()} directly`).not.toMatch(/pubchem|rapidapi/i);
  });
});

test('search "aspirin" shows its structure image and formula', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('textbox', { name: /find chemical compounds/i }).fill('aspirin');
  await page.getByRole('button', { name: 'Search' }).click();

  await expect(page.getByRole('heading', { name: 'Aspirin' })).toBeVisible();
  await expect(page.getByText('Formula: C9H8O4')).toBeVisible();
  await expect(page.getByText('Molecular weight: 180.16 g/mol')).toBeVisible();

  const img = page.getByRole('img', { name: '2D structure of Aspirin' });
  // Relative when the UI and API share an origin (local); absolute API URL when deployed separately.
  await expect(img).toHaveAttribute('src', /\/api\/compounds\/2244\/image$/);
  // The PNG actually loaded and decoded (not a broken image).
  await expect
    .poll(() => img.evaluate((el: HTMLImageElement) => (el.complete ? el.naturalWidth : 0)))
    .toBeGreaterThan(0);
});

test('a misspelled name shows the empty state', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('textbox', { name: /find chemical compounds/i }).fill('asprinnn');
  await page.getByRole('button', { name: 'Search' }).click();
  await expect(page.getByText(/No compounds found for “asprinnn”/)).toBeVisible();
});
