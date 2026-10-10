/**
 * 进程运行时适配层 — 全项目所有 spawn 的唯一出口。
 * 纪律：数组参数（绝不 shell 拼接）、捕获超时、实时输出回调。
 * ← main_cli.py run_command_with_output / 各处 subprocess.run。
 */
import { spawn } from "node:child_process";

export interface RunResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
}

export interface LiveProcess {
  pid: number;
  exited: Promise<number>;
  kill(signal?: NodeJS.Signals): void;
}

export function run(
  cmd: string[],
  opts: { cwd?: string; timeoutMs?: number; onLine?: (line: string) => void } = {},
): Promise<RunResult> {
  return new Promise((resolvePromise) => {
    const child = spawn(cmd[0], cmd.slice(1), {
      cwd: opts.cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let lineBuf = "";
    let settled = false;

    const timer = opts.timeoutMs
      ? setTimeout(() => {
          try {
            child.kill("SIGKILL");
          } catch {
            /* already gone */
          }
        }, opts.timeoutMs)
      : null;

    child.stdout?.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      stdout += text;
      if (opts.onLine) {
        lineBuf += text;
        const lines = lineBuf.split("\n");
        lineBuf = lines.pop() ?? "";
        for (const line of lines) opts.onLine(line.replace(/\r$/, ""));
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolvePromise({ ok: false, code: null, stdout, stderr: String(err) });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (opts.onLine && lineBuf) opts.onLine(lineBuf.replace(/\r$/, ""));
      resolvePromise({ ok: code === 0, code, stdout, stderr });
    });
  });
}

/** 运行命令并实时回显到控制台（run_command_with_output 的对应物）。 */
export async function runWithEcho(
  cmd: string[],
  opts: { cwd?: string; timeoutMs?: number; onLine?: (line: string) => void } = {},
): Promise<boolean> {
  const echo = (line: string) => {
    process.stdout.write(line + "\n");
    opts.onLine?.(line);
  };
  process.stdout.write(`执行命令: ${cmd.join(" ")}\n`);
  if (opts.cwd) process.stdout.write(`工作目录: ${opts.cwd}\n`);
  const result = await run(cmd, { ...opts, onLine: echo });
  return result.ok;
}

/** spawn 长驻进程（ST 服务器等），stdout/stderr 逐行回调。 */
export function spawnLive(
  cmd: string[],
  opts: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    onLine?: (line: string, stream: "out" | "err") => void;
    onClose?: (code: number | null) => void;
  } = {},
): LiveProcess {
  const child = spawn(cmd[0], cmd.slice(1), {
    cwd: opts.cwd,
    env: opts.env ? { ...process.env, ...opts.env } : process.env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exited = new Promise<number>((resolveExit) => {
    child.on("close", (code) => {
      opts.onClose?.(code);
      resolveExit(code ?? -1);
    });
    child.on("error", () => {
      opts.onClose?.(null);
      resolveExit(-1);
    });
  });
  const wire = (stream: NodeJS.ReadableStream | null, tag: "out" | "err") => {
    if (!stream) return;
    let buf = "";
    stream.on("data", (chunk: Buffer) => {
      buf += chunk.toString();
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) opts.onLine?.(line.replace(/\r$/, ""), tag);
    });
    stream.on("end", () => {
      if (buf) opts.onLine?.(buf.replace(/\r$/, ""), tag);
    });
  };
  wire(child.stdout, "out");
  wire(child.stderr, "err");
  return {
    pid: child.pid ?? -1,
    exited,
    kill(signal: NodeJS.Signals = "SIGTERM") {
      try {
        child.kill(signal);
      } catch {
        /* already gone */
      }
    },
  };
}
