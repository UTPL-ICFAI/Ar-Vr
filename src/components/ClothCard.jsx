export default function ClothCard({ garment, isActive, isLoaded, isLoading, onClick }) {
  return (
    <div
      className={isActive ? 'cloth-card active' : 'cloth-card'}
      onClick={onClick}
    >
      <div className="cloth-icon">{garment.emoji}</div>
      <div className="cloth-name">{garment.name}</div>
      <div className="cloth-type">{garment.type}</div>
      {isActive && <div className="active-badge">✓</div>}
      {isLoaded && !isActive && (
        <div className="loaded-dot" style={{
          position: 'absolute', top: 8, left: 8,
          width: 8, height: 8, borderRadius: '50%',
          background: '#4ade80'
        }} />
      )}
      {isLoading && (
        <div className="loading-indicator" style={{
          position: 'absolute', top: 8, left: 8,
          width: 10, height: 10, borderRadius: '50%',
          border: '2px solid var(--border)',
          borderTopColor: 'var(--accent)',
          animation: 'spin 0.8s linear infinite'
        }} />
      )}
    </div>
  );
}
