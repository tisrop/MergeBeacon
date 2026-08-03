import type { PrFile } from "@/types";

export const MIN_NAVIGATOR_WIDTH = 180;
export const MAX_NAVIGATOR_WIDTH = 520;

export interface FileTreeNode {
  key: string;
  name: string;
  kind: "directory" | "file";
  children: FileTreeNode[];
  file: PrFile | null;
}

export interface FileTreeRow extends FileTreeNode {
  depth: number;
}

function sortTree(nodes: FileTreeNode[]): void {
  nodes.sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
  nodes.forEach((node) => sortTree(node.children));
}

export function buildFileTree(files: PrFile[]): FileTreeNode[] {
  const root: FileTreeNode = {
    key: "",
    name: "",
    kind: "directory",
    children: [],
    file: null,
  };

  files.forEach((file) => {
    const segments = file.filename.split("/").filter(Boolean);
    if (segments.length === 0) return;

    let parent = root;
    let currentPath = "";
    segments.forEach((segment, index) => {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      const isFile = index === segments.length - 1;
      let child = parent.children.find(
        (node) => node.name === segment && node.kind === (isFile ? "file" : "directory"),
      );
      if (!child) {
        child = {
          key: isFile ? file.filename : `directory:${currentPath}`,
          name: segment,
          kind: isFile ? "file" : "directory",
          children: [],
          file: isFile ? file : null,
        };
        parent.children.push(child);
      }
      parent = child;
    });
  });

  sortTree(root.children);
  return root.children;
}

export function firstFilePath(nodes: FileTreeNode[]): string {
  for (const node of nodes) {
    if (node.file) return node.file.filename;
    const nested = firstFilePath(node.children);
    if (nested) return nested;
  }
  return "";
}

export function collectDirectoryKeys(nodes: FileTreeNode[], keys = new Set<string>()): Set<string> {
  nodes.forEach((node) => {
    if (node.kind === "directory") {
      keys.add(node.key);
      collectDirectoryKeys(node.children, keys);
    }
  });
  return keys;
}

export function expandedDirectoryKeysForFile(path: string, current: Set<string>): Set<string> {
  const segments = path.split("/").filter(Boolean);
  const next = new Set(current);
  let directoryPath = "";
  for (const segment of segments.slice(0, -1)) {
    directoryPath = directoryPath ? `${directoryPath}/${segment}` : segment;
    next.add(`directory:${directoryPath}`);
  }
  return next;
}

export function visibleFileTreeRows(
  nodes: FileTreeNode[],
  expandedDirectories: Set<string>,
): FileTreeRow[] {
  const rows: FileTreeRow[] = [];
  const visit = (children: FileTreeNode[], depth: number) => {
    children.forEach((node) => {
      rows.push({ ...node, depth });
      if (node.kind === "directory" && expandedDirectories.has(node.key)) {
        visit(node.children, depth + 1);
      }
    });
  };
  visit(nodes, 1);
  return rows;
}
