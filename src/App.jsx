import { useRef, useState, useCallback, useEffect } from 'react';
import './App.css';

import Header from './components/Header';
import CameraView from './components/CameraView';
import Sidebar from './components/Sidebar';

import useCamera from './hooks/useCamera';
import usePoseDetection from './hooks/usePoseDetection';
import useThreeJS from './hooks/useThreeJS';
import { takeSnapshot } from './utils/snapshotUtils';

function App() {
  const videoRef = useRef(null);
  const overlayCanvasRef = useRef(null);
  const threeContainerRef = useRef(null);
  const lastPoseRef = useRef(null);

  const [cameraActive, setCameraActive] = useState(false);
  const [currentCloth, setCurrentCloth] = useState('none');
  const [status, setStatus] = useState({ dot: '', message: 'Click Start Camera to begin' });
  const [loading, setLoading] = useState({ visible: false, message: '' });
  const [adjustments, setAdjustments] = useState({ scale: 1.0, y: 0, x: 0, z: 0 });
  const [noPersonDetected, setNoPersonDetected] = useState(false);
  const [loadedModels, setLoadedModels] = useState({});
  const [garmentFlipped, setGarmentFlipped] = useState(false);
  const [debugPose, setDebugPose] = useState(null);
  const [bonesDebug, setBonesDebug] = useState(null);

  // Reset flip when garment changes
  useEffect(() => { setGarmentFlipped(false); }, [currentCloth]);

  const handleCameraReady = useCallback(() => {
    setCameraActive(true);
    setStatus({ dot: 'active', message: 'Camera active' });
    setLoading({ visible: false, message: '' });
  }, []);

  const { startCamera } = useCamera(videoRef, handleCameraReady);

  const handleStartCamera = useCallback(async () => {
    setLoading({ visible: true, message: 'Starting camera...' });
    try {
      await startCamera();
    } catch {
      setStatus({ dot: 'error', message: 'Camera access denied' });
      setLoading({ visible: false, message: '' });
    }
  }, [startCamera]);

  const handlePoseResult = useCallback((pose) => {
    lastPoseRef.current = pose;
    setDebugPose(pose || null);
    if (pose) {
      setNoPersonDetected(false);
      setStatus({ dot: 'detecting', message: 'Pose detected' });
    } else {
      setNoPersonDetected(true);
      setStatus({ dot: 'active', message: 'No pose — move closer' });
    }
  }, []);

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

  const handleBonesLoaded = useCallback((boneNames) => {
    setBonesDebug(boneNames);
  }, []);

  usePoseDetection(videoRef, overlayCanvasRef, cameraActive, handlePoseResult);
  const { rendererRef, sceneRef, cameraRef } = useThreeJS(
    threeContainerRef,
    videoRef,
    currentCloth,
    adjustments,
    lastPoseRef,
    handleModelLoaded,
    garmentFlipped,
    handleBonesLoaded
  );

  const handleSnapshot = useCallback(() => {
    if (videoRef.current && rendererRef.current && sceneRef.current && cameraRef.current) {
      takeSnapshot(videoRef.current, rendererRef.current, sceneRef.current, cameraRef.current);
    }
  }, [rendererRef, sceneRef, cameraRef]);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const toggleSidebar = useCallback(() => setSidebarOpen((o) => !o), []);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  return (
    <div className="app-layout">
      <Header sidebarOpen={sidebarOpen} onToggleSidebar={toggleSidebar} />
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
          lastPose={debugPose}
          currentCloth={currentCloth}
          bonesDebug={bonesDebug}
          onSnapshot={handleSnapshot}
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
          onToggleFlip={() => setGarmentFlipped(f => !f)}
          isOpen={sidebarOpen}
          onClose={closeSidebar}
        />
      </div>
    </div>
  );
}

export default App;
