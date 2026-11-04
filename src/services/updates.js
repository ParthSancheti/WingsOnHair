export const REPOSITORY_URL = 'https://github.com/ParthSancheti/WingsOnHair';
const API = 'https://api.github.com/repos/ParthSancheti/WingsOnHair';

export function parseVersion(value) {
  const match = String(value).trim().match(/^v?(\d+)\.(\d+)(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!match) throw new Error(`Unrecognized version: ${String(value).slice(0, 50)}`);
  const parts = [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)];
  if (parts.some(part => !Number.isSafeInteger(part))) throw new Error('Version number is too large.');
  return { parts, prerelease: match[4]?.split('.') ?? [] };
}

/** Positive means left is newer. Pre-releases sort below the same stable release. */
export function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let i = 0; i < 3; i++) if (a.parts[i] !== b.parts[i]) return Math.sign(a.parts[i] - b.parts[i]);
  if (!a.prerelease.length || !b.prerelease.length) return Math.sign(b.prerelease.length - a.prerelease.length);
  for (let i = 0; i < Math.max(a.prerelease.length, b.prerelease.length); i++) {
    const first = a.prerelease[i];
    const second = b.prerelease[i];
    if (first === second) continue;
    if (first === undefined) return -1;
    if (second === undefined) return 1;
    const firstNumeric = /^\d+$/.test(first);
    const secondNumeric = /^\d+$/.test(second);
    if (firstNumeric && secondNumeric) {
      if (BigInt(first) === BigInt(second)) continue;
      return BigInt(first) > BigInt(second) ? 1 : -1;
    }
    if (firstNumeric !== secondNumeric) return firstNumeric ? -1 : 1;
    return first > second ? 1 : -1;
  }
  return 0;
}

function githubUrl(value, fallback = REPOSITORY_URL) {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && url.hostname === 'github.com') return url.href;
  } catch { /* Remote data is never trusted as an executable link. */ }
  return fallback;
}

async function request(path, { raw = false, fetcher = fetch, signal } = {}) {
  const timeout = new AbortController();
  const abort = () => timeout.abort(signal?.reason);
  if (signal?.aborted) abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => timeout.abort(), 12000);
  try {
    const response = await fetcher(`${API}${path}`, {
      headers: { Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      signal: timeout.signal,
      cache: 'no-cache',
    });
    if (!response.ok) {
      if (response.status === 404) throw new Error(path.includes('releases') ? 'No public release has been published yet.' : 'This repository resource is not publicly available yet.');
      if (response.status === 409 && path.startsWith('/commits')) throw new Error('This repository has no commits yet.');
      if (response.status === 403 || response.status === 429) throw new Error('GitHub rate limit reached. Try again later.');
      throw new Error(`GitHub returned ${response.status}. Please try again.`);
    }
    return raw ? await response.text() : await response.json();
  } catch (error) {
    if (timeout.signal.aborted) throw new Error(signal?.aborted ? 'Update check cancelled.' : 'GitHub took too long to respond. Try again.');
    if (error instanceof TypeError) throw new Error('Could not reach GitHub. Check your internet connection.');
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

/** Remote README/release/commit strings are plain text. Render with textContent. */
export async function checkForUpdates(currentVersion = '2.7.1', { fetcher = fetch, signal, releaseOnly = false } = {}) {
  parseVersion(currentVersion);
  const requests = [
    request('/releases/latest', { fetcher, signal }),
  ];
  if (!releaseOnly) requests.push(
    request('/commits?per_page=5', { fetcher, signal }),
    request('/readme', { raw: true, fetcher, signal }),
  );
  const results = await Promise.allSettled(requests);
  const result = { currentVersion, latestVersion: null, updateAvailable: false, release: null, commits: [], documentation: null, checkedAt: Date.now(), errors: {} };
  const [releaseResult, commitsResult, docsResult] = results;
  if (releaseResult.status === 'fulfilled') {
    const data = releaseResult.value ?? {};
    result.release = {
      name: String(data.name || data.tag_name || 'Latest release'),
      version: String(data.tag_name || ''),
      body: String(data.body || 'No release notes provided.'),
      publishedAt: data.published_at ?? null,
      url: githubUrl(data.html_url, `${REPOSITORY_URL}/releases`),
      assets: (Array.isArray(data.assets) ? data.assets : []).filter(asset => asset && typeof asset === 'object').map(asset => ({ name: String(asset.name || 'Download'), size: Number(asset.size) || 0, url: githubUrl(asset.browser_download_url, `${REPOSITORY_URL}/releases`) })),
    };
    result.release.apkUrl = result.release.assets.find(asset => /\.apk$/i.test(asset.name) && asset.url.startsWith(`${REPOSITORY_URL}/releases/download/`))?.url ?? null;
    try {
      result.updateAvailable = compareVersions(result.release.version, currentVersion) > 0;
      result.latestVersion = result.release.version;
    } catch { result.errors.release = 'A release exists, but its tag is not a supported version number.'; }
  } else result.errors.release = releaseResult.reason.message;
  if (!releaseOnly && commitsResult.status === 'fulfilled') {
    result.commits = (Array.isArray(commitsResult.value) ? commitsResult.value : []).filter(item => item && typeof item === 'object').map(item => ({
      sha: String(item.sha || ''), message: String(item.commit?.message || ''),
      date: item.commit?.author?.date ?? null,
      url: githubUrl(item.html_url),
      author: String(item.commit?.author?.name || 'Contributor'),
    }));
  } else if (!releaseOnly) result.errors.commits = commitsResult.reason.message;
  if (!releaseOnly && docsResult.status === 'fulfilled') result.documentation = String(docsResult.value).slice(0, 200000);
  else if (!releaseOnly) result.errors.documentation = docsResult.reason.message;
  return result;
}
