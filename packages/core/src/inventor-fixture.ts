// Test/demo helper: builds a small, synthetic Inventor-like OLE container (property sets with a preview
// image and design-tracking fields, plus a few RSe segment streams). It contains NO real CAD data, so
// it is safe to commit and lets tests exercise the reader without anyone's private files.
import * as CFB from 'cfb';

/** A valid 1x1 PNG (red pixel). */
export const TINY_PNG = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
    'base64',
  ),
);

type Val = { s: string } | { w: string } | { i: number } | { cf: Uint8Array };

function pad4(n: number) {
  return (4 - (n % 4)) % 4;
}

function valueBytes(v: Val): Buffer {
  if ('s' in v) {
    const str = Buffer.from(`${v.s}\0`, 'latin1');
    const b = Buffer.alloc(8 + str.length + pad4(str.length));
    b.writeUInt32LE(30, 0);
    b.writeUInt32LE(str.length, 4);
    str.copy(b, 8);
    return b;
  }
  if ('w' in v) {
    const str = Buffer.from(`${v.w}\0`, 'utf16le');
    const b = Buffer.alloc(8 + str.length + pad4(str.length));
    b.writeUInt32LE(31, 0);
    b.writeUInt32LE(str.length / 2, 4);
    str.copy(b, 8);
    return b;
  }
  if ('i' in v) {
    const b = Buffer.alloc(8);
    b.writeUInt32LE(3, 0);
    b.writeInt32LE(v.i, 4);
    return b;
  }
  // VT_CF: type, size, format tag (-1 = Windows clipboard format), clipboard id (3), then data
  const data = Buffer.concat([Buffer.from([3, 0, 0, 0]), Buffer.from(v.cf)]);
  const b = Buffer.alloc(8 + 4 + data.length + pad4(data.length));
  b.writeUInt32LE(71, 0);
  b.writeUInt32LE(data.length + 4, 4);
  b.writeInt32LE(-1, 8);
  data.copy(b, 12);
  return b;
}

/** Serialise one property-set stream (one section). */
export function propertySet(fmtid: number[], name: string, props: Record<number, Val>): Buffer {
  const entries: [number, Val][] = [
    [255, { s: name }],
    ...Object.entries(props).map(([k, v]) => [Number(k), v] as [number, Val]),
  ];
  const vals = entries.map(([, v]) => valueBytes(v));
  const tableLen = 8 + entries.length * 8;
  const offsets: number[] = [];
  let at = tableLen;
  for (const v of vals) {
    offsets.push(at);
    at += v.length;
  }
  const section = Buffer.alloc(at);
  section.writeUInt32LE(at, 0);
  section.writeUInt32LE(entries.length, 4);
  entries.forEach(([id], i) => {
    section.writeUInt32LE(id, 8 + i * 8);
    section.writeUInt32LE(offsets[i] as number, 12 + i * 8);
  });
  vals.forEach((v, i) => {
    v.copy(section, offsets[i] as number);
  });

  const header = Buffer.alloc(48);
  header.writeUInt16LE(0xfffe, 0);
  header.writeUInt32LE(1, 24); // one section
  Buffer.from(fmtid).copy(header, 28);
  header.writeUInt32LE(48, 44);
  return Buffer.concat([header, section]);
}

const SUMMARY_FMTID = [
  0x39, 0xde, 0x38, 0x3d, 0x88, 0x05, 0x4c, 0x14, 0xbb, 0x37, 0x18, 0xf4, 0xd5, 0xdd, 0x31, 0xc7,
];
const TRACKING_FMTID = [
  0x0f, 0x3f, 0x85, 0x32, 0x44, 0x34, 0xd1, 0x11, 0x9e, 0x93, 0x00, 0x60, 0xb0, 0x3c, 0x1c, 0xa6,
];

export interface FixtureOptions {
  preview?: Uint8Array | false;
  partNumber?: string;
  material?: string;
  author?: string;
  application?: string;
}

/** A synthetic container that looks like an Inventor part to the reader. */
export function makeInventorLikeFixture(opts: FixtureOptions = {}): Uint8Array {
  const cf = CFB.utils.cfb_new();
  const add = (path: string, content: Uint8Array | Buffer) => CFB.utils.cfb_add(cf, path, content);

  const summary: Record<number, Val> = { 4: { s: opts.author ?? 'test-author' } };
  if (opts.preview !== false) summary[17] = { cf: opts.preview ?? TINY_PNG };
  add('/\u0005SummaryStream', propertySet(SUMMARY_FMTID, 'Inventor Summary Information', summary));
  add(
    '/\u0005TrackingStream',
    propertySet(TRACKING_FMTID, 'Design Tracking Properties', {
      5: { s: opts.partNumber ?? 'PN-001' },
      20: { s: opts.material ?? 'Generic' },
      67: { s: opts.application ?? '2026.4 (Build 304435000, 435)' },
    }),
  );
  for (const name of ['Baaa', 'Bbbb', 'Bccc']) add(`/RSeStorage/${name}`, Buffer.from('segment'));
  add('/RSeStorage/RSeSegInfo', Buffer.from('info'));
  return new Uint8Array(CFB.write(cf, { type: 'buffer' }) as Buffer);
}
