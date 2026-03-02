export default function StatusBar({ dot, message }) {
  return (
    <div className="status-bar">
      <div className={`status-dot ${dot}`} />
      <span>{message}</span>
    </div>
  );
}
