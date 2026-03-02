import { useEffect, useRef, useState } from 'react';
import * as tf from '@tensorflow/tfjs';
import * as poseDetection from '@tensorflow-models/pose-detection';
import { SKELETON_PAIRS } from '../utils/poseUtils';

export default function usePoseDetection(videoRef, canvasRef, cameraActive, onPoseResult) {
  const detectorRef = useRef(null);
  const animFrameRef = useRef(null);
  const [detectorReady, setDetectorReady] = useState(false);

  useEffect(() => {
    if (!cameraActive) return;

    let cancelled = false;

    async function init() {
      await tf.ready();
      const detector = await poseDetection.createDetector(
        poseDetection.SupportedModels.MoveNet,
        {
          modelType: poseDetection.movenet.modelType.SINGLEPOSE_THUNDER,
        }
      );
      if (cancelled) return;
      detectorRef.current = detector;
      setDetectorReady(true);
      detect();
    }

    function drawSkeleton(ctx, keypoints) {
      ctx.strokeStyle = 'rgba(232,255,71,0.5)';
      ctx.lineWidth = 2;

      for (const [a, b] of SKELETON_PAIRS) {
        const kA = keypoints[a];
        const kB = keypoints[b];
        if (kA && kB && kA.score > 0.3 && kB.score > 0.3) {
          ctx.beginPath();
          ctx.moveTo(kA.x, kA.y);
          ctx.lineTo(kB.x, kB.y);
          ctx.stroke();
        }
      }

      for (const kp of keypoints) {
        if (kp.score > 0.3) {
          ctx.beginPath();
          ctx.arc(kp.x, kp.y, 4, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(232,255,71,0.85)';
          ctx.fill();
        }
      }

    }

    async function detect() {
      if (!detectorRef.current || !videoRef.current) return;
      try {
        const poses = await detectorRef.current.estimatePoses(videoRef.current);
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        const videoWidth = videoRef.current.videoWidth;
        canvas.width = videoWidth;
        canvas.height = videoRef.current.videoHeight;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        if (poses.length > 0) {
          // Mirror keypoint X coordinates to match the CSS scaleX(-1) on the video
          const mirroredPose = {
            ...poses[0],
            keypoints: poses[0].keypoints.map((kp) => ({
              ...kp,
              x: videoWidth - kp.x,
            })),
          };
          drawSkeleton(ctx, mirroredPose.keypoints);
          onPoseResult(mirroredPose);
        } else {
          onPoseResult(null);
        }
      } catch (e) {
        // silently ignore detection errors
      }
      animFrameRef.current = requestAnimationFrame(detect);
    }

    init();

    return () => {
      cancelled = true;
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [cameraActive]);

  return { detectorReady };
}
