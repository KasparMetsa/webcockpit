// The #if / #math expression evaluator (spec §3, Inv §6.3).
//
// Grammar (lowest precedence first):
//   or      := and ( ('||' | '^^') and )*
//   and     := cmp ( '&&' cmp )*
//   cmp     := add ( ('==' | '!=' | '<' | '>' | '<=' | '>=') add )*
//   add     := mul ( ('+' | '-') mul )*
//   mul     := pow ( ('*' | '/' | '%') pow )*
//   pow     := unary ( '**' unary )*
//   unary   := ('!' | '-' | '+') unary | primary
//   primary := number | "string" | {string} | '(' or ')' | bareword
//
// Semantics:
// - A quoted or braced operand is a string; a number literal is a number.
//   A bareword is a number when it looks like one, else a string, except
//   `&name` (a variable reference left unsubstituted because the variable
//   does not exist), which is 0.
// - `==` and `!=` compare as strings when either side is a string. The
//   right-hand string is a glob: `*` matches any run of characters
//   (`"$target" == "*orc*"`), case-sensitive, whole string. `<`, `>`, `<=`,
//   `>=` compare strings lexically when both are strings.
// - Truth: a non-zero number; a string is true when it is non-empty and
//   not "0".
// - Arithmetic follows tt++ precision: the result has as many decimals as
//   the most precise number literal, so `7 / 2` is 3 and `7.0 / 2` is 3.5.

import { globToRegExp } from './text';

export class ExprError extends Error {
  override name = 'ExprError';
}

type Val = { n: number; s: null } | { n: 0; s: string };

const num = (n: number): Val => ({ n, s: null });
const str = (s: string): Val => ({ n: 0, s });

type Tok =
  | { t: 'num'; v: number; dec: number }
  | { t: 'str'; v: string; quoted: boolean }
  | { t: 'op'; v: string }
  | { t: 'end' };

const OPS = ['**', '==', '!=', '<=', '>=', '&&', '||', '^^', '<', '>', '+', '-', '*', '/', '%', '!', '(', ')'];
const NUMBER = /^[+-]?(\d+(\.\d*)?|\.\d+)$/;

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i]!;
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++;
      continue;
    }
    if (c === '"') {
      let s = '';
      let j = i + 1;
      while (j < n && src[j] !== '"') {
        if (src[j] === '\\' && j + 1 < n) {
          s += src[j + 1];
          j += 2;
          continue;
        }
        s += src[j++];
      }
      out.push({ t: 'str', v: s, quoted: true });
      i = j + 1;
      continue;
    }
    if (c === '{') {
      let depth = 0;
      let j = i;
      for (; j < n; j++) {
        if (src[j] === '{') depth++;
        else if (src[j] === '}' && --depth === 0) break;
      }
      out.push({ t: 'str', v: src.slice(i + 1, j), quoted: true });
      i = j + 1;
      continue;
    }
    if ((c >= '0' && c <= '9') || (c === '.' && src[i + 1] !== undefined && src[i + 1]! >= '0' && src[i + 1]! <= '9')) {
      let j = i;
      while (j < n && ((src[j]! >= '0' && src[j]! <= '9') || src[j] === '.')) j++;
      // A number glued to letters (`3rd`) is a bareword.
      if (j < n && /[A-Za-z_]/.test(src[j]!)) {
        const k = wordEnd(src, j);
        out.push({ t: 'str', v: src.slice(i, k), quoted: false });
        i = k;
        continue;
      }
      const text = src.slice(i, j);
      const dot = text.indexOf('.');
      out.push({ t: 'num', v: Number(text), dec: dot < 0 ? 0 : text.length - dot - 1 });
      i = j;
      continue;
    }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (op) {
      out.push({ t: 'op', v: op });
      i += op.length;
      continue;
    }
    const k = wordEnd(src, i);
    out.push({ t: 'str', v: src.slice(i, Math.max(k, i + 1)), quoted: false });
    i = Math.max(k, i + 1);
  }
  out.push({ t: 'end' });
  return out;
}

