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
      <span>💡</span> Stand 1–2 meters from camera · Face forward · Keep arms slightly out
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
  lastPose,
  currentCloth,
}) {
  return (
    <div className="camera-area">
      <video ref={videoRef} autoPlay playsInline muted className="webcam" />
      <canvas ref={overlayCanvasRef} className="overlay-canvas" />
      <div ref={threeContainerRef} className="three-container" />
      {!cameraActive && <CameraPlaceholder onStart={onStartCamera} />}
      {cameraActive && <StatusBar dot={status.dot} message={status.message} />}
      {loading.visible && <LoadingOverlay message={loading.message} />}
      {noPersonDetected && <HintBox />}
      {cameraActive && (
        <div style={{
          position: 'absolute', bottom: 60, left: 10,
          background: 'rgba(0,0,0,0.7)', color: '#e8ff47',
          fontSize: '10px', padding: '6px 10px', borderRadius: '6px',
          fontFamily: 'monospace', lineHeight: 1.8, zIndex: 20
        }}>
          <div>Cloth: {currentCloth}</div>
          <div>Video: {videoRef.current?.videoWidth}x{videoRef.current?.videoHeight}</div>
          <div>Container: {threeContainerRef.current?.clientWidth}x{threeContainerRef.current?.clientHeight}</div>
          <div>L shoulder: ({Math.round(lastPose?.keypoints[5]?.x)}, {Math.round(lastPose?.keypoints[5]?.y)})</div>
          <div>R shoulder: ({Math.round(lastPose?.keypoints[6]?.x)}, {Math.round(lastPose?.keypoints[6]?.y)})</div>
          <div>Expected NDC Y: {lastPose ? (-(((lastPose.keypoints[5]?.y + lastPose.keypoints[6]?.y)/2 / (videoRef.current?.videoHeight||720)) * 2 - 1)).toFixed(2) : 'n/a'}</div>
        </div>
      )}
    </div>
  );
}
