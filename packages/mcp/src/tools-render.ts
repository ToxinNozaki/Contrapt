// render_view: lets the AI SEE the current model. Returns PNG images (and saves them under renders/).
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NAMED_VIEWS, renderMeshes, type ViewName } from '@contrapt/core';
import { z } from 'zod';
import { j, type ToolDef } from './tools.ts';

const VIEW_NAMES = Object.keys(NAMED_VIEWS) as [ViewName, ...ViewName[]];

export const renderTools: ToolDef[] = [
  {
    name: 'render_view',
    description:
      'Render the current model to an image so you can SEE it: shaded solids with feature edges and an axis triad (X red, Y green, Z blue). Use it after building to check shape and proportions, and to compare with a reference picture. Views: iso (default), front, back, left, right, top, bottom; or give azimuth/elevation in degrees. Ask for several views at once to check hidden sides.',
    input: {
      views: z
        .array(z.enum(VIEW_NAMES))
        .min(1)
        .max(6)
        .optional()
        .describe('named views, default ["iso"]'),
      azimuth: z
        .number()
        .min(-360)
        .max(360)
        .optional()
        .describe('custom camera: 0 = from front (-Y), 90 = from right (+X)'),
      elevation: z
        .number()
        .min(-90)
        .max(90)
        .optional()
        .describe('custom camera: degrees above the XY plane'),
      size: z
        .number()
        .int()
        .min(128)
        .max(1280)
        .optional()
        .describe('image width/height in pixels, default 640'),
      edges: z.boolean().optional().describe('draw feature edges, default true'),
      dark: z.boolean().optional().describe('dark background'),
    },
    readOnly: true,
    run: async (a, ctx) => {
      const meshes = ctx.session.meshes;
      if (!meshes.length) throw new Error('Nothing to render yet: the model has no bodies.');
      const size = (a.size as number | undefined) ?? 640;
      const custom = a.azimuth !== undefined || a.elevation !== undefined;
      const names: (ViewName | 'custom')[] = custom
        ? ['custom']
        : ((a.views as ViewName[] | undefined) ?? ['iso']);
      const dir = join(ctx.outDir, 'renders');
      await mkdir(dir, { recursive: true });

      const images: { mimeType: string; data: string }[] = [];
      const info: { view: string; file: string; camera: string }[] = [];
      for (const name of names) {
        const r = renderMeshes(meshes, {
          width: size,
          view: name === 'custom' ? undefined : name,
          azimuth: a.azimuth as number | undefined,
          elevation: a.elevation as number | undefined,
          edges: (a.edges as boolean | undefined) ?? true,
          background: a.dark ? 'dark' : 'light',
        });
        const file = `${ctx.session.snapshot().name.replace(/[^A-Za-z0-9_-]/g, '_')}-${name}.png`;
        await writeFile(join(dir, file), r.png);
        images.push({ mimeType: 'image/png', data: Buffer.from(r.png).toString('base64') });
        info.push({ view: name, file: `renders/${file}`, camera: r.camera });
      }
      return { text: j({ rendered: info, version: ctx.session.version }), images };
    },
  },
];
