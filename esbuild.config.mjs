import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";
import { copyFile, mkdir, readFile, readdir, writeFile } from "fs/promises";
import { dirname, resolve, join } from "path";

const prod = process.argv[2] === "production";

const VAULT_PLUGIN_DIR = resolve(
  process.cwd(),
  "..",
  ".obsidian",
  "plugins",
  "smart-study",
);

async function collectCss(rootCss) {
  const featureRoot = resolve(process.cwd(), "src", "features");
  const parts = [await readFile(rootCss, "utf8")];
  async function walk(dir) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        await walk(full);
      } else if (e.isFile() && e.name.endsWith(".css")) {
        parts.push(`/* ${e.name} */\n` + (await readFile(full, "utf8")));
      }
    }
  }
  await walk(featureRoot);
  return parts.join("\n\n");
}

const copyToVault = {
  name: "copy-to-vault",
  setup(build) {
    build.onEnd(async (result) => {
      if (result.errors.length > 0) return;
      const combinedCss = await collectCss(resolve(process.cwd(), "styles.css"));
      const builtCssPath = resolve(process.cwd(), "main.css");
      await writeFile(builtCssPath, combinedCss, "utf8");
      await mkdir(VAULT_PLUGIN_DIR, { recursive: true });
      await Promise.all([
        copyFile("main.js", resolve(VAULT_PLUGIN_DIR, "main.js")),
        copyFile("manifest.json", resolve(VAULT_PLUGIN_DIR, "manifest.json")),
        writeFile(resolve(VAULT_PLUGIN_DIR, "styles.css"), combinedCss, "utf8"),
      ]);
      const ts = new Date().toISOString().slice(11, 19);
      console.log(`[${ts}] copied to ${VAULT_PLUGIN_DIR}`);
    });
  },
};

const ctx = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    ...builtins,
  ],
  format: "cjs",
  target: "es2022",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
  platform: "node",
  plugins: [copyToVault],
  define: {
    "process.env.NODE_ENV": prod ? '"production"' : '"development"',
  },
});

if (prod) {
  await ctx.rebuild();
  await ctx.dispose();
} else {
  await ctx.watch();
}
