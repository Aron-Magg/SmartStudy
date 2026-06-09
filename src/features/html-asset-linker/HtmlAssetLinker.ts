import { App, normalizePath, TAbstractFile, TFile, TFolder } from "obsidian";

/**
 * For each `<base>.html` paired with a sibling `<base>_files/` folder, write a
 * sidecar `<base>.assets.md` that wikilinks both the HTML and every file in the
 * asset folder. Obsidian's link index turns those wikilinks into graph edges,
 * so the HTML and its assets appear as a single connected component.
 */
export class HtmlAssetLinker {
  private static readonly SIDECAR_EXT = ".assets.md";
  private static readonly MAGIC_HEADER = "smart-study:html-asset-linker";

  constructor(private readonly app: App) {}

  async indexVault(): Promise<{ created: number; updated: number; skipped: number }> {
    let created = 0;
    let updated = 0;
    let skipped = 0;
    const root = this.app.vault.getRoot();
    const folders: TFolder[] = [root];
    while (folders.length) {
      const f = folders.shift()!;
      for (const child of f.children) {
        if (child instanceof TFolder) folders.push(child);
      }
      const res = await this.indexFolder(f);
      created += res.created;
      updated += res.updated;
      skipped += res.skipped;
    }
    return { created, updated, skipped };
  }

  /** Called when a file/folder is created or renamed. */
  async indexNear(file: TAbstractFile): Promise<void> {
    const parent =
      file instanceof TFolder ? file.parent : (file as TFile).parent;
    if (parent) await this.indexFolder(parent);
  }

  async indexFolder(folder: TFolder): Promise<{ created: number; updated: number; skipped: number }> {
    let created = 0;
    let updated = 0;
    let skipped = 0;
    const byName = new Map<string, TAbstractFile>();
    for (const child of folder.children) {
      byName.set(child.name, child);
    }
    for (const child of folder.children) {
      if (!(child instanceof TFolder)) continue;
      if (!child.name.endsWith("_files")) continue;
      const base = child.name.slice(0, -"_files".length);
      const html =
        byName.get(`${base}.html`) ?? byName.get(`${base}.htm`);
      if (!(html instanceof TFile)) continue;
      const result = await this.writeSidecar(html, child);
      if (result === "created") created++;
      else if (result === "updated") updated++;
      else skipped++;
    }
    return { created, updated, skipped };
  }

  private async writeSidecar(
    html: TFile,
    assetsFolder: TFolder,
  ): Promise<"created" | "updated" | "skipped"> {
    const sidecarPath = sidecarPathFor(html);
    const content = await this.buildContent(html, assetsFolder);
    const existing = this.app.vault.getAbstractFileByPath(sidecarPath);
    if (existing instanceof TFile) {
      const prev = await this.app.vault.read(existing);
      if (!prev.includes(HtmlAssetLinker.MAGIC_HEADER)) {
        // user-authored file with the same name — never overwrite
        return "skipped";
      }
      if (prev === content) return "skipped";
      await this.app.vault.modify(existing, content);
      return "updated";
    }
    await this.app.vault.create(sidecarPath, content);
    return "created";
  }

  private async buildContent(
    html: TFile,
    assetsFolder: TFolder,
  ): Promise<string> {
    const assets = await this.listAssets(assetsFolder);
    const lines: string[] = [];
    lines.push("---");
    lines.push(`${HtmlAssetLinker.MAGIC_HEADER}: true`);
    lines.push(`for: ${html.path}`);
    lines.push(`assets-folder: ${assetsFolder.path}`);
    lines.push(`generated-by: smart-study`);
    lines.push("---");
    lines.push("");
    lines.push(`# Assets linked to [[${html.path}|${html.basename}]]`);
    lines.push("");
    lines.push(
      "_Auto-generated sidecar. Connects the HTML and its asset folder in the graph view._",
    );
    lines.push("");
    if (assets.length === 0) {
      lines.push("_(no assets found)_");
    } else {
      for (const a of assets) lines.push(`- [[${a}]]`);
    }
    lines.push("");
    return lines.join("\n");
  }

  private async listAssets(folder: TFolder): Promise<string[]> {
    const out: string[] = [];
    const stack: TFolder[] = [folder];
    while (stack.length) {
      const f = stack.shift()!;
      for (const child of f.children) {
        if (child instanceof TFolder) stack.push(child);
        else if (child instanceof TFile) out.push(child.path);
      }
    }
    out.sort();
    return out;
  }
}

function sidecarPathFor(html: TFile): string {
  const dir = html.parent?.path ?? "";
  const name = `${html.basename}.assets.md`;
  return normalizePath(dir ? `${dir}/${name}` : name);
}
