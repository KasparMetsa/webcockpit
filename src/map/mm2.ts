// MMapper `.mm2` reader, schema v42 only (ADR 0020; research
// notes/research/mmapper-rendering.md §1). Pure: runs in the map worker
// and in Node tests. The inflate step is injectable; the default uses
// `DecompressionStream('deflate')` (zlib-wrapped, as qCompress writes).
//
//   0   i32 BE  magic FF B2 AF 01
//   4   u32 BE  schema version (42)
//   8   u32 BE  uncompressed length (qCompress header)
//   12  …       zlib stream to EOF → the QDataStream payload (big endian)
//
// Payload: u32 rooms, u32 marks, Coordinate selected, rooms × Room,
// marks × Infomark. Strings are QString: u32 byte length (0xFFFFFFFF =
// null) then UTF-16BE. Contents and notes are skipped by length.

import {
  DIR_COUNT,
  EXIT_FLAG,
  INFOMARK_TYPE,
  type Infomarks,
  type MapData,
  buildIndexes,
} from './model';

export const MM2_MAGIC = 0xffb2af01;
export const MM2_VERSION = 42;
/** Bytes before the zlib stream. */
export const MM2_HEADER = 12;

/** Inflates a zlib (RFC 1950) stream. */
export type Inflate = (zlib: Uint8Array) => Promise<Uint8Array>;

export class Mm2Error extends Error {
  override name = 'Mm2Error';
}

/** Default inflate: `DecompressionStream('deflate')` (browsers, workers, Node ≥ 18). */
export const inflateZlib: Inflate = async (zlib) => {
  const stream = new Blob([zlib as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
};

/** The header of a `.mm2` file, or an error for anything that is not v42. */
export function readMm2Header(bytes: Uint8Array): { version: number; length: number } {
  if (bytes.byteLength < MM2_HEADER) throw new Mm2Error('Not an MMapper map (.mm2): file too short');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0) !== MM2_MAGIC) throw new Mm2Error('Not an MMapper map (.mm2): bad magic number');
  const version = dv.getUint32(4);
  if (version !== MM2_VERSION) {
    throw new Mm2Error(
      `Unsupported MMapper map version ${version}: only version ${MM2_VERSION} (MMapper 25.05 and later) can be read. ` +
        'Open and save the map in a current MMapper first.',
    );
  }
  return { version, length: dv.getUint32(8) };
}

/** Reads a whole `.mm2` file (header, inflate, payload). */
export async function readMm2(bytes: Uint8Array, inflate: Inflate = inflateZlib): Promise<MapData> {
  const { version, length } = readMm2Header(bytes);
  let payload: Uint8Array;
  try {
    payload = await inflate(bytes.subarray(MM2_HEADER));
  } catch (err) {
    throw new Mm2Error(`Damaged MMapper map: decompression failed (${err instanceof Error ? err.message : String(err)})`);
  }
  if (payload.byteLength !== length) {
    throw new Mm2Error(`Damaged MMapper map: ${payload.byteLength} bytes after decompression, header says ${length}`);
  }
  return parseMm2Payload(payload, version);
}

const NO_TARGET = 0xffffffff;

