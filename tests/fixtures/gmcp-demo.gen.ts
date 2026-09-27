// Generates tests/fixtures/gmcp-demo.log, the offline GMCP demo (ADR 0016):
//
//   node tests/fixtures/gmcp-demo.gen.ts
//
// A synthetic ~60 s run in the raw capture format (src/capture/format.ts)
// with GMCP records in realistic MUME shapes (kebab-case keys, bare-integer
// Group.Remove, `label: 0` for unlabeled NPCs): login, a group fight with a
// labeled mercenary, comm traffic on every channel, sunrise, the clock
// lines, a wimpy change, an achievement and a level-up by XP. Open it with
// `/?fixture=gmcp-demo.log` on the dev server. All names are invented.

import { writeFileSync } from 'node:fs';

const T0 = 1790449200000000; // µs
const ESC = '\x1b';
const out: string[] = [];
let t = 0; // seconds since T0

const ts = (): string => String(Math.round(T0 + t * 1e6)).padStart(16, '0');
/** Advance the clock by `s` seconds. */
const wait = (s: number): void => {
  t += s;
};
const line = (text: string): void => void out.push(`${ts()} ${text}`);
const cmd = (text: string): void => void out.push(`${ts()} > ${text}`);
const gmcp = (pkg: string, data?: unknown): void =>
  void out.push(`${ts()} ${ESC}GMCP ${pkg}${data === undefined ? '' : ' ' + JSON.stringify(data)}`);
const prompt = (p = 'o HP:Fine>'): void => line(p);

const c = (code: number, s: string): string => `${ESC}[${code}m${s}${ESC}[0m`;

// ---------------------------------------------------------------- login
gmcp('Comm.Channel.List', [
  { name: 'tales', caption: 'Narrates', command: 'narrate' },
  { name: 'tells', caption: 'Tells', command: 'tell' },
  { name: 'says', caption: 'Says', command: 'say' },
  { name: 'yells', caption: 'Yells', command: 'yell' },
  { name: 'prayers', caption: 'Prayers', command: 'pray' },
  { name: 'emotes', caption: 'Emotes', command: 'emote' },
  { name: 'whispers', caption: 'Whispers', command: 'whisper' },
  { name: 'questions', caption: 'Questions', command: 'question' },
  { name: 'songs', caption: 'Songs', command: 'sing' },
  { name: 'socials', caption: 'Socials', command: 'social' },
]);
wait(0.2);
gmcp('Char.Name', { name: 'Rasta', fullname: 'Rasta Fari the Wanderer' });
cmd('change width all 500');
cmd('change width table terminal');
line('Reconnecting.');
gmcp('Char.StatusVars', {
  name: 'Rasta',
  fullname: 'Rasta Fari the Wanderer',
  race: 'Man',
  subrace: 'Dunadan',
  subclass: 'warrior',
  level: 25,
  'next-level-xp': 20000,
  'next-level-tp': 3300,
});
const vitals = {
  hp: 172,
  'hp-string': 'Healthy',
  maxhp: 172,
  mana: 40,
  'mana-string': 'Full',
  maxmana: 40,
  mp: 131,
  'mp-string': 'Rested',
  maxmp: 131,
  xp: 5770000,
  tp: 40100,
  carrying: 'light',
  ride: null,
  ridden: null,
  climb: null,
  sneak: null,
  hidden: false,
  swim: false,
  light: '*',
  fog: null,
  weather: ' ',
  alertness: 'normal',
  mood: 'brave',
  'spell-effort': 'normal',
  position: 'standing',
  'mount-moves': null,
  wimpy: 30,
  opponent: null,
  buffer: null,
  'opponent-hits': null,
  'buffer-hits': null,
};
gmcp('Char.Vitals', vitals);
gmcp('Group.Set', [
  { id: 1, type: 'you', name: 'Rasta', label: 0, hp: 172, 'hp-string': 'Healthy', maxhp: 172, mana: 40, 'mana-string': 'Full', maxmana: 40, mp: 131, 'mp-string': 'Rested', maxmp: 131 },
  { id: 2, type: 'ally', name: 'Gibur', hp: 140, 'hp-string': 'Healthy', maxhp: 140, mana: 90, 'mana-string': 'Full', maxmana: 90, mp: 110, 'mp-string': 'Rested', maxmp: 110 },
  { id: 3, type: 'ally', name: 'Dori', hp: 95, 'hp-string': 'Fine', maxhp: 120, mana: 150, 'mana-string': 'Full', maxmana: 150, mp: 80, 'mp-string': 'Tired', maxmp: 100 },
  { id: 4, type: 'npc', name: 'a citizen mercenary', label: 'MERC', hp: 200, 'hp-string': 'Healthy', maxhp: 200, mana: 0, 'mana-string': 'Full', maxmana: 0, mp: 150, 'mp-string': 'Rested', maxmp: 150 },
  { id: 5, type: 'npc', name: 'a large dog', label: 0, hp: 60, 'hp-string': 'Healthy', maxhp: 60, mana: 0, 'mana-string': 'Full', maxmana: 0, mp: 90, 'mp-string': 'Rested', maxmp: 90 },
]);
line(c(32, 'The Last Bridge'));
line('The ancient stone bridge spans the Hoarwell here. The road continues east and west.');
line('Exits: east, west.');
line('A citizen mercenary (MERC) stands here, guarding you.');
line('A large dog is here, wagging its tail.');
prompt();

