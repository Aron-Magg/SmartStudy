import { parse } from "smol-toml";

export interface PyProject {
  project?: {
    name?: string;
    version?: string;
    dependencies?: string[];
    "optional-dependencies"?: Record<string, string[]>;
    [k: string]: unknown;
  };
  tool?: {
    uv?: {
      dependencies?: string[];
      "dev-dependencies"?: string[];
    };
    poetry?: {
      dependencies?: Record<string, unknown>;
      "dev-dependencies"?: Record<string, unknown>;
    };
  };
  [k: string]: unknown;
}

export function parsePyProject(raw: string): PyProject {
  return parse(raw) as PyProject;
}

export function declaredPackages(p: PyProject): Set<string> {
  const names = new Set<string>();
  const fromList = (list?: string[]) => {
    if (!list) return;
    for (const spec of list) {
      const m = /^([A-Za-z0-9._-]+)/.exec(spec);
      if (m) names.add(m[1].toLowerCase().replace(/_/g, "-"));
    }
  };
  fromList(p.project?.dependencies);
  fromList(p.tool?.uv?.dependencies);
  fromList(p.tool?.uv?.["dev-dependencies"]);
  const optional = p.project?.["optional-dependencies"];
  if (optional) {
    for (const v of Object.values(optional)) fromList(v);
  }
  const poetryDeps = p.tool?.poetry?.dependencies;
  if (poetryDeps) {
    for (const name of Object.keys(poetryDeps)) {
      if (name === "python") continue;
      names.add(name.toLowerCase().replace(/_/g, "-"));
    }
  }
  return names;
}
