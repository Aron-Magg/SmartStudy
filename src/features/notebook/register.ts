import { Notice, WorkspaceLeaf } from "obsidian";
import type SmartStudyPlugin from "../../main";
import { JupyterServerService } from "../../services/JupyterServerService";
import { KernelClient } from "../../services/KernelClient";
import { NOTEBOOK_VIEW_TYPE, NotebookView } from "./NotebookView";

export function registerNotebookFeature(plugin: SmartStudyPlugin): void {
  const servers = new JupyterServerService(
    plugin.venvService,
    () => plugin.settings.uvPath,
    plugin.settings.jupyterIdleTimeoutMinutes,
  );
  const kernels = new KernelClient();

  plugin.jupyterServers = servers;
  plugin.kernelClient = kernels;

  plugin.register(() => {
    servers.dispose();
    void kernels.dispose();
  });

  plugin.registerView(
    NOTEBOOK_VIEW_TYPE,
    (leaf: WorkspaceLeaf) =>
      new NotebookView(leaf, plugin, servers, kernels),
  );
  plugin.registerExtensions(["ipynb"], NOTEBOOK_VIEW_TYPE);

  plugin.addCommand({
    id: "smart-notebook-stop-all-servers",
    name: "Stop all Jupyter servers",
    callback: async () => {
      await servers.stopAll();
      new Notice("Stopped all Jupyter servers");
    },
  });

  plugin.addCommand({
    id: "smart-notebook-list-running-servers",
    name: "List running Jupyter servers",
    callback: () => {
      const running = servers.listRunning();
      if (running.length === 0) {
        new Notice("No Jupyter servers running");
        return;
      }
      const txt = running
        .map((r) => `${r.venvFolder} @ ${r.url}`)
        .join("\n");
      new Notice(txt, 8000);
    },
  });
}
