import type { ToolDef } from "./claude";
import { API_BASE } from "./api-config";

export type InstalledSkill = {
  id: string;
  slash: string;
  title: string;
  body: string;
};

export type SampleSkill = {
  id: string;
  slash: string;
  title: string;
  path?: string;
};

export type PackSkill = {
  id: string;
  slash: string;
  title: string;
};

export type PackExtension = {
  id: string;
  name: string;
  description: string;
  network: boolean;
  secrets: string[];
};

export type Pack = {
  id: string;
  source: string;
  category: string;
  categoryLabel: string;
  title: string;
  description: string;
  version: string;
  gate?: string;
  skills: PackSkill[];
  knowledge: string[];
  extensions: PackExtension[];
  deps: Record<string, unknown>;
  installed: boolean;
};

const API = API_BASE + "/api/user-skills";
const USER_FN_API = API_BASE + "/api/user-fn";

function asList(data: unknown): InstalledSkill[] {
  const skills = data && typeof data === "object" ? (data as { skills?: unknown }).skills : null;
  if (!Array.isArray(skills)) return [];
  const out: InstalledSkill[] = [];
  for (const s of skills) {
    if (!s || typeof s !== "object") continue;
    const id = String((s as InstalledSkill).id || "").trim();
    const slash = String((s as InstalledSkill).slash || "").trim();
    const title = String((s as InstalledSkill).title || "").trim();
    const body = String((s as InstalledSkill).body || "").trim();
    if (id && slash && title && body) out.push({ id, slash, title, body });
  }
  return out;
}

export async function fetchUserSkills(): Promise<InstalledSkill[]> {
  const r = await fetch(API);
  if (!r.ok) return [];
  return asList(await r.json());
}

export async function installUserSkill(markdown: string): Promise<InstalledSkill> {
  const r = await fetch(API, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ markdown }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const detail = typeof data.detail === "string" ? data.detail : "安装失败";
    throw new Error(detail);
  }
  const s = data.skill || data;
  return {
    id: String(s.id || ""),
    slash: String(s.slash || ""),
    title: String(s.title || ""),
    body: String(s.body || ""),
  };
}

export async function installSampleSkill(id: string): Promise<InstalledSkill> {
  const r = await fetch(API + "/install-sample", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const detail = typeof data.detail === "string" ? data.detail : "安装示例技能失败";
    throw new Error(detail);
  }
  const s = data.skill || data;
  return {
    id: String(s.id || ""),
    slash: String(s.slash || ""),
    title: String(s.title || ""),
    body: String(s.body || ""),
  };
}

export async function fetchSampleSkills(): Promise<SampleSkill[]> {
  const r = await fetch(API + "/samples");
  if (!r.ok) return [];
  const data = await r.json().catch(() => ({}));
  const samples = data && typeof data === "object" ? (data as { samples?: unknown }).samples : null;
  if (!Array.isArray(samples)) return [];
  const out: SampleSkill[] = [];
  for (const s of samples) {
    if (!s || typeof s !== "object") continue;
    const id = String((s as SampleSkill).id || "").trim();
    const slash = String((s as SampleSkill).slash || "").trim();
    const title = String((s as SampleSkill).title || "").trim();
    if (id && slash && title) out.push({ id, slash, title, path: String((s as SampleSkill).path || "") });
  }
  return out;
}

export async function fetchPacks(): Promise<Pack[]> {
  const r = await fetch(API + "/packs");
  if (!r.ok) return [];
  const data = await r.json().catch(() => ({}));
  const packs = data && typeof data === "object" ? (data as { packs?: unknown }).packs : null;
  if (!Array.isArray(packs)) return [];
  const out: Pack[] = [];
  for (const p of packs) {
    if (!p || typeof p !== "object") continue;
    const id = String((p as Pack).id || "").trim();
    if (!id) continue;
    out.push({
      id,
      source: String((p as Pack).source || "official"),
      category: String((p as Pack).category || ""),
      categoryLabel: String((p as Pack).categoryLabel || ""),
      title: String((p as Pack).title || id),
      description: String((p as Pack).description || ""),
      version: String((p as Pack).version || ""),
      gate: String((p as Pack).gate || ""),
      skills: Array.isArray((p as Pack).skills) ? ((p as Pack).skills as PackSkill[]) : [],
      knowledge: Array.isArray((p as Pack).knowledge) ? ((p as Pack).knowledge as string[]) : [],
      extensions: Array.isArray((p as Pack).extensions) ? ((p as Pack).extensions as PackExtension[]) : [],
      deps: (p as Pack).deps && typeof (p as Pack).deps === "object" ? ((p as Pack).deps as Record<string, unknown>) : {},
      installed: Boolean((p as Pack).installed),
    });
  }
  return out;
}

