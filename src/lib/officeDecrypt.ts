/**
 * In-browser decryption of a password-protected Excel workbook (.xlsx/.xlsm
 * saved with File › Info › Protect Workbook › Encrypt with Password).
 *
 * An encrypted workbook is NOT a zip: Excel wraps it in an OLE compound file
 * holding an "EncryptionInfo" stream (how the key was derived) and an
 * "EncryptedPackage" stream (the real .xlsx bytes, AES-encrypted). SheetJS
 * cannot open it and throws "File is password-protected", so the Stage-1
 * import failed on any firm workbook kept under a password. This implements
 * ECMA-376 Agile Encryption (MS-OFFCRYPTO §2.3.4.10–15 — what every Excel
 * since 2010 writes) with WebCrypto, so the file never leaves the browser
 * and the password is never sent anywhere.
 */
import * as XLSX from "xlsx";

export class WrongPasswordError extends Error {
  constructor() { super("Incorrect password for this workbook."); this.name = "WrongPasswordError"; }
}

const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

type Cfb = { FileIndex: { name: string; content: ArrayLike<number> }[] };
function readCfb(bytes: Uint8Array): Cfb | null {
  try { return XLSX.CFB.read(bytes, { type: "array" }) as Cfb; } catch { return null; }
}
function stream(cfb: Cfb, name: string): Uint8Array | null {
  const e = cfb.FileIndex.find((f) => f.name === name);
  return e?.content ? Uint8Array.from(e.content) : null;
}

/** True when the bytes are an Office-encrypted workbook (OLE container with
 * EncryptionInfo + EncryptedPackage). A plain legacy .xls is also OLE but has
 * neither stream, so it is never mistaken for one. */
export function isEncryptedOfficeFile(buffer: ArrayBuffer): boolean {
  const b = new Uint8Array(buffer);
  if (b.length < 512 || OLE_MAGIC.some((m, i) => b[i] !== m)) return false;
  const cfb = readCfb(b);
  return !!cfb && !!stream(cfb, "EncryptionInfo") && !!stream(cfb, "EncryptedPackage");
}

const HASHES: Record<string, string> = { SHA1: "SHA-1", "SHA-1": "SHA-1", SHA256: "SHA-256", SHA384: "SHA-384", SHA512: "SHA-512" };

const attrs = (xml: string, tag: string): Record<string, string> => {
  const m = xml.match(new RegExp(`<${tag}\\b([^>]*)>`));
  const out: Record<string, string> = {};
  if (m) for (const a of m[1].matchAll(/([\w:]+)="([^"]*)"/g)) out[a[1]] = a[2];
  return out;
};
const b64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};
const le32 = (n: number): Uint8Array => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); return b; };
/** Truncate, or pad with 0x36, to exactly `len` bytes (MS-OFFCRYPTO §2.3.4.11). */
const fit = (b: Uint8Array, len: number): Uint8Array => {
  if (b.length >= len) return b.slice(0, len);
  const out = new Uint8Array(len).fill(0x36);
  out.set(b);
  return out;
};

const subtle = (): SubtleCrypto => {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new Error("This browser cannot decrypt password-protected workbooks. Save the file without a password and import again.");
  return s;
};
const digest = async (alg: string, data: Uint8Array): Promise<Uint8Array> => new Uint8Array(await subtle().digest(alg, data));

