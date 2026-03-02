export default function LoadingOverlay({ message }) {
  return (
    <div className="loading-overlay">
      <div className="spinner" />
      <p className="loading-text">{message}</p>
    </div>
  );
}
