import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_SETTINGS, PRESETS, decodeTelemetry, encodeCommand, impulseEase, sampleWingAngle } from '../src/services/protocol.js';
import { checkForUpdates, compareVersions } from '../src/services/updates.js';
import { WingConnection } from '../src/services/ble.js';

const packet = (overrides = {}) => {
  const bytes = Uint8Array.of(0x57, 1, 254, 1, 45, 50, 255, 0, 0x78, 0x56, 0x34, 0x12, 3, 6, 40, 20);
  for (const [index, value] of Object.entries(overrides)) bytes[Number(index)] = value;
  return new DataView(bytes.buffer);
};

test('preset commands match the six-byte firmware protocol', () => {
  const expected = [
    [1, 25, 85, 6, 40, 20], [2, 20, 100, 8, 20, 80],
    [3, 15, 110, 22, 15, 85], [4, 35, 90, 4, 65, 15],
  ];
  PRESETS.forEach((preset, index) => assert.deepEqual([...new Uint8Array(encodeCommand(preset).buffer)], expected[index]));
});

test('unsafe or lossy commands are rejected before they reach hardware', () => {
  for (const patch of [
    { minAngle: 0 }, { maxAngle: 111 }, { minAngle: 85, maxAngle: 85 },
    { mode: 7 }, { mode: -1 }, { speed: 3.1 }, { speed: 0.21 }, { speed: NaN },
    { impulseX: 0 }, { impulseY: 100 }, { impulseX: 40.2 }, { minAngle: '25' },
  ]) assert.throws(() => encodeCommand({ ...DEFAULT_SETTINGS, ...patch }));
});

test('telemetry decodes unsigned uptime, reported angles, and battery provenance', () => {
  const value = decodeTelemetry(packet(), 1234);
  assert.equal(value.uptimeSeconds, 0x12345678);
  assert.equal(value.angle, 45);
  assert.equal(value.targetAngle, 50);
  assert.equal(value.batteryPercent, null);
  assert.equal(value.batteryKind, 'unavailable');
  assert.equal(value.running, true);
  assert.equal(value.servoAttached, true);
  assert.equal(value.receivedAt, 1234);
  assert.equal(decodeTelemetry(packet({ 6: 71, 7: 1 })).batteryKind, 'estimated');
  assert.equal(decodeTelemetry(packet({ 6: 71, 7: 1 })).batteryPercent, 71);
  assert.equal(decodeTelemetry(packet({ 6: 71, 7: 0 })).batteryPercent, null);
});

test('telemetry respects buffer offsets and rejects incompatible or corrupt packets', () => {
  const outer = new Uint8Array(40);
  outer.set(new Uint8Array(packet().buffer), 5);
  assert.equal(decodeTelemetry(outer.subarray(5, 21)).sequence, 254);
  for (const invalid of [new Uint8Array(15), packet({ 0: 0 }), packet({ 1: 2 }), packet({ 4: 255 }), packet({ 6: 200 }), packet({ 7: 9 }), packet({ 13: 0 })]) {
    assert.throws(() => decodeTelemetry(invalid));
  }
});

test('impulse easing stays monotone and within endpoints across the full editable range', () => {
  for (const x of [5, 40, 95]) for (const y of [5, 20, 95]) {
    assert.equal(impulseEase(0, x, y), 0);
    assert.equal(impulseEase(1, x, y), 1);
    let previous = 0;
    for (let i = 1; i <= 100; i++) {
      const value = impulseEase(i / 100, x, y);
      assert.ok(value >= previous && value <= 1);
      previous = value;
    }
  }
  assert.ok(impulseEase(0.2, 20, 80) > impulseEase(0.2, 65, 15));
});

test('preset motion has exact endpoints, bounded range, and Golden Pulse rest', () => {
  for (const settings of PRESETS) {
    for (let elapsed = 0; elapsed < 20000; elapsed += 7) {
      const angle = sampleWingAngle(settings, elapsed);
      assert.ok(angle >= settings.minAngle && angle <= settings.maxAngle);
    }
    assert.equal(sampleWingAngle(settings, 0), settings.minAngle);
    assert.equal(sampleWingAngle({ ...settings, mode: 0 }, 900), settings.minAngle);
  }
  const golden = PRESETS[1];
  assert.equal(sampleWingAngle(golden, (0.175 / golden.speed) * 1000), golden.maxAngle);
  assert.equal(sampleWingAngle(golden, (0.525 / golden.speed) * 1000), golden.maxAngle);
  assert.equal(sampleWingAngle(golden, (0.85 / golden.speed) * 1000), golden.minAngle);
  const custom = { ...DEFAULT_SETTINGS, mode: 5, speed: 1 };
  assert.equal(sampleWingAngle(custom, 500), custom.maxAngle);
  assert.equal(sampleWingAngle(custom, 750), Math.round(custom.maxAngle - (custom.maxAngle - custom.minAngle) * impulseEase(0.5, 40, 20)));
});

