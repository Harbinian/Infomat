export default function DeliverableActions({
  deliverable,
  onDownload,
  onGenerate,
  onUpload,
  busy = false,
}) {
  if (!deliverable) return null;

  const handleUpload = event => {
    const file = event.target.files?.[0];
    if (file) onUpload?.(deliverable, file);
    event.target.value = '';
  };

  return (
    <div className="deliverable-actions">
      <button type="button" className="action-btn tone-neutral" onClick={() => onGenerate?.(deliverable)} disabled={busy}>
        生成模板
      </button>
      <label className="action-btn tone-primary">
        {busy ? '上传中' : '上传凭证'}
        <input type="file" accept=".md,.markdown,.docx,.xlsx" onChange={handleUpload} disabled={busy} />
      </label>
      <button type="button" className="action-btn tone-neutral" onClick={() => onDownload?.(deliverable)} disabled={busy}>
        下载正本
      </button>
    </div>
  );
}
