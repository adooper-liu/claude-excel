import type { ToolDef } from './claude';
import { assertManifestExecutors } from './skill-registry';
import chart from '../../skills/core/chart/manifest.json';
import format from '../../skills/core/format/manifest.json';
import formula from '../../skills/core/formula/manifest.json';
import inspect from '../../skills/core/inspect/manifest.json';
import navigation from '../../skills/core/navigation/manifest.json';
import readWrite from '../../skills/core/read-write/manifest.json';
import reconcile from '../../skills/core/reconcile/manifest.json';
import reshape from '../../skills/core/reshape/manifest.json';
import calculate from '../../skills/core/calculate/manifest.json';
import sortFilter from '../../skills/core/sort-filter/manifest.json';
import table from '../../skills/core/table/manifest.json';
import web from '../../skills/core/web/manifest.json';

const LOCAL_MANIFESTS = [
  chart, format, formula, inspect, navigation, readWrite, reconcile, reshape, calculate, sortFilter, table, web,
];

function localTools(): ToolDef[] {
  const tools = LOCAL_MANIFESTS.flatMap(
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
