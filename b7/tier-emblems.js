// Original B7 brand artwork, not historical symbols of the mythological Pleiades.
const motifs = [
  '<path d="M72 25C39 23 27 64 49 85C60 95 76 95 87 87C54 95 41 48 72 25Z"/><path class="seal-detail" d="M28 76Q60 56 96 67M25 83Q59 63 95 74"/>',
  '<ellipse class="seal-detail" cx="60" cy="60" rx="40" ry="21" transform="rotate(-38 60 60)"/><circle cx="44" cy="70" r="13"/><circle cx="77" cy="46" r="9"/><path class="seal-light" d="M44 48V92M22 70H66M77 31V61M62 46H92"/>',
  '<circle cx="60" cy="60" r="26"/><path class="seal-light" d="M40 42A27 27 0 0 1 84 72"/><ellipse class="seal-detail" cx="60" cy="60" rx="43" ry="12" transform="rotate(-25 60 60)"/><path d="M60 17V25M97 47L90 49M30 84L24 89"/>',
  '<path d="M29 84C32 48 60 27 89 27C89 65 64 86 29 84Z"/><path class="seal-detail" d="M29 84Q57 60 89 27M38 82Q38 46 80 30M30 74Q67 76 88 36"/><circle class="seal-light" cx="77" cy="39" r="4"/>',
  '<path d="M60 24C40 39 40 54 60 69C80 54 80 39 60 24ZM26 48C26 73 41 83 60 69C58 46 44 40 26 48ZM94 48C76 40 62 46 60 69C79 83 94 73 94 48Z"/><path class="seal-detail" d="M60 69V96M35 87Q60 98 85 87"/><circle class="seal-light" cx="60" cy="58" r="4"/>',
  '<path d="M64 23L39 65H57L50 97L83 52H64Z"/><path class="seal-detail" d="M35 29L45 38M22 53L35 55M27 84L39 77M85 29L77 39M98 60H86M87 88L78 79"/><path class="seal-light" d="M61 30L45 61H64L57 84"/>',
  '<ellipse class="seal-detail" cx="60" cy="62" rx="42" ry="16" transform="rotate(-20 60 62)"/><path d="M39 89L64 39H38V31H80V39L52 89Z"/><path class="seal-detail" d="M29 34Q60 7 91 34"/><g class="seal-light"><circle cx="29" cy="34" r="2"/><circle cx="39" cy="25" r="2"/><circle cx="49" cy="21" r="2"/><circle cx="60" cy="19" r="2"/><circle cx="71" cy="21" r="2"/><circle cx="81" cy="25" r="2"/><circle cx="91" cy="34" r="2"/></g>'
];

export function tierEmblem(level, variant = 'preview') {
  const id = `b7-seal-${variant}-${level}`;
  // Reflect only Alcyone's seven, leaving its orbital crown centered.
  const art = level === 7 ? motifs[6].replace('<path d="M39', '<path transform="translate(120 0) scale(-1 1)" d="M39') : motifs[level - 1];
  return `<svg class="sister-seal sister-seal-${level}" viewBox="0 0 120 120" aria-hidden="true" focusable="false"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#887047"/><stop offset=".32" stop-color="#fff0bf"/><stop offset=".65" stop-color="#c69d54"/><stop offset="1" stop-color="#ead4a5"/></linearGradient></defs><circle class="seal-rim" cx="60" cy="60" r="54"/><circle class="seal-inner" cx="60" cy="60" r="49"/><g class="seal-art" fill="none" stroke="url(#${id})" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${art}</g></svg>`;
}
