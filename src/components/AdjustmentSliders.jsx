const FIT_PRESETS = [
  { label: 'Slim', scale: 0.85 },
  { label: 'Regular', scale: 1.0 },
  { label: 'Loose', scale: 1.2 },
];

export default function AdjustmentSliders({ adjustments, onChange, onReset, onSnapshot, onPreset }) {
  return (
    <div className="adjustments-section">
      <div className="adjustments-title">ADJUSTMENTS</div>

      {/* Fit presets */}
      <div className="preset-row" style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
        {FIT_PRESETS.map((p) => (
          <button
            key={p.label}
            className={`btn-preset${adjustments.scale === p.scale ? ' active' : ''}`}
            style={{
              flex: 1,
              padding: '4px 0',
              fontSize: 12,
              borderRadius: 4,
              border: adjustments.scale === p.scale ? '2px solid #6c63ff' : '1px solid #555',
              background: adjustments.scale === p.scale ? '#6c63ff22' : 'transparent',
              color: '#fff',
              cursor: 'pointer',
            }}
            onClick={() => onPreset && onPreset(p.scale)}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="slider-row">
        <span className="slider-label">Garment Size</span>
        <input
          className="slider-input"
          type="range"
          min="0.1"
          max="3"
          step="0.05"
          value={adjustments.scale}
          onChange={(e) => onChange('scale', parseFloat(e.target.value))}
        />
        <span className="slider-value">{adjustments.scale.toFixed(2)}</span>
      </div>

      <div className="slider-row">
        <span className="slider-label">Shift Left/Right</span>
        <input
          className="slider-input"
          type="range"
          min="-200"
          max="200"
          step="1"
          value={adjustments.x}
          onChange={(e) => onChange('x', parseFloat(e.target.value))}
        />
        <span className="slider-value">{adjustments.x}</span>
      </div>

      <div className="slider-row">
        <span className="slider-label">Shift Up/Down</span>
        <input
          className="slider-input"
          type="range"
          min="-200"
          max="200"
          step="1"
          value={adjustments.y}
          onChange={(e) => onChange('y', parseFloat(e.target.value))}
        />
        <span className="slider-value">{adjustments.y}</span>
      </div>

      <div className="slider-row">
        <span className="slider-label">Bring Forward/Back</span>
        <input
          className="slider-input"
          type="range"
          min="-50"
          max="50"
          step="1"
          value={adjustments.z}
          onChange={(e) => onChange('z', parseFloat(e.target.value))}
        />
        <span className="slider-value">{adjustments.z}</span>
      </div>

      <div className="action-buttons">
        <button className="btn-reset" onClick={onReset}>
          ↺ Reset
        </button>
        <button className="btn-snapshot" onClick={onSnapshot}>
          📸 Snapshot
        </button>
      </div>
    </div>
  );
}
