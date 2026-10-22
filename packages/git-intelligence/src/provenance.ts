import type { GraphNode } from "@pathcompiler/graph-core";
import { compareText, RelativePathSchema } from "@pathcompiler/source-model";

export function filesForNode(node: GraphNode): string[] {
  const files = new Set<string>();
  if (node.type === "File" && typeof node.data?.path === "string")
    files.add(RelativePathSchema.parse(node.data.path));
  if (Array.isArray(node.data?.evidence)) {
    for (const evidence of node.data.evidence) {
      if (
        evidence &&
        typeof evidence === "object" &&
        !Array.isArray(evidence) &&
        typeof evidence.file === "string"
      )
        files.add(RelativePathSchema.parse(evidence.file));
    }
  }
  return [...files].sort(compareText);
}
