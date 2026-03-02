import * as THREE from 'three';

// ── Reusable objects (avoid per-frame GC pressure) ──
const _raycaster = new THREE.Raycaster();
const _zPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
const _ndc = new THREE.Vector2();

/**
 * Convert a video-space pixel (x,y) to Three.js world-space on the Z=0 plane.
 * Handles object-fit:cover scaling + CSS scaleX(-1) mirror.
 */
function videoPixelToWorld(videoX, videoY, vW, vH, cW, cH, camera, mirrorX = true) {
  // Object-fit: cover mapping
  const videoAspect = vW / vH;
  const containerAspect = cW / cH;

  let renderW, renderH, offsetX, offsetY;
  if (videoAspect > containerAspect) {
    renderH = cH;
    renderW = cH * videoAspect;
  } else {
    renderW = cW;
    renderH = cW / videoAspect;
  }
  offsetX = (cW - renderW) / 2;
  offsetY = (cH - renderH) / 2;

  let cx = videoX * (renderW / vW) + offsetX;
  const cy = videoY * (renderH / vH) + offsetY;

  if (mirrorX) cx = cW - cx;

  const ndcX = (cx / cW) * 2.0 - 1.0;
  const ndcY = 1.0 - (cy / cH) * 2.0;

  // Unproject to Z=0 via raycaster (reuse module objects)
  _raycaster.setFromCamera(_ndc.set(ndcX, ndcY), camera);
  const worldPt = new THREE.Vector3();
  const hit = _raycaster.ray.intersectPlane(_zPlane, worldPt);

  if (!hit) {
    const fovRad = THREE.MathUtils.degToRad(camera.fov);
    const halfH = Math.tan(fovRad / 2) * camera.position.z;
    const halfW = halfH * camera.aspect;
    worldPt.set(ndcX * halfW, ndcY * halfH, 0);
  }

  return worldPt;
}

/**
 * Compute garment placement from pose landmarks.
 * Returns per-axis scale (scaleX, scaleY, scaleZ) for proper body-ratio matching.
 *
 * @param {Object}   pose        – MoveNet/BlazePose result
 * @param {THREE.PerspectiveCamera} camera
 * @param {HTMLElement} container – Three.js overlay container
 * @param {Object}   adjustments – {scale, x, y, z}
 * @param {HTMLVideoElement} videoEl
 * @param {Object}   modelDims   – {width, height, depth} of the raw un-scaled model
 */
