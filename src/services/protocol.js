/** Shared with firmware/WingsOnHair_Firmware. Commands are exactly six bytes. */
export const SERVICE_UUID = '7a1b0001-6e3d-4b7a-9c21-8f5d0a2e6c10';
export const COMMAND_UUID = '7a1b0002-6e3d-4b7a-9c21-8f5d0a2e6c10';
export const TELEMETRY_UUID = '7a1b0003-6e3d-4b7a-9c21-8f5d0a2e6c10';
export const DEVICE_NAME = 'WingsOnHair';

export const PRESETS = Object.freeze([
  Object.freeze({ id: 'velvet', name: 'Velvet Breeze', description: 'A little slower. A little softer.', mode: 1, minAngle: 25, maxAngle: 85, speed: 0.6, impulseX: 40, impulseY: 20 }),
  Object.freeze({ id: 'golden', name: 'Golden Pulse', description: 'Two little flutters. One golden moment.', mode: 2, minAngle: 20, maxAngle: 100, speed: 0.8, impulseX: 20, impulseY: 80 }),
  Object.freeze({ id: 'euphoria', name: 'Euphoria Rush', description: 'For the moments you feel everything.', mode: 3, minAngle: 15, maxAngle: 110, speed: 2.2, impulseX: 15, impulseY: 85 }),
  Object.freeze({ id: 'midnight', name: 'Midnight Serenade', description: 'A quiet rhythm, all your own.', mode: 4, minAngle: 35, maxAngle: 90, speed: 0.4, impulseX: 65, impulseY: 15 }),
]);
export const DEFAULT_SETTINGS = PRESETS[0];

function integerInRange(value, min, max, label) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${label} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

export function validateSettings(settings) {
  if (!settings || typeof settings !== 'object') throw new TypeError('Wing settings are required.');
  const mode = integerInRange(settings.mode, 0, 6, 'Mode');
  const minAngle = integerInRange(settings.minAngle, 15, 110, 'Minimum angle');
  const maxAngle = integerInRange(settings.maxAngle, 15, 110, 'Maximum angle');
  if (minAngle >= maxAngle) throw new RangeError('Minimum angle must be lower than maximum angle.');
  if (typeof settings.speed !== 'number' || !Number.isFinite(settings.speed) || settings.speed < 0.2 || settings.speed > 3) {
    throw new RangeError('Flap speed must be between 0.2 and 3 Hz.');
  }
  const speedTenths = Math.round(settings.speed * 10);
  if (Math.abs(speedTenths / 10 - settings.speed) > 0.000001) throw new RangeError('Flap speed must use 0.1 Hz increments.');
  const impulseX = integerInRange(settings.impulseX, 5, 95, 'Impulse X');
  const impulseY = integerInRange(settings.impulseY, 5, 95, 'Impulse Y');
  return { mode, minAngle, maxAngle, speed: speedTenths / 10, impulseX, impulseY };
}

export function encodeCommand(settings) {
  const s = validateSettings(settings);
  return new DataView(Uint8Array.of(s.mode, s.minAngle, s.maxAngle, Math.round(s.speed * 10), s.impulseX, s.impulseY).buffer);
}

function asDataView(input) {
  if (input instanceof DataView) return input;
  if (input instanceof ArrayBuffer) return new DataView(input);
  if (ArrayBuffer.isView(input)) return new DataView(input.buffer, input.byteOffset, input.byteLength);
  throw new TypeError('Telemetry must be a DataView, ArrayBuffer, or typed array.');
}

export function decodeTelemetry(input, receivedAt = Date.now()) {
  const view = asDataView(input);
  if (![16, 19].includes(view.byteLength)) throw new RangeError('Unexpected telemetry length; expected 16 or 19 bytes.');
  const version = view.getUint8(1);
  if (view.getUint8(0) !== 0x57 || !((version === 1 && view.byteLength === 16) || (version === 2 && view.byteLength === 19))) throw new Error('Unsupported Wings On Hair firmware protocol.');
  const bounds = version === 2 ? {
    minAngle: integerInRange(view.getUint8(16), 15, 110, 'Telemetry minimum'),
    maxAngle: integerInRange(view.getUint8(17), 15, 110, 'Telemetry maximum'),
    selectedMode: integerInRange(view.getUint8(18), 1, 5, 'Selected mode'),
  } : {};
  if (version === 2 && bounds.minAngle >= bounds.maxAngle) throw new RangeError('Invalid telemetry angle range.');
  const mode = integerInRange(view.getUint8(3), 0, 6, 'Telemetry mode');
  const angle = integerInRange(view.getUint8(4), 15, 110, 'Commanded angle');
  const targetAngle = integerInRange(view.getUint8(5), 15, 110, 'Target angle');
  const batteryCode = view.getUint8(7);
  if (batteryCode > 2) throw new RangeError('Unknown battery telemetry type.');
  const batteryValue = view.getUint8(6);
  if (batteryValue > 100 && batteryValue !== 255) throw new RangeError('Invalid battery percentage.');
  const speed = integerInRange(view.getUint8(13), 2, 30, 'Telemetry speed') / 10;
  const impulseX = integerInRange(view.getUint8(14), 5, 95, 'Telemetry impulse X');
  const impulseY = integerInRange(view.getUint8(15), 5, 95, 'Telemetry impulse Y');
  return {
    ...bounds, sequence: view.getUint8(2), mode, angle, targetAngle,
    batteryPercent: batteryCode === 0 || batteryValue === 255 ? null : batteryValue,
    batteryKind: ['unavailable', 'estimated', 'measured'][batteryCode],
    uptimeSeconds: view.getUint32(8, true),
    running: Boolean(view.getUint8(12) & 1),
    servoAttached: Boolean(view.getUint8(12) & 2),
    speed, impulseX, impulseY, receivedAt,
  };
}

const cubic = (t, p1, p2) => 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t ** 2 * p2 + t ** 3;

/** Solves x(t) before evaluating y(t), matching the firmware's 14-step bisection. */
export function impulseEase(progress, impulseX = 40, impulseY = 20) {
  if (progress <= 0) return 0;
  if (progress >= 1) return 1;
  const x = Math.min(95, Math.max(5, impulseX)) / 100;
  const y = Math.min(95, Math.max(5, impulseY)) / 100;
  let low = 0;
  let high = 1;
  for (let i = 0; i < 14; i++) {
    const t = (low + high) / 2;
    if (cubic(t, x, 0.75) < progress) low = t;
    else high = t;
  }
  return cubic((low + high) / 2, y, 1);
}

/** Commanded servo position, not a measurement of the mechanical wing position. */
export function sampleWingAngle(settings, elapsedMs) {
  if (settings.mode === 0) return settings.minAngle;
  let phase = ((Math.max(0, elapsedMs) * settings.speed / 1000) % 1);
  if (settings.mode === 2) {
    if (phase >= 0.7) return settings.minAngle;
    phase = (phase / 0.35) % 1;
  }
  const amount = phase < 0.5
    ? impulseEase(phase * 2, settings.impulseX, settings.impulseY)
    : 1 - impulseEase((phase - 0.5) * 2, settings.impulseX, settings.impulseY);
  return Math.round(settings.minAngle + (settings.maxAngle - settings.minAngle) * amount);
}
