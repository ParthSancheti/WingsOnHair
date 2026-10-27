import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const screenshotDirectory = fileURLToPath(new URL('../docs/screenshots/', import.meta.url));
const pageErrors = new WeakMap();
test.beforeEach(async ({ page }) => {
  const errors = []; pageErrors.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
});
test.afterEach(async ({ page }) => expect(pageErrors.get(page)).toEqual([]));

async function preview(page) {
  await page.goto('/');
  await page.locator('.welcome [data-action="demo"]').click();
  await expect(page.locator('.home')).toBeVisible();
  await expect(page.locator('#connection-status')).toContainText('Preview · no device');
}
async function capture(page, name) {
  await mkdir(screenshotDirectory, { recursive: true });
  await expect(page.locator('#toast')).not.toHaveClass(/visible/, { timeout: 5000 });
  await page.screenshot({ path: `${screenshotDirectory}/${name}.png`, fullPage: false, animations: 'disabled' });
}
async function assertNoOverflow(page) {
  const result = await page.evaluate(() => ({ viewport: innerWidth, width: document.documentElement.scrollWidth }));
  expect(result.width).toBeLessThanOrEqual(result.viewport + 1);
}

test('the simple welcome and single-screen controls expose four working modes', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Meet your wings.' })).toBeVisible();
  await capture(page, 'simple-welcome');
  await page.locator('.welcome [data-action="demo"]').click();
  await expect(page.locator('#connection-status')).toContainText('Preview');
  await expect(page.locator('.mode-button')).toHaveCount(4);
  await expect(page.locator('.desktop-nav, .mobile-nav, #battery-value, #shake-toggle, #beat-toggle')).toHaveCount(0);
  for (const [mode, name] of [[1, 'Calm'], [2, 'Pulse'], [3, 'Energy'], [4, 'Night']]) {
    await page.locator(`[data-mode="${mode}"]`).click();
    await expect(page.locator('#current-mood')).toHaveText(name);
    await expect(page.locator(`[data-mode="${mode}"]`)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#play-button')).toHaveAttribute('aria-label', 'Pause wings');
  }
  await page.locator('[data-mode="1"]').click();
  await assertNoOverflow(page);
  await expect(page.locator('.controls')).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(1081);
  await capture(page, 'simple-desktop');
  await page.locator('.theme-toggle').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await capture(page, 'simple-dark');
});

test('the phone screen keeps the main controls visible', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await preview(page);
  await assertNoOverflow(page);
  await expect(page.locator('.controls')).toBeInViewport();
  await expect(page.locator('#play-button')).toBeInViewport();
  await capture(page, 'simple-mobile');
  await page.locator('.theme-toggle').click();
  await capture(page, 'simple-mobile-dark');
});

test('short presses blur the surroundings and holding previews without selecting', async ({ page }) => {
  await preview(page);
  const pulse = page.locator('[data-mode="2"]');
  await pulse.hover(); await page.mouse.down();
  await expect(pulse).toHaveClass(/is-pressed/);
  expect(await page.locator('.hero-region').evaluate(element => getComputedStyle(element).filter)).toContain('blur(2px)');
  await page.mouse.up();
  await expect(pulse).not.toHaveClass(/is-pressed/);
  await expect(page.locator('#current-mood')).toHaveText('Pulse');
  await page.locator('[data-mode="3"]').hover(); await page.mouse.down();
  await expect(page.locator('.mode-sheet')).toBeVisible();
  await expect(page.locator('#sheet-title')).toHaveText('Energy');
  await expect(page.locator('#current-mood')).toHaveText('Pulse');
  expect(await page.locator('.sheet-backdrop').evaluate(element => getComputedStyle(element).backdropFilter)).toContain('blur(22px)');
  await page.mouse.up();
  await expect(page.locator('.mode-sheet')).toBeVisible();
  await expect(page.locator('#current-mood')).toHaveText('Pulse');
  await capture(page, 'simple-mode-preview');
  await page.locator('[data-action="use-mode"]').click();
  await expect(page.locator('.sheet')).toHaveCount(0);
  await expect(page.locator('#current-mood')).toHaveText('Energy');
});

