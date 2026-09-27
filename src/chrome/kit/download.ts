// TUI kit: a browser download of a Blob (History backups, exports).

/** Starts a download of `blob` as `name`. */
export function downloadBlob(blob: Blob, name: string, doc: Document = document): void {
  const url = URL.createObjectURL(blob);
  const a = doc.createElement('a');
  a.href = url;
  a.download = name;
  a.hidden = true;
  (doc.body ?? doc.documentElement).appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
