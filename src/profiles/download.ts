// Export: a profile as a `<name>.tin` file download.

/** Starts a download of `text` as `<name>.tin`. Returns the file name. */
export function downloadProfile(name: string, text: string, doc: Document = document): string {
  const file = `${name}.tin`;
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const a = doc.createElement('a');
  a.href = url;
  a.download = file;
  a.hidden = true;
  (doc.body ?? doc.documentElement).appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return file;
}
