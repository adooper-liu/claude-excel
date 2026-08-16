import type { ToolDef } from './claude';
import { assertManifestExecutors } from './skill-registry';
import { CORE_SKILL_MANIFESTS } from './skill-manifests';

function localTools(): ToolDef[] {
  const tools = CORE_SKILL_MANIFESTS.flatMap(
    (m) => m.tools as ToolDef[]
  );
  assertManifestExecutors(tools.map((t) => t.name));
  return tools;
}

let cachedTools: ToolDef[] | null = null;

export async function getAllTools(): Promise<ToolDef[]> {
  if (!cachedTools) {
    cachedTools = localTools();
  }
  return cachedTools;
}
