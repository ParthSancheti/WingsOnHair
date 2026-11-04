import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, createHash } from 'node:crypto';
import { verifyFirmwareManifest, verifyFirmwareImage, firmwarePayload, firmwareStream } from '../src/services/firmware.js';
import { encodeTravel, decodeDeviceSettings, validateTravel, SETTINGS_UUID, OTA_CONTROL_UUID, OTA_DATA_UUID } from '../src/services/device-protocol.js';
import { WingConnection } from '../src/services/ble.js';

const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
const publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
function fixture() {
  const image = new Uint8Array(512); image[0] = 0xe9; image[12] = 5;
  const manifest = { board: 'WingsOnHair-ESP32C3', version: '2.8.0', versionCode: 20800, size: image.length,
    sha256: createHash('sha256').update(image).digest('hex'), url: 'https://github.com/ParthSancheti/WingsOnHair/releases/download/v2.8.0/test.bin' };
  manifest.signature = sign('sha256', Buffer.from(firmwarePayload(manifest)), { key: pair.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64');
  return { manifest, image };
}
test('saved travel validates boundaries, byte offsets and firmware capabilities', () => {
  for (const pair of [[14, 40], [25, 131], [50, 50], [60, 45], [25.5, 45]]) assert.throws(() => validateTravel(...pair));
  assert.deepEqual([...new Uint8Array(encodeTravel(25, 45, 513).buffer)], [0x4c, 1, 25, 45, 1, 2]);
  const bytes = new Uint8Array(20); bytes.set([0x4c, 1, 1, 25, 45, 0, 1, 2], 3);
  new DataView(bytes.buffer).setUint32(11, 20700, true); bytes[15] = 1;
  assert.deepEqual(decodeDeviceSettings(new DataView(bytes.buffer, 3, 14)), { configured: true, start: 25, end: 45, error: 0, token: 513, versionCode: 20700, ota: true });
  assert.deepEqual(validateTravel(45, 113), { start: 45, end: 113 });
  assert.deepEqual(validateTravel(45, 130), { start: 45, end: 130 });
});
test('signed firmware rejects wrong keys, changed metadata, corrupt bytes and wrong-chip images', async () => {
  const { manifest, image } = fixture();
  await verifyFirmwareManifest(manifest, { publicKey });
  await verifyFirmwareImage(manifest, image);
  for (const patch of [{ size: 513 }, { versionCode: 20900 }, { sha256: 'a'.repeat(64) }, { board: 'ESP32-S3' }, { url: 'https://example.org/firmware.bin' }]) {
    await assert.rejects(verifyFirmwareManifest({ ...manifest, ...patch }, { publicKey }));
  }
  const other = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  await assert.rejects(verifyFirmwareManifest(manifest, { publicKey: other.publicKey.export({ type: 'spki', format: 'pem' }).toString() }));
  const corrupt = image.slice(); corrupt[100] ^= 1;
  await assert.rejects(verifyFirmwareImage(manifest, corrupt), /corrupt/);
  corrupt[12] = 9;
  await assert.rejects(verifyFirmwareImage(manifest, corrupt), /ESP32-C3/);
  assert.equal(firmwareStream(manifest, image).length, image.length + 96);
});

function clientFixture({ reject = false, disconnectAt = -1 } = {}) {
  const client = { commands: [], chunks: [], start: 25, end: 45, token: 0, phase: 0, offset: 0, version: 0, size: 0,
    async initialize() {}, async isEnabled() { return true; }, async startEnabledNotifications() {}, async stopEnabledNotifications() {},
    async requestLEScan(options, callback) { callback({ device: { deviceId: 'test' } }); }, async stopLEScan() {},
    async connect(id, callback) { this.disconnected = callback; }, async disconnect() {},
    async startNotifications() {}, async stopNotifications() {}, async readRssi() { return -40; }, async getMtu() { return 247; },
    async read(id, service, characteristic) {
      if (characteristic === SETTINGS_UUID) {
        const value = new Uint8Array(14); value.set([0x4c, 1, 1, this.start, this.end, 0, this.token & 255, this.token >> 8]);
        new DataView(value.buffer).setUint32(8, 20700, true); value[12] = 1; return new DataView(value.buffer);
      }
      const value = new Uint8Array(16); value.set([0x4f, 1, this.phase, this.phase === 5 ? 2 : 0]);
      const view = new DataView(value.buffer); view.setUint32(4, this.offset, true); view.setUint32(8, this.size, true); view.setUint32(12, this.version, true); return view;
    },
    async write(id, service, characteristic, view) {
      const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
      if (characteristic === SETTINGS_UUID) { this.start = bytes[2]; this.end = bytes[3]; this.token = view.getUint16(4, true); }
      else if (characteristic === OTA_CONTROL_UUID) {
        this.commands.push(bytes[0]);
        if (bytes[0] === 1) { this.phase = 1; this.offset = 0; this.size = view.getUint32(1, true); this.version = view.getUint32(5, true); }
        else if (bytes[0] === 2) this.phase = reject ? 5 : 4;
        else if (bytes[0] === 3) this.phase = 0;
      } else if (characteristic === OTA_DATA_UUID) {
        assert.equal(view.getUint32(0, true), this.offset);
        this.chunks.push(bytes.slice(4)); this.offset += bytes.length - 4;
        this.phase = this.offset === this.size + 96 ? 3 : this.offset >= 96 ? 2 : 1;
        if (this.chunks.length === disconnectAt) this.disconnected();
      }
    },
  };
  return client;
}
const connectionFor = client => new WingConnection({ client, platform: 'android', verifyManifest: m => verifyFirmwareManifest(m, { publicKey }) });
test('saving limits waits for the accessory acknowledgement and survives a new connection', async () => {
  const client = clientFixture(); let connection = connectionFor(client);
  try {
    await connection.connect();
    const saved = await connection.saveTravel(45, 113); assert.equal(saved.end, 113);
    await connection.dispose(); connection = connectionFor(client);
    await connection.connect(); assert.equal(connection.deviceSettings.start, 45); assert.equal(connection.deviceSettings.end, 113);
  } finally { await connection.dispose(); }
});
test('OTA transfers the signed stream in acknowledged MTU-sized chunks then commits', async () => {
  const client = clientFixture(), connection = connectionFor(client), { manifest, image } = fixture();
  try {
    await connection.connect();
    const progress = [];
    await connection.updateFirmware(manifest, image, { onProgress: value => progress.push(value) });
    assert.deepEqual(Buffer.concat(client.chunks.map(v => Buffer.from(v))), Buffer.from(firmwareStream(manifest, image)));
    assert.deepEqual(client.commands, [1, 2]); assert.equal(progress.at(-1), 100); assert.equal(connection._updating, false);
  } finally { await connection.dispose(); }
});
test('OTA rejection, cancellation and disconnect never report a completed install', async () => {
  const { manifest, image } = fixture();
  for (const options of [{ reject: true }, { disconnectAt: 1 }, { cancel: true }]) {
    const client = clientFixture(options), connection = connectionFor(client);
    try {
      await connection.connect();
      const abort = new AbortController(); if (options.cancel) abort.abort();
      const progress = [];
      await assert.rejects(connection.updateFirmware(manifest, image, { signal: abort.signal, onProgress: value => progress.push(value) }));
      assert.ok(!progress.includes(100)); assert.equal(connection._updating, false);
      if (options.disconnectAt) assert.ok(!client.commands.includes(2)); else assert.equal(client.commands.at(-1), 3);
    } finally { await connection.dispose(); }
  }
});
