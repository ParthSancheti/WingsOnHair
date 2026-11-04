export const SETTINGS_UUID = '7a1b0004-6e3d-4b7a-9c21-8f5d0a2e6c10';
export const OTA_CONTROL_UUID = '7a1b0005-6e3d-4b7a-9c21-8f5d0a2e6c10';
export const OTA_DATA_UUID = '7a1b0006-6e3d-4b7a-9c21-8f5d0a2e6c10';
export function validateTravel(start, end) {
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 15 || end > 110 || start >= end) throw new Error('Choose a start and end between 15° and 110°, with the end above the start.');
  return { start, end };
}
export function encodeTravel(start, end, token) {
  validateTravel(start, end);
  return new DataView(Uint8Array.of(0x4c, 1, start, end, token & 255, token >> 8 & 255).buffer);
}
export function decodeDeviceSettings(view) {
  if (!(view instanceof DataView) || view.byteLength !== 14 || view.getUint8(0) !== 0x4c || view.getUint8(1) !== 1) throw new Error('Update the butterfly once over USB to enable saved travel and wireless updates.');
  const start = view.getUint8(3), end = view.getUint8(4);
  validateTravel(start, end);
  return { configured: view.getUint8(2) === 1, start, end, error: view.getUint8(5), token: view.getUint16(6, true), versionCode: view.getUint32(8, true), ota: Boolean(view.getUint8(12) & 1) };
}
export function decodeOtaStatus(view) {
  if (!(view instanceof DataView) || view.byteLength !== 16 || view.getUint8(0) !== 0x4f || view.getUint8(1) !== 1) return null;
  const phase = view.getUint8(2), error = view.getUint8(3);
  if (phase > 5) throw new Error('Invalid firmware update status.');
  return { phase, error, offset: view.getUint32(4, true), size: view.getUint32(8, true), versionCode: view.getUint32(12, true) };
}
