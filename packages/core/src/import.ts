// Importing other CAD systems' files.
//
// What Contrapt can read:
//   - STEP (.step/.stp): exact solids; this is the universal route from nearly every CAD system.
// What it can only recognise and explain (so an AI gives an accurate, helpful answer instead of guessing):
//   - Autodesk Inventor .ipt/.iam/.idw/.ipn and other proprietary formats (SolidWorks, Fusion, CATIA, NX, Creo, ...).
//     Those formats are closed; the supported route today is "export STEP from the original program".
//     Direct readers/bridges are on the roadmap (see docs/FEATURES.md, P7).
//   - IGES, STL, OBJ, 3MF, DXF, glTF: planned importers (recognised, not yet readable).

export type FormatKind =
  | 'solid'
  | 'assembly'
  | 'drawing'
  | 'mesh'
  | 'surface'
  | 'presentation'
  | 'unknown';
/** supported: Contrapt can read it now. planned: a native importer is on the roadmap. via-step: export STEP from the source program. */
export type FormatSupport = 'supported' | 'planned' | 'via-step' | 'unknown';

export interface FormatInfo {
  /** Lower-case id (the extension without a dot, normalised: stp -> step, igs -> iges). */
  format: string;
  name: string;
  kind: FormatKind;
  support: FormatSupport;
  /** Plain-language instructions for getting this into Contrapt. */
  howTo: string;
}

interface KnownFormat extends Omit<FormatInfo, 'format'> {
  ext: string[];
}

const STEP_HOWTO = 'Export STEP (AP214 or AP242 preferred, AP203 also works).';
const via = (name: string, kind: FormatKind, how: string, ext: string[]): KnownFormat => ({
  ext,
  name,
  kind,
  support: 'via-step',
  howTo: how,
});

