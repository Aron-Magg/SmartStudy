import { promises as fs } from "fs";
import { join } from "path";

export async function dirSize(path: string): Promise<number> {
  let total = 0;
  let stack: string[] = [path];
  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries: import("fs").Dirent[];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = join(current, e.name);
      if (e.isDirectory() && !e.isSymbolicLink()) {
        stack.push(full);
      } else if (e.isFile()) {
        try {
          const s = await fs.stat(full);
          total += s.size;
        } catch {
          /* ignore */
        }
      }
    }
  }
  return total;
}

export function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  for (const unit of units) {
    if (value < 1024) return `${value.toFixed(value < 10 ? 2 : 1)} ${unit}`;
    value /= 1024;
  }
  return `${value.toFixed(1)} PB`;
}
