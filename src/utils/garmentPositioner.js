import * as THREE from 'three';

// ── Reusable objects (avoid per-frame GC pressure) ──
const _raycaster = new THREE.Raycaster();
const _zPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
const _ndc = new THREE.Vector2();

/**
 * Convert a video-space pixel (x,y) to Three.js world-space on the Z=0 plane.
 * Handles object-fit:cover scaling + optional CSS scaleX(-1) mirror.
 */
export function videoPixelToWorld(videoX, videoY, vW, vH, cW, cH, camera, mirrorX = true) {
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
 * Uses torso center (shoulder midpoint ↔ hip midpoint) as anchor
 * and shoulder distance for uniform scaling.
 *
 * @param {Object}   pose
 * @param {THREE.PerspectiveCamera} camera
 * @param {HTMLElement} container
 * @param {Object}   adjustments – { scale, x, y, z }
 * @param {HTMLVideoElement} videoEl
 * @param {Object}   modelDims   – { width, height, depth }
 * @param {boolean}  isFrontCamera – whether to apply mirror in coordinate conversion
 */
export function computeGarmentTransform(pose, camera, container, adjustments, videoEl, modelDims, isFrontCamera = true) {
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

  const mirrorX = isFrontCamera;

  // ── Convert landmarks to world space ──
  const lShWorld = videoPixelToWorld(lSh.x, lSh.y, vW, vH, cW, cH, camera, mirrorX);
  const rShWorld = videoPixelToWorld(rSh.x, rSh.y, vW, vH, cW, cH, camera, mirrorX);

  const shoulderMidX = (lShWorld.x + rShWorld.x) / 2;
  const shoulderMidY = (lShWorld.y + rShWorld.y) / 2;
  const shoulderDist = lShWorld.distanceTo(rShWorld);

  // ── Hip midpoint ──
  let hipMidY = null;
  if (lHip && rHip && lHip.score > 0.25 && rHip.score > 0.25) {
    const lHipWorld = videoPixelToWorld(lHip.x, lHip.y, vW, vH, cW, cH, camera, mirrorX);
    const rHipWorld = videoPixelToWorld(rHip.x, rHip.y, vW, vH, cW, cH, camera, mirrorX);
    hipMidY = (lHipWorld.y + rHipWorld.y) / 2;
  }

  // ── Neck position (between nose and shoulders) ──
  let neckY = shoulderMidY;
  let noseWorld = null;
  if (nose && nose.score > 0.25) {
    noseWorld = videoPixelToWorld(nose.x, nose.y, vW, vH, cW, cH, camera, mirrorX);
    neckY = noseWorld.y + (shoulderMidY - noseWorld.y) * 0.75;
  }

  // ── TORSO CENTER: anchor point for the garment ──
  let torsoCenterY;
  if (hipMidY !== null) {
    torsoCenterY = (neckY + hipMidY) / 2;
  } else {
    // Estimate: torso center is about 0.5× shoulder width below neck
    torsoCenterY = shoulderMidY - shoulderDist * 0.45;
  }

  // ── UNIFORM SCALE from shoulder distance ──
  const SCALE_MULTIPLIER = 2.2;
  const modelW = Math.max(modelDims.width, 0.001);
  const scaleFactor = (shoulderDist * SCALE_MULTIPLIER) / modelW;

  const adj = adjustments.scale;
  const uniformScale = scaleFactor * adj;

  // Clamp scale to sane range
  const fovRad = THREE.MathUtils.degToRad(camera.fov);
  const halfH  = Math.tan(fovRad / 2) * camera.position.z;
  const halfW  = halfH * camera.aspect;
  const minScale = (halfW * 0.15) / modelW;
  const maxScale = (halfW * 2.0) / modelW;
  const clampedScale = Math.min(maxScale, Math.max(minScale, uniformScale));

  // ── Position ──
  const adjX = (adjustments.x / 100) * halfW * 0.5;
  const adjY = (adjustments.y / 100) * halfH * 0.5;
  const posX = shoulderMidX + adjX;
  let posY = torsoCenterY + adjY;
  const posZ = (adjustments.z / 100) * 0.5;

  // Clamp Y to keep garment on screen
  const maxWorldY = halfH * 0.9;
  posY = Math.max(-maxWorldY, Math.min(maxWorldY, posY));

  // ── Rotation Z: shoulder tilt angle ──
  const rotZ = Math.atan2(lShWorld.y - rShWorld.y, lShWorld.x - rShWorld.x);

  // ── Rotation Y: body turn estimate from apparent shoulder width ──
  const maxShoulderW = halfW * 0.6;
  const turnCos = Math.min(1.0, shoulderDist / maxShoulderW);
  const turnMag = Math.acos(Math.max(0.01, turnCos));

  let turnDirection = 0;
  if (noseWorld) {
    const noseDx = noseWorld.x - shoulderMidX;
    if (Math.abs(noseDx) > shoulderDist * 0.03) {
      turnDirection = Math.sign(noseDx);
    }
  }

  const rotY = THREE.MathUtils.clamp(
    turnDirection * turnMag,
    -Math.PI / 4,
    Math.PI / 4,
  );

  return {
    position: new THREE.Vector3(posX, posY, posZ),
    scale: clampedScale,
    rotZ,
    rotY,
  };
}

