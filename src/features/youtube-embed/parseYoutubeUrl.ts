export interface YoutubeRef {
  videoId: string;
  startSeconds?: number;
  playlistId?: string;
}

const VIDEO_ID_RE = /^[a-zA-Z0-9_-]{6,20}$/;
const PLAYLIST_ID_RE = /^[a-zA-Z0-9_-]{10,64}$/;

export function parseYoutubeUrl(raw: string): YoutubeRef | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, "").replace(/^m\./, "");
  let videoId: string | undefined;

  if (host === "youtu.be") {
    videoId = url.pathname.slice(1).split("/")[0];
  } else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (url.pathname === "/watch") {
      videoId = url.searchParams.get("v") ?? undefined;
    } else if (url.pathname.startsWith("/embed/")) {
      videoId = url.pathname.slice("/embed/".length).split("/")[0];
    } else if (url.pathname.startsWith("/shorts/")) {
      videoId = url.pathname.slice("/shorts/".length).split("/")[0];
    } else if (url.pathname.startsWith("/live/")) {
      videoId = url.pathname.slice("/live/".length).split("/")[0];
    }
  } else {
    return null;
  }

  if (!videoId || !VIDEO_ID_RE.test(videoId)) return null;

  const ts = url.searchParams.get("t") ?? url.searchParams.get("start");
  const startSeconds = ts ? parseTimestamp(ts) : undefined;

  const list = url.searchParams.get("list");
  const playlistId = list && PLAYLIST_ID_RE.test(list) ? list : undefined;

  return { videoId, startSeconds, playlistId };
}

function parseTimestamp(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/^\d+$/.test(trimmed)) return parseInt(trimmed, 10);

  const re = /(\d+)\s*([hms])/gi;
  let total = 0;
  let matched = false;
  let m: RegExpExecArray | null;
  while ((m = re.exec(trimmed)) !== null) {
    matched = true;
    const n = parseInt(m[1], 10);
    const unit = m[2].toLowerCase();
    if (unit === "h") total += n * 3600;
    else if (unit === "m") total += n * 60;
    else total += n;
  }
  return matched ? total : undefined;
}

export function buildEmbedUrl(
  ref: YoutubeRef,
  opts: { privacyMode: boolean } = { privacyMode: true },
): string {
  const host = opts.privacyMode ? "www.youtube-nocookie.com" : "www.youtube.com";
  const params = new URLSearchParams();
  if (ref.startSeconds && ref.startSeconds > 0) {
    params.set("start", String(ref.startSeconds));
  }
  if (ref.playlistId) {
    params.set("list", ref.playlistId);
  }
  const qs = params.toString();
  return `https://${host}/embed/${ref.videoId}${qs ? `?${qs}` : ""}`;
}
