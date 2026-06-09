<div align="center">

# Smart Study

**An Obsidian plugin that turns your vault into a study workspace.**
Jupyter notebooks with per-folder venvs, HTML and PDF lecture viewers, AI-generated quizzes with spaced repetition, and a Pomodoro timer with stats.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue?style=flat-square)](LICENSE)
[![Obsidian](https://img.shields.io/badge/Obsidian-1.5%2B-7c3aed?style=flat-square)](https://obsidian.md)
[![Platform](https://img.shields.io/badge/platform-desktop-444?style=flat-square)](#)
[![Latest release](https://img.shields.io/badge/release-download-22c55e?style=flat-square)](../../releases/latest)

</div>

> [!NOTE]
> Smart Study is desktop-only. It spawns subprocesses (Jupyter, `uv`), which Obsidian Mobile doesn't support.

> [!WARNING]
> Early development (`0.1.x`). APIs, settings, and on-disk data formats may change between minor versions.

## Table of contents

- [Features](#features)
- [Installation](#installation)
  - [From a GitHub release](#from-a-github-release)
  - [Via BRAT](#via-brat)
  - [From source](#from-source)
- [Configuration](#configuration)
- [Development](#development)
- [Releasing](#releasing)
- [License](#license)

## Features

| Feature | What it does |
| --- | --- |
| **Notebook** | Open `.ipynb` files and run cells against a per-folder `uv`-managed Python venv. Each notebook folder gets its own isolated environment. |
| **HTML viewer** | Render HTML lectures inline with relative-asset resolution. Links open in-app or externally based on target. |
| **PDF viewer** | Native-feeling PDF rendering inside an Obsidian leaf. |
| **Quiz generator** | Generate multiple-choice quizzes from your notes via an LLM, track answers, and revisit weak items with spaced repetition. |
| **Quiz library & stats** | Saved quiz library plus a dashboard with per-topic accuracy, streaks, and review history. |
| **Pomodoro** | Configurable work/break timer with notifications, optional sound, and per-day session stats. |
| **Venv inspector** | List, inspect, and clean the Python venvs created by the Notebook feature. |
| **HTML asset linker** | Keeps inline asset references resolvable when notes move within the vault. |

## Installation

### From a GitHub release

The simplest path — no build tools required.

1. Open the [latest release](../../releases/latest) and download `smart-study-<version>.zip`.
2. Unzip it into your vault's plugin folder. You should end up with this layout:

   ```
   <your-vault>/.obsidian/plugins/smart-study/
   ├── main.js
   ├── manifest.json
   └── styles.css
   ```

3. In Obsidian, open **Settings → Community plugins**, click **Reload plugins**, then enable **Smart Study**.

> [!TIP]
> Prefer single files? The release also exposes `main.js`, `manifest.json`, and `styles.css` individually — drop them into a `smart-study/` folder you create yourself.

### Via BRAT

If you use the [BRAT](https://github.com/TfTHacker/obsidian42-brat) community plugin:

1. Open BRAT and choose **Add Beta plugin**.
2. Paste this repository's URL.
3. BRAT installs the latest GitHub release and keeps it up to date.

### From source

Requirements: **Node.js 20+** and **npm**.

```sh
git clone <repository-url> smart-study
cd smart-study
npm install
VAULT_PATH=/absolute/path/to/your/vault npm run build
```

The build emits `main.js`, `manifest.json`, and `styles.css` directly into `<VAULT_PATH>/.obsidian/plugins/smart-study/`. Enable the plugin in **Settings → Community plugins**.

> [!NOTE]
> If you omit `VAULT_PATH` and the build can't find a vault at `..`, it still produces `main.js` and `main.css` in the repo root. Copy them into your vault's plugin folder manually (rename `main.css` → `styles.css`).

## Configuration

Open **Settings → Smart Study** after enabling the plugin.

### Runtime requirements

| Feature | Requires |
| --- | --- |
| Notebook, Venv inspector | [`uv`](https://github.com/astral-sh/uv) on `PATH`, or a custom binary path in plugin settings. |
| Quiz generator | An API key for **Anthropic**, **OpenAI**, or **OpenRouter**. |

### Providing API keys

Keys can be set in plugin settings, or supplied as environment variables before launching Obsidian:

```sh
export ANTHROPIC_API_KEY=...
export OPENAI_API_KEY=...
export OPENROUTER_API_KEY=...
```

Environment variables take precedence over values stored in settings.

> [!CAUTION]
> Keys saved in the settings UI are stored in plain text at `<vault>/.obsidian/plugins/smart-study/data.json`. Exclude `.obsidian/` from cloud sync, or stick to environment variables.

## Development

```sh
npm install
VAULT_PATH=/absolute/path/to/your/vault npm run dev
```

`dev` watches sources and re-copies the build into your vault on every change. Reload the plugin from Obsidian's settings — or use the [Hot Reload](https://github.com/pjeby/hot-reload) community plugin — to pick up changes without restarting.

### Project layout

```
src/
├── features/           Self-contained features, each registered in main.ts
│   ├── notebook/
│   ├── html-viewer/
│   ├── pdf-viewer/
│   ├── quiz/
│   ├── pomodoro/
│   ├── venv-inspector/
│   └── html-asset-linker/
├── services/           Cross-feature services (AI, Jupyter, venv, stats…)
├── lib/                Pure utilities (schemas, shell helpers, TOML…)
├── settings/           Settings UI and persistence
└── main.ts             Plugin entry point
```

Each feature exposes a `register.ts` invoked from `main.ts`, so disabling or removing a feature touches one file.

## Releasing

Tag a commit with a SemVer version matching `manifest.json` and push the tag:

```sh
git tag 0.1.0
git push origin 0.1.0
```

The [release workflow](.github/workflows/release.yml) builds the plugin and publishes `main.js`, `manifest.json`, `styles.css`, and `smart-study-<version>.zip` to GitHub Releases. It fails fast if the tag doesn't match `manifest.json`'s `version` field — so bump the manifest before tagging.

## License

Released under the [MIT License](LICENSE).
Copyright © Aron Maggisano.
