import { MarkdownPostProcessorContext, App } from "obsidian";

export function processHtmlLinks(
  app: App,
  el: HTMLElement,
  ctx: MarkdownPostProcessorContext,
): void {
  const anchors = el.querySelectorAll("a.internal-link, a.external-link, a[data-href], a[href]");
  anchors.forEach((aRaw) => {
    const a = aRaw as HTMLAnchorElement;
    const target =
      a.getAttribute("data-href") ?? a.getAttribute("href") ?? "";
    if (!/\.(html?)(#.*)?$/i.test(target)) return;

    a.addEventListener("click", (ev) => {
      ev.preventDefault();
      const cleaned = target.split("#")[0];
      app.workspace.openLinkText(cleaned, ctx.sourcePath, false);
    });

    // Resolve "unresolved-link" visual state for .html files in the vault.
    const resolved = resolveInVault(app, target.split("#")[0], ctx.sourcePath);
    if (resolved) {
      a.classList.remove("is-unresolved");
      a.classList.add("smart-html-link-resolved");
    }
  });
}

function resolveInVault(
  app: App,
  href: string,
  sourcePath: string,
): boolean {
  if (!href) return false;
  const direct = app.metadataCache.getFirstLinkpathDest(href, sourcePath);
  if (direct) return true;
  const stripped = href.replace(/\.html?$/i, "");
  if (stripped !== href) {
    const fallback = app.metadataCache.getFirstLinkpathDest(stripped, sourcePath);
    if (fallback) return true;
  }
  return false;
}
