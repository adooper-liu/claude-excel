import React, { useMemo, useState } from "react";
import type { Pack } from "../../services/user-skills";
import { formatExtensionConsent } from "../../services/user-skills";

interface Props {
  packs: Pack[];
  onInstallPack?: (packId: string) => Promise<void>;
  onUninstallPack?: (packId: string) => Promise<void>;
  onClose: () => void;
}

export default function PackMenu({
  packs,
  onInstallPack,
  onUninstallPack,
  onClose,
}: Props): JSX.Element {
  const [packBusy, setPackBusy] = useState<string | null>(null);
  const [packErr, setPackErr] = useState("");
  const [consentFor, setConsentFor] = useState<string | null>(null);

  const packGroups = useMemo(() => {
    const groups: Array<{ label: string; items: Pack[] }> = [];
    for (const p of packs) {
      const label = p.categoryLabel || p.category || "未分类";
      const g = groups.find((x) => x.label === label);
      if (g) g.items.push(p);
      else groups.push({ label, items: [p] });
    }
    return groups;
  }, [packs]);

  async function runInstall(packId: string): Promise<void> {
    if (!onInstallPack) return;
    setPackErr("");
    setPackBusy(packId);
    setConsentFor(null);
    try {
      await onInstallPack(packId);
    } catch (err) {
      setPackErr(err instanceof Error ? err.message : String(err));
    } finally {
      setPackBusy(null);
    }
  }

  function requestInstall(p: Pack): void {
    setPackErr("");
    if (p.extensions?.length && consentFor !== p.id) {
      setConsentFor(p.id);
      return;
    }
    void runInstall(p.id);
  }

  return (
    <div className="flyout pack-flyout" role="dialog" aria-label="场景包">
      <div className="flyout-head">
        <span>场景包</span>
        <button className="icon-btn" onClick={onClose} title="关闭" aria-label="关闭">
          ✕
        </button>
      </div>
      {packs.length === 0 ? (
        <p className="flyout-empty">暂无可用场景包。</p>
      ) : (
        <div className="pack-menu-groups">
          {packGroups.map((g) => (
            <div key={g.label} className="pack-menu-group">
              <div className="pack-group-label">{g.label}</div>
              {g.items.map((p) => (
                <div key={p.id} className="pack-menu-item">
                  <div className="pack-card-title">{p.title}</div>
                  {p.description && <div className="pack-card-desc">{p.description}</div>}
                  <div className="pack-card-meta">
                    {p.gate ? `Gate ${p.gate} · ` : ""}
                    {p.skills.map((s) => "/" + s.slash).join(" · ")}
                    {p.installed ? " · 已安装" : ""}
                  </div>
                  {!p.installed && onInstallPack && (
                    <>
                      {consentFor === p.id && (p.extensions?.length ?? 0) > 0 && (
                        <div className="pack-consent">
                          <div className="pack-consent-text">{formatExtensionConsent(p)}</div>
                          <div className="sample-actions">
                            <button
                              type="button"
                              className="sample-btn primary"
                              disabled={packBusy === p.id}
                              onClick={() => void runInstall(p.id)}
                            >
                              {packBusy === p.id ? "安装中…" : "确认安装"}
                            </button>
                            <button
                              type="button"
                              className="sample-btn ghost"
                              disabled={packBusy === p.id}
                              onClick={() => setConsentFor(null)}
                            >
                              取消
                            </button>
                          </div>
                        </div>
                      )}
                      {consentFor !== p.id && (
                        <button
                          type="button"
                          className="pack-install-btn"
                          disabled={packBusy === p.id}
                          onClick={() => requestInstall(p)}
                        >
                          {packBusy === p.id ? "安装中…" : "安装"}
                        </button>
                      )}
                    </>
                  )}
                  {p.installed && onUninstallPack && (
                    <button
                      type="button"
                      className="pack-install-btn pack-uninstall-btn"
                      disabled={packBusy === p.id}
                      onClick={() => {
                        setPackErr("");
                        setPackBusy(p.id);
                        void onUninstallPack(p.id)
                          .catch((err) => {
                            setPackErr(err instanceof Error ? err.message : String(err));
                          })
                          .finally(() => setPackBusy(null));
                      }}
                    >
                      {packBusy === p.id ? "卸载中…" : "卸载"}
                    </button>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      {packErr && <p className="pack-menu-err">{packErr}</p>}
    </div>
  );
}
