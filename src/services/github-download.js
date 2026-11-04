import { Capacitor, CapacitorHttp } from '@capacitor/core';
import { bytesFromBase64, MAX_FIRMWARE_SIZE } from './firmware.js';
/** Native HTTPS avoids GitHub release asset CORS restrictions in Android's WebView. */
export async function downloadGithubAsset(url, { json = false } = {}) {
  if (!url.startsWith('https://github.com/ParthSancheti/WingsOnHair/releases/download/')) throw new Error('Unexpected firmware download source.');
  if (Capacitor.isNativePlatform()) {
    const result = await CapacitorHttp.get({ url, responseType: json ? 'json' : 'arraybuffer', readTimeout: 60000, connectTimeout: 15000 });
    if (result.status !== 200) throw new Error(`GitHub download failed (${result.status}).`);
    if (json) return typeof result.data === 'string' ? JSON.parse(result.data) : result.data;
    if (typeof result.data !== 'string' || result.data.length > Math.ceil(MAX_FIRMWARE_SIZE * 4 / 3) + 16) throw new Error('Firmware download is too large.');
    return bytesFromBase64(result.data);
  }
  const response = await fetch(url, { cache: 'no-cache', signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`GitHub download failed (${response.status}).`);
  return json ? response.json() : new Uint8Array(await response.arrayBuffer());
}