test('keyboard holds open a preview and never activate a mode on release', async ({ page }) => {
  await preview(page);
  await page.locator('[data-mode="4"]').focus(); await page.keyboard.down('Enter');
  await expect(page.locator('.mode-sheet')).toBeVisible();
  await expect(page.locator('#sheet-title')).toHaveText('Night');
  await page.keyboard.up('Enter');
  await expect(page.locator('#current-mood')).toHaveText('Calm');
  await page.keyboard.press('Escape');
  await expect(page.locator('.sheet')).toHaveCount(0);
  await page.locator('[data-mode="2"]').focus(); await page.keyboard.press('Space');
  await expect(page.locator('#current-mood')).toHaveText('Pulse');
  await expect(page.locator('.sheet')).toHaveCount(0);
});

test('speed changes preserve paused and running states and survive a reload', async ({ page }) => {
  await preview(page);
  await page.locator('#play-button').click();
  await expect(page.locator('#play-button')).toHaveAttribute('aria-label', 'Start wings');
  await page.locator('[data-action="speed"]').click();
  await page.locator('#speed-slider').focus(); await page.locator('#speed-slider').press('ArrowRight');
  await expect(page.locator('#speed-value')).toHaveText('0.7 Hz');
  await page.waitForTimeout(800);
  await expect(page.locator('#play-button')).toHaveAttribute('aria-label', 'Start wings');
  await page.getByRole('button', { name: /^Done/ }).click();
  await page.locator('#play-button').click();
  await page.locator('[data-action="speed"]').click();
  await page.locator('#speed-slider').focus(); await page.locator('#speed-slider').press('ArrowRight');
  await expect(page.locator('#speed-value')).toHaveText('0.8 Hz');
  await page.waitForTimeout(800);
  await expect(page.locator('#play-button')).toHaveAttribute('aria-label', 'Pause wings');
  await page.getByRole('button', { name: /^Done/ }).click();
  await page.reload();
  await expect(page.locator('.welcome')).toHaveCount(0);
  await expect(page.locator('#play-button')).toHaveAttribute('aria-label', 'Start wings');
  await page.locator('[data-action="speed"]').click();
  await expect(page.locator('#speed-value')).toHaveText('0.8 Hz');
});

test('appearance persists and replay welcome remains usable', async ({ page }) => {
  await preview(page); await page.locator('.theme-toggle').click(); await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.locator('[data-action="about"]').click();
  await expect(page.locator('.about-sheet')).toBeVisible();
  await page.locator('[data-action="replay"]').click();
  await expect(page.locator('.welcome')).toBeVisible();
  await page.locator('.welcome [data-action="demo"]').click();
  await expect(page.locator('.home')).toBeVisible();
  await expect(page.locator('#connection-status')).toContainText('Preview');
  await expect(page.locator('.app-shell')).not.toHaveAttribute('inert', '');
});

test('pairing failure can be dismissed and recovered with preview', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'bluetooth', { configurable: true, value: undefined }));
  await page.goto('/'); await page.locator('[data-action="begin"]').click();
  await page.locator('[data-action="skip-name"]').click();
  await expect(page.locator('.pair-sheet')).toBeVisible();
  await page.locator('#connect-button').click();
  await expect(page.locator('#pair-error')).toContainText('This browser cannot connect to Bluetooth');
  await expect(page.locator('#connect-button')).toBeEnabled();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.locator('.sheet')).toHaveCount(0);
  await expect(page.locator('.welcome')).toBeVisible();
  await page.locator('.bluetooth-button').click();
  await page.locator('.pair-sheet [data-action="demo"]').click();
  await expect(page.locator('#connection-status')).toContainText('Preview · no device');
});

