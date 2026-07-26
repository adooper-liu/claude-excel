import React, { useCallback, useRef, DragEvent } from 'react';

interface Props { onUpload: (file: File) => void; disabled: boolean }

export default function FileUpload({ onUpload, disabled }: Props): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = React.useState(false);

  const handleFile = useCallback((f: File) => {
    if (f.name.endsWith('.xlsx') || f.name.endsWith('.xls') || f.name.endsWith('.csv')) {
      onUpload(f);
    }
  }, [onUpload]);

  const onDrop = useCallback((e: DragEvent) => { e.preventDefault(); setDragOver(false);
    const f = e.dataTransfer.files[0]; if (f) handleFile(f); }, [handleFile]);

  const onChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (f) handleFile(f); }, [handleFile]);

  return (
    <div className={`file-upload ${dragOver ? 'drag-over' : ''}`}
         onDragOver={e => { e.preventDefault(); setDragOver(true); }}
         onDragLeave={() => setDragOver(false)}
         onDrop={onDrop}
         onClick={() => inputRef.current?.click()}>
      <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" onChange={onChange} hidden />
      <div className="upload-icon">📁</div>
      <p>拖拽 Excel 文件到这里<br/>或点击上传</p>
    </div>
  );
}