const KNOWN: KnownFormat[] = [
  {
    ext: ['step', 'stp'],
    name: 'STEP (ISO 10303)',
    kind: 'solid',
    support: 'supported',
    howTo: 'Readable now: use import_file.',
  },
  {
    ext: ['iges', 'igs'],
    name: 'IGES',
    kind: 'surface',
    support: 'planned',
    howTo: `IGES import is planned. Prefer STEP: ${STEP_HOWTO}`,
  },
  {
    ext: ['stl'],
    name: 'STL mesh',
    kind: 'mesh',
    support: 'planned',
    howTo:
      'Mesh import (approximate geometry, no exact faces) is planned. For solid editing, export STEP from the source CAD instead.',
  },
  {
    ext: ['obj'],
    name: 'Wavefront OBJ mesh',
    kind: 'mesh',
    support: 'planned',
    howTo: 'Mesh import is planned.',
  },
  {
    ext: ['3mf'],
    name: '3MF mesh',
    kind: 'mesh',
    support: 'planned',
    howTo: 'Mesh import is planned.',
  },
  {
    ext: ['glb', 'gltf'],
    name: 'glTF mesh/scene',
    kind: 'mesh',
    support: 'planned',
    howTo: 'Scene import is planned.',
  },
  {
    ext: ['dxf'],
    name: 'DXF 2D/3D drawing exchange',
    kind: 'drawing',
    support: 'planned',
    howTo: '2D DXF import (as sketch/reference geometry) is planned.',
  },
  {
    ext: ['dwg'],
    name: 'AutoCAD DWG',
    kind: 'drawing',
    support: 'planned',
    howTo:
      'DWG is proprietary. In the source program, save/export as DXF (or STEP for 3D). Direct DWG reading is a possible future addition.',
  },
  via(
    'Autodesk Inventor part (.ipt)',
    'solid',
    `Inventor part files are a closed format Contrapt cannot read directly yet. In Inventor: File > Export > CAD Format > STEP, then put the .step in the imports folder. (Without Inventor installed: Autodesk's free Inventor View, or Autodesk's cloud converter, can produce STEP/OBJ/STL.)`,
    ['ipt'],
  ),
  via(
    'Autodesk Inventor assembly (.iam)',
    'assembly',
    `Closed format. In Inventor: File > Export > CAD Format > STEP exports the whole assembly (the structure is kept as separate solids in one body here). Export individual parts too if you need to edit them. The .iam only references its .ipt files, so any export must be done with all referenced parts present.`,
    ['iam'],
  ),
  via(
    'Autodesk Inventor drawing (.idw)',
    'drawing',
    `An .idw is a 2D drawing: it has views, dimensions and notes but no 3D geometry of its own. Open it in Inventor and export PDF or DXF/DWG for the 2D content; the 3D model lives in the referenced .ipt/.iam, which you export as STEP. Contrapt will treat imported drawings as reference only.`,
    ['idw'],
  ),
  via(
    'Autodesk Inventor presentation (.ipn)',
    'presentation',
    'A presentation file stores exploded views/animations of an assembly, not new geometry. Export the assembly (.iam) as STEP instead.',
    ['ipn'],
  ),
  via('SolidWorks part (.sldprt)', 'solid', 'In SolidWorks: File > Save As > STEP AP214.', [
    'sldprt',
  ]),
  via(
    'SolidWorks assembly (.sldasm)',
    'assembly',
    'In SolidWorks: File > Save As > STEP AP214 (assembly).',
    ['sldasm'],
  ),
  via(
    'SolidWorks drawing (.slddrw)',
    'drawing',
    'A 2D drawing. Export PDF or DXF/DWG from SolidWorks; export the 3D parts as STEP.',
    ['slddrw'],
  ),
  via('Autodesk Fusion design (.f3d/.f3z)', 'solid', 'In Fusion: File > Export > STEP.', [
    'f3d',
    'f3z',
  ]),
  via('CATIA part/product', 'solid', 'In CATIA: File > Save As > STEP.', ['catpart', 'catproduct']),
  via(
    'Siemens NX / PTC Creo part (.prt)',
    'solid',
    'Export STEP from NX (File > Export > STEP) or Creo (File > Save a Copy > STEP).',
    ['prt', 'asm'],
  ),
  via(
    'Parasolid (.x_t/.x_b)',
    'solid',
    'Re-export as STEP from the program that wrote it (Parasolid is a kernel format).',
    ['x_t', 'x_b'],
  ),
  via('ACIS (.sat/.sab)', 'solid', 'Re-export as STEP from the program that wrote it.', [
    'sat',
    'sab',
  ]),
  via(
    'Rhino (.3dm)',
    'surface',
    'In Rhino: File > Export Selected > STEP. Note that Rhino surfaces are not always closed solids.',
    ['3dm'],
  ),
  via('FreeCAD (.fcstd)', 'solid', 'In FreeCAD: select the body, File > Export > STEP.', ['fcstd']),
  via(
    'SketchUp (.skp)',
    'mesh',
    'SketchUp models are meshes. Export OBJ or STL (mesh import is planned); exact solids are not available.',
    ['skp'],
  ),
  via(
    'Blender (.blend)',
    'mesh',
    'Blender models are meshes. Export OBJ, STL or glTF (mesh import is planned).',
    ['blend'],
  ),
];

const BY_EXT = new Map<string, KnownFormat>();
for (const k of KNOWN) for (const e of k.ext) BY_EXT.set(e, k);

const extOf = (name: string): string => {
  const m = /\.([A-Za-z0-9_]+)$/.exec(name);
  return m ? (m[1] as string).toLowerCase() : '';
};

const canon = (ext: string): string => ({ stp: 'step', igs: 'iges', gltf: 'glb' })[ext] ?? ext;

const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

