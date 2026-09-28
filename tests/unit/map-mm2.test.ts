import { existsSync, readFileSync } from 'node:fs';
import { deflateSync, inflateSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  DIR,
  DIR_COUNT,
  DOOR_FLAG,
  EXIT_FLAG,
  INFOMARK_TYPE,
  type MapData,
  buildIndexes,
  exitSources,
  exitTargets,
  roomsByNameDesc,
} from '../../src/map/model';
import { MM2_MAGIC, Mm2Error, inflateZlib, mapHash, readMm2 } from '../../src/map/mm2';
import { encodeMm2Payload, wrapMm2, writeMm2 } from '../../src/map/mm2-write';
import { neighbourhood, subsetMap } from '../../src/map/subset';

const nodeInflate = async (z: Uint8Array): Promise<Uint8Array> => new Uint8Array(inflateSync(z));
const nodeDeflate = async (b: Uint8Array): Promise<Uint8Array> => new Uint8Array(deflateSync(b));

interface RoomSpec {
  id: number;
  pos: [number, number, number];
  name?: string;
  desc?: string;
  serverId?: number;
  terrain?: number;
  /** dir → [exit flags, door flags, door name, target ext ids]. */
  exits?: Partial<Record<number, [number, number, string, number[]]>>;
}

/** A MapData straight from specs (exits by external id, as in the file). */
function makeMap(specs: RoomSpec[], marks: MapData['infomarks'] | null = null): MapData {
  const n = specs.length;
  const slots = n * DIR_COUNT;
  const byExt = new Map(specs.map((s, i) => [s.id, i]));
  const outStart = new Uint32Array(slots + 1);
  const to: number[] = [];
  const exitFlags = new Uint16Array(slots);
  const doorFlags = new Uint16Array(slots);
  const doorNames = new Map<number, string>();
  specs.forEach((s, r) => {
    for (let d = 0; d < DIR_COUNT; d++) {
      const slot = r * DIR_COUNT + d;
      outStart[slot] = to.length;
      const e = s.exits?.[d];
      if (!e) continue;
      exitFlags[slot] = e[0];
      doorFlags[slot] = e[1];
      if (e[2]) doorNames.set(slot, e[2]);
      for (const t of e[3]) to.push(byExt.get(t)!);
    }
  });
  outStart[slots] = to.length;
  const u8 = (f: (s: RoomSpec) => number): Uint8Array => Uint8Array.from(specs, f);
  const map: MapData = {
    version: 42,
    roomCount: n,
    selected: { x: 1, y: 2, z: 0 },
    x: Int32Array.from(specs, (s) => s.pos[0]),
    y: Int32Array.from(specs, (s) => s.pos[1]),
    z: Int32Array.from(specs, (s) => s.pos[2]),
    extId: Uint32Array.from(specs, (s) => s.id),
    serverId: Uint32Array.from(specs, (s) => s.serverId ?? 0),
    terrain: u8((s) => s.terrain ?? 3),
    light: u8(() => 2),
    align: u8(() => 0),
    portable: u8(() => 0),
    ridable: u8(() => 2),
    sundeath: u8(() => 0),
    mobFlags: Uint32Array.from(specs, () => 1 << 1),
    loadFlags: Uint32Array.from(specs, () => 1 << 5),
    names: specs.map((s) => s.name ?? `Room ${s.id}`),
    descs: specs.map((s) => s.desc ?? `A plain room number ${s.id}.\n`),
    areas: specs.map(() => ''),
    exitFlags,
    doorFlags,
    doorNames,
    outStart,
    outTo: Uint32Array.from(to),
    inStart: new Uint32Array(0),
    inFrom: new Uint32Array(0),
    infomarks: marks ?? {
      count: 0,
      type: new Uint8Array(0),
      cls: new Uint8Array(0),
      angle: new Int32Array(0),
      x1: new Int32Array(0),
      y1: new Int32Array(0),
      z1: new Int32Array(0),
      x2: new Int32Array(0),
      y2: new Int32Array(0),
      z2: new Int32Array(0),
      text: [],
    },
    byServerId: new Map(),
    byNameDesc: new Map(),
    bounds: { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0, count: 0 },
    layers: new Map(),
  };
  buildIndexes(map);
  return map;
}

const E = EXIT_FLAG.EXIT;

