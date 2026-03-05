export default function Header({ sidebarOpen, onToggleSidebar }) {
  return (
    <header className="header">
      <div className="logo">
        Fit<span>AR</span>
      </div>
      <span className="badge">VIRTUAL TRY-ON</span>
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
    </header>
  );
}
