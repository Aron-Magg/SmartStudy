import { WorkspaceLeaf } from "obsidian";
import type SmartStudyPlugin from "../../main";
import { HTML_VIEW_TYPE, HtmlView } from "./HtmlView";
import { processHtmlLinks } from "./LinkHandler";

export function registerHtmlFeature(plugin: SmartStudyPlugin): void {
  plugin.registerView(
    HTML_VIEW_TYPE,
    (leaf: WorkspaceLeaf) => new HtmlView(leaf, plugin),
  );
  plugin.registerExtensions(["html", "htm"], HTML_VIEW_TYPE);

  plugin.registerMarkdownPostProcessor((el, ctx) => {
    processHtmlLinks(plugin.app, el, ctx);
  });
}