/** Three rooms: A(0,0) ⇄ B(1,0) east/west, B → C up (one-way), a hidden door north of A, a dangling exit. */
function tiny(): MapData {
  const marks: MapData['infomarks'] = {
    count: 2,
    type: Uint8Array.from([INFOMARK_TYPE.TEXT, INFOMARK_TYPE.LINE]),
    cls: Uint8Array.from([1, 2]),
    angle: Int32Array.from([0, 0]),
    x1: Int32Array.from([50, 0]),
    y1: Int32Array.from([50, 0]),
    z1: Int32Array.from([0, 0]),
    x2: Int32Array.from([50, 200]),
    y2: Int32Array.from([50, 0]),
    z2: Int32Array.from([0, 0]),
    text: ['Herbs here', 'ignored'],
  };
  return makeMap(
    [
      {
        id: 10,
        pos: [0, 0, 0],
        name: 'Market  Square',
        desc: 'A busy\n  square.',
        serverId: 1234,
        exits: {
          [DIR.E]: [E | EXIT_FLAG.ROAD, 0, '', [20]],
          [DIR.N]: [E | EXIT_FLAG.DOOR, DOOR_FLAG.HIDDEN, 'gate', []],
          [DIR.S]: [0, DOOR_FLAG.NEED_KEY, 'stray', []],
        },
      },
      { id: 20, pos: [1, 0, 0], exits: { [DIR.W]: [E, 0, '', [10]], [DIR.U]: [E | EXIT_FLAG.CLIMB, 0, '', [30]] } },
      { id: 30, pos: [1, 0, 1], terrain: 13 },
    ],
    marks,
  );
}

describe('mm2 reader (synthetic v42)', () => {
  it('round-trips a tiny map through writeMm2 / readMm2', async () => {
    const file = await writeMm2(tiny(), nodeDeflate);
    expect(new DataView(file.buffer).getUint32(0)).toBe(MM2_MAGIC);
    const m = await readMm2(file, nodeInflate);
    expect(m.roomCount).toBe(3);
    expect(m.selected).toEqual({ x: 1, y: 2, z: 0 });
    expect([...m.x]).toEqual([0, 1, 1]);
    expect([...m.z]).toEqual([0, 0, 1]);
    expect(m.names[0]).toBe('Market  Square');
    expect(m.terrain[2]).toBe(13);
    expect(m.ridable[0]).toBe(2);
    expect(m.mobFlags[0]).toBe(2);
    expect(m.loadFlags[0]).toBe(32);
    expect([...exitTargets(m, 0, DIR.E)]).toEqual([1]);
    expect([...exitTargets(m, 1, DIR.U)]).toEqual([2]);
    // Incoming rebuilt: C is entered from below (its D slot) by B.
    expect([...exitSources(m, 2, DIR.D)]).toEqual([1]);
    expect([...exitSources(m, 1, DIR.W)]).toEqual([0]);
    expect(m.byServerId.get(1234)).toBe(0);
    expect(m.bounds).toMatchObject({ minX: 0, maxX: 1, minZ: 0, maxZ: 1, count: 3 });
    expect(m.layers.get(1)).toEqual({ minX: 1, maxX: 1, minY: 0, maxY: 0, count: 1 });
    expect(m.infomarks.count).toBe(2);
    expect(m.infomarks.text).toEqual(['Herbs here', '']); // LINE loses its text
    expect(m.infomarks.x2[1]).toBe(200);
  });

  it('applies MMapper exit invariants', async () => {
    const m = await readMm2(await writeMm2(tiny(), nodeDeflate), nodeInflate);
    const n = 0 * DIR_COUNT + DIR.N;
    expect(m.exitFlags[n]! & EXIT_FLAG.UNMAPPED).toBeTruthy(); // EXIT without targets
    expect(m.exitFlags[n]! & EXIT_FLAG.DOOR).toBeTruthy();
    expect(m.doorNames.get(n)).toBe('gate');
    expect(m.doorFlags[n]).toBe(DOOR_FLAG.HIDDEN);
    const s = 0 * DIR_COUNT + DIR.S; // door data without an exit is cleared
    expect(m.exitFlags[s]).toBe(0);
    expect(m.doorFlags[s]).toBe(0);
    expect(m.doorNames.has(s)).toBe(false);
  });

  it('finds rooms by normalised name and description', () => {
    const m = tiny();
    expect(roomsByNameDesc(m, 'Market Square', 'A busy square.')).toEqual([0]);
    expect(roomsByNameDesc(m, 'Market Square', 'A quiet square.')).toEqual([]);
  });

  it('drops dangling targets but keeps the exit (UNMAPPED)', async () => {
    const m = makeMap([
      { id: 1, pos: [0, 0, 0], exits: { [DIR.E]: [E, 0, '', [2]] } },
      { id: 2, pos: [1, 0, 0] },
    ]);
    m.roomCount = 1; // write room 1 only: its east target no longer exists
    const r = await readMm2(await writeMm2(m, nodeDeflate), nodeInflate);
    expect(r.roomCount).toBe(1);
    expect(exitTargets(r, 0, DIR.E).length).toBe(0);
    expect(r.exitFlags[DIR.E]! & EXIT_FLAG.EXIT).toBeTruthy();
  });

  it('rejects other versions, bad magic and damaged data with clear errors', async () => {
    const file = await writeMm2(tiny(), nodeDeflate);
    const v41 = file.slice();
    new DataView(v41.buffer).setUint32(4, 41);
    await expect(readMm2(v41, nodeInflate)).rejects.toThrow(/version 41.*only version 42/);
    const bad = file.slice();
    bad[0] = 0;
    await expect(readMm2(bad, nodeInflate)).rejects.toThrow(Mm2Error);
    await expect(readMm2(file.slice(0, 5), nodeInflate)).rejects.toThrow(/too short/);
    const wrongLen = file.slice();
    new DataView(wrongLen.buffer).setUint32(8, 7);
    await expect(readMm2(wrongLen, nodeInflate)).rejects.toThrow(/header says 7/);
    const full = encodeMm2Payload(tiny());
    const trunc = await wrapMm2(full.slice(0, full.length - 10), nodeDeflate);
    await expect(readMm2(trunc, nodeInflate)).rejects.toThrow(/unexpected end/);
  });

  it('works with the default DecompressionStream inflate', async () => {
    const m = await readMm2(await writeMm2(tiny()), inflateZlib);
    expect(m.roomCount).toBe(3);
  });

  it('cuts a subset with exits and marks inside it', () => {
    const m = tiny();
    const s = subsetMap(m, [1, 0]);
    expect(s.roomCount).toBe(2);
    expect([...exitTargets(s, 0, DIR.E)]).toEqual([1]);
    expect(exitTargets(s, 1, DIR.U).length).toBe(0);
    expect(s.infomarks.count).toBe(2);
    expect([...neighbourhood(m, [0], 1)].sort()).toEqual([0, 1]);
    expect([...neighbourhood(m, [0], 2)].sort()).toEqual([0, 1, 2]);
  });
});

