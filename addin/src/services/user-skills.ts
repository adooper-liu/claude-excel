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

const API = "https://localhost:8765/api/user-skills";

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

export async function deleteUserSkill(id: string): Promise<void> {
  const r = await fetch(API + "/" + encodeURIComponent(id), { method: "DELETE" });
  if (!r.ok && r.status !== 404) {
    throw new Error("删除失败");
  }
}
