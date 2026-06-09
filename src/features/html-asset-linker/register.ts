import { Notice, TAbstractFile, TFile, TFolder } from "obsidian";
import type SmartStudyPlugin from "../../main";
import { HtmlAssetLinker } from "./HtmlAssetLinker";

export function registerHtmlAssetLinker(plugin: SmartStudyPlugin): void {
  const linker = new HtmlAssetLinker(plugin.app);
  plugin.htmlAssetLinker = linker;

  const reindexNear = (file: TAbstractFile) => {
    if (!shouldHandle(file)) return;
    void linker.indexNear(file).catch((e) => {
      console.error("[smart-study] html-asset-linker indexNear failed:", e);
    });
  };

  plugin.app.workspace.onLayoutReady(() => {
    void linker
      .indexVault()
      .then(({ created, updated }) => {
        if (created + updated > 0) {
          console.log(
            `[smart-study] html asset sidecars: ${created} created, ${updated} updated`,
          );
        }
      })
      .catch((e) => {
        console.error("[smart-study] html-asset-linker indexVault failed:", e);
      });
  });

  plugin.registerEvent(plugin.app.vault.on("create", reindexNear));
  plugin.registerEvent(plugin.app.vault.on("rename", reindexNear));
  plugin.registerEvent(
    plugin.app.vault.on("delete", (file) => {
      // If a tracked HTML is deleted, also drop its sidecar so the graph stays
      // clean. Asset-folder deletion just regenerates with an empty list.
      if (
        file instanceof TFile &&
        (file.extension === "html" || file.extension === "htm")
      ) {
        const sidecarPath = `${file.parent?.path ? file.parent.path + "/" : ""}${file.basename}.assets.md`;
        const sidecar = plugin.app.vault.getAbstractFileByPath(sidecarPath);
        if (sidecar instanceof TFile) void plugin.app.vault.delete(sidecar);
      }
      reindexNear(file);
    }),
  );

  plugin.addCommand({
    id: "smart-html-asset-link-rebuild",
    name: "Rebuild HTML asset sidecars",
    callback: async () => {
      const { created, updated, skipped } = await linker.indexVault();
      new Notice(
        `HTML asset sidecars — ${created} created, ${updated} updated, ${skipped} unchanged`,
      );
    },
  });
}

function shouldHandle(file: TAbstractFile): boolean {
  if (file instanceof TFile)
    return file.extension === "html" || file.extension === "htm";
  if (file instanceof TFolder) return file.name.endsWith("_files");
  return false;
}
