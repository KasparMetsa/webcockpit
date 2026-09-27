// Basic #format (spec §3 "Should"): `#format {var} {format} {arg1} {arg2} …`.
//
// Codes take optional flags `-` (left-align) and `0` (zero-pad), a width
// and a `.precision`:
//   %s  argument as text (precision truncates)
//   %d  argument as an integer (evaluated with #math rules)
//   %f  argument as a number (precision = decimals, default 2)
//   %x  hexadecimal, %X upper-case
//   %c  the character with that code
//   %u  upper-case, %l lower-case, %n capitalised, %r reversed
//   %L  length of the argument
//   %t  local time now, HH:MM:SS (no argument used)
//   %T  seconds since the epoch, %U microseconds (no argument used)
//   %%  a literal %
// Any other code is kept as written. Missing arguments are ''.

import { evalMath } from './expr';

export function formatString(fmt: string, args: readonly string[], nowMs: number): string {
  let out = '';
  let ai = 0;
  const next = (): string => args[ai++] ?? '';
  for (let i = 0; i < fmt.length; i++) {
    const c = fmt[i];
    if (c !== '%') {
      out += c;
      continue;
    }
    const m = /^([-0]*)(\d*)(?:\.(\d+))?([sdfxXculnrLtTU%])/.exec(fmt.slice(i + 1));
    if (!m) {
      out += c;
      continue;
    }
    i += m[0].length;
    const flags = m[1]!;
    const width = m[2] ? Number(m[2]) : 0;
    const prec = m[3] !== undefined ? Number(m[3]) : -1;
    const code = m[4]!;
    let v: string;
    switch (code) {
      case '%':
        out += '%';
        continue;
      case 's':
        v = next();
        if (prec >= 0) v = v.slice(0, prec);
        break;
      case 'd':
        v = String(Math.trunc(toNumber(next())));
        break;
      case 'f':
        v = toNumber(next()).toFixed(prec >= 0 ? prec : 2);
        break;
      case 'x':
        v = Math.trunc(toNumber(next())).toString(16);
        break;
      case 'X':
        v = Math.trunc(toNumber(next())).toString(16).toUpperCase();
        break;
      case 'c':
        v = String.fromCodePoint(Math.max(0, Math.trunc(toNumber(next()))) % 0x110000);
        break;
      case 'u':
        v = next().toUpperCase();
        break;
      case 'l':
        v = next().toLowerCase();
        break;
      case 'n': {
        const a = next();
        v = a.charAt(0).toUpperCase() + a.slice(1);
        break;
      }
      case 'r':
        v = Array.from(next()).reverse().join('');
        break;
      case 'L':
        v = String(Array.from(next()).length);
        break;
      case 't': {
        const d = new Date(nowMs);
        const p = (n: number) => String(n).padStart(2, '0');
        v = `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
        break;
      }
      case 'T':
        v = String(Math.floor(nowMs / 1000));
        break;
      case 'U':
        v = String(Math.round(nowMs * 1000));
        break;
      default:
        v = '';
    }
    if (width > 0 && v.length < width) {
      if (flags.includes('-')) v = v.padEnd(width);
      else if (flags.includes('0') && /[dfxX]/.test(code)) {
        const neg = v.startsWith('-');
        v = (neg ? '-' : '') + (neg ? v.slice(1) : v).padStart(width - (neg ? 1 : 0), '0');
      } else v = v.padStart(width);
    }
    out += v;
  }
  return out;
}

function toNumber(s: string): number {
  const n = Number(s.trim());
  if (Number.isFinite(n)) return n;
  try {
    const r = Number(evalMath(s));
    return Number.isFinite(r) ? r : 0;
  } catch {
    return 0;
  }
}