test('update results stay plain text and failed checks remain retryable', async ({ page }) => {
  let fail = false;
  await page.route('https://api.github.com/repos/ParthSancheti/WingsOnHair/**', async route => {
    if (fail) return route.fulfill({ status: 403, json: { message: '<script>window.injected=true</script>' } });
    if (route.request().url().includes('/releases/latest')) return route.fulfill({ json: { tag_name: 'v2.6.0', name: '<img src=x onerror="window.injected=true">', body: '<script>window.injected=true</script>', html_url: 'https://github.com/ParthSancheti/WingsOnHair/releases/tag/v2.6.0' } });
    return route.fulfill({ contentType: 'text/plain', body: '<script>window.injected=true</script>' });
  });
  await preview(page); await page.locator('[data-action="about"]').click();
  await page.locator('#update-button').click();
  await expect(page.locator('#update-result')).toHaveText('v2.6.0 is available.');
  await expect(page.locator('#update-link a')).toHaveAttribute('href', 'https://github.com/ParthSancheti/WingsOnHair/releases/tag/v2.6.0');
  expect(await page.evaluate(() => window.injected)).toBeUndefined();
  await expect(page.locator('.about-sheet script, .about-sheet img')).toHaveCount(0);
  fail = true; await page.locator('#update-button').click();
  await expect(page.locator('#update-result')).toContainText('GitHub rate limit reached.');
  await expect(page.locator('#update-button')).toBeEnabled();
});

