// Builds public/favicon.ico from public/icons/icon-192.png.
//
// Why a generator instead of a committed binary with no provenance: the readers
// and Safari fall back to /favicon.ico when a page declares no icon, and the
// platform served a 404 there. Rather than hand-copy a file nobody can trace,
// the ICO is rendered from the same 192px source the web manifest already uses,
// so the tab icon and the installed-app icon cannot drift apart.
//
// The ICO container is written directly: an icon directory followed by PNG
// payloads. Every target browser (Chrome 4+, Firefox 3.5+, Edge, Safari 12+)
// accepts PNG-compressed entries, so no BMP/AND-mask encoding is needed. This
// keeps the build free of an extra dependency such as png-to-ico.
import sharp from 'sharp';
import { readFile, writeFile } from 'node:fs/promises';

const SOURCE = new URL('../public/icons/icon-192.png', import.meta.url);
const TARGET = new URL('../public/favicon.ico', import.meta.url);
const SIZES = [16, 32, 48];

const source = await readFile(SOURCE);

const entries = [];
for (const size of SIZES) {
  // Nearest-neighbour for the small sizes: the mark is a letterform on a solid
  // field, so smoothing would only blur the stem at 16px.
  const png = await sharp(source).resize(size, size, { kernel: 'nearest' }).png({ compressionLevel: 9 }).toBuffer();
  entries.push({ size, png });
}

const HEADER_BYTES = 6;
const DIRECTORY_BYTES = 16;
const payloadOffset = HEADER_BYTES + DIRECTORY_BYTES * entries.length;

const header = Buffer.alloc(HEADER_BYTES);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: 1 = icon
header.writeUInt16LE(entries.length, 4);

const directory = Buffer.alloc(DIRECTORY_BYTES * entries.length);
let offset = payloadOffset;
entries.forEach((entry, index) => {
  const at = index * DIRECTORY_BYTES;
  // 256 is encoded as 0 in a single byte; none of our sizes need that, but the
  // guard keeps the field honest if SIZES ever grows.
  directory.writeUInt8(entry.size >= 256 ? 0 : entry.size, at + 0); // width
  directory.writeUInt8(entry.size >= 256 ? 0 : entry.size, at + 1); // height
  directory.writeUInt8(0, at + 2); // palette colour count
  directory.writeUInt8(0, at + 3); // reserved
  directory.writeUInt16LE(1, at + 4); // colour planes
  directory.writeUInt16LE(32, at + 6); // bits per pixel
  directory.writeUInt32LE(entry.png.length, at + 8); // payload size
  directory.writeUInt32LE(offset, at + 12); // payload offset
  offset += entry.png.length;
});

const ico = Buffer.concat([header, directory, ...entries.map(entry => entry.png)]);
await writeFile(TARGET, ico);

console.log(`Wrote public/favicon.ico (${ico.length} bytes): ${SIZES.join(', ')} px from icon-192.png`);
