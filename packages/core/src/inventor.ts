// Native, read-only inspection of Autodesk Inventor documents (.ipt, .iam, .idw, .ipn).
//
// Inventor files are OLE/CFB containers. Their *geometry* is stored in a proprietary, undocumented
// database, which this module does NOT decode (see docs/FEATURES.md, P7, for the planned converters).
// What it reads reliably, without Inventor installed:
//   - container facts (CFB version, stream count, number of RSe data segments),
//   - the document's property sets (summary info, design-tracking properties such as part number and
//     material, the Inventor version that saved it),
//   - the embedded preview image (a PNG/JPEG thumbnail), which lets an AI *see* what the file contains.
//
// The input is untrusted: every read is bounds-checked, sizes are capped, and failures degrade to notes.
import * as CFB from 'cfb';

export type PropValue = string | number | boolean;

export interface InventorSection {
  /** Human label stored in the section (for example "Design Tracking Properties"), when present. */
  name?: string;
  fmtid: string;
  properties: { id: number; value: PropValue }[];
}

export interface InventorPreview {
  format: 'png' | 'jpeg';
  width?: number;
  height?: number;
  bytes: Uint8Array;
}

export interface InventorInfo {
  /** CFB major version (3 = 512-byte sectors, 4 = 4096-byte sectors). */
  cfbVersion?: number;
  streams: number;
  /** Count of RSe "B" data segments (where Inventor keeps geometry and feature data). */
  rseSegments: number;
  sections: InventorSection[];
  /** Best-effort friendly fields drawn from the property sets above. */
  summary: {
    application?: string;
    author?: string;
    title?: string;
    subject?: string;
    comments?: string;
    partNumber?: string;
    material?: string;
  };
  preview?: InventorPreview;
  /** Plain-language caveats and reasons something is missing. */
  notes: string[];
}

const MAX_PROPS = 5000;
const MAX_STRING = 400;

const hex = (b: Uint8Array, from: number, to: number) =>
  Array.from(b.subarray(from, to), (x) => x.toString(16).padStart(2, '0')).join('');

function guid(b: Buffer, o: number): string {
  const le = (n: number, l: number) =>
    b
      .readUIntLE(o + n, l)
      .toString(16)
      .padStart(l * 2, '0');
  return `${le(0, 4)}-${le(4, 2)}-${le(6, 2)}-${hex(b, o + 8, o + 10)}-${hex(b, o + 10, o + 16)}`;
}

function clip(s: string): string {
  return s.length > MAX_STRING ? `${s.slice(0, MAX_STRING)}…` : s;
}

type Raw = PropValue | { binary: Uint8Array } | undefined;

function readValue(b: Buffer, off: number): Raw {
  const type = b.readUInt16LE(off) & 0x0fff;
  const p = off + 4;
  switch (type) {
    case 2:
      return b.readInt16LE(p);
    case 3:
    case 19:
      return b.readInt32LE(p);
    case 5:
      return b.readDoubleLE(p);
    case 11:
      return b.readInt16LE(p) !== 0;
    case 30: {
      const n = b.readUInt32LE(p);
      if (n > b.length) return undefined;
      return clip(
        b
          .subarray(p + 4, p + 4 + n)
          .toString('latin1')
          .replace(/\0+$/, ''),
      );
    }
    case 31: {
      const n = b.readUInt32LE(p);
      if (n * 2 > b.length) return undefined;
      return clip(
        b
          .subarray(p + 4, p + 4 + n * 2)
          .toString('utf16le')
          .replace(/\0+$/, ''),
      );
    }
    case 64: {
      const lo = BigInt(b.readUInt32LE(p));
      const hi = BigInt(b.readUInt32LE(p + 4));
      const ms = Number(((hi << 32n) | lo) / 10000n) - 11644473600000;
      return Number.isFinite(ms) && ms > 0 && ms < 4102444800000
        ? new Date(ms).toISOString()
        : undefined;
    }
    case 65: // VT_BLOB
    case 71: {
      // VT_CF: size, format tag, then data
      const n = b.readUInt32LE(p);
      if (n > b.length) return undefined;
      return { binary: b.subarray(p + 4, p + 4 + n) };
    }
    default:
      return undefined;
  }
}

