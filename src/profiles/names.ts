// Profile name rules (ADR 0010 "Profiles", Inv §3.4).
//
// A name starts with a letter and holds only ASCII letters, digits and
// `_`, at most 32 characters. Names are unique case-sensitively, as the
// IndexedDB key is. `default` always exists and cannot be renamed or
// deleted.

export const DEFAULT_PROFILE = 'default';
export const NAME_MAX = 32;

const NAME_RE = /^[A-Za-z][A-Za-z0-9_]*$/;

/** The hint line shown under a name prompt. */
export const NAME_HINT = 'letters, digits and _ · must start with a letter · max 32';

/**
 * Why `name` cannot be used, or null when it can. `existing` is the list of
 * taken names; `except` (the profile being renamed) does not count.
 */
export function nameError(name: string, existing: Iterable<string>, except?: string): string | null {
  if (name === '') return 'Enter a name.';
  if (name.length > NAME_MAX) return `At most ${NAME_MAX} characters.`;
  if (!/^[A-Za-z]/.test(name)) return 'The name must start with a letter.';
  if (!NAME_RE.test(name)) return 'Only letters, digits and _ are allowed.';
  for (const n of existing) {
    if (n === name && n !== except) return `"${name}" already exists.`;
  }
  return null;
}

/** True when `name` follows the rules (ignoring collisions). */
export function isValidName(name: string): boolean {
  return name.length <= NAME_MAX && NAME_RE.test(name);
}

/**
 * A valid name from a file name: the extension is dropped, runs of other
 * characters become `_`, a leading non-letter gets a `p` prefix, and the
 * result is cut to 32. `My Profile (2).tin` → `My_Profile_2`.
 */
export function nameFromFileName(fileName: string): string {
  const base = fileName.replace(/^.*[\\/]/, '').replace(/\.[^.]*$/, '');
  let s = base
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (s === '') s = 'imported';
  if (!/^[A-Za-z]/.test(s)) s = 'p' + s;
  return s.slice(0, NAME_MAX);
}

/**
 * `base` if it is free, else `base_2`, `base_3` … (cut so the suffix fits
 * in 32 characters).
 */
export function uniqueName(base: string, existing: Iterable<string>): string {
  const taken = new Set(existing);
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) {
    const suffix = `_${i}`;
    const name = base.slice(0, NAME_MAX - suffix.length) + suffix;
    if (!taken.has(name)) return name;
  }
}
