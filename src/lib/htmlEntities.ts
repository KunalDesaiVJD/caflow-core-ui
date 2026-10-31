/**
 * Plain text from a string that arrived HTML-escaped — eOffice customer sync
 * sends "V J DESAI &amp; CO LLP", and a name pasted from a web page can carry
 * the same. Decodes named and numeric entities (unlike cleanTallyName, which
 * drops numeric ones because Tally uses them for control characters).
 * Run twice so a double-escaped "&amp;amp;" also comes out as "&".
 */
const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeOnce(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code >= 32 ? String.fromCodePoint(code) : "";
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

export function decodeHtmlEntities(value: string | null | undefined): string {
  if (!value) return "";
  return decodeOnce(decodeOnce(value));
}
