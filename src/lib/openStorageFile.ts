/**
 * Open or force-download a public Supabase Storage file — the same
 * synthesized-`<a>`-click convention TdsFilingsManager.tsx's ACK
 * view/download already uses, generalised here for reuse.
 *
 * NOT `window.open()`: it is silently blocked by ad-blockers/popup settings
 * with no error, whereas a synthesized anchor click is a real user-gesture
 * navigation that always passes through.
 *
 * Plain `a.download` is ignored for a cross-origin URL (this app's origin
 * differs from the Supabase Storage origin) — Supabase Storage's own
 * `?download=<filename>` query param is what actually forces a real
 * `Content-Disposition: attachment` response, so downloadStorageFile appends
 * that rather than relying on the anchor attribute alone.
 */
function clickAnchor(href: string, download?: string) {
  const a = document.createElement("a");
  a.href = href;
  a.target = "_blank";
  a.rel = "noopener";
  if (download) a.download = download;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function viewStorageFile(url: string) {
  clickAnchor(url);
}

export function downloadStorageFile(url: string, fileName: string) {
  let href = url;
  try {
    const u = new URL(url);
    u.searchParams.set("download", fileName);
    href = u.toString();
  } catch {
    // Not a valid absolute URL — fall through and try the plain href anyway;
    // the browser will either download it or open it, never silently do nothing.
  }
  clickAnchor(href, fileName);
}

/**
 * Best-effort removal of a public 'documents' bucket object, given only its
 * public URL (the shape every file_url column in this app stores — none of
 * them separately track the raw storage key). Same URL→path extraction
 * TdsFilingsManager.tsx's deleteAckFile already relies on. Never throws: a
 * storage-side failure here must not block the caller's own row delete —
 * the DB row disappearing is what the user actually asked for; a leftover
 * blob in Storage is a cheap, silent cleanup miss, not a broken delete.
 */
export async function removePublicDocumentByUrl(supabase: { storage: { from: (bucket: string) => { remove: (paths: string[]) => Promise<unknown> } } }, url: string | null | undefined) {
  if (!url) return;
  const marker = "/storage/v1/object/public/documents/";
  const idx = url.indexOf(marker);
  if (idx === -1) return;
  try {
    await supabase.storage.from("documents").remove([url.slice(idx + marker.length)]);
  } catch {
    // best-effort — see doc above
  }
}