/** What the bytes themselves look like, independent of the file name. */
export function sniffContent(bytes: Uint8Array): string | undefined {
  const head = new TextDecoder('utf-8', { fatal: false })
    .decode(bytes.subarray(0, 400))
    .replace(/^﻿/, '');
  const trimmed = head.trimStart();
  if (trimmed.startsWith('ISO-10303-21')) return 'step';
  if (OLE_MAGIC.every((b, i) => bytes[i] === b)) return 'ole';
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05))
    return 'zip';
  if (head.startsWith('glTF')) return 'glb';
  if (/^AC10\d\d/.test(head)) return 'dwg';
  if (/^\s*0\r?\n\s*SECTION/.test(head)) return 'dxf';
  const firstLine = head.split(/\r?\n/)[0] ?? '';
  if (firstLine.length >= 73 && firstLine[72] === 'S') return 'iges';
  if (/^solid[\s\S]*facet/i.test(head)) return 'stl';
  if (bytes.length > 84) {
    const n = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(80, true);
    if (84 + 50 * n === bytes.length) return 'stl';
  }
  return undefined;
}

/** Identify a file by name and content, and explain how (or whether) it can be brought into Contrapt. */
export function detectFormat(fileName: string, bytes: Uint8Array): FormatInfo {
  const ext = extOf(fileName);
  const known = BY_EXT.get(ext);
  const sniffed = sniffContent(bytes);
  const format = canon(ext) || sniffed || 'unknown';

  if (!known) {
    // Unknown extension: fall back to what the content looks like.
    if (sniffed === 'step') {
      const k = BY_EXT.get('step') as KnownFormat;
      return { format: 'step', name: k.name, kind: k.kind, support: k.support, howTo: k.howTo };
    }
    const hint = sniffed ? ` The content looks like ${sniffed.toUpperCase()}.` : '';
    return {
      format,
      name: ext ? `.${ext} file` : 'Unknown file',
      kind: 'unknown',
      support: 'unknown',
      howTo: `Contrapt does not recognise this file type.${hint} Export STEP from the program that made it.`,
    };
  }

  let howTo = known.howTo;
  // A .step file that is really something else (renamed, corrupt, or a different export) should say so.
  if (known.support === 'supported' && sniffed !== 'step') {
    howTo = `This is named ${known.name} but its contents do not look like a STEP file${sniffed ? ` (they look like ${sniffed.toUpperCase()})` : ''}. Re-export it as STEP.`;
    return { format: canon(ext), name: known.name, kind: known.kind, support: 'unknown', howTo };
  }
  return { format: canon(ext), name: known.name, kind: known.kind, support: known.support, howTo };
}

export interface StepSummary {
  schema?: string;
  fileName?: string;
  originatingSystem?: string;
  solids: number;
  products: number;
}

/** Cheap text summary of a STEP file (no geometry processing). */
export function describeStep(bytes: Uint8Array): StepSummary {
  const text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  const schema = /FILE_SCHEMA\s*\(\s*\(\s*'([^']*)'/.exec(text)?.[1];
  const fileName = /FILE_NAME\s*\(\s*'([^']*)'/.exec(text)?.[1];
  const header = /FILE_NAME\s*\([\s\S]*?\)\s*;/.exec(text)?.[0] ?? '';
  const quoted = [...header.matchAll(/'([^']*)'/g)].map((m) => m[1] as string);
  const originatingSystem = quoted.length >= 6 ? quoted[quoted.length - 2] : undefined;
  const solids = (text.match(/\bMANIFOLD_SOLID_BREP\s*\(/g) ?? []).length;
  const products = (text.match(/#\d+\s*=\s*PRODUCT\s*\(/g) ?? []).length;
  return { schema, fileName, originatingSystem: originatingSystem || undefined, solids, products };
}

/** Validate an import file name: plain names only (no folders), so the AI can never reach other paths. */
export const SAFE_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9 _.()+-]{0,120}$/;
export function isSafeFileName(name: string): boolean {
  return SAFE_FILE_NAME.test(name) && !name.includes('..');
}
