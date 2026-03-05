import { useCallback, useRef } from 'react';

/**
 * Camera manager hook with front/back camera switching.
 *
 * @param {React.RefObject<HTMLVideoElement>} videoRef
 * @param {(facingMode: string) => void} onReady - called with current facingMode when camera is ready
 * @returns {{ startCamera, stopCamera, switchCamera, facingModeRef }}
 */
export default function useCamera(videoRef, onReady) {
  const streamRef = useRef(null);
  const facingModeRef = useRef('user');

  /* ── stop all active tracks ── */
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, [videoRef]);

  /* ── start (or restart) with a given facingMode ── */
  const startCamera = useCallback(
    async (facingMode) => {
      stopCamera();

      const mode = facingMode || facingModeRef.current;
      facingModeRef.current = mode;

      const constraints = {
        video: {
          facingMode: mode,
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      };

      // On mobile Safari, ideal constraints sometimes fail — fall back
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch (_firstErr) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: mode },
            audio: false,
          });
        } catch (secondErr) {
          console.error('Camera error:', secondErr);
          throw secondErr;
        }
      }

      streamRef.current = stream;
      videoRef.current.srcObject = stream;

      await new Promise((resolve) => {
        videoRef.current.onloadedmetadata = resolve;
      });
      videoRef.current.play();
      onReady(mode);
    },
    [videoRef, onReady, stopCamera],
  );

  /* ── toggle between front ↔ back ── */
  const switchCamera = useCallback(async () => {
    const newMode = facingModeRef.current === 'user' ? 'environment' : 'user';
    await startCamera(newMode);
    return newMode;
  }, [startCamera]);

  return { startCamera, stopCamera, switchCamera, facingModeRef };
}
