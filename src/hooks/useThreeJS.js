import { useEffect, useRef, useCallback } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import GARMENTS from '../constants/garments';
import { computeGarmentTransform, videoPixelToWorld } from '../utils/garmentPositioner';
import { prepareSleeveData, deformSleeves, resetSleeves } from '../utils/armDeformer';

export default function useThreeJS(containerRef, videoRef, currentCloth, adjustments, lastPoseRef, onModelLoaded, garmentFlipped) {
  const rendererRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const clothMeshRef = useRef(null);
  const animFrameRef = useRef(null);
  const loaderRef = useRef(null);
  const clothModelDimsRef = useRef({ width: 1, height: 1, depth: 1 });
  const loadingClothRef = useRef(null);
  const garmentFlippedRef = useRef(false);
  const videoElRef = useRef(null);
  const currentClothRef = useRef(currentCloth);

  // Smoothing refs
  const smoothPos = useRef(new THREE.Vector3());
  const smoothScale = useRef(new THREE.Vector3(0.5, 0.5, 0.5));
  const smoothRotZ = useRef(0);
  const smoothRotY = useRef(0);
  const firstFrame = useRef(true);
  const poseAge = useRef(0);

  // Arm deformation refs
  const sleeveDataRef = useRef(null);
  const smoothLeftAngle = useRef(null);
  const smoothRightAngle = useRef(null);

  // Store adjustments in a ref so the render loop always sees the latest values
  const adjustmentsRef = useRef(adjustments);
  useEffect(() => { adjustmentsRef.current = adjustments; }, [adjustments]);

  // Keep garmentFlipped ref in sync
  useEffect(() => { garmentFlippedRef.current = garmentFlipped; }, [garmentFlipped]);

  // Keep currentClothRef in sync
  useEffect(() => { currentClothRef.current = currentCloth; }, [currentCloth]);

  // Keep videoElRef in sync — no dep array, runs every render
  useEffect(() => {
    videoElRef.current = videoRef?.current ?? null;
  });

  // Auto-orient: ensure Y is the tallest dimension (model stands upright)
  function autoOrientModel(model) {
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());

    // If Y is already tallest or close to tallest, model is upright
    if (size.y >= size.x * 0.7 && size.y >= size.z * 0.7) {
      return;
    }

    // Z is tallest → model is lying forward/backward → rotate around X
    if (size.z > size.y && size.z >= size.x) {
      model.rotation.x = -Math.PI / 2;
    }
    // X is tallest → model is lying sideways → rotate around Z
    else if (size.x > size.y && size.x > size.z) {
      model.rotation.z = Math.PI / 2;
    }
  }

  // Helper: set opacity on all meshes in a model
  function setMeshOpacity(mesh, opacity) {
    mesh.traverse((child) => {
      if (child.isMesh && child.material) {
        const needsTransparent = opacity < 0.99;
        if (child.material.transparent !== needsTransparent ||
            Math.abs(child.material.opacity - opacity) > 0.01) {
          child.material.transparent = needsTransparent;
          child.material.opacity = opacity;
          child.material.needsUpdate = true;
        }
      }
    });
  }

  // Setup scene once on mount
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const width = container.clientWidth;
    const height = container.clientHeight;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(width, height);
    renderer.setClearColor(0x000000, 0);
    renderer.sortObjects = true;
    renderer.shadowMap.enabled = false;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Scene
    const scene = new THREE.Scene();
    sceneRef.current = scene;

    // Neutral environment for PBR materials
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    pmremGenerator.compileEquirectangularShader();
    const envScene = new THREE.Scene();
    envScene.background = new THREE.Color(0xcccccc);
    const envRT = pmremGenerator.fromScene(envScene, 0.04);
    scene.environment = envRT.texture;
    pmremGenerator.dispose();

    // Camera
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.01, 100);
    camera.position.z = 5;
    camera.updateProjectionMatrix();
    cameraRef.current = camera;

    // Lights — 3-point setup + hemisphere for realism
    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
    hemiLight.position.set(0, 10, 0);
    scene.add(hemiLight);

    const ambient = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(ambient);

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.4);
    keyLight.position.set(2, 5, 5);
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xffffff, 0.5);
    fillLight.position.set(-3, 2, 4);
    scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0x8888ff, 0.35);
    rimLight.position.set(0, 3, -5);
    scene.add(rimLight);

    // Loader
    loaderRef.current = new GLTFLoader();

    // Render loop
    function renderLoop() {
      animFrameRef.current = requestAnimationFrame(renderLoop);

      // Keep renderer size in sync with container (handles window resize)
      if (containerRef.current && rendererRef.current) {
        const w = containerRef.current.clientWidth;
        const h = containerRef.current.clientHeight;
        if (w > 0 && h > 0) {
          const s = rendererRef.current.getSize(new THREE.Vector2());
          if (Math.abs(s.x - w) > 1 || Math.abs(s.y - h) > 1) {
            rendererRef.current.setSize(w, h);
            cameraRef.current.aspect = w / h;
            cameraRef.current.updateProjectionMatrix();
          }
        }
      }

      // Compute garment transform from current pose
      const hasPose  = !!(lastPoseRef.current);
      const hasMesh  = !!(clothMeshRef.current);
      const hasVideo = !!(videoElRef.current && videoElRef.current.videoWidth > 0);

      if (hasMesh && hasPose && hasVideo) {
        const t = computeGarmentTransform(
          lastPoseRef.current,
          cameraRef.current,
          containerRef.current,
          adjustmentsRef.current,
          videoElRef.current,
          clothModelDimsRef.current
        );

        const minS = t ? Math.min(t.scaleX, t.scaleY, t.scaleZ) : 0;
        const maxS = t ? Math.max(t.scaleX, t.scaleY, t.scaleZ) : 0;

        if (t && minS > 0.005 && maxS < 30) {
          poseAge.current = 0;

          // Apply flip offset to rotY
          let targetRotY = t.rotY;
          if (garmentFlippedRef.current) {
            targetRotY += Math.PI;
          }

          if (firstFrame.current) {
            // Snap instantly on first valid frame
            smoothPos.current.copy(t.position);
            smoothScale.current.set(t.scaleX, t.scaleY, t.scaleZ);
            smoothRotZ.current = t.rotZ;
            smoothRotY.current = targetRotY;
            firstFrame.current = false;
            clothMeshRef.current.visible = true;
            console.log('FIRST FRAME pos:', t.position, 'scale:', t.scaleX, t.scaleY, t.scaleZ);
          } else {
            // Adaptive smoothing: more responsive when moving, smoother when still
            const posDelta = smoothPos.current.distanceTo(t.position);
            const scaleDelta = Math.abs(smoothScale.current.x - t.scaleX);
            const motion = posDelta + scaleDelta;
            const S = THREE.MathUtils.clamp(0.08 + motion * 1.5, 0.08, 0.35);

            // Position lerp
            smoothPos.current.lerp(t.position, S);

            // Per-axis scale lerp
            smoothScale.current.x += (t.scaleX - smoothScale.current.x) * S;
            smoothScale.current.y += (t.scaleY - smoothScale.current.y) * S;
            smoothScale.current.z += (t.scaleZ - smoothScale.current.z) * S;

            // Angle lerp with wraparound fix
            let dz = t.rotZ - smoothRotZ.current;
            while (dz >  Math.PI) dz -= Math.PI * 2;
            while (dz < -Math.PI) dz += Math.PI * 2;
            smoothRotZ.current += dz * S;

            let dy = targetRotY - smoothRotY.current;
            while (dy >  Math.PI) dy -= Math.PI * 2;
            while (dy < -Math.PI) dy += Math.PI * 2;
            smoothRotY.current += dy * S;
          }

          // Apply to mesh — per-axis scale for body-ratio matching
          clothMeshRef.current.position.copy(smoothPos.current);
          clothMeshRef.current.scale.copy(smoothScale.current);
          clothMeshRef.current.rotation.z = smoothRotZ.current;
          clothMeshRef.current.rotation.y = smoothRotY.current;

          // Full opacity when tracking
          setMeshOpacity(clothMeshRef.current, 1.0);
        }
      } else if (hasMesh) {
        // Fade out when pose lost
        poseAge.current += 1;
        if (poseAge.current > 10) {
          const opacity = Math.max(0, 1 - (poseAge.current - 10) * 0.06);
          setMeshOpacity(clothMeshRef.current, opacity);
        }
      }

      // ── ARM / SLEEVE DEFORMATION ──
      if (sleeveDataRef.current && lastPoseRef.current && videoElRef.current && clothMeshRef.current?.visible) {
        const kps = lastPoseRef.current.keypoints;
        const lSh = kps[5], rSh = kps[6];
        const lEl = kps[7], rEl = kps[8];

        const vW = videoElRef.current.videoWidth  || 1280;
        const vH = videoElRef.current.videoHeight || 720;
        const cW = containerRef.current?.clientWidth  || 800;
        const cH = containerRef.current?.clientHeight || 600;

        let targetLeft = null;
        let targetRight = null;

        // Both user and model are CSS-mirrored by scaleX(-1), so:
        // User's LEFT arm (kps 5,7) → model LEFT sleeve (negative X)
        // User's RIGHT arm (kps 6,8) → model RIGHT sleeve (positive X)
        // World angle from videoPixelToWorld has mirrorX applied, so convert
        // to model space with: modelAngle = π - worldAngle
        if (lSh && lEl && lSh.score > 0.25 && lEl.score > 0.25) {
          const lShW = videoPixelToWorld(lSh.x, lSh.y, vW, vH, cW, cH, cameraRef.current);
          const lElW = videoPixelToWorld(lEl.x, lEl.y, vW, vH, cW, cH, cameraRef.current);
          const worldAngle = Math.atan2(lElW.y - lShW.y, lElW.x - lShW.x);
          targetLeft = Math.PI - worldAngle - smoothRotZ.current;
        }
        if (rSh && rEl && rSh.score > 0.25 && rEl.score > 0.25) {
          const rShW = videoPixelToWorld(rSh.x, rSh.y, vW, vH, cW, cH, cameraRef.current);
          const rElW = videoPixelToWorld(rEl.x, rEl.y, vW, vH, cW, cH, cameraRef.current);
          const worldAngle = Math.atan2(rElW.y - rShW.y, rElW.x - rShW.x);
          targetRight = Math.PI - worldAngle - smoothRotZ.current;
        }

        // Smooth arm angles (with wraparound handling)
        const ARM_S = 0.25;

        if (targetLeft !== null) {
          if (smoothLeftAngle.current === null) {
            smoothLeftAngle.current = targetLeft;
          } else {
            let da = targetLeft - smoothLeftAngle.current;
            while (da >  Math.PI) da -= Math.PI * 2;
            while (da < -Math.PI) da += Math.PI * 2;
            smoothLeftAngle.current += da * ARM_S;
          }
        } else if (smoothLeftAngle.current !== null) {
          // Return to rest pose smoothly
          let da = sleeveDataRef.current.leftRestAngle - smoothLeftAngle.current;
          while (da >  Math.PI) da -= Math.PI * 2;
          while (da < -Math.PI) da += Math.PI * 2;
          smoothLeftAngle.current += da * 0.1;
          if (Math.abs(da) < 0.03) smoothLeftAngle.current = null;
        }

        if (targetRight !== null) {
          if (smoothRightAngle.current === null) {
            smoothRightAngle.current = targetRight;
          } else {
            let da = targetRight - smoothRightAngle.current;
            while (da >  Math.PI) da -= Math.PI * 2;
            while (da < -Math.PI) da += Math.PI * 2;
            smoothRightAngle.current += da * ARM_S;
          }
        } else if (smoothRightAngle.current !== null) {
          let da = sleeveDataRef.current.rightRestAngle - smoothRightAngle.current;
          while (da >  Math.PI) da -= Math.PI * 2;
          while (da < -Math.PI) da += Math.PI * 2;
          smoothRightAngle.current += da * 0.1;
          if (Math.abs(da) < 0.03) smoothRightAngle.current = null;
        }

        deformSleeves(sleeveDataRef.current, smoothLeftAngle.current, smoothRightAngle.current);
      }

      rendererRef.current.render(sceneRef.current, cameraRef.current);
    }
    renderLoop();

    // Resize handler
    function handleResize() {
      const w = container.clientWidth;
      const h = container.clientHeight;
      cameraRef.current.aspect = w / h;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(w, h);
    }
    window.addEventListener('resize', handleResize);

    // Cleanup
    return () => {
      cancelAnimationFrame(animFrameRef.current);
      window.removeEventListener('resize', handleResize);
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  // Load / unload garment when currentCloth changes
  useEffect(() => {
    if (clothMeshRef.current && sceneRef.current) {
      sceneRef.current.remove(clothMeshRef.current);
      clothMeshRef.current = null;
    }

    // Reset sleeve deformation data
    if (sleeveDataRef.current) {
      resetSleeves(sleeveDataRef.current);
      sleeveDataRef.current = null;
    }
    smoothLeftAngle.current = null;
    smoothRightAngle.current = null;

    // Reset smoothing on cloth change
    firstFrame.current = true;
    poseAge.current = 0;

    if (currentCloth === 'none') return;

    const garment = GARMENTS.find((g) => g.id === currentCloth);
    if (!garment || !garment.modelPath) return;

    loadingClothRef.current = currentCloth;
    console.log('Attempting to load GLB from:', garment.modelPath);

    loaderRef.current.load(
      garment.modelPath,
      (gltf) => {
        // Race condition guard: discard if user switched garment during load
        if (loadingClothRef.current !== currentCloth) {
          console.log('Garment switched during load, discarding:', currentCloth);
          return;
        }

        const model = gltf.scene;

        // Center the model at origin
        const box = new THREE.Box3().setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        model.position.sub(center);

        // Auto-orient: make model stand upright (Y = tallest)
        autoOrientModel(model);

        // Re-center after orientation
        const box2 = new THREE.Box3().setFromObject(model);
        const center2 = box2.getCenter(new THREE.Vector3());
        model.position.sub(center2);

        // Check if model ended up upside down (center below origin)
        const checkBox = new THREE.Box3().setFromObject(model);
        const checkCenter = checkBox.getCenter(new THREE.Vector3());
        if (checkCenter.y < -0.3) {
          model.rotation.x += Math.PI;
          const fixBox = new THREE.Box3().setFromObject(model);
          const fixCenter = fixBox.getCenter(new THREE.Vector3());
          model.position.sub(fixCenter);
        }

        // Wrap model in a Group to separate orientation from pose rotation.
        // Model retains its orientation rotation (rotation.x for standing up).
        // Wrapper gets pose-driven transforms (position, scale, rotY, rotZ)
        // so they don't interfere with the model's Euler angles.
        const wrapper = new THREE.Group();
        wrapper.add(model);

        // Measure dimensions from the wrapper (includes model orientation)
        const sizeBox = new THREE.Box3().setFromObject(wrapper);
        const size = sizeBox.getSize(new THREE.Vector3());
        clothModelDimsRef.current = { width: size.x, height: size.y, depth: size.z };
        console.log('Model loaded:', currentCloth, 'dims:', {
          width: size.x.toFixed(3),
          height: size.y.toFixed(3),
          depth: size.z.toFixed(3)
        });

        // Start invisible — render loop shows it on first valid pose
        wrapper.visible = false;

        // Fix materials: preserve PBR, fix common visibility issues
        model.traverse((child) => {
          if (child.isMesh) {
            if (child.geometry) {
              child.geometry.computeBoundingBox();
              child.geometry.computeBoundingSphere();
            }
            if (child.material) {
              if (!child.material.map && child.material.opacity < 0.3) {
                child.material.opacity = 1.0;
              }
              child.material.transparent = child.material.opacity < 0.99;
              child.material.side = THREE.DoubleSide;
              child.material.depthTest = true;
              child.material.depthWrite = true;
              if (child.material.map) {
                child.material.map.colorSpace = THREE.SRGBColorSpace;
              }
              child.material.needsUpdate = true;
            }
          }
        });

        sceneRef.current.add(wrapper);
        clothMeshRef.current = wrapper;

        // Prepare sleeve vertex deformation data
        sleeveDataRef.current = prepareSleeveData(wrapper);

        // Reset smoothing for the new garment
        firstFrame.current = true;
        poseAge.current = 0;

        if (onModelLoaded) onModelLoaded(currentCloth);
      },
      undefined,
      (err) => {
        console.error('GLB LOAD FAILED for', currentCloth, ':', err);
        console.error('Attempted path:', garment.modelPath);
      }
    );
  }, [currentCloth]);

  return { rendererRef, sceneRef, cameraRef };
}
