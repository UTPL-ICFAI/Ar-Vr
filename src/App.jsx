import { useRef, useState, useCallback, useEffect } from 'react';
import './App.css';

import Header from './components/Header';
import CameraView from './components/CameraView';
import Sidebar from './components/Sidebar';
import BottomBar from './components/BottomBar';

import useCamera from './hooks/useCamera';
import usePoseDetection from './hooks/usePoseDetection';
import useThreeJS from './hooks/useThreeJS';
import useTouchGestures from './hooks/useTouchGestures';
import { takeSnapshot } from './utils/snapshotUtils';

function App() {
  const videoRef         = useRef(null);
  const overlayCanvasRef = useRef(null);
  const threeContainerRef = useRef(null);
  const lastPoseRef      = useRef(null);

  const [cameraActive, setCameraActive]     = useState(false);
  const [isFrontCamera, setIsFrontCamera]   = useState(true);
  const [currentCloth, setCurrentCloth]     = useState('none');
  const [status, setStatus]                 = useState({ dot: '', message: 'Tap Start Camera' });
  const [loading, setLoading]               = useState({ visible: false, message: '' });
  const [adjustments, setAdjustments]       = useState({ scale: 1.0, y: 0, x: 0, z: 0 });
  const [noPersonDetected, setNoPersonDetected] = useState(false);
  const [loadedModels, setLoadedModels]     = useState({});
  const [garmentFlipped, setGarmentFlipped] = useState(false);
  const [sidebarOpen, setSidebarOpen]       = useState(false);

  // Reset flip on garment change
  useEffect(() => { setGarmentFlipped(false); }, [currentCloth]);

  // ── Camera ──
  const handleCameraReady = useCallback((facingMode) => {
    setCameraActive(true);
    setIsFrontCamera(facingMode === 'user');
    setStatus({ dot: 'active', message: 'Camera active' });
    setLoading({ visible: false, message: '' });
  }, []);

  const { startCamera, switchCamera } = useCamera(videoRef, handleCameraReady);

  const handleStartCamera = useCallback(async () => {
    setLoading({ visible: true, message: 'Starting camera...' });
    try {
      await startCamera('user');
    } catch {
      setStatus({ dot: 'error', message: 'Camera access denied' });
      setLoading({ visible: false, message: '' });
    }
  }, [startCamera]);

  const handleSwitchCamera = useCallback(async () => {
    try {
      setLoading({ visible: true, message: 'Switching camera...' });
      await switchCamera();
    } catch {
      setStatus({ dot: 'error', message: 'Camera switch failed' });
      setLoading({ visible: false, message: '' });
    }
  }, [switchCamera]);

  // ── Pose ──
  const handlePoseResult = useCallback((pose) => {
    lastPoseRef.current = pose;
    if (pose) {
      setNoPersonDetected(false);
      setStatus({ dot: 'detecting', message: 'Tracking' });
    } else {
      setNoPersonDetected(true);
      setStatus({ dot: 'active', message: 'No pose — move closer' });
    }
  }, []);

  // ── Adjustments ──
  const handleAdjustmentChange = useCallback((key, value) => {
    setAdjustments((prev) => ({ ...prev, [key]: value }));
  }, []);

  const handleReset = useCallback(() => {
    setAdjustments({ scale: 1.0, y: 0, x: 0, z: 0 });
  }, []);

  const handlePreset = useCallback((scale) => {
    setAdjustments((prev) => ({ ...prev, scale }));
  }, []);

  const handleModelLoaded = useCallback((id) => {
    setLoadedModels((prev) => ({ ...prev, [id]: true }));
  }, []);

  // ── Hooks ──
  usePoseDetection(videoRef, overlayCanvasRef, cameraActive, handlePoseResult, isFrontCamera);

  const { rendererRef, sceneRef, cameraRef } = useThreeJS(
    threeContainerRef, videoRef, currentCloth, adjustments,
    lastPoseRef, handleModelLoaded, garmentFlipped, null, // onBonesLoaded = null (no debug)
    isFrontCamera,
  );

  // Touch gestures (pinch to scale, drag to reposition)
  useTouchGestures(threeContainerRef, handleAdjustmentChange, adjustments);

  // ── Snapshot ──
  const handleSnapshot = useCallback(() => {
    if (videoRef.current && rendererRef.current && sceneRef.current && cameraRef.current) {
      takeSnapshot(videoRef.current, rendererRef.current, sceneRef.current, cameraRef.current);
    }
  }, [rendererRef, sceneRef, cameraRef]);

  // ── Sidebar ──
  const toggleSidebar = useCallback(() => setSidebarOpen((o) => !o), []);
  const closeSidebar  = useCallback(() => setSidebarOpen(false), []);

  return (
    <div className={`app-layout${isFrontCamera ? ' front-camera' : ' back-camera'}`}>
      <Header
        sidebarOpen={sidebarOpen}
        onToggleSidebar={toggleSidebar}
        onSwitchCamera={handleSwitchCamera}
        cameraActive={cameraActive}
      />

      <div className="main-layout">
        <CameraView
          videoRef={videoRef}
          overlayCanvasRef={overlayCanvasRef}
          threeContainerRef={threeContainerRef}
          cameraActive={cameraActive}
          status={status}
          loading={loading}
          noPersonDetected={noPersonDetected}
          onStartCamera={handleStartCamera}
          isFrontCamera={isFrontCamera}
        />

        <Sidebar
          currentCloth={currentCloth}
          adjustments={adjustments}
          onSelectCloth={setCurrentCloth}
          onAdjustmentChange={handleAdjustmentChange}
          onReset={handleReset}
          onSnapshot={handleSnapshot}
          onPreset={handlePreset}
          loadedModels={loadedModels}
          garmentFlipped={garmentFlipped}
          onToggleFlip={() => setGarmentFlipped((f) => !f)}
          isOpen={sidebarOpen}
          onClose={closeSidebar}
        />
      </div>

      <BottomBar
        currentCloth={currentCloth}
        onSelectCloth={setCurrentCloth}
        onSnapshot={handleSnapshot}
        loadedModels={loadedModels}
        cameraActive={cameraActive}
      />
    </div>
  );
}

export default App;
