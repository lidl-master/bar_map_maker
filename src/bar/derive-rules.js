// Rules for exporting a map opened from an archive (a derivative): it needs its own name or version, and the
// original's licence may forbid derivatives (ND) or commercial use (NC). Pure.
import { mapFileBase } from '../formats/index.js';

/** `<name>_<version>.sd7`, lower case, as BAR's map archives are named. */
export function archiveFileName({ name, version }) {
  return `${mapFileBase(name)}_${mapFileBase(version)}.sd7`.toLowerCase();
}

const same = (a, b) => String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
const fileName = (path) => path.split(/[\\/]/).pop();

/**
 * True when the doc would export under the original's archive name or map name + version: BAR would see two
 * different maps with one name.
 */
export function clashesWithOriginal(settings, original) {
  const sameArchive = (() => {
    try { return archiveFileName(settings) === fileName(original.archive).toLowerCase(); } catch { return false; }
  })();
  return sameArchive || (same(settings.name, original.info.name) && same(settings.version, original.info.version));
}

/** Throws an Error with code 'SAME_NAME' when clashesWithOriginal. */
export function checkDerivativeName(settings, original) {
  if (!clashesWithOriginal(settings, original)) return;
  throw Object.assign(new Error(`${settings.name} ${settings.version} is the name and version of the map it was opened from. `
    + 'Give it a new version (for example a suffix like -edit1) so BAR can tell the two maps apart.'), { code: 'SAME_NAME' });
}

/**
 * The version to suggest for a derivative: the original's with "-edit1", or the next free -editN (taken(version) is
 * true when an archive with that version exists already).
 */
export function suggestVersion(settings, original, taken = () => false) {
  const base = String(original.info.version || settings.version || '1').replace(/-edit\d+$/i, '');
  for (let n = 1; ; n++) {
    const version = `${base}-edit${n}`;
    if (!taken(version) && !clashesWithOriginal({ ...settings, version }, original)) return version;
  }
}

// Licence wording, as map authors write it: "CC BY-NC-ND 4.0", ".../licenses/by-nc-nd/4.0", "ND", "NoDerivs",
// "No Derivatives", "NonCommercial". Bare abbreviations count in capitals only (readmes say "2nd", "and", "nc" anyway).
const clause = (code) => [new RegExp(`\\bby(?:[ _-](?:nc|sa|nd))*[ _-]${code}\\b`, 'i'), new RegExp(`\\b${code.toUpperCase()}\\b`)];
const ND = [...clause('nd'), /\bno[ -]?deriv/i];
const NC = [...clause('nc'), /\bnon[ -]?commercial/i, /\bnot for commercial/i];

/** @returns {{nd: boolean, nc: boolean}} */
export function classifyLicence(text) {
  return { nd: ND.some((re) => re.test(text)), nc: NC.some((re) => re.test(text)) };
}

// Licence and readme files of the map itself (code libraries bundled in libs/ or Lua folders carry their own).
const LICENCE_FILE = /(^|\/)(licen[cs]e|copying|readme)[^/]*$/i;
const CODE_FOLDER = /^(libs?|lua\w*)\//i;

/**
 * What the original's licence says about derivatives: mapinfo's licence line (original.info.licence) and the archive's
 * own licence / readme files.
 * @param {{info: {licence: string|null}}} original
 * @param {Map<string, Uint8Array>} files  archive files (at least its licence and readme files)
 * @returns {{nd: boolean, nc: boolean, unknown: boolean, licence: string|null}} licence: what to name in the warning
 */
export function licenceWarnings(original, files) {
  const texts = [];
  if (original.info.licence) texts.push([original.info.licence, original.info.licence]);
  for (const [path, bytes] of files) {
    if (LICENCE_FILE.test(path) && !CODE_FOLDER.test(path)) texts.push([fileName(path), new TextDecoder().decode(bytes)]);
  }
  const hits = texts.map(([name, text]) => ({ name, ...classifyLicence(text) }));
  const named = hits.find((h) => h.nd || h.nc) ?? hits[0];
  return { nd: hits.some((h) => h.nd), nc: hits.some((h) => h.nc), unknown: !hits.length, licence: named?.name ?? null };
}
