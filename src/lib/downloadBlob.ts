/**
 * Save a Blob as a file. The object URL is released only after the browser has had time to
 * start the download — revoking it straight after click() makes Chrome fail larger downloads
 * with "Failed – Network error", which is how statements/ledgers appeared to "not download".
 */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.replace(/[\\/:*?"<>|]+/g, "-");
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 60_000);
}
