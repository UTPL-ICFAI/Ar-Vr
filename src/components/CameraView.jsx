import StatusBar from './StatusBar';
import LoadingOverlay from './LoadingOverlay';

function CameraPlaceholder({ onStart }) {
  return (
    <div className="camera-placeholder">
      <div className="camera-placeholder-inner">
        <div className="camera-icon">📷</div>
        <p>Position yourself in front of the camera and try on clothes virtually in real time.</p>
        <button className="start-btn" onClick={onStart}>
          START CAMERA
        </button>
      </div>
    </div>
  );
}

function HintBox() {
  return (
    <div className="hint-box">
      <span>💡</span> Stand 1–2 m away · Face forward · Arms slightly out
    </div>
  );
}

export default function CameraView({
  videoRef,
  overlayCanvasRef,
  threeContainerRef,
  cameraActive,
  status,
  loading,
  noPersonDetected,
  onStartCamera,
  isFrontCamera,
}) {
  return (
    <div className="camera-area">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className={`webcam${isFrontCamera ? ' mirrored' : ''}`}
      />
      <canvas
        ref={overlayCanvasRef}
        className={`overlay-canvas${isFrontCamera ? ' mirrored' : ''}`}
      />
      <div
        ref={threeContainerRef}
        className={`three-container${isFrontCamera ? ' mirrored' : ''}`}
      />
      {!cameraActive && <CameraPlaceholder onStart={onStartCamera} />}
      {cameraActive && <StatusBar dot={status.dot} message={status.message} />}
      {loading.visible && <LoadingOverlay message={loading.message} />}
      {noPersonDetected && <HintBox />}
    </div>
  );
}