/** Find an embedded PNG or JPEG inside a thumbnail blob and cut it out exactly. */
export function extractImage(blob: Uint8Array): InventorPreview | undefined {
  const b = Buffer.from(blob.buffer, blob.byteOffset, blob.byteLength);
  const png = b.indexOf(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (png >= 0) {
    // walk the PNG chunks to the end so trailing bytes are not included
    let o = png + 8;
    while (o + 12 <= b.length) {
      const len = b.readUInt32BE(o);
      const type = b.toString('latin1', o + 4, o + 8);
      o += 12 + len;
      if (type === 'IEND') {
        if (o > b.length) return undefined;
        const bytes = b.subarray(png, o);
        const width = bytes.length >= 24 ? bytes.readUInt32BE(16) : undefined;
        const height = bytes.length >= 24 ? bytes.readUInt32BE(20) : undefined;
        return { format: 'png', width, height, bytes: new Uint8Array(bytes) };
      }
      if (len > b.length) return undefined;
    }
    return undefined;
  }
  const jpg = b.indexOf(Buffer.from([0xff, 0xd8, 0xff]));
  if (jpg >= 0) {
    const end = b.lastIndexOf(Buffer.from([0xff, 0xd9]));
    if (end > jpg) return { format: 'jpeg', bytes: new Uint8Array(b.subarray(jpg, end + 2)) };
  }
  return undefined;
}

function parsePropertySet(raw: Buffer, preview: { value?: InventorPreview }): InventorSection[] {
  if (raw.length < 48 || raw.readUInt16LE(0) !== 0xfffe) return [];
  const sections: InventorSection[] = [];
  const nsec = Math.min(raw.readUInt32LE(24), 8);
  for (let s = 0; s < nsec; s++) {
    try {
      const fmtid = guid(raw, 28 + s * 20);
      const secOff = raw.readUInt32LE(28 + s * 20 + 16);
      const count = Math.min(raw.readUInt32LE(secOff + 4), MAX_PROPS);
      const section: InventorSection = { fmtid, properties: [] };
      for (let k = 0; k < count; k++) {
        const id = raw.readUInt32LE(secOff + 8 + k * 8);
        let v: Raw;
        try {
          v = readValue(raw, secOff + raw.readUInt32LE(secOff + 12 + k * 8));
        } catch {
          continue; // a bad value never sinks the whole file
        }
        if (v === undefined) continue;
        if (typeof v === 'object') {
          if (!preview.value) preview.value = extractImage(v.binary);
          continue;
        }
        if (id === 255 && typeof v === 'string') section.name = v;
        else section.properties.push({ id, value: v });
      }
      sections.push(section);
    } catch {
      /* skip a damaged section */
    }
  }
  return sections;
}

/**
 * Inspect an Inventor document. Never throws for a damaged or unexpected file: the `notes` field says
 * what could not be read.
 */
export function readInventorFile(bytes: Uint8Array): InventorInfo {
  const info: InventorInfo = { streams: 0, rseSegments: 0, sections: [], summary: {}, notes: [] };
  if (bytes.length >= 28) info.cfbVersion = (bytes[26] ?? 0) | ((bytes[27] ?? 0) << 8);

  let cf: CFB.CFB$Container;
  try {
    cf = CFB.read(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength), {
      type: 'buffer',
    });
  } catch (e) {
    info.notes.push(`Could not open the file as an OLE container (${(e as Error).message}).`);
    return info;
  }

  const holder: { value?: InventorPreview } = {};
  cf.FileIndex.forEach((entry, i) => {
    if (entry.type !== 2) return;
    info.streams++;
    const path = cf.FullPaths[i] ?? '';
    if (/\/RSeStorage\/B[A-Za-z0-9]+$/.test(path)) info.rseSegments++;
    if (!path.includes('\u0005')) return;
    const content = entry.content;
    if (!content) return;
    info.sections.push(...parsePropertySet(Buffer.from(content as Uint8Array), holder));
  });
  info.preview = holder.value;

  const named = (name: string) => info.sections.find((s) => s.name === name);
  const prop = (sec: InventorSection | undefined, id: number) =>
    sec?.properties.find((p) => p.id === id)?.value;
  const str = (v: PropValue | undefined) => (typeof v === 'string' && v ? v : undefined);

  const summary = named('Inventor Summary Information');
  info.summary.title = str(prop(summary, 2));
  info.summary.subject = str(prop(summary, 3));
  info.summary.author = str(prop(summary, 4));
  info.summary.comments = str(prop(summary, 6));
  const tracking = named('Design Tracking Properties');
  info.summary.partNumber = str(prop(tracking, 5));
  info.summary.material = str(prop(tracking, 20));
  for (const sec of info.sections) {
    const v = sec.properties
      .map((p) => p.value)
      .find((x) => typeof x === 'string' && /^\d{4}(\.\d+)?\s*\(Build/.test(x));
    if (typeof v === 'string') {
      info.summary.application = v;
      break;
    }
  }

  if (info.rseSegments === 0)
    info.notes.push('No RSe data segments found: this may not be an Inventor document.');
  if (!info.preview) info.notes.push('No preview image is stored in this file.');
  info.notes.push(
    'Geometry is not read natively yet. To get editable solids, export STEP from Inventor, or use a converter (see the importing-cad-files knowledge pack).',
  );
  return info;
}
