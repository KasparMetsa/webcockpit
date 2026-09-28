// MMapper `.mm2` v42 writer (the inverse of src/map/mm2.ts). Pure; the
// deflate step is injectable. Used by the tests (synthetic maps) and by
// the HTML replay export, which embeds a map subset as `.mm2` bytes
// (ADR 0020 "Package notes"). Room contents and notes are written empty
// (the reader does not keep them); exits refer to targets by `extId`.

import { DIR_COUNT, type MapData } from './model';
import { MM2_MAGIC, MM2_VERSION } from './mm2';

/** Compresses to a zlib (RFC 1950) stream. */
export type Deflate = (raw: Uint8Array) => Promise<Uint8Array>;

/** Default deflate: `CompressionStream('deflate')`. */
export const deflateZlib: Deflate = async (raw) => {
  const stream = new Blob([raw as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
};

class Writer {
  buf = new Uint8Array(1 << 16);
  dv = new DataView(this.buf.buffer);
  p = 0;
  private room(n: number): void {
    if (this.p + n <= this.buf.length) return;
    let len = this.buf.length * 2;
    while (len < this.p + n) len *= 2;
    const b = new Uint8Array(len);
    b.set(this.buf);
    this.buf = b;
    this.dv = new DataView(b.buffer);
  }
  u8(v: number): void {
    this.room(1);
    this.buf[this.p++] = v;
  }
  u16(v: number): void {
    this.room(2);
    this.dv.setUint16(this.p, v);
    this.p += 2;
  }
  u32(v: number): void {
    this.room(4);
    this.dv.setUint32(this.p, v >>> 0);
    this.p += 4;
  }
  i32(v: number): void {
    this.room(4);
    this.dv.setInt32(this.p, v);
    this.p += 4;
  }
  str(s: string): void {
    this.u32(s.length * 2);
    this.room(s.length * 2);
    for (let i = 0; i < s.length; i++) {
      this.dv.setUint16(this.p, s.charCodeAt(i));
      this.p += 2;
    }
  }
  bytes(): Uint8Array {
    return this.buf.slice(0, this.p);
  }
}

/** The uncompressed v42 payload of `map`. */
export function encodeMm2Payload(map: MapData): Uint8Array {
  const w = new Writer();
  const n = map.roomCount;
  const im = map.infomarks;
  w.u32(n);
  w.u32(im.count);
  w.i32(map.selected.x);
  w.i32(map.selected.y);
  w.i32(map.selected.z);
  for (let r = 0; r < n; r++) {
    w.str(map.areas[r] ?? '');
    w.str(map.names[r] ?? '');
    w.str(map.descs[r] ?? '');
    w.str(''); // contents
    w.u32(map.extId[r]!);
    w.u32(map.serverId[r]!);
    w.str(''); // note
    w.u8(map.terrain[r]!);
    w.u8(map.light[r]!);
    w.u8(map.align[r]!);
    w.u8(map.portable[r]!);
    w.u8(map.ridable[r]!);
    w.u8(map.sundeath[r]!);
    w.u32(map.mobFlags[r]!);
    w.u32(map.loadFlags[r]!);
    w.i32(map.x[r]!);
    w.i32(map.y[r]!);
    w.i32(map.z[r]!);
    for (let d = 0; d < DIR_COUNT; d++) {
      const s = r * DIR_COUNT + d;
      w.u16(map.exitFlags[s]!);
      w.u16(map.doorFlags[s]!);
      w.str(map.doorNames.get(s) ?? '');
      for (let k = map.outStart[s]!; k < map.outStart[s + 1]!; k++) w.u32(map.extId[map.outTo[k]!]!);
      w.u32(0xffffffff);
    }
  }
  for (let m = 0; m < im.count; m++) {
    w.str(im.text[m] ?? '');
    w.u8(im.type[m]!);
    w.u8(im.cls[m]!);
    w.i32(im.angle[m]!);
    w.i32(im.x1[m]!);
    w.i32(im.y1[m]!);
    w.i32(im.z1[m]!);
    w.i32(im.x2[m]!);
    w.i32(im.y2[m]!);
    w.i32(im.z2[m]!);
  }
  return w.bytes();
}

/** Wraps a payload as a `.mm2` file: magic, version, length, zlib stream. */
export async function wrapMm2(payload: Uint8Array, deflate: Deflate = deflateZlib): Promise<Uint8Array> {
  const z = await deflate(payload);
  const out = new Uint8Array(12 + z.byteLength);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, MM2_MAGIC);
  dv.setUint32(4, MM2_VERSION);
  dv.setUint32(8, payload.byteLength);
  out.set(z, 12);
  return out;
}

/** `map` as a complete `.mm2` v42 file. */
export function writeMm2(map: MapData, deflate: Deflate = deflateZlib): Promise<Uint8Array> {
  return wrapMm2(encodeMm2Payload(map), deflate);
}