// SHA-512 round constants, as [hi, lo] 32-bit halves.
const K512 = [
  0x428a2f98, 0xd728ae22, 0x71374491, 0x23ef65cd, 0xb5c0fbcf, 0xec4d3b2f, 0xe9b5dba5, 0x8189dbbc, 0x3956c25b, 0xf348b538, 0x59f111f1, 0xb605d019, 0x923f82a4, 0xaf194f9b, 0xab1c5ed5, 0xda6d8118,
  0xd807aa98, 0xa3030242, 0x12835b01, 0x45706fbe, 0x243185be, 0x4ee4b28c, 0x550c7dc3, 0xd5ffb4e2, 0x72be5d74, 0xf27b896f, 0x80deb1fe, 0x3b1696b1, 0x9bdc06a7, 0x25c71235, 0xc19bf174, 0xcf692694,
  0xe49b69c1, 0x9ef14ad2, 0xefbe4786, 0x384f25e3, 0x0fc19dc6, 0x8b8cd5b5, 0x240ca1cc, 0x77ac9c65, 0x2de92c6f, 0x592b0275, 0x4a7484aa, 0x6ea6e483, 0x5cb0a9dc, 0xbd41fbd4, 0x76f988da, 0x831153b5,
  0x983e5152, 0xee66dfab, 0xa831c66d, 0x2db43210, 0xb00327c8, 0x98fb213f, 0xbf597fc7, 0xbeef0ee4, 0xc6e00bf3, 0x3da88fc2, 0xd5a79147, 0x930aa725, 0x06ca6351, 0xe003826f, 0x14292967, 0x0a0e6e70,
  0x27b70a85, 0x46d22ffc, 0x2e1b2138, 0x5c26c926, 0x4d2c6dfc, 0x5ac42aed, 0x53380d13, 0x9d95b3df, 0x650a7354, 0x8baf63de, 0x766a0abb, 0x3c77b2a8, 0x81c2c92e, 0x47edaee6, 0x92722c85, 0x1482353b,
  0xa2bfe8a1, 0x4cf10364, 0xa81a664b, 0xbc423001, 0xc24b8b70, 0xd0f89791, 0xc76c51a3, 0x0654be30, 0xd192e819, 0xd6ef5218, 0xd6990624, 0x5565a910, 0xf40e3585, 0x5771202a, 0x106aa070, 0x32bbd1b8,
  0x19a4c116, 0xb8d2d0c8, 0x1e376c08, 0x5141ab53, 0x2748774c, 0xdf8eeb99, 0x34b0bcb5, 0xe19b48a8, 0x391c0cb3, 0xc5c95a63, 0x4ed8aa4a, 0xe3418acb, 0x5b9cca4f, 0x7763e373, 0x682e6ff3, 0xd6b2b8a3,
  0x748f82ee, 0x5defb2fc, 0x78a5636f, 0x43172f60, 0x84c87814, 0xa1f0ab72, 0x8cc70208, 0x1a6439ec, 0x90befffa, 0x23631e28, 0xa4506ceb, 0xde82bde9, 0xbef9a3f7, 0xb2c67915, 0xc67178f2, 0xe372532b,
  0xca273ece, 0xea26619c, 0xd186b8c7, 0x21c0c207, 0xeada7dd6, 0xcde0eb1e, 0xf57d4f7f, 0xee6ed178, 0x06f067aa, 0x72176fba, 0x0a637dc5, 0xa2c898a6, 0x113f9804, 0xbef90dae, 0x1b710b35, 0x131c471b,
  0x28db77f5, 0x23047d84, 0x32caab7b, 0x40c72493, 0x3c9ebe0a, 0x15c9bebc, 0x431d67c4, 0x9c100d4c, 0x4cc5d4be, 0xcb3e42b6, 0x597f299c, 0xfc657e2a, 0x5fcb6fab, 0x3ad6faec, 0x6c44198c, 0x4a475817,
];
const IV512 = [0x6a09e667, 0xf3bcc908, 0xbb67ae85, 0x84caa73b, 0x3c6ef372, 0xfe94f82b, 0xa54ff53a, 0x5f1d36f1, 0x510e527f, 0xade682d1, 0x9b05688c, 0x2b3e6c1f, 0x1f83d9ab, 0xfb41bd6b, 0x5be0cd19, 0x137e2179];
const W512 = new Int32Array(160);

