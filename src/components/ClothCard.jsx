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
      {isLoaded && !isActive && <div className="loaded-dot" />}
      {isLoading && <div className="loading-indicator" />}
    </div>
  );
}
