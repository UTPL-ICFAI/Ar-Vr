import GARMENTS from '../constants/garments';

/**
 * Mobile bottom bar — horizontal garment strip + floating snapshot button.
 * Renders over the camera view on mobile, hidden on desktop.
 */
export default function BottomBar({
  currentCloth,
  onSelectCloth,
  onSnapshot,
  loadedModels,
  cameraActive,
}) {
  if (!cameraActive) return null;

  return (
    <div className="bottom-bar">
      <div className="garment-strip">
        {GARMENTS.map((g) => (
          <button
            key={g.id}
            className={`garment-chip${currentCloth === g.id ? ' active' : ''}`}
            onClick={() => onSelectCloth(g.id)}
          >
            <span className="chip-icon">{g.emoji}</span>
            <span className="chip-label">{g.name}</span>
            {!!loadedModels?.[g.id] && currentCloth !== g.id && (
              <span className="chip-dot" />
            )}
          </button>
        ))}
      </div>
      <button className="fab-snapshot" onClick={onSnapshot} aria-label="Take snapshot">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="13" r="4" stroke="currentColor" strokeWidth="2"/>
          <path d="M5 7h2l1.5-2h7L17 7h2a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9a2 2 0 012-2z" stroke="currentColor" strokeWidth="2"/>
        </svg>
      </button>
    </div>
  );
}
