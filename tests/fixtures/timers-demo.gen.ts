// Generates tests/fixtures/timers-demo.log, the offline Timers demo (ADR 0017):
//
//   node tests/fixtures/timers-demo.gen.ts
//
// A synthetic ~62 s run in the raw capture format (src/capture/format.ts),
// shaped like MUME output (replies end with an empty line and the prompt;
// a cast echoes `You start to concentrate...` and lands a moment later):
// login, spells landing (armour, shield, bless, sanctuary), buffs (second
// wind, anger), a debuff (tiredness), hunger, three stores and a recall, a
// blinded `2.orc`, a charmed troll and an enslaved shadow, a `stat` block
// that reconciles (detect magic shows untracked), a refresh, hunger
// dropping and second wind fading into winded. Open it with
// `/?fixture=timers-demo.log` on the dev server. All names are invented.

import { writeFileSync } from 'node:fs';

const T0 = 1790452800000000; // µs
const ESC = '\x1b';
const out: string[] = [];
let t = 0; // seconds since T0

const ts = (): string => String(Math.round(T0 + t * 1e6)).padStart(16, '0');
const wait = (s: number): void => {
  t += s;
};
const line = (text: string): void => void out.push(`${ts()} ${text}`);
const cmd = (text: string): void => void out.push(`${ts()} > ${text}`);
const gmcp = (pkg: string, data?: unknown): void =>
  void out.push(`${ts()} ${ESC}GMCP ${pkg}${data === undefined ? '' : ' ' + JSON.stringify(data)}`);

const PROMPT = '*=>';
const c = (code: number, s: string): string => `${ESC}[${code}m${s}${ESC}[0m`;
/** Spell landings and other effects come in magenta, as MUME colours them. */
const fx = (s: string): string => c(35, s);

/** A command and its reply: lines, empty line, prompt. */
const reply = (command: string, lines: readonly string[]): void => {
  cmd(command);
  wait(0.2);
  for (const l of lines) line(l);
  line('');
  line(PROMPT);
};
/** Unsolicited output: empty line, lines, empty line, prompt. */
const event = (lines: readonly string[]): void => {
  line('');
  for (const l of lines) line(l);
  line('');
  line(PROMPT);
};
/**
 * A cast: the command (and MUME's echo when it came from a server alias),
 * `You start to concentrate...`, then the result `secs` later.
 */
const cast = (command: string, result: readonly string[], secs = 1.5, echo?: string): void => {
  cmd(command);
  wait(0.15);
  if (echo) line(echo);
  line('You start to concentrate...');
  line('');
  wait(secs);
  for (const l of result) line(l);
  line('');
  line(PROMPT);
};

// ---------------------------------------------------------------- login
gmcp('Char.Name', { name: 'Ithilwen', fullname: 'Ithilwen the Starlit' });
cmd('change width all 500');
line('Reconnecting.');
line('');
gmcp('Char.StatusVars', {
  name: 'Ithilwen',
  fullname: 'Ithilwen the Starlit',
  race: 'Elf',
  subrace: 'Noldo',
  subclass: 'mage',
  level: 30,
  'next-level-xp': 400000,
  'next-level-tp': 2000,
});
gmcp('Char.Vitals', {
  hp: 120,
  'hp-string': 'Healthy',
  maxhp: 120,
  mana: 210,
  'mana-string': 'Full',
  maxmana: 210,
  mp: 140,
  'mp-string': 'Rested',
  maxmp: 140,
  position: 'standing',
  mood: 'wimpy',
  'spell-effort': 'normal',
  alertness: 'normal',
});
line(c(32, 'The Hall of Fire'));
line('A great fire burns in the hearth, and the hall is warm and quiet.');
line('Exits: north, south.');
line('');
line(PROMPT);

// ----------------------------------------------------------- buffing up
wait(1.5);
cast('arm', [fx('A blue transparent wall slowly appears around you.')], 1.5, "[cast n 'armour']");
wait(0.5);
event([fx('You feel a surge of energy as you gain a second wind.')]);
wait(1);
cast("cast 'shield'", [fx('You feel protected.')]);
wait(0.5);
event([fx('You are filled with anger!')]);
wait(1);
cast("cast 'bless'", [fx('You begin to feel the light of Aman shine upon you.')]);
wait(1);
cast("cast 'sanctuary'", [fx('You start glowing.')]);
wait(1.5);
event(['You feel your muscles relax and your pulse slow as the strength that welled within you subsides.']);
wait(1);
event(['You are hungry.']);

// ---------------------------------------------------------- stored spells
wait(1.5);
cast('store fireb', [fx('You stored it.')], 2, "[cast n 'store' fireball]");
wait(0.5);
cast('store earth', [fx('You stored it.')], 2, "[cast n 'store' earthquake]");
wait(0.5);
cast('store earth', [fx('You stored it.')], 2, "[cast n 'store' earthquake]");

// ------------------------------------------------------ blind and charm
wait(1.5);
reply('n', [
  c(32, 'A Dark Corridor'),
  'The corridor is narrow and smells of smoke.',
  c(31, 'An orc is here, snarling.'),
  c(31, 'An orc is here, snarling.'),
  c(31, 'A huge stone troll stands here.'),
  'Exits: south.',
]);
wait(1);
cast("cast 'blindness' 2.orc", ['An orc seems to be blinded!'], 1.2);
wait(1);
cast("cast 'charm' troll", ['A huge stone troll starts following you.'], 2);
wait(1.5);
event(['An enslaved shadow arrives from the south.', 'An enslaved shadow starts following you.']);
wait(1.5);
cmd("cast 'fireball' 1.orc");
wait(0.15);
line('You quickly recall your stored spell...');
line(c(31, 'You throw a fireball at an orc, and it burns fiercely!'));
line('');
line(PROMPT);

// ------------------------------------------------------------ stat reconcile
wait(14);
reply('stat', [
  'You are a 30th level mage.',
  'You have 120/120 hit points, 190/210 mana and 137/140 movement points.',
  'Affected by:',
  '- sanctuary',
  '- second wind',
  '- tiredness',
  '- bless',
  '- stored spell earthquake',
  '- stored spell earthquake',
  '- detect magic',
  '- hunger',
  '- shield',
  '- armour',
]);

// ------------------------------------------------------------ the end of it
wait(3);
cast("cast 'shield'", [fx('Your protection is revitalised.')]);
wait(2);
reply('eat bread', ['You eat the bread.', 'You are full.']);
wait(3);
event(['The fire crackles in the hall to the south.']);
wait(4);
event([fx('Your energy wanes as your second wind fades.')]);
wait(2);
event(['The troll grunts and looks around.']);

writeFileSync(new URL('./timers-demo.log', import.meta.url), out.join('\n') + '\n');
console.log(`timers-demo.log: ${out.length} lines, ${t.toFixed(1)} s`);
