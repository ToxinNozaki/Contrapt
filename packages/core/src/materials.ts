// Material library: typical properties for mass and (later) hand-calculation and analysis tools.
// Values are TYPICAL and mirror the "Materials" knowledge pack (a test ties the two together). Real parts vary with
// grade, temper, heat treatment, print settings and moisture: always use the supplier's datasheet for anything critical.

export interface Material {
  /** The name used in the `material` step. */
  name: string;
  /** What it is, in plain words. */
  label: string;
  /** g/cm^3 */
  density: number;
  /** Young's modulus, GPa (undefined where it is not meaningful, e.g. rubbery TPU). */
  youngsModulusGPa?: number;
  /** Yield strength (or tensile strength for plastics that do not yield cleanly), MPa. */
  yieldMPa?: number;
  /** Thermal conductivity, W/(m K) (typical; undefined where it is not a single sensible number). */
  conductivityWmK?: number;
  /** Linear thermal expansion coefficient, 1/K (typical). Undefined for wood and rubbery TPU. */
  expansionPerK?: number;
  /** Row label as written in knowledge/materials.md (used by the consistency test). */
  packRow: string;
}

export const MATERIALS: Record<string, Material> = {
  '6061-T6': {
    name: '6061-T6',
    label: 'Aluminium 6061-T6',
    density: 2.7,
    youngsModulusGPa: 69,
    yieldMPa: 275,
    conductivityWmK: 167,
    expansionPerK: 23.6e-6,
    packRow: 'Aluminium 6061-T6',
  },
  '7075-T6': {
    name: '7075-T6',
    label: 'Aluminium 7075-T6',
    density: 2.81,
    youngsModulusGPa: 72,
    yieldMPa: 500,
    conductivityWmK: 130,
    expansionPerK: 23.4e-6,
    packRow: 'Aluminium 7075-T6',
  },
  'mild-steel': {
    name: 'mild-steel',
    label: 'Mild steel (A36 / 1018)',
    density: 7.85,
    youngsModulusGPa: 200,
    yieldMPa: 250,
    conductivityWmK: 50,
    expansionPerK: 12e-6,
    packRow: 'Mild steel (A36 / 1018)',
  },
  'stainless-304': {
    name: 'stainless-304',
    label: 'Stainless steel 304',
    density: 8.0,
    youngsModulusGPa: 193,
    yieldMPa: 215,
    conductivityWmK: 16,
    expansionPerK: 17.3e-6,
    packRow: 'Stainless 304',
  },
  'alloy-steel-4140': {
    name: 'alloy-steel-4140',
    label: 'Alloy steel 4140 (annealed)',
    density: 7.85,
    youngsModulusGPa: 205,
    yieldMPa: 415,
    conductivityWmK: 42,
    expansionPerK: 12.3e-6,
    packRow: 'Alloy steel 4140',
  },
  brass: {
    name: 'brass',
    label: 'Brass (C360)',
    density: 8.5,
    youngsModulusGPa: 97,
    yieldMPa: 310,
    conductivityWmK: 115,
    expansionPerK: 20.5e-6,
    packRow: 'Brass (C360)',
  },
  copper: {
    name: 'copper',
    label: 'Copper (annealed)',
    density: 8.96,
    youngsModulusGPa: 117,
    yieldMPa: 70,
    conductivityWmK: 390,
    expansionPerK: 17e-6,
    packRow: 'Copper',
  },
  'titanium-6al4v': {
    name: 'titanium-6al4v',
    label: 'Titanium Ti-6Al-4V',
    density: 4.43,
    youngsModulusGPa: 114,
    yieldMPa: 880,
    conductivityWmK: 6.7,
    expansionPerK: 8.6e-6,
    packRow: 'Titanium Ti-6Al-4V',
  },
  PLA: {
    name: 'PLA',
    label: 'PLA (printed)',
    density: 1.24,
    youngsModulusGPa: 3.5,
    yieldMPa: 45,
    conductivityWmK: 0.13,
    expansionPerK: 68e-6,
    packRow: 'PLA (printed)',
  },
  PETG: {
    name: 'PETG',
    label: 'PETG (printed)',
    density: 1.27,
    youngsModulusGPa: 2.1,
    yieldMPa: 45,
    conductivityWmK: 0.2,
    expansionPerK: 60e-6,
    packRow: 'PETG (printed)',
  },
  ABS: {
    name: 'ABS',
    label: 'ABS / ASA (printed)',
    density: 1.05,
    youngsModulusGPa: 2.2,
    yieldMPa: 38,
    conductivityWmK: 0.17,
    expansionPerK: 90e-6,
    packRow: 'ABS / ASA (printed)',
  },
  nylon: {
    name: 'nylon',
    label: 'Nylon PA12/PA6',
    density: 1.1,
    youngsModulusGPa: 2.0,
    yieldMPa: 55,
    conductivityWmK: 0.25,
    expansionPerK: 80e-6,
    packRow: 'Nylon PA12/PA6',
  },
  polycarbonate: {
    name: 'polycarbonate',
    label: 'Polycarbonate',
    density: 1.2,
    youngsModulusGPa: 2.3,
    yieldMPa: 60,
    conductivityWmK: 0.2,
    expansionPerK: 65e-6,
    packRow: 'Polycarbonate',
  },
  TPU: { name: 'TPU', label: 'TPU (flexible)', density: 1.2, packRow: 'TPU' },
  acrylic: {
    name: 'acrylic',
    label: 'Acrylic (PMMA)',
    density: 1.18,
    youngsModulusGPa: 3.2,
    yieldMPa: 70,
    conductivityWmK: 0.19,
    expansionPerK: 70e-6,
    packRow: 'Acrylic (PMMA)',
  },
  acetal: {
    name: 'acetal',
    label: 'Acetal / Delrin (POM)',
    density: 1.41,
    youngsModulusGPa: 3.1,
    yieldMPa: 65,
    conductivityWmK: 0.31,
    expansionPerK: 110e-6,
    packRow: 'Acetal / Delrin (POM)',
  },
  'birch-plywood': {
    name: 'birch-plywood',
    label: 'Birch plywood',
    density: 0.65,
    youngsModulusGPa: 10,
    conductivityWmK: 0.13,
    packRow: 'Birch plywood',
  },
  hardwood: {
    name: 'hardwood',
    label: 'Hardwood (oak / maple)',
    density: 0.7,
    youngsModulusGPa: 12,
    conductivityWmK: 0.17,
    packRow: 'Hardwood (oak/maple)',
  },
};

export const MATERIAL_NAMES = Object.keys(MATERIALS) as [string, ...string[]];

export function getMaterial(name: string): Material {
  const m = MATERIALS[name];
  if (!m) throw new Error(`Unknown material "${name}". Available: ${MATERIAL_NAMES.join(', ')}`);
  return m;
}

/** Mass in grams from a volume in mm^3: mm^3 x (g/cm^3) / 1000. */
export function massGrams(volumeMm3: number, density: number): number {
  return Math.round(((volumeMm3 * density) / 1000) * 1e4) / 1e4;
}