export function computeGarmentTransform(pose, camera, container, adjustments, videoEl, modelDims) {
  if (!pose || !videoEl || !camera || !container || !modelDims) return null;

  const kps  = pose.keypoints;
  const lSh  = kps[5];   // LEFT_SHOULDER
  const rSh  = kps[6];   // RIGHT_SHOULDER
  const lHip = kps[11];  // LEFT_HIP
  const rHip = kps[12];  // RIGHT_HIP
  const nose = kps[0];   // NOSE

  if (!lSh || !rSh || lSh.score < 0.25 || rSh.score < 0.25) return null;

  const vW = videoEl.videoWidth  || 1280;
  const vH = videoEl.videoHeight || 720;
  const cW = container.clientWidth  || 800;
  const cH = container.clientHeight || 600;

  // ── Convert landmarks to world space ──
  const lShWorld = videoPixelToWorld(lSh.x, lSh.y, vW, vH, cW, cH, camera);
  const rShWorld = videoPixelToWorld(rSh.x, rSh.y, vW, vH, cW, cH, camera);

  const shoulderMidX = (lShWorld.x + rShWorld.x) / 2;
  const shoulderMidY = (lShWorld.y + rShWorld.y) / 2;
  const worldShoulderW = lShWorld.distanceTo(rShWorld);

  // ── Nose (used for neck position + turn direction) ──
  let noseWorld = null;
  if (nose && nose.score > 0.25) {
    noseWorld = videoPixelToWorld(nose.x, nose.y, vW, vH, cW, cH, camera);
  }

  // ── Neck position ──
  let neckY = shoulderMidY;
  if (noseWorld) {
    neckY = noseWorld.y + (shoulderMidY - noseWorld.y) * 0.75;
  }

  // ── Hip midpoint ──
  let hipMidY = null;
  let hipMidX = null;
  if (lHip && rHip && lHip.score > 0.25 && rHip.score > 0.25) {
    const lHipWorld = videoPixelToWorld(lHip.x, lHip.y, vW, vH, cW, cH, camera);
    const rHipWorld = videoPixelToWorld(rHip.x, rHip.y, vW, vH, cW, cH, camera);
    hipMidY = (lHipWorld.y + rHipWorld.y) / 2;
    hipMidX = (lHipWorld.x + rHipWorld.x) / 2;
  }

  // ── Per-axis scale (body-ratio aware) ──
  const SHOULDER_PAD = 1.30;               // garment slightly wider than shoulders
  const targetW = worldShoulderW * SHOULDER_PAD;
  const modelW  = Math.max(modelDims.width,  0.001);
  const modelH  = Math.max(modelDims.height, 0.001);

  // Width-based scale: matches garment to shoulder span
  const sW = targetW / modelW;

  // Height-based scale: matches garment to actual torso length
  let sH = sW; // default: uniform
  if (hipMidY !== null) {
    const torsoLen = Math.abs(neckY - hipMidY);
    if (torsoLen > 0.01) {
      const targetH = torsoLen * 1.05;     // extend ~5% below hips
      sH = targetH / modelH;
    }
  }

  // Clamp height/width ratio to prevent extreme distortion
  const ratio = sH / sW;
  if (ratio < 0.6)  sH = sW * 0.6;
  if (ratio > 1.3)  sH = sW * 1.3;

  const adj = adjustments.scale;
  const scaleX = sW * adj;
  const scaleY = sH * adj;
  const scaleZ = sW * adj;

  // ── Position ──
  const fovRad = THREE.MathUtils.degToRad(camera.fov);
  const halfH  = Math.tan(fovRad / 2) * camera.position.z;
  const halfW  = halfH * camera.aspect;
  const adjX   = (adjustments.x / 100) * halfW * 0.5;
  const adjY   = (adjustments.y / 100) * halfH * 0.5;

  // Center garment between neck and hips
  let centerY;
  if (hipMidY !== null) {
    centerY = (neckY + hipMidY) / 2;
  } else {
    centerY = shoulderMidY - worldShoulderW * 0.45;
  }

  const posX = shoulderMidX + adjX;
  const posY = centerY + adjY;
  const posZ = (adjustments.z / 100) * 0.5;

  // ── Rotation ──
  // With mirrorX=true, lShWorld.x > rShWorld.x in world space.
  // CSS scaleX(-1) on the container visually negates the rotation,
  // so we compute WITHOUT negation — CSS handles the flip.
  const rotZ = Math.atan2(lShWorld.y - rShWorld.y, lShWorld.x - rShWorld.x);

  // Body turn magnitude from apparent shoulder width
  const maxShoulderW = Math.tan(fovRad / 2) * camera.position.z * 0.6;
  const turnCos = Math.min(1.0, worldShoulderW / maxShoulderW);
  const turnMag = Math.acos(Math.max(0.01, turnCos));

  // Turn direction: detect which way the person is turning
  // Primary signal: nose offset relative to shoulder midpoint
  // Secondary signal: shoulder midpoint offset relative to hip midpoint
  let turnDirection = 0;
  if (noseWorld) {
    const noseDx = noseWorld.x - shoulderMidX;
    if (Math.abs(noseDx) > worldShoulderW * 0.03) {
      turnDirection = Math.sign(noseDx);
    }
  }
  if (turnDirection === 0 && hipMidX !== null) {
    const shHipDx = shoulderMidX - hipMidX;
    if (Math.abs(shHipDx) > worldShoulderW * 0.05) {
      turnDirection = Math.sign(shHipDx);
    }
  }

  // Signed rotY, clamped to ±45° to prevent garment from flipping
  // CSS scaleX(-1) on the container visually negates Y rotation,
  // so we use positive turnDirection — CSS handles the flip.
  const rotY = THREE.MathUtils.clamp(
    turnDirection * turnMag,
    -Math.PI / 4,
    Math.PI / 4
  );

  return {
    position: new THREE.Vector3(posX, posY, posZ),
    scaleX,
    scaleY,
    scaleZ,
    rotZ,
    rotY,
  };
}

export { videoPixelToWorld };
