import React, { useMemo, useRef, useState } from "react";
import type { Pack } from "../../services/user-skills";
import { formatExtensionConsent } from "../../services/user-skills";
import { FINANCE_PACK_ID, importFinanceCsvFiles } from "../../services/finance-csv-import";

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
  const [ordersFile, setOrdersFile] = useState<File | null>(null);
  const [adsFile, setAdsFile] = useState<File | null>(null);
  const [importMsg, setImportMsg] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const ordersInputRef = useRef<HTMLInputElement>(null);
  const adsInputRef = useRef<HTMLInputElement>(null);

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

  async function runCsvImport(): Promise<void> {
    if (!ordersFile || !adsFile) {
      setPackErr("请先选择订单 CSV 和广告 CSV");
      return;
    }
    setPackErr("");
    setImportMsg("");
    setImportBusy(true);
    try {
      const r = await importFinanceCsvFiles(ordersFile, adsFile);
      setImportMsg(
        "已导入 " +
          r.orderSheet +
          "（" +
          r.orderRows +
          " 行）与 " +
          r.adsSheet +
          "（" +
          r.adsRows +
          " 行）。发 /跨境业财 跑 recipe。"
      );
      setOrdersFile(null);
      setAdsFile(null);
    } catch (err) {
      setPackErr(err instanceof Error ? err.message : String(err));
    } finally {
      setImportBusy(false);
    }
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
                  {p.installed && p.id === FINANCE_PACK_ID && (
                    <div className="pack-csv-import">
                      <div className="pack-csv-import-label">导入 CSV（真实业务数据）</div>
                      <input
                        ref={ordersInputRef}
                        type="file"
                        accept=".csv,text/csv"
                        className="pack-csv-input-hidden"
                        onChange={(e) => {
                          setOrdersFile(e.target.files?.[0] || null);
                          setImportMsg("");
                        }}
                      />
                      <input
                        ref={adsInputRef}
                        type="file"
                        accept=".csv,text/csv"
                        className="pack-csv-input-hidden"
                        onChange={(e) => {
                          setAdsFile(e.target.files?.[0] || null);
                          setImportMsg("");
                        }}
                      />
                      <div className="pack-csv-import-actions">
                        <button
                          type="button"
                          className="sample-btn ghost"
                          disabled={importBusy}
                          onClick={() => ordersInputRef.current?.click()}
                        >
                          {ordersFile ? "订单 ✓" : "选订单 CSV"}
                        </button>
                        <button
                          type="button"
                          className="sample-btn ghost"
                          disabled={importBusy}
                          onClick={() => adsInputRef.current?.click()}
                        >
                          {adsFile ? "广告 ✓" : "选广告 CSV"}
                        </button>
                        <button
                          type="button"
                          className="pack-install-btn"
                          disabled={importBusy || !ordersFile || !adsFile}
                          onClick={() => void runCsvImport()}
                        >
                          {importBusy ? "导入中…" : "导入并写表"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      {packErr && <p className="pack-menu-err">{packErr}</p>}
      {importMsg && <p className="pack-menu-ok">{importMsg}</p>}
    </div>
  );
}