test('version comparison understands numeric ordering and stable releases', () => {
  assert.equal(compareVersions('v2.5', '2.5.0'), 0);
  assert.equal(compareVersions('2.10.0', '2.9.8'), 1);
  assert.equal(compareVersions('2.5.0-beta.10', '2.5.0-beta.2'), 1);
  assert.equal(compareVersions('2.5.0', '2.5.0-rc.1'), 1);
  assert.equal(compareVersions('2.5.0-alpha', '2.5.0-beta'), -1);
  assert.equal(compareVersions('2.5.0+build.4', '2.5.0'), 0);
  assert.throws(() => compareVersions('coming soon', '2.5.0'));
});

test('GitHub updates preserve partial success and do not confuse commits with releases', async () => {
  const calls = [];
  const fetcher = async (url) => {
    calls.push(url);
    if (url.endsWith('/releases/latest')) return new Response('', { status: 404 });
    if (url.includes('/commits')) return Response.json([{ sha: 'abc123', commit: { message: 'An improvement', author: { name: 'Parth' } }, html_url: 'javascript:alert(1)' }]);
    return new Response('# Wings\n<script>untrusted</script>');
  };
  const result = await checkForUpdates('2.5.0', { fetcher });
  assert.equal(calls.length, 3);
  assert.match(result.errors.release, /No public release/);
  assert.equal(result.updateAvailable, false);
  assert.equal(result.commits.length, 1);
  assert.equal(result.commits[0].url, 'https://github.com/ParthSancheti/WingsOnHair');
  assert.equal(result.documentation, '# Wings\n<script>untrusted</script>');
});

test('GitHub release and rate-limit states are explicit', async () => {
  const fetcher = async url => url.endsWith('/releases/latest')
    ? Response.json({ tag_name: 'v2.6.0', name: 'New wings', body: 'Notes', html_url: 'https://github.com/ParthSancheti/WingsOnHair/releases/tag/v2.6.0' })
    : new Response('', { status: 403 });
  const result = await checkForUpdates('2.5.0', { fetcher });
  assert.equal(result.updateAvailable, true);
  assert.equal(result.latestVersion, 'v2.6.0');
  assert.match(result.errors.documentation, /rate limit/);
});

test('an empty GitHub repository has a clear commits message', async () => {
  const fetcher = async url => new Response('', { status: url.includes('/commits') ? 409 : 404 });
  const result = await checkForUpdates('2.5.0', { fetcher });
  assert.equal(result.errors.commits, 'This repository has no commits yet.');
  assert.equal(result.commits.length, 0);
});

function fakeClient({ powered = true } = {}) {
  return {
    writes: [], powered, enabledCallback: null, telemetryCallback: null, disconnectCallback: null,
    async initialize() {}, async isEnabled() { return this.powered; },
    async startEnabledNotifications(callback) { this.enabledCallback = callback; callback(this.powered); },
    async stopEnabledNotifications() { this.enabledCallback = null; },
    async requestEnable() { this.powered = true; this.enabledCallback?.(true); },
    async requestLEScan(options, callback) { callback({ device: { deviceId: 'test-device', name: 'WingsOnHair' } }); },
    async stopLEScan() {},
    async connect(id, callback) { this.disconnectCallback = callback; },
    async disconnect() {},
    async startNotifications(id, service, characteristic, callback) { this.telemetryCallback = callback; },
    async stopNotifications() { this.telemetryCallback = null; },
    async readRssi() { return -52; },
    async write(id, service, characteristic, value) { this.writes.push([...new Uint8Array(value.buffer)]); },
  };
}

