import * as THREE from 'three';

// Reusable temp vector
const _v = new THREE.Vector3();

/**
 * Analyze a garment wrapper and identify sleeve vertices for deformation.
 * Must be called right after model setup, while the wrapper is still at
 * origin with identity transform (before the render loop repositions it).
 *
 * @param {THREE.Group} wrapper - The garment wrapper group
 * @returns {Object|null} Sleeve deformation data, or null if no sleeves found
 */
export function prepareSleeveData(wrapper) {
  // Ensure all world matrices are up to date
  wrapper.updateMatrixWorld(true);

  const bbox = new THREE.Box3().setFromObject(wrapper);
  const size = bbox.getSize(new THREE.Vector3());
  const center = bbox.getCenter(new THREE.Vector3());

  if (size.x < 0.001 || size.y < 0.001) return null;

  // ── Shoulder pivot points (wrapper-local ≈ world at setup time) ──
  // Shoulders sit ~72% up from the bottom, ~27% out from center on each side
  const shoulderY = bbox.min.y + size.y * 0.72;
  const shoulderSpread = size.x * 0.27;
  const leftPivot  = new THREE.Vector3(center.x - shoulderSpread, shoulderY, center.z);
  const rightPivot = new THREE.Vector3(center.x + shoulderSpread, shoulderY, center.z);

  // Vertices farther than this from center X are "sleeve territory"
  const sleeveThreshold = shoulderSpread * 0.6;

  // Only consider upper portion of the garment (sleeves don't reach the hem)
  const minRelY = 0.40;

  const entries = [];

  wrapper.traverse((child) => {
    if (!child.isMesh || !child.geometry) return;
    const posAttr = child.geometry.attributes.position;
    if (!posAttr) return;

    child.updateWorldMatrix(true, false);
    const toWorld = child.matrixWorld.clone();
    const toLocal = toWorld.clone().invert();

    const origPositions = new Float32Array(posAttr.array);
    const leftVerts  = [];
    const rightVerts = [];

    for (let i = 0; i < posAttr.count; i++) {
      _v.set(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i));
      _v.applyMatrix4(toWorld); // to wrapper space

      const dx = _v.x - center.x;
      const absDx = Math.abs(dx);
      if (absDx < sleeveThreshold) continue;

      const relY = (_v.y - bbox.min.y) / size.y;
      if (relY < minRelY) continue;

      // Weight: 0 at threshold, 1 at model edge — soft curve
      const maxDist = size.x * 0.5;
      const distWeight = Math.min(1, (absDx - sleeveThreshold) / (maxDist - sleeveThreshold + 0.001));
      const weight = Math.pow(distWeight, 0.6);
      if (weight < 0.03) continue;

      const info = {
        index: i,
        weight,
        ox: posAttr.getX(i),
        oy: posAttr.getY(i),
        oz: posAttr.getZ(i),
      };

      if (dx < 0) leftVerts.push(info);
      else        rightVerts.push(info);
    }

    if (leftVerts.length > 0 || rightVerts.length > 0) {
      entries.push({ mesh: child, origPositions, leftVerts, rightVerts, toWorld, toLocal });
    }
  });

  if (entries.length === 0) return null;

  // ── Compute rest-pose arm angles from average sleeve vertex direction ──
  let lDx = 0, lDy = 0, lN = 0;
  let rDx = 0, rDy = 0, rN = 0;

  for (const e of entries) {
    for (const v of e.leftVerts) {
      _v.set(v.ox, v.oy, v.oz).applyMatrix4(e.toWorld);
      lDx += _v.x - leftPivot.x;
      lDy += _v.y - leftPivot.y;
      lN++;
    }
    for (const v of e.rightVerts) {
      _v.set(v.ox, v.oy, v.oz).applyMatrix4(e.toWorld);
      rDx += _v.x - rightPivot.x;
      rDy += _v.y - rightPivot.y;
      rN++;
    }
  }

  const leftRestAngle  = lN > 0 ? Math.atan2(lDy / lN, lDx / lN) : Math.PI;
  const rightRestAngle = rN > 0 ? Math.atan2(rDy / rN, rDx / rN) : 0;

  console.log('Sleeve deformation prepared:', {
    leftVerts:  entries.reduce((s, e) => s + e.leftVerts.length, 0),
    rightVerts: entries.reduce((s, e) => s + e.rightVerts.length, 0),
    leftRestAngle:  (leftRestAngle  * 180 / Math.PI).toFixed(1) + '°',
    rightRestAngle: (rightRestAngle * 180 / Math.PI).toFixed(1) + '°',
  });

  return { entries, leftPivot, rightPivot, leftRestAngle, rightRestAngle };
}

