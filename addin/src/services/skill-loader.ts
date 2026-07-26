import type { ToolDef } from './claude';

const SKILLS_URL = 'https://localhost:8765/api/skills';

let cachedTools: ToolDef[] | null = null;

export async function getAllTools(): Promise<ToolDef[]> {
  if (cachedTools) return cachedTools;
  try {
    const resp = await fetch(SKILLS_URL);
    const data = await resp.json();
    cachedTools = data.tools || [];
    return cachedTools;
  } catch {
    return cachedTools || [];
  }
}