/** Parses the inflated v42 payload. */
export function parseMm2Payload(u: Uint8Array, version = MM2_VERSION): MapData {
  const dv = new DataView(u.buffer, u.byteOffset, u.byteLength);
  const end = u.byteLength;
  const td = new TextDecoder('utf-16be');
  let p = 0;
  const need = (n: number): void => {
    if (p + n > end) throw new Mm2Error(`Damaged MMapper map: unexpected end of data at byte ${p}`);
  };
  const u8 = (): number => {
    need(1);
    return u[p++]!;
  };
  const u16 = (): number => {
    need(2);
    const v = dv.getUint16(p);
    p += 2;
    return v;
  };
  const u32 = (): number => {
    need(4);
    const v = dv.getUint32(p);
    p += 4;
    return v;
  };
  const i32 = (): number => {
    need(4);
    const v = dv.getInt32(p);
    p += 4;
    return v;
  };
  const str = (): string => {
    const n = u32();
    if (n === NO_TARGET || n === 0) return '';
    need(n);
    const s = td.decode(u.subarray(p, p + n));
    p += n;
    return s;
  };
  const skipStr = (): void => {
    const n = u32();
    if (n === NO_TARGET) return;
    need(n);
    p += n;
  };

  const rooms = u32();
  const marks = u32();
  // Each room takes at least 7 exits × 12 bytes; reject absurd counts early.
  if (rooms > end / 84 || marks > end / 30) throw new Mm2Error('Damaged MMapper map: impossible room or mark count');
  const selected = { x: i32(), y: i32(), z: i32() };

  const slots = rooms * DIR_COUNT;
  const x = new Int32Array(rooms);
  const y = new Int32Array(rooms);
  const z = new Int32Array(rooms);
  const extId = new Uint32Array(rooms);
  const serverId = new Uint32Array(rooms);
  const terrain = new Uint8Array(rooms);
  const light = new Uint8Array(rooms);
  const align = new Uint8Array(rooms);
  const portable = new Uint8Array(rooms);
  const ridable = new Uint8Array(rooms);
  const sundeath = new Uint8Array(rooms);
  const mobFlags = new Uint32Array(rooms);
  const loadFlags = new Uint32Array(rooms);
  const names: string[] = new Array<string>(rooms);
  const descs: string[] = new Array<string>(rooms);
  const areas: string[] = new Array<string>(rooms);
  const exitFlags = new Uint16Array(slots);
  const doorFlags = new Uint16Array(slots);
  const doorNames = new Map<number, string>();
  const outStart = new Uint32Array(slots + 1);
  // External target ids first; resolved to indices after all rooms are read.
  let ext = new Uint32Array(Math.max(16, rooms * 2));
  let nOut = 0;

  for (let r = 0; r < rooms; r++) {
    areas[r] = str();
    names[r] = str();
    descs[r] = str();
    skipStr(); // contents
    extId[r] = u32();
    serverId[r] = u32();
    skipStr(); // note
    terrain[r] = u8();
    light[r] = u8();
    align[r] = u8();
    portable[r] = u8();
    ridable[r] = u8();
    sundeath[r] = u8();
    mobFlags[r] = u32();
    loadFlags[r] = u32();
    x[r] = i32();
    y[r] = i32();
    z[r] = i32();
    for (let d = 0; d < DIR_COUNT; d++) {
      const s = r * DIR_COUNT + d;
      exitFlags[s] = u16();
      doorFlags[s] = u16();
      const door = str();
      if (door !== '') doorNames.set(s, door);
      outStart[s] = nOut;
      for (let t = u32(); t !== NO_TARGET; t = u32()) {
        if (nOut === ext.length) {
          const grown = new Uint32Array(ext.length * 2);
          grown.set(ext);
          ext = grown;
        }
        ext[nOut++] = t;
      }
    }
  }
  outStart[slots] = nOut;

  const text: string[] = new Array<string>(marks);
  const im: Infomarks = {
    count: marks,
    type: new Uint8Array(marks),
    cls: new Uint8Array(marks),
    angle: new Int32Array(marks),
    x1: new Int32Array(marks),
    y1: new Int32Array(marks),
    z1: new Int32Array(marks),
    x2: new Int32Array(marks),
    y2: new Int32Array(marks),
    z2: new Int32Array(marks),
    text,
  };
  for (let m = 0; m < marks; m++) {
    const t = str();
    let type = u8();
    if (type > INFOMARK_TYPE.ARROW) type = INFOMARK_TYPE.TEXT;
    let cls = u8();
    if (cls > 9) cls = 0;
    im.type[m] = type;
    im.cls[m] = cls;
    im.angle[m] = i32();
    im.x1[m] = i32();
    im.y1[m] = i32();
    im.z1[m] = i32();
    im.x2[m] = i32();
    im.y2[m] = i32();
    im.z2[m] = i32();
    // MMapper loadMark: non-TEXT marks lose their text; empty TEXT gets a default.
    text[m] = type !== INFOMARK_TYPE.TEXT ? '' : t === '' ? 'New Marker' : t;
  }
  if (p !== end) throw new Mm2Error(`Damaged MMapper map: ${end - p} unexpected bytes after the last infomark`);

  // Resolve external ids to indices (dangling targets are dropped) and
  // apply MMapper's exit invariants (RawExit.cpp) on the raw target counts.
  const byExt = new Map<number, number>();
  for (let r = 0; r < rooms; r++) byExt.set(extId[r]!, r);
  const outTo = new Uint32Array(nOut);
  let k = 0;
  for (let s = 0; s < slots; s++) {
    const a = outStart[s]!;
    const b = outStart[s + 1]!;
    outStart[s] = k;
    for (let j = a; j < b; j++) {
      const idx = byExt.get(ext[j]!);
      if (idx !== undefined) outTo[k++] = idx;
    }
    let f = exitFlags[s]!;
    const hasOut = b > a;
    const isExit = (f & EXIT_FLAG.EXIT) !== 0;
    const unmapped = !hasOut && isExit;
    const exit = hasOut || unmapped;
    const door = exit && ((f & EXIT_FLAG.DOOR) !== 0 || doorFlags[s] !== 0 || doorNames.has(s));
    f = exit ? f | EXIT_FLAG.EXIT : f & ~EXIT_FLAG.EXIT;
    f = door ? f | EXIT_FLAG.DOOR : f & ~EXIT_FLAG.DOOR;
    f = unmapped ? f | EXIT_FLAG.UNMAPPED : f & ~EXIT_FLAG.UNMAPPED;
    exitFlags[s] = f;
    if (!door) {
      doorFlags[s] = 0;
      doorNames.delete(s);
    }
  }
  outStart[slots] = k;

  const map: MapData = {
    version,
    roomCount: rooms,
    selected,
    x,
    y,
    z,
    extId,
    serverId,
    terrain,
    light,
    align,
    portable,
    ridable,
    sundeath,
    mobFlags,
    loadFlags,
    names,
    descs,
    areas,
    exitFlags,
    doorFlags,
    doorNames,
    outStart,
    outTo: k === nOut ? outTo : outTo.slice(0, k),
    inStart: new Uint32Array(0),
    inFrom: new Uint32Array(0),
    infomarks: im,
    byServerId: new Map(),
    byNameDesc: new Map(),
    bounds: { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0, count: 0 },
    layers: new Map(),
  };
  buildIndexes(map);
  return map;
}

/** Hex SHA-256 prefix of the file bytes: the key learned server ids are stored under (DB `mapIds`). */
export async function mapHash(bytes: Uint8Array): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as Uint8Array<ArrayBuffer>));
  let s = '';
  for (let i = 0; i < 16; i++) s += d[i]!.toString(16).padStart(2, '0');
  return s;
}

