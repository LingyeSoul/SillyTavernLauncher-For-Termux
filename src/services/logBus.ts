/**
 * 日志总线 — 环形缓冲 + 订阅广播。
 * CLI 场景把行直接打到 stdout；WEBUI 场景接到 SSE。
 * 灵感 ← 参考项目 terminalLogs store 的"引用恒定、版本号自增"性能契约。
 */
export interface LogLine {
  seq: number;
  time: string;
  source: string; // "st" | "task" | "webui" | ...
  text: string;
}

export class LogBus {
  private lines: LogLine[] = [];
  private subscribers = new Set<(line: LogLine) => void>();
  private seq = 0;
  private capacity: number;

  constructor(capacity = 5000) {
    this.capacity = capacity;
  }

  push(source: string, text: string): LogLine {
    const line: LogLine = { seq: ++this.seq, time: new Date().toISOString(), source, text };
    this.lines.push(line);
    if (this.lines.length > this.capacity) {
      this.lines.splice(0, this.lines.length - this.capacity);
    }
    for (const fn of this.subscribers) {
      try {
        fn(line);
      } catch {
        /* 订阅者异常不阻断 */
      }
    }
    return line;
  }

  /** seq 之后的行（用于断线补拉）。 */
  since(seq: number): LogLine[] {
    return this.lines.filter((l) => l.seq > seq);
  }

  subscribe(fn: (line: LogLine) => void): () => void {
    this.subscribers.add(fn);
    return () => this.subscribers.delete(fn);
  }
}

let bus: LogBus | null = null;

export function getLogBus(): LogBus {
  if (!bus) bus = new LogBus();
  return bus;
}