/**
 * Deform sleeve vertices by rotating them around shoulder pivots.
 * Angles are in the wrapper's rest-pose local space (before rotZ/rotY).
 *
 * @param {Object}      data        - from prepareSleeveData()
 * @param {number|null} leftAngle   - target left arm angle (radians), or null to restore
 * @param {number|null} rightAngle  - target right arm angle (radians), or null to restore
 */
export function deformSleeves(data, leftAngle, rightAngle) {
  if (!data) return;

  const doLeft  = leftAngle  !== null;
  const doRight = rightAngle !== null;
  const leftDelta  = doLeft  ? leftAngle  - data.leftRestAngle  : 0;
  const rightDelta = doRight ? rightAngle - data.rightRestAngle : 0;

  for (const entry of data.entries) {
    const pos = entry.mesh.geometry.attributes.position;
    let dirty = false;

    // ── LEFT SLEEVE ──
    if (entry.leftVerts.length > 0) {
      if (doLeft && Math.abs(leftDelta) > 0.015) {
        const cosA = Math.cos(leftDelta);
        const sinA = Math.sin(leftDelta);

        for (const v of entry.leftVerts) {
          // Original vertex → wrapper space
          _v.set(v.ox, v.oy, v.oz).applyMatrix4(entry.toWorld);

          // Relative to shoulder pivot
          const rx = _v.x - data.leftPivot.x;
          const ry = _v.y - data.leftPivot.y;

          // Rotated position
          const nx = rx * cosA - ry * sinA;
          const ny = rx * sinA + ry * cosA;

          // Blend original → rotated by vertex weight
          _v.x = data.leftPivot.x + rx + (nx - rx) * v.weight;
          _v.y = data.leftPivot.y + ry + (ny - ry) * v.weight;

          // Back to mesh local space
          _v.applyMatrix4(entry.toLocal);
          pos.setXYZ(v.index, _v.x, _v.y, _v.z);
          dirty = true;
        }
      } else {
        // Restore originals
        for (const v of entry.leftVerts) {
          pos.setXYZ(v.index, v.ox, v.oy, v.oz);
        }
        dirty = true;
      }
    }

    // ── RIGHT SLEEVE ──
    if (entry.rightVerts.length > 0) {
      if (doRight && Math.abs(rightDelta) > 0.015) {
        const cosA = Math.cos(rightDelta);
        const sinA = Math.sin(rightDelta);

        for (const v of entry.rightVerts) {
          _v.set(v.ox, v.oy, v.oz).applyMatrix4(entry.toWorld);

          const rx = _v.x - data.rightPivot.x;
          const ry = _v.y - data.rightPivot.y;

          const nx = rx * cosA - ry * sinA;
          const ny = rx * sinA + ry * cosA;

          _v.x = data.rightPivot.x + rx + (nx - rx) * v.weight;
          _v.y = data.rightPivot.y + ry + (ny - ry) * v.weight;

          _v.applyMatrix4(entry.toLocal);
          pos.setXYZ(v.index, _v.x, _v.y, _v.z);
          dirty = true;
        }
      } else {
        for (const v of entry.rightVerts) {
          pos.setXYZ(v.index, v.ox, v.oy, v.oz);
        }
        dirty = true;
      }
    }

    if (dirty) {
      pos.needsUpdate = true;
      entry.mesh.geometry.computeBoundingSphere();
    }
  }
}

/**
 * Restore all vertices to their original (rest-pose) positions.
 */
export function resetSleeves(data) {
  if (!data) return;
  for (const entry of data.entries) {
    const pos = entry.mesh.geometry.attributes.position;
    pos.array.set(entry.origPositions);
    pos.needsUpdate = true;
    entry.mesh.geometry.computeBoundingSphere();
  }
}
