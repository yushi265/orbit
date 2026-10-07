export function EmptyState({
  title,
  action,
  onAction,
}: {
  title: string;
  action: string;
  onAction: () => void;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">◌</span>
      <strong>{title}</strong>
      <p>まだ表示するデータがありません。</p>
      <button className="text-button" onClick={onAction}>
        {action} →
      </button>
    </div>
  );
}
