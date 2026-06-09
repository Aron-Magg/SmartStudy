import type { KernelHandle } from "../../services/KernelClient";
import type { CellOutput } from "./types";

interface QueueItem {
  code: string;
  onOutput: (out: CellOutput) => void;
  onDone: (executionCount: number | null, ok: boolean) => void;
  onError: (err: Error) => void;
}

export class ExecBus {
  private queue: QueueItem[] = [];
  private running = false;
  private kernel: KernelHandle | null = null;

  setKernel(kernel: KernelHandle | null): void {
    this.kernel = kernel;
  }

  hasKernel(): boolean {
    return this.kernel !== null;
  }

  enqueue(item: QueueItem): void {
    this.queue.push(item);
    void this.pump();
  }

  async interrupt(): Promise<void> {
    if (this.kernel) await this.kernel.interrupt();
  }

  async restart(): Promise<void> {
    if (this.kernel) await this.kernel.restart();
  }

  clearQueue(): void {
    this.queue = [];
  }

  private async pump(): Promise<void> {
    if (this.running) return;
    if (!this.kernel) return;
    this.running = true;
    try {
      while (this.queue.length > 0) {
        const item = this.queue.shift()!;
        try {
          const outputs: CellOutput[] = [];
          const reply = await this.kernel.execute(item.code, {
            onOutput: (o) => {
              const converted = convertOutput(o);
              if (converted) {
                outputs.push(converted);
                item.onOutput(converted);
              }
            },
          });
          const ok = reply.content.status === "ok";
          item.onDone(reply.content.execution_count ?? null, ok);
        } catch (e) {
          item.onError(e instanceof Error ? e : new Error(String(e)));
        }
      }
    } finally {
      this.running = false;
    }
  }
}

function convertOutput(
  o: import("../../services/KernelClient").CellOutput,
): CellOutput | null {
  if (o.type === "stream") {
    return {
      output_type: "stream",
      name: o.stream ?? "stdout",
      text: o.text ?? "",
    };
  }
  if (o.type === "display_data" || o.type === "execute_result") {
    return {
      output_type: o.type === "display_data" ? "display_data" : "execute_result",
      data: (o.data ?? {}) as Record<string, string | string[]>,
    };
  }
  if (o.type === "error") {
    return {
      output_type: "error",
      ename: o.ename ?? "Error",
      evalue: o.evalue ?? "",
      traceback: o.traceback ?? [],
    };
  }
  return null;
}
