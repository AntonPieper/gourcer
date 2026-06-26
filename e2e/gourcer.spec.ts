import { expect, test, type Page } from '@playwright/test';
import { PNG } from 'pngjs';

test('renders the hell-ui history with live controls and a nonblank Three canvas', async ({
  page,
}) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Gourcer' })).toBeVisible();
  await expect(page.getByTestId('timeline-hud')).toBeVisible();
  await expect(page.getByLabel('Languages used near current time')).toBeVisible();
  await expect(page.getByLabel('Scrub timeline')).toBeVisible();
  await expect(page.getByLabel('Export WebM video')).toBeVisible();
  await expect(page.locator('canvas')).toBeVisible();

  await expect.poll(() => page.locator('.legend-item').count()).toBeGreaterThan(0);
  await expect.poll(() => canvasStats(page)).toMatchObject({
    hasBrightPixels: true,
    hasColorVariance: true,
  });

  await page.getByLabel('Pause timeline').click();
  const scrubber = page.getByLabel('Scrub timeline');
  const max = await scrubber.evaluate((input) => (input as HTMLInputElement).max);

  await scrubber.evaluate((input, value) => {
    const range = input as HTMLInputElement;
    range.value = value;
    range.dispatchEvent(new Event('input', { bubbles: true }));
  }, max);

  await expect(page.getByText('100%')).toBeVisible();
});

async function canvasStats(page: Page) {
  const canvas = page.locator('canvas').first();
  const screenshot = await canvas.screenshot();
  const png = PNG.sync.read(screenshot);
  const colors = new Set<string>();
  let brightPixels = 0;

  for (let y = 0; y < png.height; y += 8) {
    for (let x = 0; x < png.width; x += 8) {
      const index = (png.width * y + x) * 4;
      const r = png.data[index] ?? 0;
      const g = png.data[index + 1] ?? 0;
      const b = png.data[index + 2] ?? 0;
      const a = png.data[index + 3] ?? 0;

      if (a === 0) {
        continue;
      }

      colors.add(`${Math.round(r / 12)}:${Math.round(g / 12)}:${Math.round(b / 12)}`);

      if (r + g + b > 160) {
        brightPixels += 1;
      }
    }
  }

  return {
    hasBrightPixels: brightPixels > 10,
    hasColorVariance: colors.size > 14,
  };
}
