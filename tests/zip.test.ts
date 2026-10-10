/** ZIP 安全层测试 — 自实现写入/解析的往返 + 对抗性输入拒绝。 */
import { afterAll, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { buildZipBuffer, extractZipEntry, parseZipCentralDirectory, validateZipEntries } from "../src/services/sync/zip.ts";
import { SyncSecurityError } from "../src/services/sync/common.ts";
import { craftZip, cleanupDataDirs, makeDataDir } from "./helpers.ts";

afterAll(cleanupDataDirs);

async function writeArchive(buffer: Buffer): Promise<string> {
  const filePath = path.join(makeDataDir(), "archive.zip");
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

describe("ZIP 构建与解析往返", () => {
  it("多文件 + 中文文件名 + 空文件往返一致", async () => {
    const dir = makeDataDir();
    const a = path.join(dir, "a.txt");
    const b = path.join(dir, "中文 目录", "b.json");
    fs.writeFileSync(a, "hello zip");
    fs.mkdirSync(path.dirname(b), { recursive: true });
    fs.writeFileSync(b, JSON.stringify({ ok: true }));
    const empty = path.join(dir, "empty.bin");
    fs.writeFileSync(empty, "");

    const buffer = await buildZipBuffer([
      { path: a, name: "a.txt" },
      { path: b, name: "中文 目录/b.json" },
      { path: empty, name: "empty.bin" },
    ]);

    const archive = await writeArchive(buffer);
    const entries = validateZipEntries(await parseZipCentralDirectory(archive, buffer.length));
    expect([...entries.keys()].sort()).toEqual(["a.txt", "empty.bin", "中文 目录/b.json"].sort());

    const outDir = makeDataDir();
    for (const [name, entry] of entries) {
      const target = path.join(outDir, ...name.split("/"));
      fs.mkdirSync(path.dirname(target), { recursive: true });
      await extractZipEntry(archive, entry, target);
    }
    expect(fs.readFileSync(path.join(outDir, "a.txt"), "utf-8")).toBe("hello zip");
    expect(JSON.parse(fs.readFileSync(path.join(outDir, "中文 目录", "b.json"), "utf-8"))).toEqual({ ok: true });
    expect(fs.statSync(path.join(outDir, "empty.bin")).size).toBe(0);
  });

  it("空文件列表生成合法空 ZIP", async () => {
    const buffer = await buildZipBuffer([]);
    const archive = await writeArchive(buffer);
    const entries = validateZipEntries(await parseZipCentralDirectory(archive, buffer.length));
    expect(entries.size).toBe(0);
  });

  it("大文件往返（1MB 随机数据）", async () => {
    const dir = makeDataDir();
    const big = path.join(dir, "big.bin");
    const data = Buffer.alloc(1024 * 1024);
    for (let i = 0; i < data.length; i += 4096) data.writeUInt32LE(i, i);
    fs.writeFileSync(big, data);

    const buffer = await buildZipBuffer([{ path: big, name: "big.bin" }]);
    const archive = await writeArchive(buffer);
    const entries = validateZipEntries(await parseZipCentralDirectory(archive, buffer.length));
    const target = path.join(dir, "out.bin");
    await extractZipEntry(archive, entries.get("big.bin")!, target);
    expect(fs.statSync(target).size).toBe(data.length);
  });
});

describe("对抗性 ZIP 拒绝", () => {
  async function expectRejected(entries: { name: string; data?: Buffer; flagBits?: number; unixMode?: number }[], match: RegExp) {
    const archive = await writeArchive(craftZip(entries));
    const parsed = await parseZipCentralDirectory(archive, fs.statSync(archive).size);
    expect(() => validateZipEntries(parsed)).toThrow(match);
  }

  it("拒绝路径穿越", () => expectRejected([{ name: "../outside.txt", data: Buffer.from("x") }], /越过|无效/));
  it("拒绝绝对路径", () => expectRejected([{ name: "/etc/passwd" }], /越过|无效/));
  it("拒绝反斜杠", () => expectRejected([{ name: "a\\b.txt" }], /无效/));
  it("拒绝驱动器号", () => expectRejected([{ name: "c:/evil.txt" }], /越过/));
  it("拒绝重复路径", () =>
    expectRejected(
      [
        { name: "a.txt", data: Buffer.from("1") },
        { name: "a.txt", data: Buffer.from("2") },
      ],
      /重复/,
    ));
  it("拒绝文件与目录冲突", () =>
    expectRejected(
      [
        { name: "a", data: Buffer.from("file") },
        { name: "a/child.txt", data: Buffer.from("child") },
      ],
      /冲突/,
    ));
  it("拒绝加密条目", () =>
    expectRejected([{ name: "a.txt", data: Buffer.from("x"), flagBits: 0x1 }], /加密/));
  it("拒绝符号链接条目", () =>
    expectRejected([{ name: "link.txt", data: Buffer.from("/etc/passwd"), unixMode: 0o120777 }], /符号链接/));

  it("拒绝声明大小与内容不一致的条目", async () => {
    // 构造 CD 声明 8 字节但实际内容只有 4 字节：直接改 craftZip 结果
    const buffer = craftZip([{ name: "a.txt", data: Buffer.from("abcd") }]);
    // CD 条目中 uncompressedSize 位于 CDH+24；找到 CD 起始并改写
    const cdOffset = buffer.readUInt32LE(buffer.length - 22 + 16);
    buffer.writeUInt32LE(8, cdOffset + 24);
    const archive = await writeArchive(buffer);
    const parsed = await parseZipCentralDirectory(archive, buffer.length);
    const validated = validateZipEntries(parsed);
    const target = path.join(makeDataDir(), "a.txt");
    await expect(extractZipEntry(archive, validated.get("a.txt")!, target)).rejects.toThrow(SyncSecurityError);
  });

  it("非 ZIP 内容被拒绝", async () => {
    const garbage = Buffer.from("this is not a zip file at all, really not a zip..........");
    const archive = await writeArchive(garbage);
    await expect(parseZipCentralDirectory(archive, garbage.length)).rejects.toThrow(/不是有效 ZIP/);
  });
});
