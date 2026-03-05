export default function Header({ sidebarOpen, onToggleSidebar, onSwitchCamera, cameraActive }) {
  return (
    <header className="header">
      <div className="logo">
        Fit<span>AR</span>
      </div>
      <span className="badge">VIRTUAL TRY-ON</span>

      <div className="header-actions">
        {cameraActive && (
          <button
            className="btn-camera-switch"
            onClick={onSwitchCamera}
            aria-label="Switch camera"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M11 19H4a2 2 0 01-2-2V7a2 2 0 012-2h5l2-2h4l2 2h3a2 2 0 012 2v4"/>
              <circle cx="12" cy="11" r="3"/>
              <path d="M17 22l3-3-3-3"/>
              <path d="M23 19H17"/>
            </svg>
          </button>
        )}
        <button
          className="hamburger-btn"
          onClick={onToggleSidebar}
          aria-label={sidebarOpen ? 'Close menu' : 'Open menu'}
        >
          <div className={`hamburger-icon${sidebarOpen ? ' open' : ''}`}>
            <span />
            <span />
            <span />
          </div>
        </button>
      </div>
    </header>
  );
}
