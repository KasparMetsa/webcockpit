import { describe, expect, it } from 'vitest';
import { Bus } from '../../src/core/bus';
import { type Line } from '../../src/core/types';
import { CLOCK_KEY, GameState, type GamePart } from '../../src/gmcp/state';
import { ScriptEngine } from '../../src/script/engine';

const T = 1_790_449_200_000;

class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string): string | null {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.m.set(k, v);
  }
}

const line = (text: string): Line => ({ text, runs: [], tags: [], prompt: false, raw: text, ts: 0 });

function setup(storage: MemStorage | null = new MemStorage(), now = () => T) {
  const bus = new Bus();
  const game = new GameState({ now, storage: storage as unknown as Storage }).attach(bus);
  const parts: GamePart[] = [];
  game.subscribe((p) => parts.push(p));
  const engine = new ScriptEngine({ send: () => {}, message: () => {} });
  engine.attach(bus);
  game.installRules(engine.system);
  return { bus, game, parts, engine, storage };
}

describe('GameState', () => {
  it('routes GMCP to the models and tells listeners what changed', () => {
    const t = setup();
    t.bus.emit('gmcp', { pkg: 'Char.Name', data: { name: 'Rasta' } });
    t.bus.emit('gmcp', { pkg: 'Group.Set', data: [{ id: 2, type: 'ally', name: 'Gibur' }] });
    t.bus.emit('gmcp', { pkg: 'Comm.Channel.Text', data: {} });
    expect(t.parts).toEqual(['char', 'group']);
    expect(t.game.char.name).toBe('Rasta');
    expect(t.game.group.list()).toHaveLength(1);
  });

  it('Char.Vitals fight fields reach the group', () => {
    const t = setup();
    t.bus.emit('gmcp', { pkg: 'Group.Set', data: [{ id: 2, type: 'ally', name: 'Gibur', hp: 100, maxhp: 100 }] });
    t.parts.length = 0;
    t.bus.emit('gmcp', { pkg: 'Char.Vitals', data: { buffer: 'Gibur', 'buffer-hits': 'bad' } });
    expect(t.parts).toEqual(['char', 'group']);
    expect(t.game.group.get(2)!.hp.word).toBe('bad');
  });

  it('resets on a new connection and a live disconnect, not after a replay', () => {
    const t = setup();
    const named = () => t.bus.emit('gmcp', { pkg: 'Char.Name', data: { name: 'Rasta' } });
    named();
    t.bus.emit('conn.state', { state: 'disconnected', prev: 'playing', replay: true });
    expect(t.game.char.name).toBe('Rasta');
    t.bus.emit('conn.state', { state: 'connecting', prev: 'disconnected' });
    expect(t.game.char.name).toBeNull();
    named();
    t.bus.emit('conn.state', { state: 'disconnected', prev: 'playing', reason: 'closed' });
    expect(t.game.char.name).toBeNull();
  });

  it('wimpy lines are system rules', () => {
    const t = setup();
    t.engine.processLine(line('Wimpy set to: 50'));
    expect(t.game.char.view().wimpy).toBe(50);
    t.engine.processLine(line('Wimpy removed.'));
    expect(t.game.char.view().wimpy).toBe(0);
    t.engine.processLine(line('Wimpy set to: lots'));
    expect(t.game.char.view().wimpy).toBe(0);
    // Not in the profile.
    expect(t.engine.user.count('action')).toBe(0);
  });

  it('clock lines and Event.Sun sync the clock, which is saved', () => {
    const t = setup();
    t.engine.processLine(line('8 am on Sterday, the 12th of Astron, year 2973 of the Third Age.'));
    expect(t.game.clock.precision).toBe('hour');
    expect(t.parts).toContain('clock');
    t.bus.emit('gmcp', { pkg: 'Event.Sun', data: { what: 'rise' } });
    expect(t.game.clock.now(T)).toMatchObject({ hour: 7, minute: 0 });
    t.engine.processLine(line('The current time is 8:05am.'));
    expect(t.game.clock.now(T)).toMatchObject({ hour: 8, minute: 5 });
    const saved = JSON.parse(t.storage!.getItem(CLOCK_KEY)!);
    expect(saved).toMatchObject({ precision: 'minute', reason: 'room_clock', lastSync: T / 1000 });
    // A new page loads it.
    const again = new GameState({ now: () => T + 1000, storage: t.storage as unknown as Storage });
    expect(again.clock.now(T + 1000)).toMatchObject({ hour: 8, minute: 6 });
    // The clock survives a disconnect.
    t.bus.emit('conn.state', { state: 'disconnected', prev: 'playing' });
    expect(t.game.clock.precision).toBe('minute');
  });

  it('MSSP time syncs the clock', () => {
    const t = setup();
    t.game.mssp(new Map([
      ['GAME YEAR', ['2973']],
      ['GAME MONTH', ['Astron']],
      ['GAME DAY', ['0']],
      ['GAME HOUR', ['9']],
    ]));
    expect(t.game.clock.now(T)).toMatchObject({ day: 1, hour: 9 });
  });

  it('works without storage', () => {
    const t = setup(null);
    t.engine.processLine(line('Sterday, the 12th of Astron, year 2973 of the Third Age.'));
    expect(t.game.clock.precision).toBe('day');
  });
});
