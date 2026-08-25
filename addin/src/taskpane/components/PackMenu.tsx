import React, { useMemo, useRef, useState } from "react";
import type { Pack, SampleSkill } from "../../services/user-skills";
import { exportPack, formatExtensionConsent } from "../../services/user-skills";
import { FINANCE_PACK_ID, importFinanceCsvFiles } from "../../services/finance-csv-import";

interface Props {
  packs: Pack[];
  samples: SampleSkill[];
  installedIds: Set<string>;
  onInstallPack?: (packId: string) => Promise<void>;
  onUninstallPack?: (packId: string) => Promise<void>;
  onInstallSample?: (sampleId: string) => Promise<void>;
  onUninstallSample?: (sampleId: string) => Promise<void>;
  onImportPack?: (file: File) => Promise<void>;
  onRemoveImportedPack?: (id: string) => Promise<void>;
  onCreatePack?: () => void;
  onClose: () => void;
}

export default function PackMenu({
  packs,
  samples,
  installedIds,
  onInstallPack,
  onUninstallPack,
  onInstallSample,
  onUninstallSample,
  onImportPack,
  onRemoveImportedPack,
  onCreatePack,
  onClose,
}: Props): JSX.Element {
  const [packBusy, setPackBusy] = useState<string | null>(null);
  const [sampleBusy, setSampleBusy] = useState<string | null>(null);
  const [packErr, setPackErr] = useState("");
  const [consentFor, setConsentFor] = useState<string | null>(null);
  const [ordersFile, setOrdersFile] = useState<File | null>(null);
  const [adsFile, setAdsFile] = useState<File | null>(null);
  const [importMsg, setImportMsg] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const [importErr, setImportErr] = useState("");
  const importInputRef = useRef<HTMLInputElement>(null);
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
    <div className="flyout pack-flyout" role="dialog" aria-label="安装">
      <div className="flyout-head">
        <span>安装</span>
        <div className="flyout-head-actions">
          {onCreatePack && (
            <button
              type="button"
              className="sample-btn ghost"
              disabled={importBusy}
              onClick={() => {
                onClose();
                onCreatePack();
              }}
              title="对话创建场景包"
            >
              创建 Pack
            </button>
          )}
          <button
            type="button"
            className="sample-btn ghost"
            disabled={importBusy}
            onClick={() => importInputRef.current?.click()}
            title="导入 Pack (zip)"
          >
            {importBusy ? "导入中…" : "导入"}
          </button>
          <button className="icon-btn" onClick={onClose} title="关闭" aria-label="关闭">
            ✕
          </button>
        </div>
      </div>
      <input
        ref={importInputRef}
        type="file"
        accept=".zip,application/zip"
        className="pack-csv-input-hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f || !onImportPack) return;
          setImportErr("");
          setImportBusy(true);
          try {
            await onImportPack(f);
          } catch (err) {
            setImportErr(err instanceof Error ? err.message : String(err));
          } finally {
            setImportBusy(false);
            e.target.value = "";
          }
        }}
      />
      {packs.length === 0 && samples.length === 0 ? (
        <p className="flyout-empty">暂无可用示例。</p>
      ) : (
        <div className="pack-menu-groups">
          {packGroups.map((g) => (
            <div key={g.label} className="pack-menu-group">
              <div className="pack-group-label">{g.label}</div>
              {g.items.map((p) => (
                <div key={p.id} className="pack-menu-item">
                  <div className="pack-card-title">
                    {p.title}
                    {p.source === "third-party" && <span className="pack-badge">第三方</span>}
                  </div>
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
                  {p.source === "third-party" && !p.installed && onRemoveImportedPack && (
                    <button
                      type="button"
                      className="sample-btn ghost"
                      onClick={() => {
                        setPackErr("");
                        void onRemoveImportedPack(p.id).catch((err) =>
                          setPackErr(err instanceof Error ? err.message : String(err))
                        );
                      }}
                    >
                      删除来源
                    </button>
                  )}
                  <button
                    type="button"
                    className="sample-btn ghost"
                    onClick={() => {
                      setPackErr("");
                      void exportPack(p.id).catch((err) =>
                        setPackErr(err instanceof Error ? err.message : String(err))
                      );
                    }}
                  >
                    导出
                  </button>
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
          {samples.length > 0 && (
            <div className="pack-menu-group">
              <div className="pack-group-label">单个示例</div>
              {samples.map((s) => {
                const isInstalled = installedIds.has(s.id);
                return (
                  <div key={s.id} className="pack-menu-item">
                    <div className="pack-card-title">{s.title}</div>
                    <div className="pack-card-meta">
                      /{s.slash}
                      {isInstalled ? " · 已安装" : ""}
                    </div>
                    {!isInstalled && onInstallSample && (
                      <button
                        type="button"
                        className="pack-install-btn"
                        disabled={sampleBusy === s.id}
                        onClick={() => {
                          setPackErr("");
                          setSampleBusy(s.id);
                          void onInstallSample(s.id)
                            .catch((err) => {
                              setPackErr(err instanceof Error ? err.message : String(err));
                            })
                            .finally(() => setSampleBusy(null));
                        }}
                      >
                        {sampleBusy === s.id ? "安装中…" : "安装"}
                      </button>
                    )}
                    {isInstalled && onUninstallSample && (
                      <button
                        type="button"
                        className="pack-install-btn pack-uninstall-btn"
                        disabled={sampleBusy === s.id}
                        onClick={() => {
                          setPackErr("");
                          setSampleBusy(s.id);
                          void onUninstallSample(s.id)
                            .catch((err) => {
                              setPackErr(err instanceof Error ? err.message : String(err));
                            })
                            .finally(() => setSampleBusy(null));
                        }}
                      >
                        {sampleBusy === s.id ? "卸载中…" : "卸载"}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
      {packErr && <p className="pack-menu-err">{packErr}</p>}
      {importErr && <p className="pack-menu-err">{importErr}</p>}
      {importMsg && <p className="pack-menu-ok">{importMsg}</p>}
    </div>
  );
}