for (const viewport of [{ width: 320, height: 568 }, { width: 844, height: 390 }]) {
  test(`controls and sheets stay reachable at ${viewport.width}×${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport); await preview(page); await assertNoOverflow(page);
    await page.locator('[data-action="speed"]').click(); await assertNoOverflow(page);
    const bounds = await page.locator('.sheet').boundingBox();
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width + 1);
    await page.getByRole('button', { name: /^Done/ }).scrollIntoViewIfNeeded();
    await expect(page.getByRole('button', { name: /^Done/ })).toBeInViewport();
    await page.getByRole('button', { name: /^Done/ }).click();
    await page.locator('.brand').click();
    await page.locator('[data-action="replay"]').scrollIntoViewIfNeeded();
    await expect(page.locator('[data-action="replay"]')).toBeInViewport();
    await assertNoOverflow(page);
  });
}

test('visible animation and the Capacitor vibration path run with motion enabled', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.addInitScript(() => {
    window.welcomeTransforms = [];
    window.vibrationCalls = [];
    Object.defineProperty(navigator, 'vibrate', {
      configurable: true,
      value(pattern) { window.vibrationCalls.push(Array.isArray(pattern) ? [...pattern] : [pattern]); return true; },
    });
    document.addEventListener('animationstart', event => {
      if (!event.target.classList?.contains('welcome-art')) return;
      let frames = 0;
      const sample = () => {
        const style = getComputedStyle(event.target);
        if (style.animationPlayState !== 'paused') {
          window.welcomeTransforms.push(style.transform); frames++;
        }
        if (frames < 8) requestAnimationFrame(sample);
      };
      sample();
    });
  });
  await page.goto('/');
  await expect(page.locator('.launch-screen')).toBeVisible();
  expect(await page.locator('.launch-tile').evaluate(el => getComputedStyle(el).animationName)).toBe('icon-unfold');
  await expect(page.locator('.launch-screen')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => new Set(window.welcomeTransforms).size)).toBeGreaterThan(1);
  const animation = await page.locator('.welcome-art').evaluate(element => ({ name: getComputedStyle(element).animationName, duration: getComputedStyle(element).animationDuration }));
  expect(animation.name).toContain('butterfly-arrive');
  expect(animation.duration).toBe('1.3s');
  await page.locator('.welcome-art').evaluate(element => Promise.all(element.getAnimations().map(item => item.finished)));
  const before = await page.evaluate(() => ({ angle: document.documentElement.style.getPropertyValue('--left-wing-angle'), matrix: getComputedStyle(document.querySelector('.welcome-art .wing-left')).transform }));
  await expect.poll(() => page.evaluate(() => document.documentElement.style.getPropertyValue('--left-wing-angle'))).not.toBe(before.angle);
  await expect.poll(() => page.locator('.welcome-art .wing-left').evaluate(element => getComputedStyle(element).transform)).not.toBe(before.matrix);

  await page.locator('.welcome [data-action="demo"]').click();
  await expect(page.locator('.home')).toBeVisible();
  await page.locator('[data-mode="3"]').hover();
  await page.waitForTimeout(90); // Let the app's short haptic debounce expire.
  await page.evaluate(() => { window.vibrationCalls = []; });
  await page.mouse.down();
  await expect.poll(() => page.evaluate(() => window.vibrationCalls.some(pattern => pattern.length === 1 && pattern[0] === 20))).toBe(true);
  await expect(page.locator('.mode-sheet')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.vibrationCalls.some(pattern => pattern.length === 1 && pattern[0] === 43))).toBe(true);
  await page.mouse.up();
  await expect(page.locator('#current-mood')).toHaveText('Calm');
  const preview = await page.locator('.mode-preview-art').evaluate(element => ({ angle: element.style.getPropertyValue('--left-wing-angle'), matrix: getComputedStyle(element.querySelector('.wing-left')).transform }));
  await expect.poll(() => page.locator('.mode-preview-art').evaluate(element => element.style.getPropertyValue('--left-wing-angle'))).not.toBe(preview.angle);
  await expect.poll(() => page.locator('.mode-preview-art .wing-left').evaluate(element => getComputedStyle(element).transform)).not.toBe(preview.matrix);
});

test('name onboarding saves a name and opens the connection radar', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/'); await page.locator('[data-action="begin"]').click();
  await expect(page.getByRole('heading', { name: 'What should you be called?' })).toBeVisible();
  await page.getByLabel('Your name').fill('Parth');
  await capture(page, 'simple-name');
  await page.getByRole('button', { name: 'Next' }).click();
  await expect(page.locator('.pair-sheet .radar')).toBeVisible();
  await capture(page, 'simple-pairing');
  await page.locator('.pair-sheet [data-action="demo"]').click();
  await expect(page.locator('.butterfly-caption p')).toHaveText('A little magic for Parth.');
  await page.reload();
  await expect(page.locator('.butterfly-caption p')).toHaveText('A little magic for Parth.');
});

test('fluid theme uses distinct blends, slow motion and rounded top controls', async ({ page }) => {
  await preview(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const orb = page.locator('.orb-one');
  await expect(page.locator('.aurora-orb')).toHaveCount(4);
  expect(await orb.evaluate(el => getComputedStyle(el).mixBlendMode)).toBe('multiply');
  expect(await orb.evaluate(el => getComputedStyle(el).animationDuration)).toBe('25s');
  expect(await page.locator('.orb-two').evaluate(el => getComputedStyle(el).animationDuration)).toBe('22s');
  expect(await page.locator('.fluid-field').evaluate(el => getComputedStyle(el).animationDuration)).toBe('20s');
  const matrix = await orb.evaluate(el => getComputedStyle(el).transform);
  await expect.poll(() => orb.evaluate(el => getComputedStyle(el).transform)).not.toBe(matrix);
  expect(await page.locator('.aurora').evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgb(240, 244, 248)');
  const header = await page.locator('.floating-bar').boundingBox();
  expect(header.y).toBeGreaterThanOrEqual(24);
  expect(await page.locator('.brand-icon').evaluate(el => getComputedStyle(el).borderRadius)).toBe('50%');
  const play = await page.locator('#play-button').boundingBox();
  const hero = await page.locator('.hero-region').boundingBox();
  const caption = await page.locator('.butterfly-caption').boundingBox();
  expect(play.y + play.height).toBeLessThanOrEqual(hero.y);
  expect(caption.y).toBeGreaterThanOrEqual(hero.y + hero.height);
  await page.locator('.theme-toggle').click();
  expect(await orb.evaluate(el => getComputedStyle(el).mixBlendMode)).toBe('screen');
  await expect.poll(() => page.locator('.aurora').evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgb(5, 5, 8)');
});
