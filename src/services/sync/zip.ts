/**
 * ZIP 安全层 — 自实现的流式写入 + 中心目录解析 + 逐条目校验解压。
 * ← Python zipfile 对应物。不引入第三方库：deflate 用 node:zlib，CRC 用 zlib.crc32。
 *
 * 安全约束（与 Python 版逐条对齐）：
 *   - 条目数 ≤ MAX_SYNC_ZIP_FILES，解压后总量 ≤ MAX_SYNC_ZIP_SIZE
 *   - 拒绝：加密条目(flag bit0)、符号链接(unix mode)、重复路径、
 *          绝对路径 / ".." / 反斜杠 / 驱动器号、文件与目录路径冲突
 *   - 解压时逐条目限制写出字节数 == 声明大小，CRC 校验
 *   - 单文件压缩输出超过 MAX_ENTRY_BUFFER 时中止（防止内存爆掉手机）
 */
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { once } from "node:events";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import * as zlib from "node:zlib";
import { MAX_SYNC_ZIP_FILES, MAX_SYNC_ZIP_SIZE, SyncSecurityError } from "./common.ts";

const LFH_SIG = 0x04034b50;
const CDH_SIG = 0x02014b50;
const EOCD_SIG = 0x06054b50;
const CHUNK = 1 << 16;
/** 单条目压缩输出的内存上限（写入侧逐文件缓冲）。 */
const MAX_ENTRY_BUFFER = 512 * 1024 * 1024;

export interface ZipEntry {
  name: string;
  crc32: number;
  compressedSize: number;
  uncompressedSize: number;
  method: number; // 0=stored 8=deflate
  flagBits: number;
  isDir: boolean;
  unixMode: number; // external_attr >> 16
  localHeaderOffset: number;
}

function dosDateTime(d: Date): { time: number; date: number } {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = (((d.getFullYear() - 1980) & 0x7f) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time: Math.max(0, time), date: Math.max(0, date) };
}

/** 读取一个文件并 deflate，返回压缩块序列与 CRC；逐块读取源文件控制内存。 */
async function deflateFile(
  path: string,
): Promise<{ chunks: Buffer[]; compressedSize: number; crc: number }> {
  const def = zlib.createDeflateRaw({ level: 6 });
  const chunks: Buffer[] = [];
  let compressedSize = 0;
  let crc = 0;
  def.on("data", (c: Buffer) => {
    compressedSize += c.length;
    if (compressedSize > MAX_ENTRY_BUFFER) {
      def.destroy(new SyncSecurityError(`单文件压缩输出超过限制: ${path}`));
      return;
    }
    chunks.push(c);
  });
  const ended = once(def, "end").catch((e) => {
    throw e;
  });
  const fd = await fsp.open(path, "r");
  try {
    const buf = Buffer.alloc(CHUNK);
    let pos = 0;
    for (;;) {
      const { bytesRead } = await fd.read(buf, 0, CHUNK, pos);
      if (!bytesRead) break;
      const chunk = buf.subarray(0, bytesRead);
      crc = zlib.crc32(chunk, crc);
      if (!def.write(chunk)) await once(def, "drain");
      pos += bytesRead;
    }
    def.end();
    await ended;
  } finally {
    await fd.close();
  }
  return { chunks, compressedSize, crc };
}

function localHeader(nameBuf: Buffer, crc: number, compressedSize: number, uncompressedSize: number, when: { time: number; date: number }): Buffer {
  const h = Buffer.alloc(30);
  h.writeUInt32LE(LFH_SIG, 0);
  h.writeUInt16LE(20, 4);
  h.writeUInt16LE(0x0800, 6); // UTF-8 名称
  h.writeUInt16LE(8, 8); // deflate
  h.writeUInt16LE(when.time, 10);
  h.writeUInt16LE(when.date, 12);
  h.writeUInt32LE(crc >>> 0, 14);
  h.writeUInt32LE(compressedSize, 18);
  h.writeUInt32LE(uncompressedSize, 22);
  h.writeUInt16LE(nameBuf.length, 26);
  h.writeUInt16LE(0, 28);
  return Buffer.concat([h, nameBuf]);
}

function centralHeader(
  nameBuf: Buffer,
  crc: number,
  compressedSize: number,
  uncompressedSize: number,
  unixMode: number,
  lhOffset: number,
  when: { time: number; date: number },
): Buffer {
  const h = Buffer.alloc(46);
  h.writeUInt32LE(CDH_SIG, 0);
  h.writeUInt16LE(20, 4); // version made by
  h.writeUInt16LE(20, 6); // version needed
  h.writeUInt16LE(0x0800, 8);
  h.writeUInt16LE(8, 10);
  h.writeUInt16LE(when.time, 12);
  h.writeUInt16LE(when.date, 14);
  h.writeUInt32LE(crc >>> 0, 16);
  h.writeUInt32LE(compressedSize, 20);
  h.writeUInt32LE(uncompressedSize, 24);
  h.writeUInt16LE(nameBuf.length, 28);
  h.writeUInt16LE(0, 30);
  h.writeUInt16LE(0, 32);
  h.writeUInt16LE(0, 34);
  h.writeUInt16LE(0, 36);
  h.writeUInt32LE(((unixMode & 0xffff) << 16) >>> 0, 38);
  h.writeUInt32LE(lhOffset, 42);
  return Buffer.concat([h, nameBuf]);
}

