import {
  KernelManager,
  ServerConnection,
  type Kernel,
  type KernelMessage,
} from "@jupyterlab/services";
import type { JupyterServerInfo } from "./JupyterServerService";

export interface CellOutput {
  type: "stream" | "display_data" | "execute_result" | "error";
  data?: Record<string, string>;
  text?: string;
  ename?: string;
  evalue?: string;
  traceback?: string[];
  stream?: "stdout" | "stderr";
}

export interface ExecuteCallbacks {
  onOutput?: (output: CellOutput) => void;
  onStatus?: (status: Kernel.Status) => void;
  onExecuteReply?: (msg: KernelMessage.IExecuteReplyMsg) => void;
}

export interface KernelHandle {
  id: string;
  kernel: Kernel.IKernelConnection;
  execute(code: string, cb?: ExecuteCallbacks): Promise<KernelMessage.IExecuteReplyMsg>;
  interrupt(): Promise<void>;
  restart(): Promise<void>;
  shutdown(): Promise<void>;
}

export class KernelClient {
  private managers = new Map<string, KernelManager>();

  async startKernel(
    info: JupyterServerInfo,
    kernelName = "python3",
  ): Promise<KernelHandle> {
    const manager = this.getManager(info);
    await manager.ready;
    const kernel = await manager.startNew({ name: kernelName });
    await kernel.info;
    return this.wrap(kernel);
  }

  private getManager(info: JupyterServerInfo): KernelManager {
    const key = `${info.url}|${info.token}`;
    const existing = this.managers.get(key);
    if (existing) return existing;
    const settings = ServerConnection.makeSettings({
      baseUrl: info.url,
      wsUrl: info.url.replace(/^http/, "ws"),
      token: info.token,
      appendToken: true,
    });
    const manager = new KernelManager({ serverSettings: settings });
    this.managers.set(key, manager);
    return manager;
  }

  private wrap(kernel: Kernel.IKernelConnection): KernelHandle {
    const handle: KernelHandle = {
      id: kernel.id,
      kernel,
      execute: (code, cb) => runExecute(kernel, code, cb),
      interrupt: () => kernel.interrupt(),
      restart: () => kernel.restart(),
      shutdown: () => kernel.shutdown(),
    };
    return handle;
  }

  async dispose(): Promise<void> {
    for (const manager of this.managers.values()) {
      try {
        manager.dispose();
      } catch {
        /* ignore */
      }
    }
    this.managers.clear();
  }
}

async function runExecute(
  kernel: Kernel.IKernelConnection,
  code: string,
  cb?: ExecuteCallbacks,
): Promise<KernelMessage.IExecuteReplyMsg> {
  const future = kernel.requestExecute({
    code,
    stop_on_error: false,
    allow_stdin: false,
    silent: false,
    store_history: true,
  });

  if (cb?.onStatus) {
    const handler = () => cb.onStatus?.(kernel.status);
    kernel.statusChanged.connect(handler);
    future.done.finally(() => kernel.statusChanged.disconnect(handler));
  }

  future.onIOPub = (msg) => {
    const t = msg.header.msg_type;
    if (t === "stream") {
      const c = msg.content as KernelMessage.IStreamMsg["content"];
      cb?.onOutput?.({ type: "stream", stream: c.name, text: c.text });
    } else if (t === "display_data") {
      const c = msg.content as KernelMessage.IDisplayDataMsg["content"];
      cb?.onOutput?.({
        type: "display_data",
        data: c.data as Record<string, string>,
      });
    } else if (t === "execute_result") {
      const c = msg.content as KernelMessage.IExecuteResultMsg["content"];
      cb?.onOutput?.({
        type: "execute_result",
        data: c.data as Record<string, string>,
      });
    } else if (t === "error") {
      const c = msg.content as KernelMessage.IErrorMsg["content"];
      cb?.onOutput?.({
        type: "error",
        ename: c.ename,
        evalue: c.evalue,
        traceback: c.traceback,
      });
    }
  };

  const reply = (await future.done) as KernelMessage.IExecuteReplyMsg;
  cb?.onExecuteReply?.(reply);
  return reply;
}
