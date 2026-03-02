export function takeSnapshot(videoEl, threeRenderer, threeScene, threeCamera) {
  const snap = document.createElement('canvas');
  snap.width = videoEl.videoWidth;
  snap.height = videoEl.videoHeight;
  const ctx = snap.getContext('2d');

  // Draw mirrored video
  ctx.save();
  ctx.scale(-1, 1);
  ctx.drawImage(videoEl, -snap.width, 0);
  ctx.restore();

  // Render Three.js overlay and composite
  threeRenderer.render(threeScene, threeCamera);
  ctx.drawImage(threeRenderer.domElement, 0, 0, snap.width, snap.height);

  // Trigger download
  const link = document.createElement('a');
  link.download = 'fitar-snapshot.png';
  link.href = snap.toDataURL('image/png');
  link.click();
}