test('native connection prompts to enable Bluetooth and subscribes to real telemetry', async () => {
  const client = fakeClient({ powered: false });
  const connection = new WingConnection({ client, platform: 'android' });
  try {
    await connection.connect();
    assert.equal(connection.state.status, 'connected');
    assert.equal(connection.state.bluetoothEnabled, true);
    client.telemetryCallback(packet());
    assert.equal(connection.state.lastTelemetry.angle, 45);
    assert.equal(connection.state.stability, 'live');
    await connection.send(DEFAULT_SETTINGS);
    assert.deepEqual(client.writes[0], [1, 25, 85, 6, 40, 20]);
    client.enabledCallback(false);
    assert.equal(connection.state.status, 'disconnected');
    assert.equal(connection.state.lastTelemetry, null);
    assert.match(connection.state.error, /Bluetooth is off/);
  } finally { await connection.dispose(); }
});

test('rapid slider writes are coalesced and final stop cannot be overtaken by stale motion', async () => {
  const client = fakeClient();
  const connection = new WingConnection({ client, platform: 'android' });
  try {
    await connection.connect();
    await connection.send(DEFAULT_SETTINGS);
    const writes = [
      connection.send({ ...DEFAULT_SETTINGS, speed: 1 }),
      connection.send({ ...DEFAULT_SETTINGS, speed: 2 }),
      connection.send({ ...DEFAULT_SETTINGS, mode: 0 }),
    ];
    await Promise.all(writes);
    assert.equal(client.writes.length, 2);
    assert.equal(client.writes.at(-1)[0], 0);
  } finally { await connection.dispose(); }
});

test('failed notification setup remains a failed pairing after native disconnect callbacks', async () => {
  const client = fakeClient();
  client.startNotifications = async () => { throw new Error('Required telemetry characteristic is missing.'); };
  client.disconnect = async () => { client.disconnectCallback?.(); };
  const connection = new WingConnection({ client, platform: 'android' });
  try {
    await assert.rejects(connection.connect(), /telemetry characteristic is missing/);
    assert.equal(connection.state.status, 'disconnected');
    assert.match(connection.state.error, /telemetry characteristic is missing/);
  } finally { await connection.dispose(); }
});

test('preview never initializes Bluetooth or invents battery measurements', async () => {
  const client = fakeClient();
  client.initialize = () => { throw new Error('Preview must not touch Bluetooth'); };
  const connection = new WingConnection({ client, platform: 'android' });
  try {
    await assert.rejects(connection.send(DEFAULT_SETTINGS), /Connect your wings/);
    await connection.startDemo();
    assert.equal(connection.state.status, 'demo');
    assert.equal(connection.state.lastTelemetry.batteryPercent, null);
    assert.equal(connection.state.lastTelemetry.batteryKind, 'unavailable');
    await connection.send({ ...DEFAULT_SETTINGS, mode: 6, speed: 3 });
    await new Promise(resolve => setTimeout(resolve, 460));
    assert.equal(connection.settings.mode, DEFAULT_SETTINGS.mode);
    assert.equal(connection.settings.speed, DEFAULT_SETTINGS.speed);
    await connection.disconnect();
    assert.equal(connection.state.isDemo, false);
  } finally { await connection.dispose(); }
});

test('leaving pairing cancels scanning and ignores a late discovery', async () => {
  const client = fakeClient();
  let discovered;
  let scanning;
  const scanStarted = new Promise(resolve => { scanning = resolve; });
  let connectCalls = 0;
  client.requestLEScan = async (_options, callback) => { discovered = callback; scanning(); };
  client.connect = async () => { connectCalls++; };
  const connection = new WingConnection({ client, platform: 'android' });
  try {
    const connecting = connection.connect();
    await scanStarted;
    await connection.disconnect();
    discovered({ device: { deviceId: 'late-device' } });
    await connecting;
    assert.equal(connection.state.status, 'disconnected');
    assert.equal(connectCalls, 0);
  } finally { await connection.dispose(); }
});

test('a cancelled transition to preview cannot restart it after native cleanup', async () => {
  const client = fakeClient();
  let releaseCleanup;
  client.stopNotifications = () => new Promise(resolve => { releaseCleanup = resolve; });
  const connection = new WingConnection({ client, platform: 'android' });
  try {
    await connection.connect();
    const preview = connection.startDemo();
    await connection.disconnect();
    releaseCleanup();
    await preview;
    assert.equal(connection.state.status, 'disconnected');
    assert.equal(connection.state.isDemo, false);
    assert.equal(connection._demoTimer, undefined);
  } finally { await connection.dispose(); }
});
