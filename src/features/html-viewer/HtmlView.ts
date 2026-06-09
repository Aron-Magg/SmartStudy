import { FileView, normalizePath, TFile, WorkspaceLeaf } from "obsidian";
import type SmartStudyPlugin from "../../main";

export const HTML_VIEW_TYPE = "smart-html";

export class HtmlView extends FileView {
  private iframe: HTMLIFrameElement | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: SmartStudyPlugin,
  ) {
    super(leaf);
    this.allowNoFile = false;
  }

  getViewType(): string {
    return HTML_VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.file?.basename ?? "HTML";
  }

  getIcon(): string {
    return "file-code";
  }

  canAcceptExtension(extension: string): boolean {
    return extension === "html" || extension === "htm";
  }

  async onLoadFile(file: TFile): Promise<void> {
    await super.onLoadFile(file);
    await this.renderFile(file);
  }

  async onUnloadFile(file: TFile): Promise<void> {
    if (this.iframe) {
      this.iframe.src = "about:blank";
      this.iframe.remove();
      this.iframe = null;
    }
    await super.onUnloadFile(file);
  }

  private async renderFile(file: TFile): Promise<void> {
    const c = this.contentEl;
    c.empty();
    c.addClass("smart-html-view");

    const toolbar = c.createDiv({ cls: "smart-html-toolbar" });
    toolbar.createSpan({
      cls: "smart-html-path",
      text: file.path,
    });
    const scriptsOn = !this.plugin.settings.html.disableScripts;
    const scriptToggle = toolbar.createEl("button", {
      text: scriptsOn ? "Scripts: on" : "Scripts: off",
      cls: scriptsOn ? "mod-cta" : "",
    });
    scriptToggle.onclick = async () => {
      this.plugin.settings.html.disableScripts =
        !this.plugin.settings.html.disableScripts;
      await this.plugin.saveSettings();
      await this.renderFile(file);
    };
    const openExt = toolbar.createEl("button", { text: "Open externally" });
    openExt.onclick = () => {
      const adapter = this.app.vault.adapter as unknown as {
        getResourcePath: (p: string) => string;
      };
      const url = adapter.getResourcePath(file.path);
      window.open(url, "_blank");
    };
    const reload = toolbar.createEl("button", { text: "Reload" });
    reload.onclick = () => this.renderFile(file);

    const adapter = this.app.vault.adapter as unknown as {
      getResourcePath: (p: string) => string;
      read: (p: string) => Promise<string>;
      exists: (p: string) => Promise<boolean>;
    };

    const iframe = c.createEl("iframe", { cls: "smart-html-iframe" });
    this.iframe = iframe;

    let html: string;
    try {
      html = await adapter.read(file.path);
    } catch (e) {
      c.createDiv({
        cls: "smart-study-empty",
        text: `Failed to read file: ${e instanceof Error ? e.message : e}`,
      });
      return;
    }

    const folder = file.parent?.path ?? "";
    const prepared = await prepareDocument(html, folder, adapter, {
      stripScripts: !scriptsOn,
    });

    iframe.setAttribute(
      "sandbox",
      scriptsOn
        ? "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms allow-modals"
        : "allow-same-origin allow-popups allow-popups-to-escape-sandbox",
    );
    iframe.srcdoc = prepared;

    iframe.addEventListener("load", () => {
      try {
        const doc = iframe.contentDocument;
        if (!doc) return;
        doc.addEventListener("click", (ev) => {
          const target = (ev.target as HTMLElement)?.closest("a");
          if (!target) return;
          const href = target.getAttribute("href");
          if (!href) return;
          if (
            href.startsWith("http://") ||
            href.startsWith("https://") ||
            href.startsWith("mailto:")
          ) {
            ev.preventDefault();
            window.open(href, "_blank");
            return;
          }
          if (
            /\.(html?|md|ipynb)(#.*)?$/i.test(href) &&
            !href.startsWith("#") &&
            !href.startsWith("app://")
          ) {
            ev.preventDefault();
            const cleanHref = href.split("#")[0];
            this.app.workspace.openLinkText(cleanHref, file.path, false);
          }
        });
      } catch {
        /* ignore cross-frame errors */
      }
    });
  }
}

/* ----------------------------------------------------------------------------
 * Asset URL rewriting
 *
 * Obsidian serves files through `app://<vault-id>/<abs-path>?<token>`. Relative
 * URLs inside an iframe srcdoc lose the token, so we resolve every asset URL
 * to a vault path and re-issue it through getResourcePath. External CSS gets
 * inlined so that its own `url(...)` references also receive tokens.
 * -------------------------------------------------------------------------- */

