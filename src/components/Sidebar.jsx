import GARMENTS from '../constants/garments';
import ClothCard from './ClothCard';
import AdjustmentSliders from './AdjustmentSliders';

export default function Sidebar({
  currentCloth,
  adjustments,
  onSelectCloth,
  onAdjustmentChange,
  onReset,
  onSnapshot,
  onPreset,
  loadedModels,
  garmentFlipped,
  onToggleFlip,
}) {
  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <h2>WARDROBE</h2>
        <p>Select a garment to try on</p>
      </div>
      <div className="clothes-grid">
        {GARMENTS.map((g) => (
          <ClothCard
            key={g.id}
            garment={g}
            isActive={currentCloth === g.id}
            isLoaded={!!loadedModels?.[g.id]}
            isLoading={currentCloth === g.id && !loadedModels?.[g.id] && g.id !== 'none'}
            onClick={() => onSelectCloth(g.id)}
          />
        ))}
      </div>
      <button
        onClick={onToggleFlip}
        style={{
          margin: '0 20px 12px',
          padding: '10px',
          background: garmentFlipped ? 'var(--accent)' : 'transparent',
          color: garmentFlipped ? '#000' : 'var(--text)',
          border: '1px solid var(--border)',
          borderRadius: '8px',
          cursor: 'pointer',
          fontFamily: 'DM Sans, sans-serif',
          fontSize: '0.82rem',
          width: 'calc(100% - 40px)',
          transition: 'all 0.2s',
        }}
      >
        {garmentFlipped ? '↩ Front View' : '↪ Flip Garment'}
      </button>
      <AdjustmentSliders
        adjustments={adjustments}
        onChange={onAdjustmentChange}
        onReset={onReset}
        onSnapshot={onSnapshot}
        onPreset={onPreset}
      />
    </div>
  );
}
