// Engineering knowledge packs: plain markdown files in packages/mcp/knowledge/, one per topic.
// Anyone can add or improve a pack with a normal pull request (see knowledge/README.md).
// Each file starts with a tiny front-matter block:
//   ---
//   title: ...
//   summary: ...
//   ---
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface KnowledgeDoc {
  /** File name without .md; this is the topic id used by tools and resources. */
  id: string;
  title: string;
  summary: string;
  body: string;
}

/** Listed first, in this order; anything else follows alphabetically. */
const PREFERRED_ORDER = [
  'engineering-method',
  'safety-and-ethics',
  'contrapt-modeling-patterns',
  'strength-and-stiffness',
  'materials',
  'fasteners-and-joints',
  'tolerances-and-fits',
];

const defaultDir = () => resolve(dirname(fileURLToPath(import.meta.url)), '..', 'knowledge');

export function parseKnowledge(id: string, text: string): KnowledgeDoc {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text);
  if (!m) throw new Error(`Knowledge file "${id}.md" is missing its front-matter block`);
  const meta: Record<string, string> = {};
  for (const line of (m[1] as string).split(/\r?\n/)) {
    const kv = /^([A-Za-z_]+):\s*(.*)$/.exec(line);
    if (kv) meta[kv[1] as string] = (kv[2] as string).trim();
  }
  if (!meta.title || !meta.summary) {
    throw new Error(
      `Knowledge file "${id}.md" needs both "title" and "summary" in its front matter`,
    );
  }
  return { id, title: meta.title, summary: meta.summary, body: (m[2] as string).trim() };
}

let cache: KnowledgeDoc[] | undefined;

export function loadKnowledge(dir: string = defaultDir()): KnowledgeDoc[] {
  if (dir === defaultDir() && cache) return cache;
  const docs = readdirSync(dir)
    .filter((f) => f.endsWith('.md') && f.toLowerCase() !== 'readme.md')
    .map((f) => parseKnowledge(f.slice(0, -3), readFileSync(join(dir, f), 'utf8')));
  docs.sort((a, b) => {
    const ia = PREFERRED_ORDER.indexOf(a.id);
    const ib = PREFERRED_ORDER.indexOf(b.id);
    if (ia >= 0 || ib >= 0) return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
    return a.id.localeCompare(b.id);
  });
  if (dir === defaultDir()) cache = docs;
  return docs;
}

export function getKnowledge(id: string): KnowledgeDoc {
  const doc = loadKnowledge().find((d) => d.id === id);
  if (!doc) {
    throw new Error(
      `Unknown knowledge topic "${id}". Topics: ${loadKnowledge()
        .map((d) => d.id)
        .join(', ')}`,
    );
  }
  return doc;
}

export const knowledgeIndex = () =>
  loadKnowledge().map(({ id, title, summary }) => ({ topic: id, title, summary }));
