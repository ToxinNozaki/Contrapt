// Safe arithmetic expression evaluator for parameters ("width/2 + 3").
// No eval, no Function: a small tokenizer + recursive-descent parser. Names resolve through a
// caller-supplied lookup so parameters can reference each other (cycles are detected by the caller).

export type Num = number | string;

const FUNCS: Record<string, (...a: number[]) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  atan2: Math.atan2,
  sqrt: Math.sqrt,
  abs: Math.abs,
  min: Math.min,
  max: Math.max,
  pow: Math.pow,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  rad: (d) => ((d ?? 0) * Math.PI) / 180,
  deg: (r) => ((r ?? 0) * 180) / Math.PI,
};

const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E };

type Tok = { t: 'num' | 'id' | 'op' | 'end'; v: string };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i] as string;
    if (/\s/.test(c)) {
      i++;
    } else if (/[0-9.]/.test(c)) {
      const m = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i));
      if (!m) throw new Error(`Bad number at position ${i} in "${src}"`);
      out.push({ t: 'num', v: m[0] });
      i += m[0].length;
    } else if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i)) as RegExpExecArray;
      out.push({ t: 'id', v: m[0] });
      i += m[0].length;
    } else if ('+-*/^%(),'.includes(c)) {
      out.push({ t: 'op', v: c });
      i++;
    } else {
      throw new Error(`Unexpected character "${c}" in expression "${src}"`);
    }
  }
  out.push({ t: 'end', v: '' });
  return out;
}

/** Evaluate an expression. `lookup` returns the value of a named parameter (or undefined). */
export function evalExpr(src: string, lookup: (name: string) => number | undefined): number {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p] as Tok;
  const eat = (v?: string) => {
    const t = peek();
    if (v !== undefined && t.v !== v)
      throw new Error(`Expected "${v}" but found "${t.v}" in "${src}"`);
    p++;
    return t;
  };

  // expr := term (('+'|'-') term)*
  const expr = (): number => {
    let x = term();
    while (peek().t === 'op' && (peek().v === '+' || peek().v === '-')) {
      x = eat().v === '+' ? x + term() : x - term();
    }
    return x;
  };
  // term := unary (('*'|'/'|'%') unary)*
  const term = (): number => {
    let x = unary();
    while (peek().t === 'op' && '*/%'.includes(peek().v)) {
      const op = eat().v;
      const y = unary();
      x = op === '*' ? x * y : op === '/' ? x / y : x % y;
    }
    return x;
  };
  // unary := '-' unary | power
  const unary = (): number => {
    if (peek().t === 'op' && peek().v === '-') {
      eat();
      return -unary();
    }
    if (peek().t === 'op' && peek().v === '+') {
      eat();
      return unary();
    }
    return power();
  };
  // power := atom ('^' unary)?   (right associative)
  const power = (): number => {
    const base = atom();
    if (peek().t === 'op' && peek().v === '^') {
      eat();
      return base ** unary();
    }
    return base;
  };
  const atom = (): number => {
    const t = eat();
    if (t.t === 'num') return Number(t.v);
    if (t.t === 'op' && t.v === '(') {
      const x = expr();
      eat(')');
      return x;
    }
    if (t.t === 'id') {
      if (peek().t === 'op' && peek().v === '(') {
        const fn = FUNCS[t.v];
        if (!fn) throw new Error(`Unknown function "${t.v}" in "${src}"`);
        eat('(');
        const args: number[] = [];
        if (!(peek().t === 'op' && peek().v === ')')) {
          args.push(expr());
          while (peek().t === 'op' && peek().v === ',') {
            eat();
            args.push(expr());
          }
        }
        eat(')');
        return fn(...args);
      }
      const v = lookup(t.v);
      if (v !== undefined) return v;
      const c = CONSTS[t.v];
      if (c !== undefined) return c;
      throw new Error(`Unknown parameter "${t.v}" in "${src}"`);
    }
    throw new Error(`Unexpected "${t.v || 'end of expression'}" in "${src}"`);
  };

  const result = expr();
  if (peek().t !== 'end') throw new Error(`Unexpected "${peek().v}" in "${src}"`);
  if (!Number.isFinite(result)) throw new Error(`Expression "${src}" is not a finite number`);
  return result;
}

/** Names referenced by an expression (for dependency ordering / cycle detection). */
export function exprNames(src: string): string[] {
  const names = new Set<string>();
  const toks = tokenize(src);
  toks.forEach((t, i) => {
    const next = toks[i + 1];
    const isCall = next?.t === 'op' && next.v === '(';
    if (t.t === 'id' && !isCall && !(t.v in CONSTS)) names.add(t.v);
  });
  return [...names];
}
