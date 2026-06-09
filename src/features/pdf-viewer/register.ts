import { WorkspaceLeaf } from "obsidian";
import type SmartStudyPlugin from "../../main";
import { PDF_VIEW_TYPE, PdfView } from "./PdfView";

export function registerPdfFeature(plugin: SmartStudyPlugin): void {
  // Obsidian's core PDF viewer claims the "pdf" extension at startup. Unregister
  // it before we install our own, otherwise registerExtensions throws "Extension
  // pdf is already registered". On plugin unload Obsidian removes our handler
  // automatically; the core handler returns on the next Obsidian restart.
  const viewRegistry = (plugin.app as unknown as {
    viewRegistry?: { unregisterExtensions?: (exts: string[]) => void };
  }).viewRegistry;
  try {
    viewRegistry?.unregisterExtensions?.(["pdf"]);
  } catch (e) {
    console.warn("[smart-study] could not unregister core pdf handler", e);
  }

  plugin.registerView(
    PDF_VIEW_TYPE,
    (leaf: WorkspaceLeaf) => new PdfView(leaf, plugin),
  );
  plugin.registerExtensions(["pdf"], PDF_VIEW_TYPE);
}
