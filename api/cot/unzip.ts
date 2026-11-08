/**
 * Minimal read-only ZIP extractor for the CFTC annual archives.
 *
 * The archives are classic single-entry (or few-entry) deflate ZIPs, so
 * rather than pulling a zip dependency into the server bundle this reads the
 * central directory directly and inflates with Node's built-in zlib.
 */
import { inflateRawSync } from "node:zlib";

const EOCD_SIG = 0x06054b50;
const CENTRAL_SIG = 0x02014b50;
const LOCAL_SIG = 0x04034b50;

export function extractZipText(buf: Buffer, wantedSuffix: string): string {
  // Locate the End Of Central Directory record in the trailing bytes.
  const scanStart = Math.max(0, buf.length - 65536 - 22);
  let eocd = -1;
  for (let i = buf.length - 22; i >= scanStart; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("ZIP: end of central directory not found");

  const entryCount = buf.readUInt16LE(eocd + 10);
  const centralOffset = buf.readUInt32LE(eocd + 16);

  let ptr = centralOffset;
  for (let n = 0; n < entryCount; n++) {
    if (buf.readUInt32LE(ptr) !== CENTRAL_SIG) throw new Error("ZIP: bad central directory entry");
    const method = buf.readUInt16LE(ptr + 10);
    const compressedSize = buf.readUInt32LE(ptr + 20);
    const nameLen = buf.readUInt16LE(ptr + 28);
    const extraLen = buf.readUInt16LE(ptr + 30);
    const commentLen = buf.readUInt16LE(ptr + 32);
    const localOffset = buf.readUInt32LE(ptr + 42);
    const name = buf.subarray(ptr + 46, ptr + 46 + nameLen).toString("utf-8");
    ptr += 46 + nameLen + extraLen + commentLen;
    if (!name.toLowerCase().endsWith(wantedSuffix)) continue;

    if (buf.readUInt32LE(localOffset) !== LOCAL_SIG) throw new Error("ZIP: bad local header");
    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(dataStart, dataStart + compressedSize);
    const inflated =
      method === 8 ? inflateRawSync(raw) : method === 0 ? raw : null;
    if (inflated === null) throw new Error(`ZIP: unsupported compression method ${method}`);
    return new TextDecoder("latin1").decode(inflated);
  }
  throw new Error(`ZIP: no entry ending in "${wantedSuffix}"`);
}
