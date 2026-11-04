import './style.css';
import { Capacitor, SystemBars, SystemBarsStyle } from '@capacitor/core';
import { App } from '@capacitor/app';
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { StatusBar } from '@capacitor/status-bar';
import { WingConnection } from './src/services/ble.js';
import { reconcileWingTelemetry } from './src/services/live-state.js';
import { DEFAULT_SETTINGS, PRESETS, sampleWingAngle, validateSettings } from './src/services/protocol.js';
import { checkForUpdates } from './src/services/updates.js';
import { validateTravel } from './src/services/device-protocol.js';
import { verifyFirmwareManifest, verifyFirmwareImage } from './src/services/firmware.js';
import { downloadGithubAsset } from './src/services/github-download.js';
import { version as APP_VERSION } from './package.json';
import { installPressFeedback } from './src/interactions.js';
import { butterfly, logo, icon, escapeHtml } from './src/ui.js';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const storage = {
  get(key, fallback = null) { try { return JSON.parse(localStorage.getItem(`woh.${key}`)) ?? fallback; } catch { return fallback; } },
  set(key, value) { try { localStorage.setItem(`woh.${key}`, JSON.stringify(value)); } catch { /* Storage may be disabled. */ } },
};
const moods = [
  { mode: 1, name: 'Calm', description: 'Slow, gentle flutters.', icon: 'wind' },
  { mode: 2, name: 'Pulse', description: 'Two flutters. A little pause.', icon: 'pulse' },
  { mode: 3, name: 'Energy', description: 'A little more lively.', icon: 'sparkles' },
  { mode: 4, name: 'Night', description: 'Soft and unhurried.', icon: 'moon' },
];
const state = {
  theme: storage.get('theme') === 'dark' ? 'dark' : 'light', welcome: storage.get('onboarded') !== true,
  settings: { ...DEFAULT_SETTINGS }, running: false, connection: { status: 'disconnected', stability: 'offline' },
  telemetry: null, sheet: null, previewMode: null, commandPending: false, welcomeStep: 0,
  availableUpdate: null,
  deviceSettings: null, firmwareBusy: false, firmwareCandidate: null,
  name: typeof storage.get('name') === 'string' ? storage.get('name').slice(0, 30) : '',
};
try { const saved = storage.get('simple.settings'); if (saved && moods.some(m => m.mode === saved.mode)) state.settings = validateSettings(saved); } catch { /* Use Calm for incompatible preferences. */ }
const connection = new WingConnection();
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let animationFrame, angle = 32, lastFrame = 0, sendTimer, sendGeneration = 0, commandGraceUntil = 0;
let toastTimer, sheetGeneration = 0, lastFocus, connectionBusy = false, lastHaptic = 0, localFlutterUntil = 0, launchTimer;
let lastAutomaticUpdateCheck = 0;
let automaticUpdateCheckPending = false;
const nativeListeners = [];
let firmwareAbort = null;
const ready = () => ['connected', 'demo'].includes(state.connection.status);
const demo = () => state.connection.status === 'demo';

