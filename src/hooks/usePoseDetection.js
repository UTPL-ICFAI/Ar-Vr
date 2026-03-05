import { useEffect, useRef, useState } from 'react';
import * as tf from '@tensorflow/tfjs';
import * as poseDetection from '@tensorflow-models/pose-detection';
import { SKELETON_PAIRS } from '../utils/poseUtils';

const IS_DEV = import.meta.env.DEV;

/**
 * Pose detection hook with conditional mirroring for front/back camera.
 *
 * @param {React.RefObject} videoRef
 * @param {React.RefObject} canvasRef   – overlay canvas for skeleton
 * @param {boolean}         cameraActive
 * @param {Function}        onPoseResult
 * @param {boolean}         isFrontCamera – true = selfie (mirror keypoints)
 */
export default function usePoseDetection(videoRef, canvasRef, cameraActive, onPoseResult, isFrontCamera = true) {
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
          enableSmoothing: true,
          minPoseScore: 0.3,
        }
      );
      if (cancelled) return;
      detectorRef.current = detector;
      setDetectorReady(true);
      detect();
    }

    function drawSkeleton(ctx, keypoints) {
      ctx.strokeStyle = 'rgba(232,255,71,0.4)';
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
          ctx.arc(kp.x, kp.y, 3, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(232,255,71,0.7)';
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
        const videoHeight = videoRef.current.videoHeight;
        canvas.width = videoWidth;
        canvas.height = videoHeight;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        if (poses.length > 0) {
          // Pick pose with highest average keypoint confidence
          const bestPose = poses.reduce((best, pose) => {
            const avgScore = pose.keypoints.reduce((sum, kp) =>
              sum + (kp?.score || 0), 0) / pose.keypoints.length;
            const bestAvgScore = best.keypoints.reduce((sum, kp) =>
              sum + (kp?.score || 0), 0) / best.keypoints.length;
            return avgScore > bestAvgScore ? pose : best;
          }, poses[0]);

          // Mirror X coordinates only for front (selfie) camera
          // so keypoints match the CSS-mirrored video display
          const processedPose = isFrontCamera
            ? {
                ...bestPose,
                keypoints: bestPose.keypoints.map((kp) => ({
                  ...kp,
                  x: videoWidth - kp.x,
                })),
              }
            : bestPose;

          // Draw skeleton only in development mode
          if (IS_DEV) {
            drawSkeleton(ctx, processedPose.keypoints);
          }
          onPoseResult(processedPose);
        } else {
          onPoseResult(null);
        }
      } catch (_e) {
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
  }, [cameraActive, isFrontCamera]);

  return { detectorReady };
}