/**
 * 把文件列表打包为 ZIP 字节流（async generator，逐块产出，常量级内存）。
 * 文件按给定顺序写入；目录条目不生成（解压端按需 mkdir）。
 */
export async function* buildZip(
  files: { path: string; name: string }[],
): AsyncGenerator<Buffer, void, unknown> {
  const central: Buffer[] = [];
  let offset = 0;
  let count = 0;

  for (const file of files) {
    const stat = await fsp.stat(file.path);
    const nameBuf = Buffer.from(file.name, "utf-8");
    const when = dosDateTime(stat.mtime);
    const { chunks, compressedSize, crc } = await deflateFile(file.path);
    const lh = localHeader(nameBuf, crc, compressedSize, stat.size, when);
    yield lh;
    for (const c of chunks) yield c;
    central.push(
      centralHeader(nameBuf, crc, compressedSize, stat.size, stat.mode & 0xffff, offset, when),
    );
    offset += lh.length + compressedSize;
    count += 1;
  }

  const cdOffset = offset;
  const cdSize = central.reduce((sum, b) => sum + b.length, 0);
  for (const b of central) yield b;

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(EOCD_SIG, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(count, 8);
  eocd.writeUInt16LE(count, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  eocd.writeUInt16LE(0, 20);
  yield eocd;
}

/** 收集 buildZip 输出为单个 Buffer（测试 / 小数据用）。 */
export async function buildZipBuffer(files: { path: string; name: string }[]): Promise<Buffer> {
  const parts: Buffer[] = [];
  for await (const chunk of buildZip(files)) parts.push(chunk);
  return Buffer.concat(parts);
}

async function readAt(fd: FileHandle, position: number, length: number): Promise<Buffer> {
  const buf = Buffer.alloc(length);
  let total = 0;
  while (total < length) {
    const { bytesRead } = await fd.read(buf, total, length - total, position + total);
    if (!bytesRead) break;
    total += bytesRead;
  }
  if (total !== length) throw new SyncSecurityError("ZIP 文件被截断");
  return buf;
}

/**
 * 解析 ZIP 中心目录并执行全部安全校验；返回规范化条目（已去重、已拒绝对抗性输入）。
 * 解析失败 / 越界 / zip64 一律抛 SyncSecurityError。
 */
export async function parseZipCentralDirectory(zipPath: string, fileSize: number): Promise<ZipEntry[]> {
  const fd = await fsp.open(zipPath, "r");
  try {
    if (fileSize < 22) throw new SyncSecurityError("同步服务器返回的内容不是有效 ZIP");
    const tailSize = Math.min(fileSize, 22 + 65557);
    const tail = await readAt(fd, fileSize - tailSize, tailSize);

    let eocd = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === EOCD_SIG) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new SyncSecurityError("同步服务器返回的内容不是有效 ZIP");
    const count = tail.readUInt16LE(eocd + 10);
    const cdSize = tail.readUInt32LE(eocd + 12);
    const cdOffset = tail.readUInt32LE(eocd + 16);
    if (cdOffset + cdSize > fileSize - (tail.length - eocd - 22)) {
      throw new SyncSecurityError("ZIP 中心目录越界");
    }

    const cd = await readAt(fd, cdOffset, cdSize);
    const entries: ZipEntry[] = [];
    let pos = 0;
    for (let i = 0; i < count; i++) {
      if (pos + 46 > cd.length || cd.readUInt32LE(pos) !== CDH_SIG) {
        throw new SyncSecurityError("ZIP 中心目录损坏");
      }
      const flagBits = cd.readUInt16LE(pos + 8);
      const method = cd.readUInt16LE(pos + 10);
      const crc = cd.readUInt32LE(pos + 16);
      const compressedSize = cd.readUInt32LE(pos + 20);
      const uncompressedSize = cd.readUInt32LE(pos + 24);
      const nameLen = cd.readUInt16LE(pos + 28);
      const extraLen = cd.readUInt16LE(pos + 30);
      const commentLen = cd.readUInt16LE(pos + 32);
      const externalAttrs = cd.readUInt32LE(pos + 38);
      const lhOffset = cd.readUInt32LE(pos + 42);
      if (pos + 46 + nameLen + extraLen + commentLen > cd.length) {
        throw new SyncSecurityError("ZIP 中心目录损坏");
      }
      const name = cd.subarray(pos + 46, pos + 46 + nameLen).toString("utf-8");
      pos += 46 + nameLen + extraLen + commentLen;

      if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || lhOffset === 0xffffffff) {
        throw new SyncSecurityError("ZIP 不支持 zip64 条目");
      }
      entries.push({
        name,
        crc32: crc,
        compressedSize,
        uncompressedSize,
        method,
        flagBits,
        isDir: name.endsWith("/"),
        unixMode: (externalAttrs >>> 16) & 0xffff,
        localHeaderOffset: lhOffset,
      });
    }
    return entries;
  } finally {
    await fd.close();
  }
}