interface Adapter {
  getResourcePath: (p: string) => string;
  read: (p: string) => Promise<string>;
  exists: (p: string) => Promise<boolean>;
}

async function prepareDocument(
  html: string,
  folder: string,
  adapter: Adapter,
  opts: { stripScripts: boolean },
): Promise<string> {
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(html, "text/html");
  } catch {
    return html;
  }

  if (opts.stripScripts) {
    doc.querySelectorAll("script").forEach((s) => s.remove());
  }

  const rewriteAttr = (el: Element, attr: string) => {
    const v = el.getAttribute(attr);
    if (!v) return;
    const vp = resolveVaultPath(v, folder);
    if (vp === null) return;
    el.setAttribute(attr, adapter.getResourcePath(vp));
  };
  const rewriteSrcset = (el: Element) => {
    const v = el.getAttribute("srcset");
    if (!v) return;
    const out = v
      .split(",")
      .map((part) => {
        const trimmed = part.trim();
        if (!trimmed) return trimmed;
        const m = trimmed.match(/^(\S+)(\s.*)?$/);
        if (!m) return trimmed;
        const url = m[1];
        const tail = m[2] ?? "";
        const vp = resolveVaultPath(url, folder);
        return vp === null ? trimmed : adapter.getResourcePath(vp) + tail;
      })
      .join(", ");
    el.setAttribute("srcset", out);
  };

  doc.querySelectorAll("img, source, video, audio, iframe, embed").forEach((el) => {
    rewriteAttr(el, "src");
    if (el.tagName === "IMG" || el.tagName === "SOURCE") rewriteSrcset(el);
    rewriteAttr(el, "poster");
  });
  doc.querySelectorAll("script").forEach((el) => rewriteAttr(el, "src"));
  doc.querySelectorAll("a").forEach((el) => rewriteAttr(el, "href"));
  doc.querySelectorAll("object").forEach((el) => rewriteAttr(el, "data"));
  doc
    .querySelectorAll("link[rel~='icon'], link[rel~='manifest'], link[rel~='preload']")
    .forEach((el) => rewriteAttr(el, "href"));

  // Inline <style> tags: rewrite url(...) inside their text.
  doc.querySelectorAll("style").forEach((el) => {
    el.textContent = rewriteCssText(el.textContent ?? "", folder, adapter);
  });

  if (!opts.stripScripts) {
    enableVideoPlayback(doc);
    embedExternalVideoLinks(doc);
    wireNotionToggles(doc);
  }

  // External stylesheets: fetch, rewrite, inline as <style>.
  const linkNodes = Array.from(
    doc.querySelectorAll("link[rel='stylesheet'][href]"),
  ) as HTMLLinkElement[];
  await Promise.all(
    linkNodes.map(async (link) => {
      const href = link.getAttribute("href");
      if (!href) return;
      const vp = resolveVaultPath(href, folder);
      if (vp === null) return;
      try {
        if (!(await adapter.exists(vp))) return;
        const css = await adapter.read(vp);
        const cssFolder = vp.includes("/")
          ? vp.slice(0, vp.lastIndexOf("/"))
          : "";
        const rewritten = rewriteCssText(css, cssFolder, adapter);
        const style = doc.createElement("style");
        style.setAttribute("data-from", href);
        style.textContent = rewritten;
        link.replaceWith(style);
      } catch {
        /* leave the original link; it'll just fail to load */
      }
    }),
  );

  return "<!DOCTYPE html>\n" + doc.documentElement.outerHTML;
}

function rewriteCssText(
  css: string,
  folder: string,
  adapter: Adapter,
): string {
  const urlRe = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]+))\s*\)/g;
  return css.replace(urlRe, (whole, dq, sq, bare) => {
    const raw = (dq ?? sq ?? bare) as string;
    const vp = resolveVaultPath(raw, folder);
    if (vp === null) return whole;
    const url = adapter.getResourcePath(vp);
    return `url("${url}")`;
  });
}

/**
 * Notion ships <video> blocks with `pointer-events: none` plus a transparent
 * overlay div that swallows clicks (their JS would normally wire up a custom
 * play button). Without that JS we can't click the native controls. Patch the
 * tree so the native <video controls> works again.
 */
