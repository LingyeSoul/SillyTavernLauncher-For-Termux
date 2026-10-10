/** 测试辅助：临时 baseDir、真实 HTTP 服务器、手工构造 ZIP 字节。 */
import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";
import * as zlib from "node:zlib";
import { setBaseDir } from "../src/services/paths.ts";
import { resetConfigStore } from "../src/services/configStore.ts";

export const TOKEN = "test-secret-token";

const dataDirs: string[] = [];

/** 独立临时数据目录（不依赖 baseDir），afterAll 统一清理。 */
export function makeDataDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stl-test-"));
  dataDirs.push(dir);
  return dir;
}

export function cleanupDataDirs(): void {
  for (const dir of dataDirs) fs.rmSync(dir, { recursive: true, force: true });
  dataDirs.length = 0;
}

export function authHeader(token: string = TOKEN): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

export function useTempBaseDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stl-test-"));
  setBaseDir(dir);
  resetConfigStore();
  return dir;
}

export function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const probe = http.createServer();
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address() as { port: number };
      probe.close(() => resolve(address.port));
    });
  });
}

export async function withServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void,
): Promise<{ port: number; close: () => Promise<void> }> {
  const port = await freePort();
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  return {
    port,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export function get(port: number, pathName: string, headers: Record<string, string> = {}): Promise<{ status: number; text: string; buffer: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: "127.0.0.1", port, path: pathName, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf-8"), buffer: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
  });
}

/** 手工构造 stored/deflate 混合 ZIP 字节（允许任意对抗性条目名/标志/属性）。 */
export function craftZip(
  entries: { name: string; data?: Buffer; flagBits?: number; unixMode?: number; isDir?: boolean }[],
): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, "utf-8");
    const data = entry.data ?? Buffer.alloc(0);
    const deflated = zlib.deflateRawSync(data);
    const useDeflate = data.length > 0;
    const payload = useDeflate ? deflated : data;
    const crc = zlib.crc32(data) >>> 0;

    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(entry.flagBits ?? 0, 6);
    lh.writeUInt16LE(useDeflate ? 8 : 0, 8);
    lh.writeUInt16LE(0, 10);
    lh.writeUInt16LE(0x21, 12);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(payload.length, 18);
    lh.writeUInt32LE(data.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);
    localParts.push(lh, nameBuf, payload);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(entry.flagBits ?? 0, 8);
    ch.writeUInt16LE(useDeflate ? 8 : 0, 10);
    ch.writeUInt16LE(0, 12);
    ch.writeUInt16LE(0x21, 14);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(payload.length, 20);
    ch.writeUInt32LE(data.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt16LE(0, 30);
    ch.writeUInt16LE(0, 32);
    ch.writeUInt16LE(0, 34);
    ch.writeUInt16LE(0, 36);
    ch.writeUInt32LE((((entry.unixMode ?? 0) & 0xffff) << 16) >>> 0, 38);
    ch.writeUInt32LE(offset, 42);
    centralParts.push(ch, nameBuf);

    offset += 30 + nameBuf.length + payload.length;
  }

  const cdOffset = offset;
  const cdSize = centralParts.reduce((sum, b) => sum + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  return Buffer.concat([...localParts, ...centralParts, eocd]);
}

export function trySymlink(target: string, link: string, type: "file" | "dir"): boolean {
  try {
    fs.symlinkSync(target, link, type);
    return true;
  } catch {
    return false;
  }
}
