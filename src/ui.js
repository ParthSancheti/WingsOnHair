const paths = {
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  moon: '<path d="M20.5 13A8.5 8.5 0 0 1 11 3.5a8.5 8.5 0 1 0 9.5 9.5Z"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  back: '<path d="M19 12H5m5-5-5 5 5 5"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  bluetooth: '<path d="m7 7 10 10-5 4V3l5 4L7 17"/>',
  sliders: '<path d="M4 7h7m4 0h5M4 17h3m4 0h9"/><circle cx="13" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  sparkles: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Zm7 0v4m-2-2h4"/>',
  wind: '<path d="M3 8h12a3 3 0 1 0-3-3M2 12h17a3 3 0 1 1-3 3M5 16h5a3 3 0 1 1-3 3"/>',
  pulse: '<path d="M2 12h4l3-7 5 14 3-7h5"/>',
  leaf: '<path d="M20 4C6 1 1 9 5 16s17 4 15-12ZM4 21 15 10"/>',
  battery: '<rect x="2" y="6" width="17" height="12" rx="3"/><path d="M22 10v4M6 10v4m4-4v4"/>',
  signal: '<path d="M4 19v-3m5 3v-7m5 7V8m5 11V4"/>',
  heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',
  music: '<path d="M9 18V5l12-2v13M9 8l12-2"/><ellipse cx="6" cy="18" rx="3" ry="3"/><ellipse cx="18" cy="16" rx="3" ry="3"/>',
  shake: '<rect x="8" y="3" width="8" height="18" rx="2"/><path d="m4 6-2 3 2 3-2 3 2 3m16-12 2 3-2 3 2 3-2 3M11 17h2"/>',
  play: '<path d="m8 4 12 8-12 8Z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  github: '<path d="M9 19c-4 1-4-2-6-2m12 5v-4a3.5 3.5 0 0 0-1-2.8c3.4-.4 7-1.7 7-7.2a5.5 5.5 0 0 0-1.5-3.8A5.2 5.2 0 0 0 19.3 0S18 0 15 1.6a13 13 0 0 0-6 0C6 0 4.7 0 4.7 0a5.2 5.2 0 0 0-.2 4.2A5.5 5.5 0 0 0 3 8c0 5.5 3.6 6.8 7 7.2A3.5 3.5 0 0 0 9 18v4" transform="translate(0 1) scale(.92)"/>',
  external: '<path d="M14 3h7v7m0-7L10 14M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"/>',
  refresh: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M6.1 6a8 8 0 0 1 13.2 2M4.7 16a8 8 0 0 0 13.2 2"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.1"/>',
  code: '<path d="m8 6-6 6 6 6m8-12 6 6-6 6M14 3l-4 18"/>',
  book: '<path d="M12 5v16M12 5C8 2 4 3 2 4v15c4-2 7 0 10 2 3-2 6-4 10-2V4c-2-1-6-2-10 1Z"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  reset: '<path d="M3 3v6h6M3 9a9 9 0 1 1 0 6"/>',
};

export const icon = (name, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.sparkles}</svg>`;

export const logo = () => `<svg class="butterfly-mark" viewBox="0 0 48 48" fill="none" aria-hidden="true">
  <g fill="currentColor"><path d="M22 24C13 24 6 19 7 12 8 5 16 10 22 24ZM26 24C35 24 42 19 41 12 40 5 32 10 26 24Z"/><path d="M22 26C13 22 8 27 12 33 16 38 21 31 22 26ZM26 26C35 22 40 27 36 33 32 38 27 31 26 26Z" opacity=".75"/></g>
  <g stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M24 20v13" stroke-width="2.2"/><path d="m23 19-4-5m6 5 4-5" stroke-width="1.3"/><path d="M15 38h18l-3 3H18Z" stroke-width="1.4"/></g>