function wordEnd(src: string, i: number): number {
  let j = i;
  while (j < src.length && !/[\s()!=<>&|+\-*/%^"]/.test(src[j]!)) j++;
  // `&name` keeps its `&`.
  if (j === i && src[i] === '&') {
    j++;
    while (j < src.length && /[\w{}]/.test(src[j]!)) j++;
  }
  return j;
}

class Parser {
  private i = 0;
  dec = 0;
  constructor(private readonly toks: Tok[]) {}

  private peek(): Tok {
    return this.toks[this.i]!;
  }
  private isOp(v: string): boolean {
    const t = this.peek();
    return t.t === 'op' && t.v === v;
  }

  parse(): Val {
    const v = this.or();
    if (this.peek().t !== 'end') throw new ExprError('unexpected ' + show(this.peek()));
    return v;
  }

  private or(): Val {
    let a = this.and();
    for (;;) {
      if (this.isOp('||')) {
        this.i++;
        const b = this.and();
        a = num(truth(a) || truth(b) ? 1 : 0);
      } else if (this.isOp('^^')) {
        this.i++;
        const b = this.and();
        a = num(truth(a) !== truth(b) ? 1 : 0);
      } else return a;
    }
  }

  private and(): Val {
    let a = this.cmp();
    while (this.isOp('&&')) {
      this.i++;
      const b = this.cmp();
      a = num(truth(a) && truth(b) ? 1 : 0);
    }
    return a;
  }

  private cmp(): Val {
    let a = this.add();
    for (;;) {
      const t = this.peek();
      if (t.t !== 'op' || !['==', '!=', '<', '>', '<=', '>='].includes(t.v)) return a;
      this.i++;
      const b = this.add();
      a = num(compare(t.v, a, b) ? 1 : 0);
    }
  }

  private add(): Val {
    let a = this.mul();
    for (;;) {
      if (this.isOp('+')) {
        this.i++;
        a = num(toNum(a) + toNum(this.mul()));
      } else if (this.isOp('-')) {
        this.i++;
        a = num(toNum(a) - toNum(this.mul()));
      } else return a;
    }
  }

  private mul(): Val {
    let a = this.pow();
    for (;;) {
      const t = this.peek();
      if (t.t !== 'op' || (t.v !== '*' && t.v !== '/' && t.v !== '%')) return a;
      this.i++;
      const b = toNum(this.pow());
      const x = toNum(a);
      if (t.v === '*') a = num(x * b);
      else {
        if (b === 0) throw new ExprError('division by zero');
        a = num(t.v === '/' ? x / b : x % b);
      }
    }
  }

  private pow(): Val {
    let a = this.unary();
    while (this.isOp('**')) {
      this.i++;
      a = num(Math.pow(toNum(a), toNum(this.unary())));
    }
    return a;
  }

  private unary(): Val {
    if (this.isOp('!')) {
      this.i++;
      return num(truth(this.unary()) ? 0 : 1);
    }
    if (this.isOp('-')) {
      this.i++;
      return num(-toNum(this.unary()));
    }
    if (this.isOp('+')) {
      this.i++;
      return num(toNum(this.unary()));
    }
    return this.primary();
  }

  private primary(): Val {
    const t = this.peek();
    this.i++;
    if (t.t === 'num') {
      if (t.dec > this.dec) this.dec = t.dec;
      return num(t.v);
    }
    if (t.t === 'str') {
      if (!t.quoted) {
        if (NUMBER.test(t.v)) {
          const dot = t.v.indexOf('.');
          if (dot >= 0 && t.v.length - dot - 1 > this.dec) this.dec = t.v.length - dot - 1;
          return num(Number(t.v));
        }
        if (t.v.startsWith('&')) return num(0);
      }
      return str(t.v);
    }
    if (t.t === 'op' && t.v === '(') {
      const v = this.or();
      if (!this.isOp(')')) throw new ExprError('missing )');
      this.i++;
      return v;
    }
    throw new ExprError(t.t === 'end' ? 'unexpected end' : 'unexpected ' + show(t));
  }
}

function show(t: Tok): string {
  return t.t === 'end' ? 'end' : `'${String(t.v)}'`;
}

function truth(v: Val): boolean {
  if (v.s === null) return v.n !== 0;
  return v.s !== '' && v.s !== '0';
}

function toNum(v: Val): number {
  if (v.s === null) return v.n;
  const n = Number(v.s.trim());
  return Number.isFinite(n) ? n : 0;
}

const globCache = new Map<string, RegExp>();

function globMatch(text: string, glob: string): boolean {
  if (glob.indexOf('*') < 0) return text === glob;
  let re = globCache.get(glob);
  if (!re) {
    if (globCache.size > 500) globCache.clear();
    re = globToRegExp(glob);
    globCache.set(glob, re);
  }
  return re.test(text);
}

function compare(op: string, a: Val, b: Val): boolean {
  const strings = a.s !== null || b.s !== null;
  if (op === '==' || op === '!=') {
    const eq = strings ? globMatch(a.s ?? fmt(a.n), b.s ?? fmt(b.n)) : a.n === b.n;
    return op === '==' ? eq : !eq;
  }
  if (a.s !== null && b.s !== null) {
    const x = a.s;
    const y = b.s;
    return op === '<' ? x < y : op === '>' ? x > y : op === '<=' ? x <= y : x >= y;
  }
  const x = toNum(a);
  const y = toNum(b);
  return op === '<' ? x < y : op === '>' ? x > y : op === '<=' ? x <= y : x >= y;
}

function fmt(n: number): string {
  return String(n);
}

/** Evaluates `src` to true/false (#if). Throws ExprError on a syntax error. */
export function evalCondition(src: string): boolean {
  if (src.trim() === '') return false;
  return truth(new Parser(tokenize(src)).parse());
}

/**
 * Evaluates `src` for #math: a number formatted with tt++ precision, or a
 * string result as is.
 */
export function evalMath(src: string): string {
  const p = new Parser(tokenize(src));
  const v = p.parse();
  if (v.s !== null) return v.s;
  return formatNumber(v.n, p.dec);
}

export function formatNumber(n: number, dec: number): string {
  if (!Number.isFinite(n)) return '0';
  if (dec === 0) return String(Math.trunc(n));
  const f = n.toFixed(dec);
  return f.includes('.') ? f.replace(/\.?0+$/, '') || '0' : f;
}
