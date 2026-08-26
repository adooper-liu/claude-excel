/**
 * BackupSection.tsx — 备份与迁移：导出 / 导入备份（不含 API Key，导入后需重新填写）。
 */
import React, { useCallback, useRef, useState } from 'react';

interface Props {
  proxyUrl: string;
}

interface PreviewData {
  skills: string[];
  knowledge: string[];
  packs: Array<{ id: string; source: string; hasExtensions: boolean }>;
  needsConsent: boolean;
}

export default function BackupSection({ proxyUrl }: Props): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [consent, setConsent] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleExport = useCallback(async () => {
    setBusy(true);
    setMsg('');
    try {
      const r = await fetch(`${proxyUrl}/api/backup/export`);
      if (!r.ok) {
        const err = await r.text();
        setMsg(`导出失败：${r.status} ${err}`);
        return;
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `sheetwise-backup-${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      setMsg('已导出备份文件。');
    } catch {
      setMsg('导出失败：无法连接后端');
    } finally {
      setBusy(false);
    }
  }, [proxyUrl]);

  const handlePreview = useCallback(async () => {
    if (!file) return;
    setBusy(true);
    setMsg('');
    try {
      const form = new FormData();
      form.append('file', file);
      const r = await fetch(`${proxyUrl}/api/backup/import/preview`, { method: 'POST', body: form });
      if (!r.ok) {
        const err = await r.text();
        setMsg(`导入失败：${r.status} ${err}`);
        return;
      }
      const data = (await r.json()) as {
        contents: { skills?: string[]; knowledge?: string[]; packs?: PreviewData['packs'] };
        needsConsent?: boolean;
      };
      setPreview({
        skills: data.contents?.skills || [],
        knowledge: data.contents?.knowledge || [],
        packs: data.contents?.packs || [],
        needsConsent: !!data.needsConsent,
      });
    } catch {
      setMsg('读取备份失败：无法连接后端');
    } finally {
      setBusy(false);
    }
  }, [file, proxyUrl]);

  const handleApply = useCallback(async () => {
    if (!file) return;
    if (preview?.needsConsent && !consent) {
      setMsg('请先勾选「我信任这些扩展」再导入。');
      return;
    }
    setBusy(true);
    setMsg('');
    try {
      const form = new FormData();
      form.append('file', file);
      if (consent) form.append('consentExtensions', 'true');
      const r = await fetch(`${proxyUrl}/api/backup/import/apply`, { method: 'POST', body: form });
      if (!r.ok) {
        const err = await r.text();
        setMsg(`导入失败：${r.status} ${err}`);
        return;
      }
      const result = (await r.json()) as { restored?: { skills?: string[]; knowledge?: string[]; packs?: string[] } };
      const list = [
        ...(result.restored?.skills?.length ? [`技能 ${result.restored.skills.length}`] : []),
        ...(result.restored?.knowledge?.length ? [`知识 ${result.restored.knowledge.length}`] : []),
        ...(result.restored?.packs?.length ? [`场景包 ${result.restored.packs.length}`] : []),
      ];
      setMsg(`导入完成：${list.join('、')}。`);
      setPreview(null);
      setConsent(false);
      if (fileRef.current) fileRef.current.value = '';
    } catch {
      setMsg('导入失败：无法连接后端');
    } finally {
      setBusy(false);
    }
  }, [file, preview, consent, proxyUrl]);

  return (
    <div style={{ marginTop: 16, borderTop: '1px solid #e5e7eb', paddingTop: 12 }}>
      <h3>备份与迁移</h3>
      <div style={{ fontSize: 11, color: '#999', marginBottom: 8 }}>
        备份不含 API Key，导入后请在设置中重新填写。
      </div>
      <button onClick={() => void handleExport()} disabled={busy}>
        {busy ? '处理中...' : '导出备份'}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".zip"
        style={{ display: 'block', margin: '8px 0' }}
        onChange={(e) => handlePreviewGuard(e.target.files?.[0] ?? null)}
      />
      {file && !preview && (
        <button onClick={() => void handlePreview()} disabled={busy}>
          预览备份
        </button>
      )}
      {preview && (
        <div style={{ margin: '8px 0' }}>
          <div style={{ fontSize: 12 }}>
            备份含：技能 {preview.skills.length} 个、知识 {preview.knowledge.length} 个、场景包 {preview.packs.length} 个。
          </div>
          {preview.needsConsent && (
            <label style={{ display: 'block', margin: '6px 0', color: '#dc2626', fontSize: 12 }}>
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
              此备份含本机扩展（user.*），我信任这些扩展
            </label>
          )}
          <button onClick={() => void handleApply()} disabled={busy}>
            确认导入
          </button>
        </div>
      )}
      {msg && <div style={{ fontSize: 12, marginTop: 6 }}>{msg}</div>}
    </div>
  );

  function handlePreviewGuard(f: File | null) {
    setFile(f);
    setPreview(null);
    setMsg('');
  }
}