function haptic(kind = 'light') {
  if (Date.now() - lastHaptic < 65) return;
  lastHaptic = Date.now();
  const feedback = kind === 'success' ? Haptics.notification({ type: NotificationType.Success }) : Haptics.impact({ style: kind === 'medium' ? ImpactStyle.Medium : ImpactStyle.Light });
  feedback.catch(() => {});
}
function toast(message) {
  clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').classList.add('visible');
  toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 2800);
}
function render() {
  $('#app').innerHTML = `<div class="app-shell"><header class="floating-bar press-surface"><button class="brand pressable" data-action="about" data-press aria-label="About Wings On Hair"><span class="brand-icon">${logo()}</span><span>Wings On Hair</span></button><div class="bar-actions"><button class="icon-button bluetooth-button pressable" data-action="pair" data-press aria-label="Connect wings">${icon('bluetooth')}<i id="header-dot"></i></button><button class="icon-button theme-toggle pressable" data-action="theme" data-press aria-label="Switch theme">${icon('moon')}</button></div></header><div id="view"></div></div><div id="sheet-root"></div><aside id="update-banner" class="update-banner glass" role="status" hidden></aside>`;
  renderView(); applyTheme();
}
function renderView() {
  $('#view').innerHTML = state.welcome ? state.welcomeStep === 1 ? nameMarkup() : `<main class="welcome press-surface" aria-labelledby="welcome-title"><div class="welcome-art">${butterfly('welcome')}</div><div class="welcome-copy"><span class="section-kicker">A LITTLE EVERYDAY MAGIC</span><h1 id="welcome-title">Meet your wings.</h1><p>Pick a mood. Let them move.</p></div><div class="welcome-actions"><button class="primary-button pressable" data-action="begin" data-press>Get started ${icon('arrow')}</button><button class="text-button pressable" data-action="demo" data-press>Just looking? Try preview</button></div><span class="welcome-note">Wings On Hair · Made to move with you</span></main>` : `<main class="home press-surface" aria-label="Wing controls">
    <div class="playback-row"><button class="connection-status pressable" id="connection-status" data-action="pair" data-press><i></i><span>Not connected</span>${icon('chevron')}</button><button id="play-button" class="primary-button pressable" data-action="play" data-press>${icon('play')}<span>Start wings</span></button></div>
    <div class="hero-region"><div class="wing-glow" aria-hidden="true"></div><button class="butterfly-button pressable" data-action="flutter" data-press aria-label="Make the butterfly flutter">${butterfly('home')}</button></div>
    <div class="butterfly-caption"><h1>Wings On Hair</h1><p>${state.name ? `A little magic for ${escapeHtml(state.name)}.` : 'A little movement. Entirely yours.'}</p><span id="battery-estimate" class="battery-estimate" hidden></span></div>
    <section class="controls" aria-label="Choose a mode"><div class="controls-heading"><span>Find your rhythm</span><span class="current-mood" aria-live="polite"><i></i><span id="current-mood">Calm</span></span></div><div class="modes" role="group" aria-label="Wing modes">${moods.map(m => `<button class="mode-button glass pressable" data-mode="${m.mode}" data-press aria-pressed="${m.mode === state.settings.mode}" aria-label="${m.name} mode"><span class="mode-card-top"><span class="mode-icon">${icon(m.icon)}</span><span class="mode-check">${icon('check')}</span></span><span class="mode-name">${m.name}</span><span class="mode-description">${m.description}</span></button>`).join('')}</div>
    <button class="pace-row glass pressable" data-action="speed" data-press aria-label="Adjust speed"><span class="pace-icon">${icon('sliders')}</span><span>Your pace</span><span id="pace-value">0.6 Hz</span>${icon('chevron')}</button></section><p class="hold-hint">Tap the butterfly to flutter · Hold a mood to preview</p></main>`;
  if (state.welcome && state.welcomeStep === 1) $('#name-form').addEventListener('submit', event => {
    event.preventDefault(); state.name = $('#user-name').value.trim().slice(0, 30); storage.set('name', state.name); haptic(); openSheet('pair');
  });
  updateUI();
}
function nameMarkup() {
  return `<main class="welcome name-screen press-surface"><button class="name-back text-button pressable" data-action="welcome-back" data-press>${icon('back')} Back</button><div class="name-avatar">${butterfly('name')}</div><div class="name-card glass"><span class="section-kicker">LET’S MAKE IT YOURS</span><h1>What should you<br>be called?</h1><p>A name for our little adventure.</p><form id="name-form"><label for="user-name">Your name</label><input id="user-name" type="text" maxlength="30" autocomplete="given-name" placeholder="Enter your name" value="${escapeHtml(state.name)}"><button type="submit" class="primary-button pressable" data-press>Next ${icon('arrow')}</button></form><button class="text-button name-skip pressable" data-action="skip-name" data-press>Skip</button></div></main>`;
}
function launchIntro() {
  if (reducedMotion.matches) return;
  clearTimeout(launchTimer); $('.launch-screen')?.remove();
  const overlay = document.createElement('div'); overlay.className = 'launch-screen'; overlay.setAttribute('aria-hidden', 'true');
  overlay.innerHTML = `<div class="launch-tile">${logo()}</div><div class="launch-flight">${butterfly('launch')}</div>`;
  document.body.append(overlay); $('.app-shell').inert = true; document.documentElement.classList.add('launch-active');
  launchTimer = setTimeout(() => { overlay.remove(); document.documentElement.classList.remove('launch-active'); $('.app-shell').inert = Boolean(state.sheet); haptic('medium'); }, 1850);
}
function applyTheme() {
  document.documentElement.dataset.theme = state.theme;
  document.querySelector('meta[name="theme-color"]').content = state.theme === 'dark' ? '#050508' : '#f0f4f8';
  $$('.theme-toggle').forEach(button => { button.innerHTML = icon(state.theme === 'dark' ? 'sun' : 'moon'); button.setAttribute('aria-label', `Switch to ${state.theme === 'dark' ? 'light' : 'dark'} theme`); });
  storage.set('theme', state.theme);
  if (Capacitor.isNativePlatform()) { const style = state.theme === 'dark' ? SystemBarsStyle.Dark : SystemBarsStyle.Light; void Promise.allSettled([SystemBars.setStyle({ style }), StatusBar.setStyle({ style })]); }
}
function updateUI() {
  const status = state.connection.status, busy = ['scanning', 'connecting'].includes(status), live = status === 'connected';
  const awaitingCommand = state.commandPending || Date.now() < commandGraceUntil;
  const reportedMode = live && state.telemetry && !awaitingCommand ? state.telemetry.mode : state.running ? state.settings.mode : 0;
  const reportedMood = moods.find(item => item.mode === reportedMode);
  $('#header-dot')?.classList.toggle('live', live);
  $('.bluetooth-button')?.setAttribute('aria-label', live ? 'Manage connection' : 'Connect wings');
  if ($('#connection-status')) {
    $('#connection-status span').textContent = live ? state.connection.stability === 'delayed' ? 'Connection delayed' : 'Wings connected' : demo() ? 'Preview · no device' : busy ? 'Connecting…' : 'Not connected';
    $('#connection-status').classList.toggle('connected', live); $('#connection-status').classList.toggle('preview', demo());
    $('#current-mood').textContent = reportedMode === 0 ? 'Paused' : reportedMode === 6 ? 'Flutter' : reportedMood?.name || 'Custom';
    $('#pace-value').textContent = `${state.settings.speed.toFixed(1)} Hz`;
    $$('.mode-button').forEach(button => button.setAttribute('aria-pressed', String(+button.dataset.mode === reportedMode)));
    $('#play-button').innerHTML = `${icon(state.running ? 'pause' : 'play')}<span>${state.running ? 'Pause wings' : 'Start wings'}</span>`;
    $('#play-button').setAttribute('aria-label', state.running ? 'Pause wings' : 'Start wings');
    $('.home').classList.toggle('is-moving', state.running);
    if ($('#speed-slider') && document.activeElement !== $('#speed-slider') && !awaitingCommand) {
      $('#speed-slider').value = state.settings.speed;
      $('#speed-value').textContent = `${state.settings.speed.toFixed(1)} Hz`;
      $('#speed-slider').style.setProperty('--progress', `${(state.settings.speed - .2) / 2.8 * 100}%`);
    }
  }
  const battery = $('#battery-estimate');
  if (battery) {
    const kind = live ? state.telemetry?.batteryKind : null;
    const percent = live ? state.telemetry?.batteryPercent : null;
    battery.hidden = percent == null;
    if (percent != null) {
      battery.textContent = kind === 'estimated' ? `≈${percent}% runtime left · estimate` : `${percent}% battery`;
      battery.title = kind === 'estimated' ? 'Assumes a full 150 mAh battery at power-on; current draw is estimated, not measured.' : 'Reported by the accessory.';
    }
  }
  if ($('#pair-status')) {
    $('#pair-status').textContent = live ? 'You’re connected.' : busy ? status === 'connecting' ? 'Pairing…' : 'Finding your wings…' : state.connection.bluetoothEnabled === false ? 'Bluetooth is off.' : 'Bring your wings close.';
    $('#pair-copy').textContent = live ? 'Choose a mode whenever you’re ready.' : state.connection.bluetoothEnabled === false ? 'Tap below to turn it on.' : 'Power on your clip and keep it nearby.';
    $('#connect-button').disabled = busy;
    $('#connect-button').innerHTML = live ? `Done ${icon('check')}` : `${icon('bluetooth')} ${busy ? 'Connecting…' : 'Connect wings'}`;
    $('.radar').classList.toggle('scanning', busy);
    $('.radar').classList.toggle('connected', live);
  }
}
async function sendSettings(debounce = false) {
  clearTimeout(sendTimer); const generation = ++sendGeneration;
  const packet = { ...state.settings, mode: state.running ? state.settings.mode : 0 }; state.commandPending = true;
  const send = async () => {
    if (generation !== sendGeneration) return;
    if (!ready()) { state.commandPending = false; return; }
    try { await connection.send(packet); if (generation === sendGeneration) commandGraceUntil = Date.now() + 450; }
    catch (error) { if (generation === sendGeneration) { state.running = false; updateUI(); toast(error.message); } }
    finally { if (generation === sendGeneration) state.commandPending = false; }
  };
  if (debounce) sendTimer = setTimeout(send, 85); else await send();
}
async function chooseMode(mode) {
  if (!allowMotion()) return;
  const preset = PRESETS.find(p => p.mode === mode); if (!preset) return;
  state.settings = { ...preset }; state.running = ready(); storage.set('simple.settings', state.settings); updateUI();
  if (!reducedMotion.matches) {
    $('.current-mood')?.animate([{ opacity: .3, transform: 'translateY(6px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 280, easing: 'cubic-bezier(.2,.8,.2,1)' });
    $('.butterfly-button')?.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(-8px)' }, { transform: 'translateY(0)' }], { duration: 500, easing: 'ease-out' });
  }
  await sendSettings();
}
async function flutter() {
  localFlutterUntil = performance.now() + 800;
  if (!ready()) { toast('Connect your wings, or try preview.'); return; }
  if (!allowMotion()) return;
  await connection.send({ ...state.settings, mode: 6, speed: 3 });
}
function setSheetInert(inert) { $('.app-shell').inert = inert || document.documentElement.classList.contains('launch-active'); document.documentElement.classList.toggle('sheet-open', inert); }
function closeSheet({ cancelConnection = true } = {}) {
  if (state.firmwareBusy) return;
  if (!state.sheet) return;
  const generation = ++sheetGeneration;
  if (cancelConnection && state.sheet === 'pair' && ['scanning', 'connecting'].includes(state.connection.status)) void connection.disconnect();
  state.sheet = null; state.previewMode = null; $('.sheet-backdrop')?.classList.add('is-leaving');
  const finish = () => { if (generation !== sheetGeneration) return; $('#sheet-root').replaceChildren(); setSheetInert(false); lastFocus?.focus?.(); };
  if (reducedMotion.matches) finish(); else setTimeout(finish, 170);
}
function openSheet(type, previewMode = null) {
  ++sheetGeneration; lastFocus = document.activeElement; state.sheet = type; state.previewMode = previewMode; setSheetInert(true);
  const content = type === 'pair' ? pairingMarkup() : type === 'speed' ? speedMarkup() : type === 'mode' ? modeMarkup(previewMode) : type === 'travel' ? travelMarkup() : type === 'firmware' ? firmwareMarkup() : aboutMarkup();
  $('#sheet-root').innerHTML = `<div class="sheet-backdrop" data-action="dismiss"><section class="sheet glass press-surface ${type}-sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title" tabindex="-1"><div class="sheet-grab" aria-hidden="true"></div><button class="sheet-close icon-button pressable" data-action="close" data-press aria-label="Close">${icon('close')}</button>${content}</section></div>`;
  updateUI(); $('.sheet').focus();
  if (type === 'speed') $('#speed-slider').addEventListener('input', () => {
    state.settings.speed = Number($('#speed-slider').value); $('#speed-value').textContent = `${state.settings.speed.toFixed(1)} Hz`;
    $('#speed-slider').style.setProperty('--progress', `${(state.settings.speed - .2) / 2.8 * 100}%`);
    storage.set('simple.settings', state.settings); void sendSettings(true);
  });
  if (type === 'travel') {
    for (const id of ['travel-start', 'travel-end']) $(`#${id}`).addEventListener('input', updateTravelLabels);
    updateTravelLabels();
  }
}
function allowMotion() {
  if (state.firmwareBusy) { toast('Wait for the firmware update to finish.'); return false; }
  if (state.connection.status === 'connected' && !state.deviceSettings?.configured) { openSheet('travel'); return false; }
  return true;
}
function travelMarkup() {
  const config = state.deviceSettings;
  const supported = state.connection.status === 'connected' && Boolean(config);
  const start = config?.start ?? 25, end = config?.end ?? 45;
  return `<span class="sheet-symbol">${icon('sliders')}</span><h2 id="sheet-title">Wing travel</h2><p class="sheet-copy">Keep the starting position that works. Reduce the flap end until the wings move freely.</p>
    <p class="travel-note">${supported ? config.configured ? 'These angles are saved inside your butterfly, including after power-off.' : 'Movement is disabled until you save your tested range.' : 'Connect a butterfly with firmware 2.7 or newer. Older firmware needs one USB update first.'}</p>
    <div class="speed-readout"><label for="travel-start">Starting angle</label><output id="travel-start-value">${start}°</output></div><input id="travel-start" type="range" min="15" max="129" step="1" value="${start}">
    <div class="speed-readout"><label for="travel-end">Flap end</label><output id="travel-end-value">${end}°</output></div><input id="travel-end" type="range" min="16" max="130" step="1" value="${end}">
    <p class="about-note">Saving pauses the wings. It applies to every mode, touch control, flutter and the startup greeting. One motor moves both wings. These sliders do not move the motor while you drag them.</p>
    <p id="travel-result" role="status"></p><button class="primary-button pressable" id="save-travel" data-action="save-travel" data-press ${supported ? '' : 'disabled'}>Save on butterfly ${icon('check')}</button>`;
}
function updateTravelLabels() {
  const start = Number($('#travel-start').value), end = Number($('#travel-end').value);
  $('#travel-start-value').textContent = `${start}°`; $('#travel-end-value').textContent = `${end}°`;
  const valid = start < end;
  $('#save-travel').disabled = !valid || !state.deviceSettings || state.connection.status !== 'connected';
  $('#travel-result').textContent = valid ? '' : 'The flap end must be above the starting angle.';
}
async function saveTravel() {
  const start = Number($('#travel-start').value), end = Number($('#travel-end').value);
  validateTravel(start, end);
  $('#save-travel').disabled = true;
  $('#travel-start').disabled = $('#travel-end').disabled = true;
  try {
    clearTimeout(sendTimer); ++sendGeneration; state.commandPending = false;
    await connection.send({ ...state.settings, mode: 0 });
    state.deviceSettings = await connection.saveTravel(start, end);
    state.running = false; state.settings = { ...state.settings, minAngle: start, maxAngle: end };
    updateUI();
    if ($('#travel-result')) $('#travel-result').textContent = 'Saved inside the butterfly. Wings paused.';
  } catch (error) { if ($('#travel-result')) $('#travel-result').textContent = error.message; }
  finally { if ($('#save-travel')) { $('#save-travel').disabled = false; $('#travel-start').disabled = $('#travel-end').disabled = false; } }
}
function firmwareMarkup() {
  const config = state.deviceSettings;
  return `<span class="sheet-symbol">${icon('refresh')}</span><h2 id="sheet-title">Butterfly update</h2>
    <p class="sheet-copy">Download verified firmware from GitHub and send it over Bluetooth.</p>
    <p class="travel-note">${config?.ota ? `Connected firmware: ${Math.floor(config.versionCode / 10000)}.${Math.floor(config.versionCode / 100) % 100}.${config.versionCode % 100}. Saved angles are retained during wireless updates.` : 'Firmware 2.7 must be installed once over USB before wireless updates can work.'}</p>
    <p class="about-note">Keep the butterfly powered and close to your phone. Wings stay stopped during installation. Keep this screen open.</p>
    <p id="firmware-result" role="status"></p><progress id="firmware-progress" max="100" value="0" hidden></progress>
    <button class="primary-button pressable" data-action="firmware-check" data-press id="firmware-check">Check GitHub</button>
    <button class="primary-button pressable" data-action="firmware-install" data-press id="firmware-install" hidden>Download & update butterfly</button>
    <button class="text-button" data-action="firmware-cancel" id="firmware-cancel" hidden>Cancel transfer</button>`;
}
async function checkFirmware() {
  const button = $('#firmware-check'); button.disabled = true;
  $('#firmware-result').textContent = 'Checking GitHub…';
  state.firmwareCandidate = null; $('#firmware-install').hidden = true;
  try {
    const result = await checkForUpdates(APP_VERSION, { releaseOnly: true });
    if (state.sheet !== 'firmware') return;
    if (result.errors.release) throw new Error(result.errors.release);
    const asset = result.release?.assets.find(item => item.name === 'firmware-manifest.json');
    if (!asset) throw new Error('This release has no wireless firmware package.');
    if (asset.size > 16384) throw new Error('The firmware manifest is too large.');
    const manifest = await verifyFirmwareManifest(await downloadGithubAsset(asset.url, { json: true }));
    if (state.sheet !== 'firmware') return;
    if (!state.deviceSettings?.ota) throw new Error('Connect firmware 2.7 or newer after its first USB installation.');
    if (manifest.versionCode <= state.deviceSettings.versionCode) { $('#firmware-result').textContent = 'Your butterfly firmware is up to date.'; return; }
    state.firmwareCandidate = manifest;
    $('#firmware-result').textContent = `Firmware ${manifest.version} is ready.`;
    $('#firmware-install').hidden = false;
  } catch (error) { if ($('#firmware-result')) $('#firmware-result').textContent = error.message; }
  finally { if ($('#firmware-check')) $('#firmware-check').disabled = false; }
}
async function installFirmware() {
  const manifest = state.firmwareCandidate;
  if (!manifest || state.firmwareBusy) return;
  state.firmwareBusy = true; firmwareAbort = new AbortController();
  $('#firmware-check').disabled = true; $('#firmware-install').disabled = true;
  $('#firmware-progress').hidden = false; $('#firmware-cancel').hidden = false;
  try {
    $('#firmware-result').textContent = 'Downloading and verifying firmware…';
    const bytes = await verifyFirmwareImage(manifest, await downloadGithubAsset(manifest.url));
    if (firmwareAbort.signal.aborted) throw new Error('Update cancelled.');
    await connection.updateFirmware(manifest, bytes, { signal: firmwareAbort.signal, onProgress(percent) {
      if ($('#firmware-progress')) { $('#firmware-progress').value = percent; $('#firmware-result').textContent = `Sending firmware · ${percent}%`; }
    } });
    $('#firmware-result').textContent = 'Transfer verified. The butterfly is restarting. Reconnect to confirm its new version.';
  } catch (error) { if ($('#firmware-result')) $('#firmware-result').textContent = error.message; }
  finally {
    state.firmwareBusy = false; firmwareAbort = null;
    if ($('#firmware-cancel')) $('#firmware-cancel').hidden = true;
    if ($('#firmware-check')) $('#firmware-check').disabled = false;
    if ($('#firmware-install')) $('#firmware-install').disabled = false;
  }
}
function pairingMarkup() {
  return `<div class="radar"><i></i><i></i><i></i><div>${butterfly('pair')}</div></div><h2 id="sheet-title">Connect your wings</h2><p class="sheet-status" id="pair-status">Bring your wings close.</p><p class="sheet-copy" id="pair-copy">Power on your clip and keep it nearby.</p><p id="pair-error" class="inline-error" role="alert"></p><button class="primary-button pressable" id="connect-button" data-action="connect" data-press>${icon('bluetooth')} Connect wings</button><button class="text-button pressable" data-action="demo" data-press>Try without a device</button>${ready() ? '<button class="text-button disconnect-button pressable" data-action="disconnect" data-press>Disconnect</button>' : ''}`;
}
function speedMarkup() {
  return `<span class="sheet-symbol">${icon('sliders')}</span><h2 id="sheet-title">Your pace.</h2><p class="sheet-copy">A little slower. A little faster.</p><div class="speed-readout"><label for="speed-slider">Speed</label><output id="speed-value">${state.settings.speed.toFixed(1)} Hz</output></div><input type="range" id="speed-slider" min="0.2" max="3" step="0.1" value="${state.settings.speed}" style="--progress:${(state.settings.speed - .2) / 2.8 * 100}%"><div class="range-labels"><span>Slow</span><span>Fast</span></div><button class="primary-button pressable" data-action="close" data-press>Done ${icon('check')}</button>`;
}
function modeMarkup(mode) {
  const item = moods.find(m => m.mode === mode) || moods[0];
  return `<div class="mode-preview-art">${butterfly('mode')}</div><h2 id="sheet-title">${item.name}</h2><p class="sheet-copy">${item.description}</p><span class="preview-label">Motion preview</span><button class="primary-button pressable" data-action="use-mode" data-use-mode="${item.mode}" data-press>Use ${item.name} ${icon('check')}</button>`;
}
function aboutMarkup() {
  return `<span class="about-logo">${logo()}</span><h2 id="sheet-title">Wings On Hair</h2><p class="sheet-copy">Version ${APP_VERSION} · Made by <a href="https://github.com/ParthSancheti" target="_blank" rel="noopener noreferrer">Parth Sancheti</a></p><div class="settings-rows"><button class="settings-row pressable" data-action="travel" data-press>${icon('sliders')}<span>Wing travel</span>${icon('chevron')}</button><button class="settings-row pressable" data-action="firmware" data-press>${icon('refresh')}<span>Update butterfly</span>${icon('chevron')}</button><button class="settings-row pressable" data-action="updates" id="update-button" data-press>${icon('refresh')}<span>Check for updates</span>${icon('chevron')}</button><button class="settings-row pressable" data-action="replay" data-press>${icon('reset')}<span>Replay welcome</span>${icon('chevron')}</button><a class="settings-row" href="https://github.com/ParthSancheti/WingsOnHair" target="_blank" rel="noopener noreferrer">${icon('github')}<span>Project & hardware guide</span>${icon('external')}</a></div><p class="update-result" id="update-result" role="status"></p><div id="update-link"></div><p class="about-note">${state.telemetry?.batteryPercent != null ? `${state.telemetry.batteryKind === 'estimated' ? 'Estimated runtime left' : 'Battery'}: ${state.telemetry.batteryPercent}%. ` : ''}The runtime estimate assumes a full 150 mAh cell at power-on and is not a charge measurement.</p>`;
}
function finishWelcome() { state.welcome = false; storage.set('onboarded', true); renderView(); haptic('success'); }
async function startDemo() {
  if (connectionBusy) return; connectionBusy = true;
  try { await connection.startDemo(); if (!demo()) return; state.running = true; await sendSettings(); if (state.welcome) finishWelcome(); closeSheet({ cancelConnection: false }); updateUI(); }
  finally { connectionBusy = false; }
}
async function connect() {
  if (state.connection.status === 'connected') { if (state.welcome) finishWelcome(); closeSheet(); return; }
  if (connectionBusy) return; connectionBusy = true; if ($('#pair-error')) $('#pair-error').textContent = '';
  const generation = sheetGeneration;
  try {
    await connection.connect(); if (state.connection.status !== 'connected') return;
    haptic('success');
    if (!state.deviceSettings?.configured) {
      await connection.send({ ...state.settings, mode: 0 });
      if (state.welcome) finishWelcome();
      openSheet('travel');
      return;
    }
    await new Promise(resolve => setTimeout(resolve, reducedMotion.matches ? 0 : 650));
    if (generation !== sheetGeneration || state.connection.status !== 'connected') return;
    if (state.welcome) finishWelcome(); closeSheet({ cancelConnection: false });
  }
  catch (error) { if ($('#pair-error')) $('#pair-error').textContent = error.message; else toast(error.message); }
  finally { connectionBusy = false; updateUI(); }
}
async function checkUpdates() {
  const button = $('#update-button'); if (button.disabled) return;
  button.disabled = true; $('#update-result').textContent = 'Checking GitHub…';
  $('#update-link').replaceChildren();
  try {
    const result = await checkForUpdates(APP_VERSION, { releaseOnly: true }); if (!$('#update-result')) return;
    $('#update-result').textContent = result.updateAvailable ? `${result.latestVersion} is available.` : result.latestVersion ? 'You’re up to date.' : result.errors.release || 'No new release yet.';
    const target = result.updateAvailable ? result.release?.apkUrl || result.release?.url : result.release?.url;
    if (target) $('#update-link').innerHTML = `<a class="text-link" href="${escapeHtml(target)}" target="_blank" rel="noopener noreferrer">${result.updateAvailable && result.release?.apkUrl ? 'Download APK' : 'View release'} ${icon('external')}</a>`;
  } catch (error) { if ($('#update-result')) $('#update-result').textContent = error.message; }
  finally { if ($('#update-button')) $('#update-button').disabled = false; }
}

function showUpdateBanner() {
  const banner = $('#update-banner');
  const update = state.availableUpdate;
  if (!banner) return;
  banner.hidden = !update;
  if (!update) { banner.replaceChildren(); return; }
  banner.innerHTML = `<span>Wings On Hair ${escapeHtml(update.version)} is ready.</span><a href="${escapeHtml(update.url)}" target="_blank" rel="noopener noreferrer">${update.isApk ? 'Download APK' : 'View release'}</a><button type="button" data-action="dismiss-update" aria-label="Dismiss update alert">${icon('close')}</button>`;
}

async function checkUpdatesAutomatically() {
  if (automaticUpdateCheckPending || Date.now() - lastAutomaticUpdateCheck < 30 * 60 * 1000) return;
  automaticUpdateCheckPending = true;
  try {
    const result = await checkForUpdates(APP_VERSION, { releaseOnly: true });
    if (!result.errors.release) lastAutomaticUpdateCheck = Date.now();
    if (!result.updateAvailable || !result.release || storage.get('dismissed-update') === result.latestVersion) return;
    state.availableUpdate = {
      version: result.latestVersion,
      url: result.release.apkUrl || result.release.url,
      isApk: Boolean(result.release.apkUrl),
    };
    showUpdateBanner();
  } catch { /* A failed background check must not interrupt the app. */ }
  finally { automaticUpdateCheckPending = false; }
}

const disposePress = installPressFeedback({ onHaptic: haptic, onLongPress(button) {
  if (button.dataset.mode) openSheet('mode', +button.dataset.mode);
  else if (button.dataset.action === 'flutter') void flutter().catch(error => toast(error.message));
} });
document.addEventListener('click', async event => {
  const button = event.target.closest('[data-action], [data-mode]'); if (!button || button.disabled) return;
  if (button.dataset.action === 'dismiss' && event.target !== button) return;
  try {
    if (button.dataset.mode) { await chooseMode(+button.dataset.mode); return; }
    switch (button.dataset.action) {
      case 'dismiss-update': storage.set('dismissed-update', state.availableUpdate?.version); state.availableUpdate = null; showUpdateBanner(); break;
      case 'theme': state.theme = state.theme === 'light' ? 'dark' : 'light'; applyTheme(); break;
      case 'about': openSheet('about'); break;
      case 'pair': openSheet('pair'); break;
      case 'begin': state.welcomeStep = 1; renderView(); break;
      case 'welcome-back': state.welcomeStep = 0; renderView(); break;
      case 'skip-name': state.name = ''; storage.set('name', ''); openSheet('pair'); break;
      case 'speed': openSheet('speed'); break;
      case 'close': case 'dismiss': closeSheet(); break;
      case 'connect': await connect(); break;
      case 'demo': await startDemo(); break;
      case 'disconnect': await connection.disconnect(); closeSheet(); break;
      case 'flutter': await flutter(); break;
      case 'play': if (!ready()) { openSheet('pair'); break; } if (!allowMotion()) break; state.running = !state.running; updateUI(); await sendSettings(); break;
      case 'travel': openSheet('travel'); break;
      case 'save-travel': await saveTravel(); break;
      case 'firmware': openSheet('firmware'); break;
      case 'firmware-check': await checkFirmware(); break;
      case 'firmware-install': await installFirmware(); break;
      case 'firmware-cancel': firmwareAbort?.abort(); break;
      case 'use-mode': await chooseMode(+button.dataset.useMode); closeSheet(); break;
      case 'updates': await checkUpdates(); break;
      case 'replay': state.running = false; await sendSettings(); closeSheet(); state.welcome = true; state.welcomeStep = 0; renderView(); launchIntro(); break;
    }
  } catch (error) { toast(error.message || 'Please try again.'); }
});
document.addEventListener('change', event => { if (event.target.matches('input')) haptic(); });
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && state.sheet) { closeSheet(); return; }
  if (event.key !== 'Tab' || !state.sheet) return;
  const dialog = $('.sheet'), focusable = [...dialog.querySelectorAll('button, a[href], input')].filter(el => !el.disabled && el.getClientRects().length);
  const first = focusable[0], last = focusable.at(-1);
  if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) { event.preventDefault(); last?.focus(); }
  else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) { event.preventDefault(); first?.focus(); }
});
connection.addEventListener('state', event => {
  const previous = state.connection.status; state.connection = event.detail;
  if (!ready()) { clearTimeout(sendTimer); ++sendGeneration; state.commandPending = false; commandGraceUntil = 0; state.running = false; state.telemetry = null; state.deviceSettings = null; } updateUI();
  if (previous === 'connected' && event.detail.status === 'disconnected') toast('Wings disconnected. Tap to reconnect.');
});
connection.addEventListener('device-settings', event => { state.deviceSettings = event.detail; });
connection.addEventListener('telemetry', event => {
  state.telemetry = event.detail;
  if (!state.commandPending && Date.now() > commandGraceUntil) {
    state.running = event.detail.running;
    if (state.connection.status === 'connected') {
      const next = reconcileWingTelemetry(state.settings, event.detail);
      if (next.settings !== state.settings) {
        state.settings = next.settings;
        storage.set('simple.settings', state.settings);
      }
    }
  }
  updateUI();
});
function animate(now) {
  if (now - lastFrame >= 15) {
    const fresh = state.telemetry && Date.now() - state.telemetry.receivedAt < 1600;
    let target = fresh ? state.telemetry.angle : ready() ? angle : reducedMotion.matches ? 29 : 29 + Math.sin(now / 1200) * 10;
    if (!ready() && now < localFlutterUntil && !reducedMotion.matches) target = 25 + Math.abs(Math.sin(now / 80)) * 65;
    angle = reducedMotion.matches ? target : angle + (target - angle) * .33;
    const rotation = Math.max(3, Math.min(66, (angle - 15) * .67));
    document.documentElement.style.setProperty('--left-wing-angle', `${rotation}deg`); document.documentElement.style.setProperty('--right-wing-angle', `${-rotation}deg`);
    if (state.previewMode && $('.mode-preview-art')) {
      const preset = PRESETS.find(p => p.mode === state.previewMode), previewAngle = Math.max(3, Math.min(66, (sampleWingAngle(preset, now) - 15) * .67));
      $('.mode-preview-art').style.setProperty('--left-wing-angle', `${previewAngle}deg`); $('.mode-preview-art').style.setProperty('--right-wing-angle', `${-previewAngle}deg`);
    }
    lastFrame = now;
  }
  animationFrame = requestAnimationFrame(animate);
}
async function suspend() { clearTimeout(sendTimer); ++sendGeneration; state.commandPending = false; cancelAnimationFrame(animationFrame); if (state.firmwareBusy) { firmwareAbort?.abort(); return; } if (ready()) { state.running = false; updateUI(); await sendSettings(); } }
function resume() { cancelAnimationFrame(animationFrame); animationFrame = requestAnimationFrame(animate); void checkUpdatesAutomatically(); }
document.addEventListener('visibilitychange', () => { if (document.hidden) void suspend(); else resume(); });
async function initializeNative() {
  if (!Capacitor.isNativePlatform()) return;
  await StatusBar.setOverlaysWebView({ overlay: true }).catch(() => {}); applyTheme();
  nativeListeners.push(await App.addListener('backButton', () => {
    if (state.sheet) closeSheet();
    else if (state.welcome && state.welcomeStep === 1) { state.welcomeStep = 0; renderView(); }
    else void App.minimizeApp();
  }));
  nativeListeners.push(await App.addListener('appStateChange', ({ isActive }) => { if (isActive) resume(); else void suspend(); }));
}
render(); if (state.welcome) launchIntro(); resume(); void initializeNative();
window.addEventListener('pagehide', () => { disposePress(); clearTimeout(launchTimer); clearTimeout(sendTimer); clearTimeout(toastTimer); cancelAnimationFrame(animationFrame); void connection.dispose(); nativeListeners.forEach(listener => void listener.remove()); });