/** 对解析出的条目执行对抗性输入校验（Python _validated_zip_members 的对应物）。 */
export function validateZipEntries(entries: ZipEntry[]): Map<string, ZipEntry> {
  if (entries.length > MAX_SYNC_ZIP_FILES) throw new SyncSecurityError("ZIP 文件数量超过限制");
  if (entries.reduce((sum, e) => sum + e.uncompressedSize, 0) > MAX_SYNC_ZIP_SIZE) {
    throw new SyncSecurityError("ZIP 解压后大小超过限制");
  }

  const normalized = new Map<string, ZipEntry>();
  const files = new Set<string>();
  for (const entry of entries) {
    const name = entry.name;
    if (!name || name.includes("\0") || name.includes("\\")) {
      throw new SyncSecurityError("ZIP 包含无效路径");
    }
    const parts = name.replace(/\/+$/, "").split("/");
    if (
      parts.length === 0 ||
      name.startsWith("/") ||
      parts.includes("..") ||
      parts.includes("") ||
      /^[A-Za-z]:$/.test(parts[0])
    ) {
      throw new SyncSecurityError("ZIP 路径越过数据目录");
    }
    const path = parts.join("/");
    if (normalized.has(path)) throw new SyncSecurityError("ZIP 包含重复路径");

    const modeType = entry.unixMode & 0o170000;
    if (modeType !== 0 && modeType === 0o120000) {
      throw new SyncSecurityError("ZIP 不允许包含符号链接");
    }
    if (entry.flagBits & 0x1) throw new SyncSecurityError("ZIP 不允许包含加密文件");
    if (entry.method !== 0 && entry.method !== 8) {
      throw new SyncSecurityError("ZIP 包含不支持的压缩方法");
    }

    if (!entry.isDir) files.add(path);
    normalized.set(path, entry);
  }
  // 文件与目录冲突：任一条目的祖先前缀若是文件即冲突（O(n·深度)）。
  for (const path of normalized.keys()) {
    const parts = path.split("/");
    for (let i = 1; i < parts.length; i++) {
      if (files.has(parts.slice(0, i).join("/"))) {
        throw new SyncSecurityError("ZIP 文件与目录路径冲突");
      }
    }
  }
  return normalized;
}

/** 校验后的单条目解压：写出到 targetPath（独占创建），强制大小与 CRC 一致。 */
export async function extractZipEntry(
  zipPath: string,
  entry: ZipEntry,
  targetPath: string,
  onMkdir?: (dir: string) => void,
): Promise<void> {
  if (entry.isDir) {
    fs.mkdirSync(targetPath, { recursive: true });
    onMkdir?.(targetPath);
    return;
  }
  const fd = await fsp.open(zipPath, "r");
  try {
    const lh = await readAt(fd, entry.localHeaderOffset, 30);
    if (lh.readUInt32LE(0) !== LFH_SIG) throw new SyncSecurityError("ZIP 本地头损坏");
    const dataStart = entry.localHeaderOffset + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28);

    let written = 0;
    let crc = 0;
    const guard = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        written += chunk.length;
        crc = zlib.crc32(chunk, crc);
        if (written > entry.uncompressedSize) {
          cb(new SyncSecurityError("ZIP 文件大小与声明不一致"));
          return;
        }
        cb(null, chunk);
      },
    });

    async function* compressed(): AsyncGenerator<Buffer> {
      let pos = 0;
      const buf = Buffer.alloc(CHUNK);
      while (pos < entry.compressedSize) {
        const want = Math.min(CHUNK, entry.compressedSize - pos);
        const { bytesRead } = await fd.read(buf, 0, want, dataStart + pos);
        if (!bytesRead) throw new SyncSecurityError("ZIP 文件被截断");
        pos += bytesRead;
        yield buf.subarray(0, bytesRead);
      }
    }

    const source = Readable.from(compressed());
    const output = fs.createWriteStream(targetPath, { flags: "wx" });
    if (entry.method === 8) {
      await pipeline(source, zlib.createInflateRaw(), guard, output);
    } else {
      await pipeline(source, guard, output);
    }
    if (written !== entry.uncompressedSize) throw new SyncSecurityError("ZIP 文件大小与声明不一致");
    if ((crc >>> 0) !== (entry.crc32 >>> 0)) throw new SyncSecurityError("ZIP 文件 CRC 校验失败");
  } finally {
    await fd.close();
  }
}