// ------------------------------------------------------ clock and chatter
wait(2);
cmd('time');
line('8 am on Sterday, the 12th of Astron, year 2973 of the Third Age.');
prompt();
wait(1.5);
gmcp('Comm.Channel.Text', { channel: 'tales', talker: 'Gibur', 'talker-type': 'player', text: "Gibur narrates 'orcs gathering at the ford'" });
line(c(33, "Gibur narrates 'orcs gathering at the ford'"));
prompt();
wait(2);
cmd('tell gibur on my way');
gmcp('Comm.Channel.Text', { channel: 'tells', talker: 'you', destination: 'Gibur', text: 'on my way' });
line(c(32, "You tell Gibur 'on my way'"));
prompt();
wait(1.5);
gmcp('Comm.Channel.Text', { channel: 'tells', talker: 'Gibur', 'talker-type': 'player', text: "Gibur tells you 'hurry, bring the merc'" });
line(c(32, "Gibur tells you 'hurry, bring the merc'"));
prompt();
wait(1);
gmcp('Event.Sun', { what: 'rise' });
line(c(33, 'The sun rises in the east.'));
prompt();
wait(1.5);
cmd('look at clock');
line('The current time is 8:00am.');
prompt();
wait(1.5);
cmd('wimpy 50');
line('Wimpy set to: 50');
gmcp('Char.Vitals', { wimpy: 50 });
prompt();
wait(1);
cmd('change mood aggressive');
line('You will now fight aggressively.');
gmcp('Char.Vitals', { mood: 'aggressive' });
prompt();

// --------------------------------------------------------------- moving
wait(2);
cmd('e');
gmcp('Event.Moved', { dir: 'east' });
gmcp('Group.Remove', 5);
gmcp('Char.Vitals', { mp: 128, 'mp-string': 'Rested' });
line(c(32, 'Ford of Bruinen'));
line('The river runs shallow and fast over a bed of round stones.');
line('Exits: east, west.');
line(c(31, 'An orc scout is here, fighting nobody.'));
prompt('o HP:Fine>');
wait(0.4);
gmcp('Group.Add', { id: 6, type: 'npc', name: 'a large dog', label: 0, hp: 60, 'hp-string': 'Healthy', maxhp: 60, mana: 0, 'mana-string': 'Full', maxmana: 0, mp: 88, 'mp-string': 'Rested', maxmp: 90 });
line('A large dog arrives from the west.');
prompt();
wait(1.5);
cmd('label dog DOG');
line('You label a large dog as DOG.');
gmcp('Group.Update', { id: 6, label: 'DOG' });
prompt();
wait(1.5);
gmcp('Comm.Channel.Text', { channel: 'says', talker: 'Dori', 'talker-type': 'player', text: "Dori says 'I can smell them' in Khuzdul." });
line(c(36, "Dori says 'I can smell them' in Khuzdul."));
prompt();
wait(1);
cmd('whisper dori stay behind me');
gmcp('Comm.Channel.Text', { channel: 'whispers', talker: 'you', destination: 'Dori', text: 'stay behind me' });
line("You whisper to Dori 'stay behind me'");
prompt();
wait(1);
gmcp('Comm.Channel.Text', { channel: 'socials', talker: 'Dori', 'talker-type': 'player', text: 'Dori nods solemnly.' });
line('Dori nods solemnly.');
prompt();