/** Synchronous SHA-512 (FIPS 180-4) on 32-bit halves; verified against WebCrypto in tests. */
export function sha512(msg: Uint8Array): Uint8Array {
  const len = msg.length;
  const blocks = Math.ceil((len + 17) / 128);
  const m = new Uint8Array(blocks * 128);
  m.set(msg);
  m[len] = 0x80;
  const dv = new DataView(m.buffer);
  dv.setUint32(m.length - 8, Math.floor(len / 0x20000000), false);
  dv.setUint32(m.length - 4, (len * 8) >>> 0, false);
  const H = Int32Array.from(IV512);
  const W = W512;
  for (let b = 0; b < blocks; b++) {
    for (let i = 0; i < 32; i++) W[i] = dv.getInt32(b * 128 + i * 4, false);
    for (let i = 16; i < 80; i++) {
      const xh = W[2 * (i - 15)], xl = W[2 * (i - 15) + 1];
      const s0h = ((xh >>> 1) | (xl << 31)) ^ ((xh >>> 8) | (xl << 24)) ^ (xh >>> 7);
      const s0l = ((xl >>> 1) | (xh << 31)) ^ ((xl >>> 8) | (xh << 24)) ^ ((xl >>> 7) | (xh << 25));
      const yh = W[2 * (i - 2)], yl = W[2 * (i - 2) + 1];
      const s1h = ((yh >>> 19) | (yl << 13)) ^ ((yl >>> 29) | (yh << 3)) ^ (yh >>> 6);
      const s1l = ((yl >>> 19) | (yh << 13)) ^ ((yh >>> 29) | (yl << 3)) ^ ((yl >>> 6) | (yh << 26));
      let lo = (s0l >>> 0) + (s1l >>> 0) + (W[2 * (i - 7) + 1] >>> 0) + (W[2 * (i - 16) + 1] >>> 0);
      const hi = s0h + s1h + W[2 * (i - 7)] + W[2 * (i - 16)] + Math.floor(lo / 0x100000000);
      W[2 * i] = hi; W[2 * i + 1] = lo = lo >>> 0;
    }
    let ah = H[0], al = H[1], bh = H[2], bl = H[3], ch = H[4], cl = H[5], dh = H[6], dl = H[7];
    let eh = H[8], el = H[9], fh = H[10], fl = H[11], gh = H[12], gl = H[13], hh = H[14], hl = H[15];
    for (let i = 0; i < 80; i++) {
      const S1h = ((eh >>> 14) | (el << 18)) ^ ((eh >>> 18) | (el << 14)) ^ ((el >>> 9) | (eh << 23));
      const S1l = ((el >>> 14) | (eh << 18)) ^ ((el >>> 18) | (eh << 14)) ^ ((eh >>> 9) | (el << 23));
      const chh = (eh & fh) ^ (~eh & gh), chl = (el & fl) ^ (~el & gl);
      let t1l = (hl >>> 0) + (S1l >>> 0) + (chl >>> 0) + (K512[2 * i + 1] >>> 0) + (W[2 * i + 1] >>> 0);
      const t1h = hh + S1h + chh + K512[2 * i] + W[2 * i] + Math.floor(t1l / 0x100000000);
      t1l >>>= 0;
      const S0h = ((ah >>> 28) | (al << 4)) ^ ((al >>> 2) | (ah << 30)) ^ ((al >>> 7) | (ah << 25));
      const S0l = ((al >>> 28) | (ah << 4)) ^ ((ah >>> 2) | (al << 30)) ^ ((ah >>> 7) | (al << 25));
      const mjh = (ah & bh) ^ (ah & ch) ^ (bh & ch), mjl = (al & bl) ^ (al & cl) ^ (bl & cl);
      let t2l = (S0l >>> 0) + (mjl >>> 0);
      const t2h = S0h + mjh + Math.floor(t2l / 0x100000000);
      t2l >>>= 0;
      hh = gh; hl = gl; gh = fh; gl = fl; fh = eh; fl = el;
      let x = (dl >>> 0) + t1l;
      eh = (dh + t1h + Math.floor(x / 0x100000000)) | 0; el = x | 0;
      dh = ch; dl = cl; ch = bh; cl = bl; bh = ah; bl = al;
      x = t1l + t2l;
      ah = (t1h + t2h + Math.floor(x / 0x100000000)) | 0; al = x | 0;
    }
    const st = [ah, al, bh, bl, ch, cl, dh, dl, eh, el, fh, fl, gh, gl, hh, hl];
    for (let j = 0; j < 16; j += 2) {
      const lo = (H[j + 1] >>> 0) + (st[j + 1] >>> 0);
      H[j] = (H[j] + st[j] + Math.floor(lo / 0x100000000)) | 0;
      H[j + 1] = lo | 0;
    }
  }
  const out = new Uint8Array(64);
  const ov = new DataView(out.buffer);
  for (let j = 0; j < 16; j++) ov.setInt32(j * 4, H[j], false);
  return out;
}

/** AES-CBC decrypt WITHOUT padding (Office pads to the block size itself).
 * WebCrypto only does PKCS#7, so append one block that decrypts to a full
 * padding block — Enc(lastCipherBlock ⊕ 0x10…) — and let it strip that. */
async function aesCbcRaw(keyBytes: Uint8Array, iv: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const key = await subtle().importKey("raw", keyBytes, "AES-CBC", false, ["encrypt", "decrypt"]);
  const last = data.slice(data.length - 16);
  const pad = new Uint8Array(await subtle().encrypt({ name: "AES-CBC", iv: last }, key, new Uint8Array(0)));
  return new Uint8Array(await subtle().decrypt({ name: "AES-CBC", iv }, key, concat(data, pad.slice(0, 16))));
}

/** Decrypt an Agile-encrypted workbook to its plain .xlsx/.xlsm bytes.
 * Throws WrongPasswordError when the password doesn't verify. */