</svg>`;

export function butterfly(id = 'hero') {
  const prefix = `butterfly-${String(id).replace(/[^a-zA-Z0-9_-]/g, '') || 'hero'}`;
  return `<svg class="butterfly-art" viewBox="0 0 400 320" role="img" aria-label="A butterfly with pink, lilac and aqua wings">
  <defs>
    <linearGradient id="${prefix}-upper" x1=".1" y1="0" x2=".9" y2="1">
      <stop stop-color="#ffe3c7"/><stop offset=".3" stop-color="#f4aacb"/><stop offset=".65" stop-color="#bf9bea"/><stop offset="1" stop-color="#8d9fe5"/>
    </linearGradient>
    <linearGradient id="${prefix}-lower" x1="0" y1="1" x2="1" y2="0">
      <stop stop-color="#79c9d0"/><stop offset=".38" stop-color="#a9dce1"/><stop offset=".72" stop-color="#b9b3eb"/><stop offset="1" stop-color="#d5aff0"/>
    </linearGradient>
    <linearGradient id="${prefix}-body" x1="0" y1="0" x2="0" y2="1">
      <stop stop-color="#77618f"/><stop offset=".5" stop-color="#554365"/><stop offset="1" stop-color="#463751"/>
    </linearGradient>
    <g id="${prefix}-half" stroke-linecap="round" stroke-linejoin="round">
      <path d="M197 164C169 162 130 166 105 183 82 199 79 220 91 234 88 249 102 263 115 261 124 276 144 273 153 262 170 267 185 247 190 225 195 202 197 181 197 164Z" fill="url(#${prefix}-lower)" fill-opacity=".94" stroke="#9884b5" stroke-width="1.6"/>
      <g fill="none" stroke="#9a86b6" stroke-width="1.15" opacity=".58">
        <path d="M194 171C160 193 135 223 116 253"/>
        <path d="M190 176C180 210 166 239 152 255"/>
        <path d="M162 198C139 201 115 213 97 231"/>
      </g>
      <path d="M198 160C177 117 146 75 106 51 76 33 41 28 33 51 25 74 35 108 50 130 43 141 50 154 65 161 99 177 147 179 198 164Z" fill="url(#${prefix}-upper)" fill-opacity=".95" stroke="#8f7baa" stroke-width="1.7"/>
      <path d="M39 56C43 39 71 42 101 58" fill="none" stroke="#fff" stroke-width="2.3" opacity=".7"/>
      <g fill="none" stroke="#a28aba" stroke-width="1.2" opacity=".6">
        <path d="M194 158C151 131 109 91 59 51"/>
        <path d="M192 161C143 156 96 143 56 127"/>
        <path d="M171 143C155 111 138 81 118 60"/>
      </g>
    </g>
  </defs>
  <g class="hair-clip" fill="none" stroke-linecap="round" opacity=".65">
    <path d="M185 234Q200 225 215 234" stroke="#9b99aa" stroke-width="2.3"/>
    <path d="M187 236Q200 231 213 236" stroke="#e0dfe8" stroke-width="1.3"/>
  </g>
  <g class="wing wing-left"><use href="#${prefix}-half"/></g>
  <g class="wing wing-right"><use href="#${prefix}-half" transform="translate(400 0) scale(-1 1)"/></g>
  <g class="butterfly-body">
    <g fill="none" stroke="#79618e" stroke-width="1.7" stroke-linecap="round">
      <path d="M197 125C195 113 188 102 178 97"/>
      <path d="M203 125C205 113 212 102 222 97"/>
    </g>
    <g fill="#79618e"><circle cx="178" cy="97" r="1.8"/><circle cx="222" cy="97" r="1.8"/></g>
    <path d="M196 159C193 177 196 211 198 225Q200 233 202 225C204 211 207 177 204 159Z" fill="url(#${prefix}-body)" stroke="#b7a5c8" stroke-width=".7"/>
    <ellipse cx="200" cy="150" rx="6.1" ry="20" fill="url(#${prefix}-body)"/>
    <ellipse cx="200" cy="128" rx="4.9" ry="6.3" fill="#59456d"/>
    <path d="M198 140C197 148 197 153 198 158" fill="none" stroke="#c8b7d9" stroke-width="1.2" stroke-linecap="round" opacity=".5"/>
  </g>
  </svg>`;
}
export const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function miniWave(type) {
  const d = {
    1: 'M0 22C10 22 10 4 20 4S30 40 40 40 50 4 60 4 70 40 80 40 90 22 100 22',
    2: 'M0 30h10C15 30 12 7 19 7S23 30 28 30 26 12 33 12 36 30 42 30h14C61 30 58 7 65 7S69 30 74 30 72 12 79 12 82 30 88 30h12',
    3: 'M0 24 7 24 12 5 19 39 26 8 33 37 40 5 47 39 54 8 61 37 68 5 75 39 82 8 89 37 94 24h6',
    4: 'M0 25C12 25 13 10 25 10S38 35 50 35 63 10 75 10 88 25 100 25',
  };
  return `<svg class="mini-wave" viewBox="0 0 100 44" fill="none" aria-hidden="true"><path d="${d[type]}" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}