function enableVideoPlayback(doc: Document): void {
  const css = doc.createElement("style");
  css.textContent = `
    .notion-html video, .smart-html-video-fix video {
      pointer-events: auto !important;
      position: relative;
      z-index: 2;
    }
    /* Disable Notion's transparent click-overlay siblings of a <video>. */
    .notion-video-block div[style*="cursor: pointer"][style*="position: absolute"] {
      pointer-events: none !important;
    }
  `;
  doc.head?.appendChild(css);

  doc.querySelectorAll("video").forEach((v) => {
    if (!v.hasAttribute("controls")) v.setAttribute("controls", "controls");
    // Strip the inline pointer-events: none.
    const style = v.getAttribute("style") ?? "";
    const fixed = style.replace(/pointer-events\s*:\s*none[^;]*;?/gi, "");
    v.setAttribute("style", fixed + ";pointer-events:auto");
  });
}

/**
 * For standalone <a> tags pointing at YouTube or Vimeo, swap the link for an
 * embedded iframe so the video plays inline. Inline anchors that are part of
 * sentence text are left as links.
 */
function embedExternalVideoLinks(doc: Document): void {
  doc.querySelectorAll("a").forEach((a) => {
    const href = a.getAttribute("href");
    if (!href) return;
    const embed = toVideoEmbed(href);
    if (!embed) return;
    const text = (a.textContent ?? "").trim();
    const isStandalone =
      text === "" ||
      text === href ||
      text === href.replace(/^https?:\/\//, "") ||
      a.parentElement?.children.length === 1;
    if (!isStandalone) return;

    const wrap = doc.createElement("div");
    wrap.className = "smart-html-video-embed";
    wrap.setAttribute(
      "style",
      "position:relative;width:100%;max-width:880px;margin:12px auto;aspect-ratio:16/9;",
    );
    const iframe = doc.createElement("iframe");
    iframe.setAttribute("src", embed);
    iframe.setAttribute(
      "style",
      "position:absolute;inset:0;width:100%;height:100%;border:0;border-radius:6px;",
    );
    iframe.setAttribute(
      "allow",
      "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share",
    );
    iframe.setAttribute("allowfullscreen", "");
    iframe.setAttribute("loading", "lazy");
    wrap.appendChild(iframe);
    a.replaceWith(wrap);
  });
}

/**
 * Notion toggle blocks (plain `.notion-toggle-block` and toggle headings
 * `.notion-*header-block`) ship an `aria-expanded` button but no JS to make it
 * work, because the children are siblings in the DOM rather than nested. For
 * each toggle we walk forward through the block's siblings, stopping at the
 * next same-or-higher-level header (or at the next plain toggle), tag those
 * siblings as children, then inject one delegated click handler.
 */
function wireNotionToggles(doc: Document): void {
  type Level = 1 | 2 | 3 | "toggle";
  const levelOf = (el: Element): Level | null => {
    if (el.classList.contains("notion-header-block")) return 1;
    if (el.classList.contains("notion-sub_header-block")) return 2;
    if (el.classList.contains("notion-sub_sub_header-block")) return 3;
    if (el.classList.contains("notion-toggle-block")) return "toggle";
    return null;
  };

  const childrenOf = (block: Element, level: Level): Element[] => {
    const out: Element[] = [];
    let n: Element | null = block.nextElementSibling;
    while (n) {
      const nl = levelOf(n);
      if (level === "toggle") {
        if (nl === "toggle") break;
      } else {
        if (typeof nl === "number" && nl <= level) break;
      }
      out.push(n);
      n = n.nextElementSibling;
    }
    return out;
  };

  let counter = 0;
  doc
    .querySelectorAll<HTMLElement>(
      ".notion-toggle-block, .notion-header-block, .notion-sub_header-block, .notion-sub_sub_header-block",
    )
    .forEach((block) => {
      const button = block.querySelector<HTMLElement>(
        '[role="button"][aria-expanded][aria-label="Open"]',
      );
      if (!button) return;
      const level = levelOf(block);
      if (level === null) return;
      const children = childrenOf(block, level);
      if (children.length === 0) return;

      const id = `tog-${counter++}`;
      button.setAttribute("data-smart-toggle-id", id);
      // Keep current visual state (everything visible) so the page doesn't
      // suddenly collapse on first render. The arrow flips to "expanded".
      button.setAttribute("aria-expanded", "true");
      button.setAttribute("aria-label", "Close");
      const style = button.getAttribute("style") ?? "";
      if (!/cursor:/i.test(style)) {
        button.setAttribute("style", style + ";cursor:pointer");
      }
      const arrow = button.querySelector<HTMLElement>("svg");
      if (arrow) rotateArrow(arrow, true);

      children.forEach((c) => c.setAttribute("data-smart-toggle-child", id));
    });

  if (counter === 0) return;

  const script = doc.createElement("script");
  script.textContent = `
    (function() {
      var rotate = function(el, open) {
        if (!el) return;
        var s = el.getAttribute('style') || '';
        s = s.replace(/transform\\s*:\\s*rotateZ\\(-?\\d+deg\\)\\s*;?/gi, '');
        el.setAttribute('style', s + ';transform:rotateZ(' + (open ? '0' : '-90') + 'deg)');
      };
      document.addEventListener('click', function(e) {
        var btn = e.target && e.target.closest && e.target.closest('[data-smart-toggle-id]');
        if (!btn) return;
        e.preventDefault();
        e.stopPropagation();
        var id = btn.getAttribute('data-smart-toggle-id');
        var open = btn.getAttribute('aria-expanded') !== 'true';
        btn.setAttribute('aria-expanded', String(open));
        btn.setAttribute('aria-label', open ? 'Close' : 'Open');
        rotate(btn.querySelector('svg'), open);
        var nodes = document.querySelectorAll('[data-smart-toggle-child="' + id + '"]');
        for (var i = 0; i < nodes.length; i++) {
          nodes[i].style.display = open ? '' : 'none';
        }
      }, true);
    })();
  `;
  (doc.body ?? doc.documentElement).appendChild(script);
}

function rotateArrow(arrow: HTMLElement, open: boolean): void {
  const s = arrow.getAttribute("style") ?? "";
  const stripped = s.replace(/transform\s*:\s*rotateZ\(-?\d+deg\)\s*;?/gi, "");
  arrow.setAttribute(
    "style",
    stripped + `;transform:rotateZ(${open ? 0 : -90}deg)`,
  );
}

function toVideoEmbed(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "youtube.com" || host === "m.youtube.com") {
      const id = u.searchParams.get("v");
      if (id) {
        const t = u.searchParams.get("t") ?? u.searchParams.get("start");
        const start = t ? `?start=${parseTimeOffset(t)}` : "";
        return `https://www.youtube.com/embed/${id}${start}`;
      }
      const embedMatch = u.pathname.match(/^\/embed\/([A-Za-z0-9_-]+)/);
      if (embedMatch) return `https://www.youtube.com/embed/${embedMatch[1]}`;
      const shortsMatch = u.pathname.match(/^\/shorts\/([A-Za-z0-9_-]+)/);
      if (shortsMatch) return `https://www.youtube.com/embed/${shortsMatch[1]}`;
    }
    if (host === "youtu.be") {
      const id = u.pathname.replace(/^\//, "");
      if (id) {
        const t = u.searchParams.get("t");
        const start = t ? `?start=${parseTimeOffset(t)}` : "";
        return `https://www.youtube.com/embed/${id}${start}`;
      }
    }
    if (host === "vimeo.com") {
      const id = u.pathname.match(/\/(\d+)/)?.[1];
      if (id) return `https://player.vimeo.com/video/${id}`;
    }
    if (host === "player.vimeo.com") {
      return url; // already an embed URL
    }
  } catch {
    /* not a URL */
  }
  return null;
}