export async function decryptOfficeFile(buffer: ArrayBuffer, password: string): Promise<ArrayBuffer> {
  const cfb = readCfb(new Uint8Array(buffer));
  const info = cfb && stream(cfb, "EncryptionInfo");
  const pkg = cfb && stream(cfb, "EncryptedPackage");
  if (!info || !pkg) throw new Error("This file is not a password-protected Excel workbook.");
  const major = info[0] | (info[1] << 8), minor = info[2] | (info[3] << 8);
  if (major !== 4 || minor !== 4) {
    throw new Error("This workbook uses an old Excel encryption format. Open it in Excel, save it without a password (or re-save it with a password in a current Excel), and import again.");
  }
  const xml = new TextDecoder().decode(info.subarray(8));
  const kd = attrs(xml, "keyData");
  const ek = attrs(xml, "p:encryptedKey");
  if (!ek.encryptedKeyValue) throw new Error("This workbook is protected with a certificate, not a password, and can't be opened here.");

  // Password → intermediate hash (salted, then iterated spinCount times).
  const alg = HASHES[(ek.hashAlgorithm || "SHA512").toUpperCase()] || "SHA-512";
  const pw = new Uint8Array(password.length * 2);
  for (let i = 0; i < password.length; i++) { const c = password.charCodeAt(i); pw[2 * i] = c & 0xff; pw[2 * i + 1] = c >> 8; }
  let h = await digest(alg, concat(b64(ek.saltValue), pw));
  const spin = Number(ek.spinCount) || 100000;
  const buf = new Uint8Array(4 + h.length);
  const view = new DataView(buf.buffer);
  // 100,000 awaited WebCrypto digests take ~5 s (each is a thread hop), so the
  // usual SHA-512 case runs the loop on a synchronous implementation (~0.2 s).
  for (let i = 0; i < spin; i++) {
    view.setUint32(0, i, true);
    buf.set(h, 4);
    h = alg === "SHA-512" ? sha512(buf) : await digest(alg, buf);
  }
  const keyLen = (Number(ek.keyBits) || 256) / 8;
  const keyFor = async (block: number[]) => fit(await digest(alg, concat(h, Uint8Array.from(block))), keyLen);
  const pwSalt = b64(ek.saltValue);
  const blockSize = Number(ek.blockSize) || 16;

  // Verify the password before touching the package.
  const verIn = await aesCbcRaw(await keyFor([0xfe, 0xa7, 0xd2, 0x76, 0x3b, 0x4b, 0x9e, 0x79]), pwSalt, b64(ek.encryptedVerifierHashInput));
  const verHash = await aesCbcRaw(await keyFor([0xd7, 0xaa, 0x0f, 0x6d, 0x30, 0x61, 0x34, 0x4e]), pwSalt, b64(ek.encryptedVerifierHashValue));
  const expect = await digest(alg, verIn.slice(0, Number(ek.saltSize) || 16));
  const hashSize = Number(ek.hashSize) || expect.length;
  for (let i = 0; i < hashSize; i++) if (expect[i] !== verHash[i]) throw new WrongPasswordError();

  const secret = (await aesCbcRaw(await keyFor([0x14, 0x6e, 0x0b, 0xe7, 0xab, 0xac, 0xd0, 0xd6]), pwSalt, b64(ek.encryptedKeyValue))).slice(0, keyLen);

  // EncryptedPackage = 8-byte plain size + 4096-byte segments, each with its
  // own IV = H(keyData salt ‖ segment index).
  const size = Number(new DataView(pkg.buffer, pkg.byteOffset, 8).getBigUint64(0, true));
  const dataAlg = HASHES[(kd.hashAlgorithm || "SHA512").toUpperCase()] || alg;
  const kdSalt = b64(kd.saltValue);
  const kdBlock = Number(kd.blockSize) || blockSize;
  const out = new Uint8Array(size);
  const SEG = 4096;
  for (let seg = 0, off = 8; off < pkg.length && seg * SEG < size; seg++, off += SEG) {
    const chunk = pkg.subarray(off, Math.min(off + SEG, pkg.length));
    const usable = chunk.subarray(0, chunk.length - (chunk.length % 16));
    if (!usable.length) break;
    const iv = fit(await digest(dataAlg, concat(kdSalt, le32(seg))), kdBlock);
    const plain = await aesCbcRaw(secret, iv, usable);
    out.set(plain.subarray(0, Math.min(plain.length, size - seg * SEG)), seg * SEG);
  }
  return out.buffer;
}
