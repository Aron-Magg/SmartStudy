import { WorkspaceLeaf } from "obsidian";
import type SmartStudyPlugin from "../../main";
import { PYTHON_VIEW_TYPE, PythonView } from "./PythonView";

export function registerPythonViewerFeature(plugin: SmartStudyPlugin): void {
  plugin.registerView(
    PYTHON_VIEW_TYPE,
    (leaf: WorkspaceLeaf) => new PythonView(leaf),
  );
  plugin.registerExtensions(["py", "pyi", "pyx"], PYTHON_VIEW_TYPE);
}