function parseTimeOffset(t: string): number {
  if (/^\d+$/.test(t)) return parseInt(t, 10);
  let total = 0;
  const m = t.match(/(\d+)h/);
  const mm = t.match(/(\d+)m/);
  const s = t.match(/(\d+)s/);
  if (m) total += parseInt(m[1], 10) * 3600;
  if (mm) total += parseInt(mm[1], 10) * 60;
  if (s) total += parseInt(s[1], 10);
  return total;
}

function resolveVaultPath(raw: string, folder: string): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (
    /^[a-z][a-z0-9+\-.]*:/i.test(trimmed) || // any scheme (http, https, mailto, app, data, blob, javascript…)
    trimmed.startsWith("//") ||
    trimmed.startsWith("#") ||
    trimmed.startsWith("/")
  ) {
    return null;
  }
  let decoded: string;
  try {
    decoded = decodeURIComponent(trimmed);
  } catch {
    decoded = trimmed;
  }
  // Drop query/fragment — Obsidian's resource handler appends its own token.
  const stop = decoded.search(/[?#]/);
  if (stop !== -1) decoded = decoded.slice(0, stop);
  const combined = folder ? `${folder}/${decoded}` : decoded;
  const parts: string[] = [];
  for (const seg of combined.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") {
      if (parts.length > 0) parts.pop();
      continue;
    }
    parts.push(seg);
  }
  return parts.length === 0 ? null : normalizePath(parts.join("/"));
}