const ARDA = new URL('../../public/map/arda.mm2', import.meta.url);

describe.skipIf(!existsSync(ARDA))('mm2 reader (public/map/arda.mm2)', () => {
  it('reads the bundled map (numbers from research §1.5)', async () => {
    const bytes = new Uint8Array(readFileSync(ARDA));
    const t0 = performance.now();
    const m = await readMm2(bytes);
    const ms = performance.now() - t0;
    expect(m.version).toBe(42);
    expect(m.roomCount).toBe(30074);
    expect(m.infomarks.count).toBe(674);
    expect(m.byServerId.size).toBe(4912);
    expect(m.bounds).toEqual({ minX: -28, maxX: 611, minY: -261, maxY: 12, minZ: -1, maxZ: 2, count: 30074 });
    expect(m.layers.get(-1)?.count).toBe(185);
    expect(m.layers.get(0)?.count).toBe(29826);
    expect(m.layers.get(1)?.count).toBe(61);
    expect(m.layers.get(2)?.count).toBe(2);
    expect(m.selected).toEqual({ x: 451, y: -84, z: 0 });
    const types = [0, 0, 0];
    for (let i = 0; i < m.infomarks.count; i++) types[m.infomarks.type[i]!]!++;
    expect(types).toEqual([614, 17, 43]);
    // 176 exits with more than one target; +y is north (targets at Δ(0,+1), any z).
    let multi = 0;
    let northUp = 0;
    for (let r = 0; r < m.roomCount; r++) {
      for (let d = 0; d < DIR_COUNT; d++) {
        const t = exitTargets(m, r, d as 0);
        if (t.length > 1) multi++;
        if (d === DIR.N) for (const o of t) if (m.x[o] === m.x[r] && m.y[o] === m.y[r]! + 1) northUp++;
      }
    }
    expect(multi).toBe(176);
    expect(northUp).toBe(19058);
    // Every room can be found again by its own name and description.
    for (const r of [0, 1000, 20000, 30073]) {
      expect(roomsByNameDesc(m, m.names[r]!, m.descs[r]!)).toContain(r);
    }
    expect(ms).toBeLessThan(2000);
    expect(await mapHash(bytes)).toMatch(/^[0-9a-f]{32}$/);
  });

  it('round-trips a subset of the real map', async () => {
    const m = await readMm2(new Uint8Array(readFileSync(ARDA)));
    const start = m.byServerId.values().next().value!;
    const rooms = neighbourhood(m, [start], 3);
    const s = subsetMap(m, rooms);
    const back = await readMm2(await writeMm2(s));
    expect(back.roomCount).toBe(rooms.size);
    expect(back.names).toEqual(s.names);
    expect([...back.outTo]).toEqual([...s.outTo]);
  });
});

