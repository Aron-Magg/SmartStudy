export type CellType = "code" | "markdown" | "raw";

export interface CellOutputStream {
  output_type: "stream";
  name: "stdout" | "stderr";
  text: string | string[];
}

export interface CellOutputDisplayLike {
  output_type: "display_data" | "execute_result";
  data: Record<string, string | string[]>;
  metadata?: Record<string, unknown>;
  execution_count?: number | null;
}

export interface CellOutputError {
  output_type: "error";
  ename: string;
  evalue: string;
  traceback: string[];
}

export type CellOutput =
  | CellOutputStream
  | CellOutputDisplayLike
  | CellOutputError;

export interface NotebookCell {
  cell_type: CellType;
  source: string | string[];
  metadata: Record<string, unknown>;
  outputs?: CellOutput[];
  execution_count?: number | null;
  id?: string;
}

export interface NotebookFile {
  cells: NotebookCell[];
  metadata: Record<string, unknown>;
  nbformat: number;
  nbformat_minor: number;
}

export function emptyNotebook(): NotebookFile {
  return {
    cells: [],
    metadata: {
      kernelspec: {
        display_name: "Python 3",
        language: "python",
        name: "python3",
      },
      language_info: { name: "python" },
    },
    nbformat: 4,
    nbformat_minor: 5,
  };
}

export function cellSourceToString(src: string | string[]): string {
  return Array.isArray(src) ? src.join("") : src;
}

export function outputTextToString(t: string | string[]): string {
  return Array.isArray(t) ? t.join("") : t;
}

export function newCell(type: CellType, source = ""): NotebookCell {
  const base: NotebookCell = {
    cell_type: type,
    source,
    metadata: {},
    id: randomCellId(),
  };
  if (type === "code") {
    base.outputs = [];
    base.execution_count = null;
  }
  return base;
}

function randomCellId(): string {
  return Math.random().toString(36).slice(2, 10);
}