export function formatExtensionConsent(pack: Pick<Pack, "title" | "extensions">): string {
  const exts = pack.extensions || [];
  if (!exts.length) return "";
  const lines = exts.map((e) => {
    const caps: string[] = [];
    if (e.network) caps.push("可联网");
    if (e.secrets?.length) caps.push("会读取密钥");
    const cap = caps.length ? "（" + caps.join("、") + "）" : "";
    return "· " + (e.description || e.name) + cap;
  });
  return (
    "此 pack「" +
    pack.title +
    "」含 " +
    exts.length +
    " 个本机函数：\n" +
    lines.join("\n") +
    "\n\n允许这些函数在本机运行？"
  );
}

export async function fetchUserTools(): Promise<ToolDef[]> {
  const r = await fetch(USER_FN_API);
  if (!r.ok) return [];
  const data = await r.json().catch(() => ({}));
  const fns =
    data && typeof data === "object" ? (data as { functions?: unknown }).functions : null;
  if (!Array.isArray(fns)) return [];
  const out: ToolDef[] = [];
  for (const fn of fns) {
    if (!fn || typeof fn !== "object") continue;
    const name = String((fn as { name?: string }).name || "").trim();
    if (!name.startsWith("user.")) continue;
    const authorized = (fn as { authorized?: boolean }).authorized !== false;
    const description =
      String((fn as { description?: string }).description || name) +
      (authorized ? "" : "（未授权，需重新安装授权）");
    const params = (fn as { params?: ToolDef["input_schema"] }).params;
    const input_schema: ToolDef["input_schema"] =
      params && typeof params === "object" && params.type === "object"
        ? params
        : { type: "object", properties: {} };
    out.push({ name, description, input_schema });
  }
  return out;
}

export async function installPack(
  packId: string,
  opts?: { consentExtensions?: boolean }
): Promise<Pack> {
  const r = await fetch(API + "/install-pack", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      packId,
      consentExtensions: opts?.consentExtensions === true,
    }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const detail = typeof data.detail === "string" ? data.detail : "安装场景包失败";
    throw new Error(detail);
  }
  const p = (data && typeof data === "object" ? (data as { pack?: unknown }).pack : null) || {};
  return {
    id: String((p as Pack).id || packId),
    source: String((p as Pack).source || "official"),
    category: String((p as Pack).category || ""),
    categoryLabel: String((p as Pack).categoryLabel || ""),
    title: String((p as Pack).title || packId),
    description: String((p as Pack).description || ""),
    version: String((p as Pack).version || ""),
    skills: Array.isArray((p as Pack).skills) ? ((p as Pack).skills as PackSkill[]) : [],
    knowledge: Array.isArray((p as Pack).knowledge) ? ((p as Pack).knowledge as string[]) : [],
    extensions: Array.isArray((p as Pack).extensions) ? ((p as Pack).extensions as PackExtension[]) : [],
    deps: {},
    installed: true,
  };
}

export async function deleteUserSkill(id: string): Promise<void> {
  const r = await fetch(API + "/" + encodeURIComponent(id), { method: "DELETE" });
  if (!r.ok && r.status !== 404) {
    throw new Error("删除失败");
  }
}

export async function uninstallPack(packId: string): Promise<void> {
  const r = await fetch(API + "/packs/" + encodeURIComponent(packId), { method: "DELETE" });
  if (!r.ok && r.status !== 404) {
    throw new Error("卸载失败");
  }
}

