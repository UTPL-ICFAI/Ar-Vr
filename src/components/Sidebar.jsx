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
  isOpen,
  onClose,
}) {
  const handleSelectCloth = (id) => {
    onSelectCloth(id);
    // Auto-close sidebar on mobile after selection
    if (window.innerWidth < 1024) onClose();
  };

  return (
    <>
      <div
        className={`sidebar-overlay${isOpen ? ' visible' : ''}`}
        onClick={onClose}
      />
      <div className={`sidebar${isOpen ? ' open' : ''}`}>
        <div className="sidebar-header">
          <h2>WARDROBE</h2>
          <p>Select a garment to try on</p>
        </div>
        <div className="sidebar-scroll">
          <div className="clothes-grid">
            {GARMENTS.map((g) => (
              <ClothCard
                key={g.id}
                garment={g}
                isActive={currentCloth === g.id}
                isLoaded={!!loadedModels?.[g.id]}
                isLoading={currentCloth === g.id && !loadedModels?.[g.id] && g.id !== 'none'}
                onClick={() => handleSelectCloth(g.id)}
              />
            ))}
          </div>
          <button
            className={`btn-flip${garmentFlipped ? ' flipped' : ''}`}
            onClick={onToggleFlip}
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
      </div>
    </>
  );
}
