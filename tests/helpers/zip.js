// A tiny ZIP writer for crafting hostile test archives (symlink entries, odd paths, lying sizes, comments) that no
// archiver would make on purpose. Stored entries only; Unix "made by", so the high 16 bits of the external attributes
// are the Unix mode (what Info-ZIP writes for symlinks: 0o120777, the link target as the data).
import { crc32 } from 'node:zlib';

const S_IFREG = 0o100644, S_IFDIR = 0o040755, S_IFLNK = 0o120777;
export const MODE = { file: S_IFREG, dir: S_IFDIR, link: S_IFLNK };

/**
 * @param {{name: string, data?: string | Uint8Array, mode?: number, size?: number}[]} entries
 *   size: the uncompressed size the headers claim (defaults to the data length)
 * @param {string} [comment]  archive comment
 * @returns {Buffer}
 */
export function zip(entries, comment = '') {
  const locals = [], centrals = [];
  let offset = 0;
  for (const { name, data = '', mode = name.endsWith('/') ? S_IFDIR : S_IFREG, size } of entries) {
    const bytes = Buffer.from(data), nameBytes = Buffer.from(name, 'utf8');
    const local = Buffer.alloc(30), central = Buffer.alloc(46);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(10, 4); // version needed
    local.writeUInt16LE(0x800, 6); // UTF-8 names
    local.writeUInt32LE(crc32(bytes), 14);
    local.writeUInt32LE(bytes.length, 18);
    local.writeUInt32LE(size ?? bytes.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4); // made by Unix
    central.writeUInt16LE(10, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt32LE(crc32(bytes), 16);
    central.writeUInt32LE(bytes.length, 20);
    central.writeUInt32LE(size ?? bytes.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(((mode << 16) | (mode >> 12 === 0o04 ? 0x10 : 0)) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, bytes);
    centrals.push(central, nameBytes);
    offset += local.length + nameBytes.length + bytes.length;
  }
  const directory = Buffer.concat(centrals), commentBytes = Buffer.from(comment, 'utf8');
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(commentBytes.length, 20);
  return Buffer.concat([...locals, directory, end, commentBytes]);
}
