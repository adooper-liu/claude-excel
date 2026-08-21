/** Single import list for core skill manifest.json files under addin/skills/core/ */

import chart from "../../skills/core/chart/manifest.json";
import format from "../../skills/core/format/manifest.json";
import formula from "../../skills/core/formula/manifest.json";
import inspect from "../../skills/core/inspect/manifest.json";
import navigation from "../../skills/core/navigation/manifest.json";
import readWrite from "../../skills/core/read-write/manifest.json";
import reconcile from "../../skills/core/reconcile/manifest.json";
import reshape from "../../skills/core/reshape/manifest.json";
import calculate from "../../skills/core/calculate/manifest.json";
import pivot from "../../skills/core/pivot/manifest.json";
import sortFilter from "../../skills/core/sort-filter/manifest.json";
import table from "../../skills/core/table/manifest.json";
import web from "../../skills/core/web/manifest.json";
import knowledge from "../../skills/core/knowledge/manifest.json";
import flows from "../../skills/core/flows/manifest.json";
import structure from "../../skills/core/structure/manifest.json";
import packAudit from "../../skills/core/pack-audit/manifest.json";

export type ManifestTool = { name: string; description?: string };
export type CoreSkillManifest = {
  name: string;
  description?: string;
  tools: ManifestTool[];
};

export const CORE_SKILL_MANIFESTS: CoreSkillManifest[] = [
  inspect,
  table,
  readWrite,
  reshape,
  reconcile,
  calculate,
  pivot,
  formula,
  sortFilter,
  format,
  chart,
  navigation,
  web,
  knowledge,
  flows,
  structure,
  packAudit,
] as CoreSkillManifest[];
