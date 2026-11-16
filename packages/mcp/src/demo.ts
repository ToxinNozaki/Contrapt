// Demo: start the viewer with a sample bracket so you can see Contrapt without an AI attached.
//   npm run demo -w @contrapt/mcp      then open the printed URL.
import { compileScript, initKernel } from '@contrapt/core';
import { Session } from './session.ts';
import { startViewer } from './viewer.ts';

const DEMO = `
  param('w', 60);
  param('t', 6);
  const outline = sketch({ id: 'outline', plane: 'XY', profile: [
    { shape: 'rect', w: 'w', h: 40, cornerRadius: 4 },
    { shape: 'circle', r: 2.5, cx: -22, cy: -13, cut: true },
    { shape: 'circle', r: 2.5, cx: 22, cy: -13, cut: true },
    { shape: 'circle', r: 2.5, cx: -22, cy: 13, cut: true },
    { shape: 'circle', r: 2.5, cx: 22, cy: 13, cut: true },
  ]});
  extrude({ id: 'plate', sketch: outline, distance: 't' });
  cylinder({ id: 'boss', r: 9, h: 14, at: [0, 0, 't + 7'] });
  boolean({ id: 'solid', kind: 'union', a: 'plate', b: 'boss' });
  cylinder({ id: 'bore', r: 4, h: 40, at: [0, 0, 10] });
  boolean({ id: 'bracket', kind: 'cut', a: 'solid', b: 'bore' });
`;

await initKernel();
const session = new Session('demo-bracket');
await session.replaceTimeline(compileScript(DEMO, { name: 'demo-bracket' }));
const port = process.env.PORT ? Number(process.env.PORT) : undefined;
const viewer = await startViewer(session, { port });
process.stderr.write(`[contrapt demo] viewer: ${viewer.url}\n`);
