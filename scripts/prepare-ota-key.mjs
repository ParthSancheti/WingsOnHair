import { generateKeyPairSync, createPublicKey } from 'node:crypto';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
const destination = process.argv[2] || '.tools/signing/firmware-private.pem';
await mkdir('.tools/signing', { recursive: true });
let privateKey;
try { privateKey = await readFile(destination, 'utf8'); }
catch (error) {
  if (error.code !== 'ENOENT') throw error;
  const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1',
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  await writeFile(destination, pair.privateKey, { flag: 'wx', mode: 0o600 });
  privateKey = pair.privateKey;
}
const publicKey = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString();
await writeFile('firmware/WingsOnHair_Firmware/ota_public_key.h', '#pragma once\nstatic constexpr char OTA_PUBLIC_KEY[] = R"KEY(' + publicKey + ')KEY";\n');
await writeFile('src/services/firmware-key.js', '// Public verification key; the private signing key stays outside source packages.\nexport const FIRMWARE_PUBLIC_KEY = ' + JSON.stringify(publicKey) + ';\n');
console.log('Public verification key written. Keep the private key backed up privately; it is required for future firmware releases.');
