// Render code-native SVG assets with the same browser used by UI tests.
import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { logo } from '../src/ui.js';

const root = new URL('../', import.meta.url);
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_BROWSER_CHANNEL || (process.env.CI ? 'chromium' : 'chrome') });
const page = await browser.newPage({ deviceScaleFactor: 1 });
try {
  for (const [density, size] of [['mdpi', 48], ['hdpi', 72], ['xhdpi', 96], ['xxhdpi', 144], ['xxxhdpi', 192]]) {
    await page.setViewportSize({ width: size, height: size });
    for (const round of [false, true]) {
      await page.setContent(`<style>html,body{margin:0;background:transparent}.tile{width:100vw;height:100vh;border-radius:${round ? '50%' : '29%'};background:linear-gradient(145deg,#f394b7,#a67ad7);display:grid;place-items:center;color:white}svg{width:78%;height:78%}</style><div class="tile">${logo()}</div>`);
      await page.screenshot({ path: fileURLToPath(new URL(`android/app/src/main/res/mipmap-${density}/ic_launcher${round ? '_round' : ''}.png`, root)), omitBackground: true });
    }
  }
  for (const name of ['wiring', 'mechanism']) {
    const svg = await readFile(new URL(`docs/images/${name}.svg`, root), 'utf8');
    await page.setViewportSize({ width: 1100, height: name === 'wiring' ? 730 : 610 });
    await page.setContent(`<style>html,body{margin:0}</style>${svg}`);
    await page.screenshot({ path: fileURLToPath(new URL(`docs/images/${name}.png`, root)) });
  }
  console.log('Rendered launcher icons and two documentation diagrams.');
} finally { await browser.close(); }
