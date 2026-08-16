import type { ToolDef } from './claude';
import { assertManifestExecutors } from './skill-registry';
import { CORE_SKILL_MANIFESTS } from './skill-manifests';
import { fetchUserTools } from './user-skills';

function localTools(): ToolDef[] {
  const tools = CORE_SKILL_MANIFESTS.flatMap(
    (m) => m.tools as ToolDef[]
  );
  assertManifestExecutors(tools.map((t) => t.name));
  return tools;
}

let cachedTools: ToolDef[] | null = null;

export function invalidateToolsCache(): void {
  cachedTools = null;
}

export async function getAllTools(): Promise<ToolDef[]> {
  if (!cachedTools) {
    const userTools = await fetchUserTools();
    cachedTools = [...localTools(), ...userTools];
  }
  return cachedTools;
}