export async function createPackFromFiles(
  files: Record<string, string>,
  opts?: { consentExtensions?: boolean }
): Promise<Pack> {
  const r = await fetch(API + "/create-pack", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      files,
      consentExtensions: opts?.consentExtensions === true,
    }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const detail = typeof data.detail === "string" ? data.detail : "创建场景包失败";
    throw new Error(detail);
  }
  const p = (data && typeof data === "object" ? (data as { pack?: unknown }).pack : null) || {};
  return {
    id: String((p as Pack).id || ""),
    source: String((p as Pack).source || "third-party"),
    category: String((p as Pack).category || ""),
    categoryLabel: String((p as Pack).categoryLabel || ""),
    title: String((p as Pack).title || ""),
    description: String((p as Pack).description || ""),
    version: String((p as Pack).version || ""),
    skills: Array.isArray((p as Pack).skills) ? ((p as Pack).skills as PackSkill[]) : [],
    knowledge: Array.isArray((p as Pack).knowledge) ? ((p as Pack).knowledge as string[]) : [],
    extensions: Array.isArray((p as Pack).extensions) ? ((p as Pack).extensions as PackExtension[]) : [],
    deps: {},
    installed: true,
  };
}

export async function createPack(
  zipBytes: Uint8Array,
  opts?: { consentExtensions?: boolean }
): Promise<Pack> {
  let binary = "";
  zipBytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  const r = await fetch(API + "/create-pack", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      zipBase64: btoa(binary),
      consentExtensions: opts?.consentExtensions === true,
    }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const detail = typeof data.detail === "string" ? data.detail : "创建场景包失败";
    throw new Error(detail);
  }
  const p = (data && typeof data === "object" ? (data as { pack?: unknown }).pack : null) || {};
  return {
    id: String((p as Pack).id || ""),
    source: String((p as Pack).source || "third-party"),
    category: String((p as Pack).category || ""),
    categoryLabel: String((p as Pack).categoryLabel || ""),
    title: String((p as Pack).title || ""),
    description: String((p as Pack).description || ""),
    version: String((p as Pack).version || ""),
    skills: Array.isArray((p as Pack).skills) ? ((p as Pack).skills as PackSkill[]) : [],
    knowledge: Array.isArray((p as Pack).knowledge) ? ((p as Pack).knowledge as string[]) : [],
    extensions: Array.isArray((p as Pack).extensions) ? ((p as Pack).extensions as PackExtension[]) : [],
    deps: {},
    installed: true,
  };
}

export async function importPackZip(file: File): Promise<Pack> {
  const fd = new FormData();
  fd.append("file", file);
  const r = await fetch(API + "/packs/import", { method: "POST", body: fd });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const detail = typeof data.detail === "string" ? data.detail : "导入失败";
    throw new Error(detail);
  }
  const p = (data && typeof data === "object" ? (data as { pack?: unknown }).pack : null) || {};
  return {
    id: String((p as Pack).id || ""),
    source: String((p as Pack).source || "third-party"),
    category: String((p as Pack).category || ""),
    categoryLabel: String((p as Pack).categoryLabel || "第三方"),
    title: String((p as Pack).title || ""),
    description: String((p as Pack).description || ""),
    version: String((p as Pack).version || ""),
    gate: String((p as Pack).gate || ""),
    skills: Array.isArray((p as Pack).skills) ? ((p as Pack).skills as PackSkill[]) : [],
    knowledge: Array.isArray((p as Pack).knowledge) ? ((p as Pack).knowledge as string[]) : [],
    extensions: Array.isArray((p as Pack).extensions) ? ((p as Pack).extensions as PackExtension[]) : [],
    deps: (p as Pack).deps && typeof (p as Pack).deps === "object" ? ((p as Pack).deps as Record<string, unknown>) : {},
    installed: false,
  };
}

export async function removeImportedPack(id: string): Promise<void> {
  const r = await fetch(API + "/packs/imported/" + encodeURIComponent(id), { method: "DELETE" });
  if (!r.ok && r.status !== 404) throw new Error("删除来源失败");
}

export async function exportPack(id: string): Promise<void> {
  const r = await fetch(API + "/packs/" + encodeURIComponent(id) + "/export");
  if (!r.ok) throw new Error("导出失败");
  const blob = await r.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = id + ".zip";
  a.click();
  URL.revokeObjectURL(url);
}
