import { describe, expect, it } from 'vitest';
import { CharModel, capitalise } from '../../src/gmcp/char';

describe('CharModel', () => {
  it('starts empty', () => {
    const v = new CharModel().view();
    expect(v).toMatchObject({ name: null, level: null, xp: null, tp: null, mood: null, wimpy: null, maxhp: null });
    expect(v.toggles).toEqual({ sneak: false, ride: false, climb: false, swim: false });
  });

  it('takes the name, capitalised in the view', () => {
    const c = new CharModel();
    expect(c.apply('Char.Name', { name: 'rasta', fullname: 'Rasta Fari' })).toBe(true);
    expect(c.view().name).toBe('Rasta');
    expect(c.fullname).toBe('Rasta Fari');
    expect(capitalise('')).toBe('');
  });

  it('merges vitals: absent keeps, null sets null', () => {
    const c = new CharModel();
    c.apply('char.vitals', { mood: 'brave', climb: 'c', sneak: 'S', swim: true, ride: 'a pony' });
    expect(c.view().toggles).toEqual({ sneak: true, ride: true, climb: true, swim: true });
    c.apply('Char.Vitals', { mood: 'Wimpy' });
    expect(c.view().mood).toBe('wimpy');
    expect(c.view().toggles.climb).toBe(true); // absent: kept
    c.apply('Char.Vitals', { climb: null, sneak: null, swim: false, ride: null });
    expect(c.vitals.has('climb')).toBe(true);
    expect(c.vitals.get('climb')).toBeNull();
    expect(c.view().toggles).toEqual({ sneak: false, ride: false, climb: false, swim: false });
    expect(c.apply('Char.Vitals', { climb: null })).toBe(false); // no change
    expect(c.apply('Char.Vitals', 'junk')).toBe(false);
    expect(c.apply('Comm.Channel.Text', {})).toBe(false);
  });

  it('derives the level from XP, not StatusVars', () => {
    const c = new CharModel();
    c.apply('Char.StatusVars', { level: 30, race: 'Man' });
    expect(c.view().level).toBe(30); // fallback while XP is unknown
    c.apply('Char.Vitals', { xp: 5_770_000, tp: 40_000 });
    expect(c.view().level).toBe(25);
  });

  it('anchors the session at the first XP/TP and splits the bars', () => {
    const c = new CharModel();
    c.apply('Char.Vitals', { xp: 5_230_000 });
    c.apply('Char.Vitals', { tp: 39_000 });
    expect([c.anchorXp, c.anchorTp]).toEqual([5_230_000, 39_000]);
    c.apply('Char.Vitals', { xp: 5_440_000, tp: 40_000 });
    const v = c.view();
    expect(v.xp!.baseline).toBeCloseTo(0.2);
    expect(v.xp!.progress).toBeCloseTo(0.5);
    expect(v.tp!.baseline).toBeLessThan(v.tp!.progress);
    // A level-up: the whole fill is gain.
    c.apply('Char.Vitals', { xp: 5_865_000 });
    expect(c.view().xp!.baseline).toBe(0);
  });

  it('TP needs XP and scales for trolls', () => {
    const c = new CharModel();
    c.apply('Char.Vitals', { tp: 125 });
    expect(c.view().tp).toBeNull();
    c.apply('Char.Vitals', { xp: 20_000 });
    expect(c.view().tp!.progress).toBe(0);
    c.apply('Char.StatusVars', { race: 'Troll' });
    expect(c.view().tp!.progress).toBeCloseTo(0.5);
  });

  it('wimpy from vitals and from text', () => {
    const c = new CharModel();
    c.apply('Char.Vitals', { wimpy: 30, maxhp: 172 });
    expect(c.view()).toMatchObject({ wimpy: 30, maxhp: 172 });
    expect(c.setWimpy(50)).toBe(true);
    expect(c.setWimpy(50)).toBe(false);
    expect(c.view().wimpy).toBe(50);
    c.setWimpy(0);
    expect(c.view().wimpy).toBe(0);
  });

  it('reset clears everything; another character starts a new session', () => {
    const c = new CharModel();
    c.apply('Char.Name', { name: 'Rasta' });
    c.apply('Char.Vitals', { xp: 5_000_000, mood: 'brave' });
    c.reset();
    expect(c.view().name).toBeNull();
    expect(c.anchorXp).toBeNull();
    expect(c.view().mood).toBeNull();
    c.apply('Char.Name', { name: 'Rasta' });
    c.apply('Char.Vitals', { xp: 5_000_000 });
    c.apply('Char.Name', { name: 'rasta' }); // same name again: same session
    expect(c.anchorXp).toBe(5_000_000);
    c.apply('Char.Name', { name: 'Gibur' });
    expect(c.anchorXp).toBeNull();
    expect(c.vitals.size).toBe(0);
    c.apply('Char.Vitals', { xp: 7_000_000 });
    expect(c.anchorXp).toBe(7_000_000);
  });
});
