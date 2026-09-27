// Raw capture line format (Inv §7.1), identical to Cockpit's `.log`:
//
//   <16-digit µs since epoch> <raw inbound line, ANSI SGR kept>\n
//   <16-digit µs since epoch> > <outbound command>\n
//
// An empty Enter is `<ts> > ` (trailing space). Every formatter returns the
// full line including its trailing '\n', so the recorder allocates exactly
// one string per captured event.

/** A µs timestamp as the 16-digit integer Cockpit writes. */
export function formatTs(us: number): string {
  return String(Math.trunc(us)).padStart(16, '0');
}

/** One inbound line (use `Line.raw`; prompts are ordinary lines). */
export function formatInbound(ts: number, raw: string): string {
  return formatTs(ts) + ' ' + raw + '\n';
}

/** One outbound command. Callers skip `secret` commands. */
export function formatOutbound(ts: number, cmd: string): string {
  return formatTs(ts) + ' > ' + cmd + '\n';
}

/**
 * Run id: `<Character>/<local time as 2026-09-19T21-35-58>`. The time part
 * is also the timestamp in the download file name.
 */
export function makeRunId(character: string, date: Date): string {
  return character + '/' + localStamp(date);
}

/** Local time as `YYYY-MM-DDTHH-MM-SS` (file-name safe). */
export function localStamp(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `T${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`
  );
}

/** Download name for a run id: `<Character>-<timestamp>.log`. */
export function runFileName(runId: string): string {
  const slash = runId.indexOf('/');
  const name = slash < 0 ? runId : runId.slice(0, slash) + '-' + runId.slice(slash + 1);
  return name.replace(/[\\/:*?"<>|]/g, '_') + '.log';
}
