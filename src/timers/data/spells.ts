// MUME's storable spells and their shortest unambiguous prefixes (Inv
// §2.6.6), used to resolve what the player typed (`fireb`, `magic m`) to a
// spell name. Facts about the game, in our own format (ADR 0017).

/** Spell name → the shortest prefix MUME accepts for it. */
export const STORABLE_SPELLS: Readonly<Record<string, string>> = {
  'magic missile': 'magic m',
  ventriloquate: 'v',
  'detect invisibility': 'detect i',
  'detect magic': 'detect m',
  armour: 'a',
  'chill touch': 'chi',
  'create light': 'cr',
  'locate magic': 'locate m',
  'burning hands': 'bu',
  shroud: 'shr',
  'find the path': 'fin',
  locate: 'locate',
  'call familiar': 'call f',
  'night vision': 'n',
  'shocking grasp': 'sho',
  earthquake: 'ea',
  teleport: 't',
  'block door': 'bl',
  'lightning bolt': 'li',
  'control weather': 'con',
  store: 'st',
  'colour spray': 'col',
  'locate life': 'locate l',
  'call lightning': 'call l',
  enchant: 'en',
  scry: 'sc',
  shield: 'shi',
  charm: 'cha',
  sleep: 'sl',
  fireball: 'fir',
  'dispel magic': 'di',
  'magic blast': 'magic b',
  'watch room': 'w',
  silence: 'si',
  identify: 'i',
  portal: 'p',
};

const ENTRIES = Object.entries(STORABLE_SPELLS);

/** Default decay time of a stored spell before any is learned, seconds (90 min). */
export const STORED_DEFAULT_S = 5400;

/**
 * The storable spell a typed name means, or null: `s` (any case) resolves
 * to a spell when it starts with the spell's shortest prefix and is itself a
 * prefix of the full name, and exactly one spell qualifies (`fireb` →
 * fireball, `magic ` → none).
 */
export function resolveSpell(s: string): string | null {
  const t = s.trim().toLowerCase();
  if (!t) return null;
  let hit: string | null = null;
  for (const [full, shortest] of ENTRIES) {
    if (t.length < shortest.length || !t.startsWith(shortest) || !full.startsWith(t)) continue;
    if (hit !== null) return null;
    hit = full;
  }
  return hit;
}
