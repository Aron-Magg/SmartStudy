import { Notice } from "obsidian";
import type SmartStudyPlugin from "../../main";
import { buildEmbedUrl, parseYoutubeUrl, YoutubeRef } from "./parseYoutubeUrl";

export function registerYoutubeEmbedFeature(plugin: SmartStudyPlugin): void {
  plugin.registerMarkdownPostProcessor((el, _ctx) => {
    const paragraphs = Array.from(el.querySelectorAll<HTMLParagraphElement>("p"));
    for (const p of paragraphs) {
      const anchor = lonelyLink(p);
      if (!anchor) continue;
      const ref = parseYoutubeUrl(anchor.href);
      if (!ref) continue;
      const embed = buildEmbedElement(ref, {
        privacyMode: plugin.settings.youtube.privacyMode,
      });
      p.replaceWith(embed);
    }
  });

  plugin.addCommand({
    id: "smart-youtube-embed-insert",
    name: "Insert YouTube embed at cursor",
    editorCallback: (editor) => {
      const url = window.prompt("YouTube URL");
      if (!url) return;
      const ref = parseYoutubeUrl(url);
      if (!ref) {
        new Notice("Not a recognised YouTube URL.");
        return;
      }
      const line = `\n${url.trim()}\n`;
      editor.replaceSelection(line);
    },
  });
}

function lonelyLink(p: HTMLElement): HTMLAnchorElement | null {
  const anchors = p.querySelectorAll<HTMLAnchorElement>("a");
  if (anchors.length !== 1) return null;
  const a = anchors[0];
  const paragraphText = (p.textContent ?? "").trim();
  const anchorText = (a.textContent ?? "").trim();
  if (!paragraphText || paragraphText !== anchorText) return null;
  return a;
}

function buildEmbedElement(
  ref: YoutubeRef,
  opts: { privacyMode: boolean },
): HTMLElement {
  const wrapper = createDiv({ cls: "smart-yt-embed" });
  wrapper.createEl("iframe", {
    attr: {
      src: buildEmbedUrl(ref, opts),
      title: "YouTube video",
      frameborder: "0",
      allow:
        "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share",
      referrerpolicy: "strict-origin-when-cross-origin",
      allowfullscreen: "true",
      loading: "lazy",
    },
  });
  return wrapper;
}
