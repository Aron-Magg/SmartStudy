# Smart Study

Obsidian plugin that turns a vault into a study workspace: per-folder Python venvs
with Jupyter execution, an HTML lecture viewer, a PDF viewer, an AI-driven quiz
generator with spaced repetition, a Pomodoro timer with stats, and a venv inspector.

Desktop only.

## Features

- **Notebook** — open `.ipynb` files; cells run against a per-folder `uv`-managed venv.
- **HTML viewer** — render HTML lectures inline, with relative asset resolution.
- **PDF viewer** — built-in PDF rendering.
- **Quiz** — AI-generated quizzes from your notes, with spaced repetition and a stats dashboard.
- **Pomodoro** — work/break timer with session history and per-day stats.
- **Venv inspector** — list and inspect the Python environments managed by the plugin.
- **HTML asset linker** — keeps inline assets resolvable across vault moves.

## Install

### Option 1 — Download a release (no build tools needed)

1. Go to the [Releases](../../releases) page and download `smart-study-<version>.zip`
   from the latest release.
2. Unzip it into `<your-vault>/.obsidian/plugins/`. You should end up with
   `<your-vault>/.obsidian/plugins/smart-study/main.js` (and `manifest.json`, `styles.css`).
3. In Obsidian: **Settings → Community plugins → Reload plugins**, then enable **Smart Study**.

You can also grab the three individual files (`main.js`, `manifest.json`, `styles.css`)
from the release and drop them into a `smart-study/` folder you create yourself.

### Option 2 — Install via BRAT

If you use [BRAT](https://github.com/TfTHacker/obsidian42-brat), add this repository's
URL as a beta plugin. BRAT will install the latest GitHub release for you.

### Option 3 — Build from source

Requirements: Node.js 20+ and npm.

```sh
git clone <repository-url> smart-study
cd smart-study
npm install
VAULT_PATH=/absolute/path/to/your/vault npm run build
```

The build copies `main.js`, `manifest.json`, and `styles.css` into
`<VAULT_PATH>/.obsidian/plugins/smart-study/`. Then enable the plugin in
**Settings → Community plugins**.

If you omit `VAULT_PATH` and the build can't find a vault at `..`, it still produces
`main.js` and `main.css` in the repo root — copy them manually into your vault's
plugin folder (rename `main.css` → `styles.css`).

## Optional runtime dependencies

- [`uv`](https://github.com/astral-sh/uv) — required for the Notebook and Venv inspector
  features. Set the path in plugin settings if it isn't on `PATH`.
- An AI provider key (Anthropic, OpenAI, or OpenRouter) — required only for the quiz
  generator. Configure in plugin settings, or set `ANTHROPIC_API_KEY` /
  `OPENAI_API_KEY` / `OPENROUTER_API_KEY` before launching Obsidian (env vars take
  precedence over settings).

## Development

```sh
npm install
VAULT_PATH=/absolute/path/to/your/vault npm run dev
```

`dev` watches sources and re-copies the build into your vault on every change.
Reload the plugin from Obsidian's settings (or use the Hot Reload community plugin)
to see changes.

## Releasing

Tag a commit with a SemVer version matching `manifest.json` and push it:

```sh
git tag 0.1.0
git push origin 0.1.0
```

The release workflow builds and publishes `main.js`, `manifest.json`, `styles.css`,
and a `smart-study-<version>.zip` to GitHub Releases.

## License

MIT — see [LICENSE](LICENSE).
