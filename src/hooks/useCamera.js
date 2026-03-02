import { useCallback } from 'react';

export default function useCamera(videoRef, onReady) {
  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
        audio: false,
      });
      videoRef.current.srcObject = stream;
      await new Promise((resolve) => {
        videoRef.current.onloadedmetadata = resolve;
      });
      videoRef.current.play();
      onReady();
    } catch (err) {
      console.error('Camera error:', err);
      throw err;
    }
  }, [videoRef, onReady]);

  return { startCamera };
}
