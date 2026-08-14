export type InstalledSkill = {
  id: string;
  slash: string;
  title: string;
  body: string;
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

export async function deleteUserSkill(id: string): Promise<void> {
  const r = await fetch(API + "/" + encodeURIComponent(id), { method: "DELETE" });
  if (!r.ok && r.status !== 404) {
    throw new Error("删除失败");
  }
}
