import { FIRMWARE_PUBLIC_KEY } from './firmware-key.js';
const PREFIX = 'https://github.com/ParthSancheti/WingsOnHair/releases/download/';
export const MAX_FIRMWARE_SIZE = 0x140000;
export const bytesFromBase64 = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));
export function firmwarePayload(manifest) {
  return `WingsOnHair-ESP32C3:${manifest.versionCode}:${manifest.size}:${manifest.sha256}`;
}
export async function verifyFirmwareManifest(manifest, { publicKey = FIRMWARE_PUBLIC_KEY, subtle = crypto.subtle } = {}) {
  if (!manifest || manifest.board !== 'WingsOnHair-ESP32C3' || !Number.isInteger(manifest.versionCode) || manifest.versionCode < 20700 || manifest.versionCode > 0xffffffff ||
      !Number.isInteger(manifest.size) || manifest.size < 256 || manifest.size > MAX_FIRMWARE_SIZE || !/^[a-f0-9]{64}$/.test(manifest.sha256) ||
      typeof manifest.signature !== 'string' || typeof manifest.url !== 'string' || !manifest.url.startsWith(PREFIX) || !/\.bin$/.test(new URL(manifest.url).pathname)) throw new Error('This release has no compatible signed ESP32-C3 firmware.');
  const signature = bytesFromBase64(manifest.signature);
  if (signature.length !== 64) throw new Error('Invalid firmware signature.');
  const keyBytes = bytesFromBase64(publicKey.replace(/-----[^-]+-----|\s/g, ''));
  const key = await subtle.importKey('spki', keyBytes, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  if (!await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, signature, new TextEncoder().encode(firmwarePayload(manifest)))) throw new Error('Firmware signature could not be verified.');
  return manifest;
}
export async function verifyFirmwareImage(manifest, bytes, subtle = crypto.subtle) {
  if (!(bytes instanceof Uint8Array) || bytes.length !== manifest.size || bytes[0] !== 0xe9 || (bytes[12] | bytes[13] << 8) !== 5) throw new Error('Firmware size or ESP32-C3 image header is incorrect.');
  const digest = new Uint8Array(await subtle.digest('SHA-256', bytes));
  const hex = [...digest].map(v => v.toString(16).padStart(2, '0')).join('');
  if (hex !== manifest.sha256) throw new Error('Firmware download is incomplete or corrupt. Nothing was installed.');
  return bytes;
}
export function firmwareStream(manifest, image) {
  const output = new Uint8Array(96 + image.length);
  output.set(manifest.sha256.match(/../g).map(v => parseInt(v, 16)));
  output.set(bytesFromBase64(manifest.signature), 32);
  output.set(image, 96);
  return output;
}
