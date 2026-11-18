export { ModelBuilder, STEP_OPS } from './builder.ts';
export type { BuildOptions, FileProvider } from './engine.ts';
export {
  type BuildReport,
  buildModel,
  type Model,
  resolveParams,
  type StepReport,
} from './engine.ts';
export { exportStep, exportStl, meshBodies, type ViewerMesh } from './export.ts';
export { evalExpr, exprNames, type Num } from './expr.ts';
export {
  DIRECTIONS,
  holeTool,
  SCREW_SIZES,
  SCREWS,
  type ScrewSize,
  screwDiameter,
} from './holes.ts';
export {
  describeStep,
  detectFormat,
  type FormatInfo,
  type FormatKind,
  type FormatSupport,
  isSafeFileName,
  type StepSummary,
  sniffContent,
} from './import.ts';
export {
  checkInterference,
  type InterferenceResult,
  type InterferenceStatus,
} from './interference.ts';
export {
  extractImage,
  type InventorInfo,
  type InventorPreview,
  type InventorSection,
  readInventorFile,
} from './inventor.ts';
export { makeInventorLikeFixture, propertySet, TINY_PNG } from './inventor-fixture.ts';
export { initKernel, kernelDiagnostics } from './kernel.ts';
export { getMaterial, MATERIAL_NAMES, MATERIALS, type Material, massGrams } from './materials.ts';
export { type BodyInfo, describeBody } from './measure.ts';
export { mirrorPlane, patternCopies, patternPositions } from './pattern.ts';
export {
  encodePng,
  NAMED_VIEWS,
  type RenderOptions,
  type RenderResult,
  renderMeshes,
  type ViewName,
} from './render.ts';
export { compileScript, type ScriptOptions } from './script.ts';
export { as3D } from './shapes.ts';
export {
  type EdgeSelector,
  emptyTimeline,
  type FaceSelector,
  formatZodError,
  type ProfileItem,
  type Step,
  StepInput,
  type StepOp,
  TIMELINE_VERSION,
  type Timeline,
  TimelineSchema,
} from './timeline.ts';
