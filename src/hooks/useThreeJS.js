import { useEffect, useRef, useCallback } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import GARMENTS from '../constants/garments';
import { computeGarmentTransform, videoPixelToWorld } from '../utils/garmentPositioner';
import { prepareSleeveData, deformSleeves, resetSleeves } from '../utils/armDeformer';

export default function useThreeJS(containerRef, videoRef, currentCloth, adjustments, lastPoseRef, onModelLoaded, garmentFlipped, onBonesLoaded) {
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
  const bonesRef = useRef({});
  const isRiggedRef = useRef(false);
  const baseRotationRef = useRef(null);

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
        const mats = Array.isArray(child.material)
          ? child.material
          : [child.material];
        const needsTransparent = opacity < 0.99;
        mats.forEach(mat => {
          if (mat.transparent !== needsTransparent ||
              Math.abs(mat.opacity - opacity) > 0.01) {
            mat.transparent = needsTransparent;
            mat.opacity = opacity;
            mat.needsUpdate = true;
          }
        });
      }
    });
  }

  // ── BONE DRIVING FUNCTION (for rigged garments) ──
  function driveBones(pose, videoEl) {
    // Only drive bones if model is rigged and has bones
    if (!isRiggedRef.current) return;
    if (!pose || !videoEl) return;

    const bones = bonesRef.current;
    if (Object.keys(bones).length === 0) return;

    const kps = pose.keypoints;
    const vW = videoEl.videoWidth  || 1280;
    const vH = videoEl.videoHeight || 720;
    const cW = containerRef.current?.clientWidth  || 800;
    const cH = containerRef.current?.clientHeight || 600;

    const BONE_SMOOTH = 0.15;

    // Helper: find bone by multiple possible names
    function findBone(keywords) {
      const boneKeys = Object.keys(bones);

      // Try exact match first
      for (const keyword of keywords) {
        const exact = boneKeys.find(k =>
          k.toLowerCase() === keyword.toLowerCase()
        );
        if (exact) return bones[exact];
      }

      // Try contains match
      for (const keyword of keywords) {
        const contains = boneKeys.find(k =>
          k.toLowerCase().includes(keyword.toLowerCase())
        );
        if (contains) return bones[contains];
      }

      return null;
    }

    // Helper: get world position of a keypoint
    function kpWorld(kp) {
      if (!kp || kp.score < 0.25) return null;
      return videoPixelToWorld(kp.x, kp.y, vW, vH, cW, cH, cameraRef.current);
    }

    // Helper: smooth angle lerp
    function smoothAngle(current, target, factor) {
      let delta = target - current;
      while (delta >  Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      return current + delta * factor;
    }

    // ── LEFT UPPER ARM (shoulder to elbow) ──
    const lSh = kpWorld(kps[5]);
    const lEl = kpWorld(kps[7]);
    if (lSh && lEl) {
      const lUpperBone = findBone([
        'mixamorig:leftarm', 'mixamorigleftarm',
        'left_arm', 'leftarm', 'l_arm', 'larm',
        'upper_arm.l', 'upperarm.l', 'arm.l',
        'left upper', 'leftshoulder',
        'bone.003', 'bone.004', 'upper_arm_l', 'arm_l',
        'bicep_l', 'shoulder_l', 'humerus_l'
      ]);
      if (lUpperBone) {
        const dir = new THREE.Vector3().subVectors(lEl, lSh);
        const angleZ = Math.atan2(dir.y, dir.x);
        const angleX = Math.atan2(dir.z, Math.sqrt(dir.x*dir.x + dir.y*dir.y));
        lUpperBone.rotation.z = smoothAngle(lUpperBone.rotation.z, angleZ - Math.PI/2, BONE_SMOOTH);
        lUpperBone.rotation.x = smoothAngle(lUpperBone.rotation.x, angleX, BONE_SMOOTH);
      }
    }

    // ── LEFT FOREARM (elbow to wrist) ──
    const lWr = kpWorld(kps[9]);
    if (lEl && lWr) {
      const lForearmBone = findBone([
        'mixamorig:leftforearm', 'mixamorigleftforearm',
        'left_forearm', 'leftforearm', 'l_forearm', 'lforearm',
        'forearm.l', 'lower_arm.l', 'lowerarm.l',
        'left fore', 'left lower',
        'bone.005', 'bone.006', 'forearm_l', 'lower_arm_l',
        'elbow_l', 'radius_l'
      ]);
      if (lForearmBone) {
        const dir = new THREE.Vector3().subVectors(lWr, lEl);
        const angleZ = Math.atan2(dir.y, dir.x);
        lForearmBone.rotation.z = smoothAngle(lForearmBone.rotation.z, angleZ - Math.PI/2, BONE_SMOOTH);
      }
    }

    // ── RIGHT UPPER ARM (shoulder to elbow) ──
    const rSh = kpWorld(kps[6]);
    const rEl = kpWorld(kps[8]);
    if (rSh && rEl) {
      const rUpperBone = findBone([
        'mixamorig:rightarm', 'mixamorigrightarm',
        'right_arm', 'rightarm', 'r_arm', 'rarm',
        'upper_arm.r', 'upperarm.r', 'arm.r',
        'right upper', 'rightshoulder',
        'bone.007', 'bone.008', 'upper_arm_r', 'arm_r',
        'bicep_r', 'shoulder_r', 'humerus_r'
      ]);
      if (rUpperBone) {
        const dir = new THREE.Vector3().subVectors(rEl, rSh);
        const angleZ = Math.atan2(dir.y, dir.x);
        const angleX = Math.atan2(dir.z, Math.sqrt(dir.x*dir.x + dir.y*dir.y));
        rUpperBone.rotation.z = smoothAngle(rUpperBone.rotation.z, angleZ - Math.PI/2, BONE_SMOOTH);
        rUpperBone.rotation.x = smoothAngle(rUpperBone.rotation.x, angleX, BONE_SMOOTH);
      }
    }

    // ── RIGHT FOREARM (elbow to wrist) ──
    const rWr = kpWorld(kps[10]);
    if (rEl && rWr) {
      const rForearmBone = findBone([
        'mixamorig:rightforearm', 'mixamorigrightforearm',
        'right_forearm', 'rightforearm', 'r_forearm', 'rforearm',
        'forearm.r', 'lower_arm.r', 'lowerarm.r',
        'right fore', 'right lower',
        'bone.009', 'bone.010', 'forearm_r', 'lower_arm_r',
        'elbow_r', 'radius_r'
      ]);
      if (rForearmBone) {
        const dir = new THREE.Vector3().subVectors(rWr, rEl);
        const angleZ = Math.atan2(dir.y, dir.x);
        rForearmBone.rotation.z = smoothAngle(rForearmBone.rotation.z, angleZ - Math.PI/2, BONE_SMOOTH);
      }
    }

    // ── SPINE BONE (optional subtle body lean) ──
    if (lSh && rSh) {
      const spineBone = findBone([
        'mixamorig:spine', 'mixamorigspine',
        'spine', 'chest', 'torso', 'body',
        'spine1', 'spine2',
        'bone', 'bone.001', 'bone.002', 'root',
        'pelvis', 'hip'
      ]);
      if (spineBone) {
        const shoulderDir = new THREE.Vector3().subVectors(rSh, lSh);
        const tiltZ = Math.atan2(shoulderDir.y, shoulderDir.x);
        spineBone.rotation.z = smoothAngle(spineBone.rotation.z, tiltZ * 0.3, BONE_SMOOTH);
      }
    }
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
    renderer.outputEncoding = THREE.sRGBEncoding;
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
            const S = THREE.MathUtils.clamp(0.12 + motion * 2.0, 0.12, 0.45);

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

      // ── BONE DRIVING (for rigged garments) ──
      if (lastPoseRef.current && videoElRef.current) {
        driveBones(lastPoseRef.current, videoElRef.current);
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

    // Reset all bones to rest position
    if (clothMeshRef.current) {
      clothMeshRef.current.traverse(child => {
        if (child.isBone) {
          child.rotation.set(0, 0, 0);
          child.position.set(0, 0, 0);
        }
      });
    }
    bonesRef.current = {};
    isRiggedRef.current = false;

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

        // Fix materials: force fully solid, opaque, front-side rendering
        model.traverse(child => {
          if (child.isMesh && child.material) {
            // Handle both single material and material arrays
            const mats = Array.isArray(child.material)
              ? child.material
              : [child.material];

            mats.forEach(mat => {
              mat.transparent = false;
              mat.opacity = 1.0;
              mat.alphaTest = 0;
              mat.depthTest = true;
              mat.depthWrite = true;
              mat.side = THREE.FrontSide;
              mat.needsUpdate = true;

              // Fix dark materials — ensure they render visible
              if (mat.color) {
                const brightness = mat.color.r + mat.color.g + mat.color.b;
                if (brightness < 0.1) {
                  mat.color.setRGB(0.5, 0.5, 0.5);
                }
              }

              if (mat.map) {
                mat.map.encoding = THREE.sRGBEncoding;
              }
            });

            // Fix geometry normals
            if (child.geometry) {
              child.geometry.computeVertexNormals();
              child.geometry.computeBoundingBox();
              child.geometry.computeBoundingSphere();
            }
          }
        });

        sceneRef.current.add(wrapper);
        clothMeshRef.current = wrapper;

        // Prepare sleeve vertex deformation data
        sleeveDataRef.current = prepareSleeveData(wrapper);

        // Find all bones in the loaded model
        const foundBones = {};
        model.traverse(child => {
          if (child.isBone) {
            foundBones[child.name.toLowerCase()] = child;
            console.log('Bone found:', child.name);
          }
        });
        bonesRef.current = foundBones;

        // Check if this garment is rigged
        const garmentData = GARMENTS.find(g => g.id === currentClothRef.current);
        isRiggedRef.current = garmentData?.isRigged || false;

        console.log('Total bones found:', Object.keys(foundBones).length);
        console.log('Is rigged:', isRiggedRef.current);

        console.log('=== BONE NAMES IN MODEL ===');
        Object.keys(bonesRef.current).forEach(name => {
          console.log(' -', name);
        });
        console.log('===========================');

        // Report bone names via callback for debug overlay
        const boneNames = Object.keys(foundBones).join(', ');
        if (onBonesLoaded) onBonesLoaded(boneNames || 'NO BONES FOUND');

        // Store base rotation for flip reference
        baseRotationRef.current = model.rotation.clone();

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