// ---------------------------------------------------------------- fight
wait(2);
cmd('kill scout');
line('You attack an orc scout.');
gmcp('Char.Vitals', { position: 'fighting', opponent: 'an orc scout', buffer: 'Rasta', 'opponent-hits': 'healthy', 'buffer-hits': 'healthy' });
line(c(31, 'You slash an orc scout hard.'));
prompt('o HP:Fine Mana:Full scout:Healthy>');
wait(1);
gmcp('Char.Vitals', { 'opponent-hits': 'fine' });
line('An orc scout slashes you.');
gmcp('Char.Vitals', { hp: 158, 'hp-string': 'Fine', 'buffer-hits': 'fine' });
gmcp('Group.Update', { id: 1, hp: 158, 'hp-string': 'Fine' });
prompt('o HP:Fine scout:Fine>');
wait(1);
gmcp('Comm.Channel.Text', { channel: 'yells', talker: '*Throzghul*', 'talker-type': 'enemy', text: `${c(31, '*Throzghul*')} yells loudly from the east 'kill them all' in Orkish.` });
line(`${c(31, '*Throzghul*')} yells loudly from the east 'kill them all' in Orkish.`);
prompt('o HP:Fine scout:Fine>');
wait(1);
line('A citizen mercenary (MERC) hits an orc scout.');
gmcp('Char.Vitals', { 'opponent-hits': 'hurt' });
gmcp('Group.Update', { id: 3, 'hp-string': 'Hurt' });
line('An orc scout pierces Dori hard.');
prompt('o HP:Fine scout:Hurt>');
wait(0.8);
gmcp('Group.Update', { id: 3, hp: 61 });
gmcp('Group.Update', { id: 4, hp: 182, 'hp-string': 'Healthy', mp: 140, 'mp-string': 'Rested' });
wait(1);
gmcp('Char.Vitals', { 'opponent-hits': 'wounded' });
line(c(31, 'You cleave an orc scout extremely hard.'));
prompt('o HP:Fine scout:Wounded>');
wait(1);
gmcp('Comm.Channel.Text', { channel: 'emotes', talker: 'Gibur', 'talker-type': 'player', text: 'Gibur grins at the scout wickedly.' });
line('Gibur grins at the scout wickedly.');
wait(1);
gmcp('Char.Vitals', { 'opponent-hits': 'dying' });
line(c(31, 'You slash an orc scout extremely hard.'));
prompt('o HP:Fine scout:Dying>');
wait(1);
line('An orc scout is dead! R.I.P.');
gmcp('Char.Vitals', { position: 'standing', opponent: null, buffer: null, 'opponent-hits': null, 'buffer-hits': null, xp: 5795500, tp: 40350 });
line(c(1, 'You rise a level!'));
gmcp('Char.StatusVars', { level: 26, 'next-level-xp': 750000, 'next-level-tp': 3400 });
gmcp('Event.Achieved', { what: 'Defeated an orc scout at the Ford of Bruinen.' });
line('Achievement unlocked: Defeated an orc scout at the Ford of Bruinen.');
prompt();

// ------------------------------------------------------------ aftermath
wait(1.5);
gmcp('Comm.Channel.Text', { channel: 'tales', talker: 'you', text: 'scout down at the ford' });
cmd('narrate scout down at the ford');
line(c(33, "You narrate 'scout down at the ford'"));
prompt();
wait(1.5);
gmcp('Comm.Channel.Text', { channel: 'prayers', talker: 'Dori', 'talker-type': 'player', text: "Dori prays 'Mahal, mend my wounds'" });
wait(1);
gmcp('Comm.Channel.Text', { channel: 'questions', talker: 'Ecthel', 'talker-type': 'player', text: "Ecthel asks 'anyone near Rivendell?'" });
wait(1);
gmcp('Comm.Channel.Text', { channel: 'songs', talker: 'Lindir', 'talker-type': 'player', text: "Lindir sings 'A Elbereth Gilthoniel'" });
wait(1);
cmd('sneak');
line('You will now try to move silently.');
gmcp('Char.Vitals', { sneak: 's', alertness: 'careful' });
prompt();
wait(1.5);
cmd('rest');
line('You sit down and rest your tired bones.');
gmcp('Char.Vitals', { position: 'resting', hp: 165, 'hp-string': 'Fine' });
gmcp('Group.Update', { id: 3, hp: 75, 'hp-string': 'Fine' });
prompt('o HP:Fine>');

// ------------------------------------------------ a member leaves and returns
wait(2);
line('Gibur leaves east.');
gmcp('Group.Remove', 2);
prompt();
wait(3);
line('Gibur arrives from the east.');
gmcp('Group.Add', { id: 7, type: 'ally', name: 'Gibur', hp: 131, 'hp-string': 'Fine', maxhp: 140, mana: 70, 'mana-string': 'Full', maxmana: 90, mp: 95, 'mp-string': 'Rested', maxmp: 110 });
gmcp('Comm.Channel.Text', { channel: 'tells', talker: 'Gibur', 'talker-type': 'player', text: "Gibur tells you 'more coming, 2 trolls'" });
line(c(32, "Gibur tells you 'more coming, 2 trolls'"));
prompt();
wait(2);
cmd('stand');
line('You stand up.');
gmcp('Char.Vitals', { position: 'standing', hp: 172, 'hp-string': 'Healthy', climb: 'c', ride: null, swim: false });
prompt();
wait(3);
gmcp('Char.Vitals', { mp: 131, 'mp-string': 'Rested' });
gmcp('Group.Update', { id: 7, mp: 110, 'mp-string': 'Rested', mana: 90, 'mana-string': 'Full' });
line('You feel rested.');
prompt();
wait(3);
line('The river keeps running over the stones.');
prompt();

wait(4);
gmcp('Comm.Channel.Text', { channel: 'says', talker: 'you', text: 'ready when you are' });
cmd('say ready when you are');
line(c(36, "You say 'ready when you are'"));
prompt();
wait(4);
gmcp('Event.Darkness', { what: 'end' });
line('A crow caws somewhere to the north.');
prompt();

writeFileSync(new URL('./gmcp-demo.log', import.meta.url), out.join('\n') + '\n');
console.log(`gmcp-demo.log: ${out.length} lines, ${t.toFixed(1)} s`);
