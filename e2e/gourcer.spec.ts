import { expect, test, type Page } from '@playwright/test';

test('renders the hell-ui history with live controls and a nonblank Three canvas', async ({
  page,
}, testInfo) => {
  await page.goto('./');

  await expect(page.getByRole('heading', { name: 'Gourcer' })).toBeVisible();
  await expect(page.getByTestId('timeline-hud')).toBeVisible();
  await expect(page.getByLabel('Languages used near current time')).toBeVisible();
  await expect(page.getByLabel('Scrub timeline')).toBeVisible();
  await expect(page.getByLabel('Export WebM video')).toBeVisible();
  await expect(page.locator('canvas')).toBeVisible();

  await expect.poll(() => page.locator('.legend-item').count()).toBeGreaterThan(0);
  await expect.poll(() => graphStats(page), { timeout: 15_000 }).toMatchObject({
    framed: true,
    hasConnectedGraph: true,
    hasReadableSpacing: true,
  });
  await expect.poll(() => legendAnimationState(page)).toMatchObject({
    animates: true,
  });

  const playingTime = await currentTimelineTime(page);
  await expect
    .poll(() => currentTimelineTime(page), { timeout: 5_000 })
    .toBeGreaterThan(playingTime);

  await page.getByLabel('Pause timeline').click();
  await page.waitForTimeout(150);
  const pausedTime = await currentTimelineTime(page);
  await page.waitForTimeout(500);
  expect(await currentTimelineTime(page)).toBe(pausedTime);

  if (testInfo.project.name === 'chromium') {
    const beforeInteraction = await graphInteractionState(page);
    await page.mouse.move(640, 360);
    await page.mouse.wheel(0, -420);
    await page.mouse.down();
    await page.mouse.move(710, 390);
    await page.mouse.up();
    const afterInteraction = await graphInteractionState(page);
    expect(afterInteraction.zoom).toBeGreaterThan(beforeInteraction.zoom);
    expect(
      afterInteraction.cameraX !== beforeInteraction.cameraX ||
        afterInteraction.cameraY !== beforeInteraction.cameraY,
    ).toBe(true);
  }

  const scrubber = page.getByLabel('Scrub timeline');
  const max = await scrubber.evaluate((input) => (input as HTMLInputElement).max);

  await scrubber.evaluate((input, value) => {
    const range = input as HTMLInputElement;
    range.value = value;
    range.dispatchEvent(new Event('input', { bubbles: true }));
  }, max);

  await expect(page.getByText('100%')).toBeVisible();
});

async function graphStats(page: Page) {
  return page.getByTestId('graph-debug').evaluate((element) => {
    const files = Number(element.getAttribute('data-files') ?? 0);
    const directories = Number(element.getAttribute('data-directories') ?? 0);
    const edges = Number(element.getAttribute('data-edges') ?? 0);
    const minFileClearance = Number(element.getAttribute('data-min-file-clearance') ?? 0);
    const minFileSpacing = Number(element.getAttribute('data-min-file-spacing') ?? 0);
    const width = Number(element.getAttribute('data-bounds-width') ?? 0);
    const height = Number(element.getAttribute('data-bounds-height') ?? 0);

    return {
      framed: width > 20 && width <= 105 && height > 20 && height <= 100,
      hasConnectedGraph: files > 100 && directories > 20 && edges > files,
      hasReadableSpacing: minFileSpacing >= 0.5 && minFileClearance >= 0.05,
    };
  });
}

async function currentTimelineTime(page: Page) {
  return page
    .getByTestId('graph-debug')
    .evaluate((element) => Number(element.getAttribute('data-current-time') ?? 0));
}

async function legendAnimationState(page: Page) {
  return page.locator('.legend').evaluate((element) => {
    const firstItem = element.querySelector('.legend-item');
    const styles = firstItem ? getComputedStyle(firstItem) : null;
    return {
      animates: styles
        ? styles.animationName !== 'none' ||
          styles.transitionDuration
          .split(',')
          .some((duration) => Number.parseFloat(duration) > 0)
        : false,
    };
  });
}

async function graphInteractionState(page: Page) {
  return page.locator('canvas').evaluate((canvas) => {
    const state = (canvas as HTMLCanvasElement).dataset;
    return {
      cameraX: Number(state.cameraX ?? 0),
      cameraY: Number(state.cameraY ?? 0),
      zoom: Number(state.zoom ?? 0),
    };
  });
}
