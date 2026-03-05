import { useEffect, useRef, useCallback } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import GARMENTS from '../constants/garments';
import { computeGarmentTransform, videoPixelToWorld } from '../utils/garmentPositioner';
import { prepareSleeveData, deformSleeves, resetSleeves } from '../utils/armDeformer';

/* ── Smoothing constants ── */
const POS_LERP   = 0.25;   // position interpolation
const SCALE_LERP = 0.25;   // scale interpolation
const ROT_LERP   = 0.20;   // rotation interpolation
const BONE_LERP  = 0.15;   // bone driving interpolation
const ARM_LERP   = 0.25;   // sleeve deformation interpolation

const IS_DEV = typeof import.meta !== 'undefined' && import.meta.env?.DEV;

/**
 * Core Three.js hook – sets up scene, loads garments, drives pose-based positioning
 * and bone animation.
 */
export default function useThreeJS(
  containerRef, videoRef, currentCloth, adjustments,
  lastPoseRef, onModelLoaded, garmentFlipped, onBonesLoaded,
  isFrontCamera,
) {
  const rendererRef   = useRef(null);
  const sceneRef      = useRef(null);
  const cameraRef     = useRef(null);
  const clothMeshRef  = useRef(null);
  const animFrameRef  = useRef(null);
  const loaderRef     = useRef(null);
  const clothModelDimsRef = useRef({ width: 1, height: 1, depth: 1 });
  const loadingClothRef   = useRef(null);
  const garmentFlippedRef = useRef(false);
  const videoElRef        = useRef(null);
  const currentClothRef   = useRef(currentCloth);
  const bonesRef          = useRef({});
  const isRiggedRef       = useRef(false);
  const baseRotationRef   = useRef(null);
  const isFrontCameraRef  = useRef(isFrontCamera !== false);

  // Smoothing state
  const smoothPos   = useRef(new THREE.Vector3());
  const smoothScale = useRef(1.0);
  const smoothRotZ  = useRef(0);
  const smoothRotY  = useRef(0);
  const firstFrame  = useRef(true);
  const poseAge     = useRef(0);

  // Arm deformation
  const sleeveDataRef   = useRef(null);
  const smoothLeftAngle  = useRef(null);
  const smoothRightAngle = useRef(null);

  // Live refs for render loop
  const adjustmentsRef = useRef(adjustments);
  useEffect(() => { adjustmentsRef.current = adjustments; }, [adjustments]);
  useEffect(() => { garmentFlippedRef.current = garmentFlipped; }, [garmentFlipped]);
  useEffect(() => { currentClothRef.current = currentCloth; }, [currentCloth]);
  useEffect(() => { isFrontCameraRef.current = isFrontCamera !== false; }, [isFrontCamera]);
  useEffect(() => { videoElRef.current = videoRef?.current ?? null; });

  // ── Helpers ──

  function autoOrientModel(model) {
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    if (size.y >= size.x * 0.7 && size.y >= size.z * 0.7) return;
    if (size.z > size.y && size.z >= size.x) {
      model.rotation.x = -Math.PI / 2;
    } else if (size.x > size.y && size.x > size.z) {
      model.rotation.z = Math.PI / 2;
    }
  }

  function setMeshOpacity(mesh, opacity) {
    mesh.traverse((child) => {
      if (child.isMesh && child.material) {
        const mats = Array.isArray(child.material) ? child.material : [child.material];
        const needsTransparent = opacity < 0.99;
        mats.forEach(mat => {
          if (mat.transparent !== needsTransparent || Math.abs(mat.opacity - opacity) > 0.01) {
            mat.transparent = needsTransparent;
            mat.opacity = opacity;
            mat.needsUpdate = true;
          }
        });
      }
    });
  }

  /** Smooth angle lerp that handles wraparound */
  function lerpAngle(current, target, t) {
    let d = target - current;
    while (d >  Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return current + d * t;
  }

  // ── Bone Driving (rigged garments) ──

  function driveBones(pose, videoEl) {
    if (!isRiggedRef.current || !pose || !videoEl) return;
    const bones = bonesRef.current;
    if (Object.keys(bones).length === 0) return;

    const kps = pose.keypoints;
    const vW = videoEl.videoWidth  || 1280;
    const vH = videoEl.videoHeight || 720;
    const cW = containerRef.current?.clientWidth  || 800;
    const cH = containerRef.current?.clientHeight || 600;

    function findBone(keywords) {
      const boneKeys = Object.keys(bones);
      for (const kw of keywords) {
        const exact = boneKeys.find(k => k.toLowerCase() === kw.toLowerCase());
        if (exact) return bones[exact];
      }
      for (const kw of keywords) {
        const contains = boneKeys.find(k => k.toLowerCase().includes(kw.toLowerCase()));
        if (contains) return bones[contains];
      }
      return null;
    }

    function kpWorld(kp) {
      if (!kp || kp.score < 0.25) return null;
      return videoPixelToWorld(
        kp.x, kp.y, vW, vH, cW, cH,
        cameraRef.current, isFrontCameraRef.current,
      );
    }

    // ── Left upper arm ──
    const lSh = kpWorld(kps[5]);
    const lEl = kpWorld(kps[7]);
    if (lSh && lEl) {
      const bone = findBone([
        'mixamorig:leftarm', 'left_arm', 'leftarm', 'l_arm',
        'upper_arm.l', 'arm.l', 'bone.003', 'bone.004',
      ]);
      if (bone) {
        const dir = new THREE.Vector3().subVectors(lEl, lSh);
        const aZ = Math.atan2(dir.y, dir.x);
        const aX = Math.atan2(dir.z, Math.sqrt(dir.x * dir.x + dir.y * dir.y));
        bone.rotation.z = lerpAngle(bone.rotation.z, aZ - Math.PI / 2, BONE_LERP);
        bone.rotation.x = lerpAngle(bone.rotation.x, aX, BONE_LERP);
      }
    }

    // ── Left forearm ──
    const lWr = kpWorld(kps[9]);
    if (lEl && lWr) {
      const bone = findBone([
        'mixamorig:leftforearm', 'left_forearm', 'leftforearm',
        'forearm.l', 'lower_arm.l', 'bone.005', 'bone.006',
      ]);
      if (bone) {
        const dir = new THREE.Vector3().subVectors(lWr, lEl);
        bone.rotation.z = lerpAngle(bone.rotation.z, Math.atan2(dir.y, dir.x) - Math.PI / 2, BONE_LERP);
      }
    }

    // ── Right upper arm ──
    const rSh = kpWorld(kps[6]);
    const rEl = kpWorld(kps[8]);
    if (rSh && rEl) {
      const bone = findBone([
        'mixamorig:rightarm', 'right_arm', 'rightarm', 'r_arm',
        'upper_arm.r', 'arm.r', 'bone.007', 'bone.008',
      ]);
      if (bone) {
        const dir = new THREE.Vector3().subVectors(rEl, rSh);
        const aZ = Math.atan2(dir.y, dir.x);
        const aX = Math.atan2(dir.z, Math.sqrt(dir.x * dir.x + dir.y * dir.y));
        bone.rotation.z = lerpAngle(bone.rotation.z, aZ - Math.PI / 2, BONE_LERP);
        bone.rotation.x = lerpAngle(bone.rotation.x, aX, BONE_LERP);
      }
    }

    // ── Right forearm ──
    const rWr = kpWorld(kps[10]);
    if (rEl && rWr) {
      const bone = findBone([
        'mixamorig:rightforearm', 'right_forearm', 'rightforearm',
        'forearm.r', 'lower_arm.r', 'bone.009', 'bone.010',
      ]);
      if (bone) {
        const dir = new THREE.Vector3().subVectors(rWr, rEl);
        bone.rotation.z = lerpAngle(bone.rotation.z, Math.atan2(dir.y, dir.x) - Math.PI / 2, BONE_LERP);
      }
    }

    // ── Spine / body lean ──
    if (lSh && rSh) {
      const bone = findBone([
        'mixamorig:spine', 'spine', 'chest', 'torso',
        'bone', 'bone.001', 'bone.002', 'root', 'pelvis',
      ]);
      if (bone) {
        const sd = new THREE.Vector3().subVectors(rSh, lSh);
        const tiltZ = Math.atan2(sd.y, sd.x);
        bone.rotation.z = lerpAngle(bone.rotation.z, tiltZ * 0.3, BONE_LERP);
      }
    }
  }

  // ── Scene setup (runs once on mount) ──

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const width  = container.clientWidth;
    const height = container.clientHeight;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
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

    // Neutral env for PBR materials
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

    // Lights — 3-point + hemisphere
    scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 0.6));
    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(2, 5, 5);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.5);
    fill.position.set(-3, 2, 4);
    scene.add(fill);
    const rim = new THREE.DirectionalLight(0x8888ff, 0.35);
    rim.position.set(0, 3, -5);
    scene.add(rim);

    loaderRef.current = new GLTFLoader();

    // ── Render loop ──
    function renderLoop() {
      animFrameRef.current = requestAnimationFrame(renderLoop);

      // Resize
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

      const hasPose  = !!lastPoseRef.current;
      const hasMesh  = !!clothMeshRef.current;
      const hasVideo = !!(videoElRef.current && videoElRef.current.videoWidth > 0);

      if (hasMesh && hasPose && hasVideo) {
        const t = computeGarmentTransform(
          lastPoseRef.current,
          cameraRef.current,
          containerRef.current,
          adjustmentsRef.current,
          videoElRef.current,
          clothModelDimsRef.current,
          isFrontCameraRef.current,
        );

        if (t && t.scale > 0.005 && t.scale < 30) {
          poseAge.current = 0;

          let targetRotY = t.rotY;
          if (garmentFlippedRef.current) targetRotY += Math.PI;

          if (firstFrame.current) {
            // Snap on first valid frame — no interpolation
            smoothPos.current.copy(t.position);
            smoothScale.current = t.scale;
            smoothRotZ.current = t.rotZ;
            smoothRotY.current = targetRotY;
            firstFrame.current = false;
            clothMeshRef.current.visible = true;
          } else {
            // Stable LERP smoothing
            smoothPos.current.lerp(t.position, POS_LERP);
            smoothScale.current += (t.scale - smoothScale.current) * SCALE_LERP;
            smoothRotZ.current = lerpAngle(smoothRotZ.current, t.rotZ, ROT_LERP);
            smoothRotY.current = lerpAngle(smoothRotY.current, targetRotY, ROT_LERP);
          }

          clothMeshRef.current.position.copy(smoothPos.current);
          clothMeshRef.current.scale.setScalar(smoothScale.current);
          clothMeshRef.current.rotation.z = smoothRotZ.current;
          clothMeshRef.current.rotation.y = smoothRotY.current;
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

      // ── Sleeve vertex deformation ──
      if (sleeveDataRef.current && lastPoseRef.current && videoElRef.current && clothMeshRef.current?.visible) {
        const kps = lastPoseRef.current.keypoints;
        const lSh = kps[5], rSh = kps[6];
        const lEl = kps[7], rEl = kps[8];
        const vW = videoElRef.current.videoWidth  || 1280;
        const vH = videoElRef.current.videoHeight || 720;
        const cW = containerRef.current?.clientWidth  || 800;
        const cH = containerRef.current?.clientHeight || 600;
        const mirrorX = isFrontCameraRef.current;

        let targetLeft = null, targetRight = null;

        if (lSh && lEl && lSh.score > 0.25 && lEl.score > 0.25) {
          const lShW = videoPixelToWorld(lSh.x, lSh.y, vW, vH, cW, cH, cameraRef.current, mirrorX);
          const lElW = videoPixelToWorld(lEl.x, lEl.y, vW, vH, cW, cH, cameraRef.current, mirrorX);
          const worldAngle = Math.atan2(lElW.y - lShW.y, lElW.x - lShW.x);
          targetLeft = Math.PI - worldAngle - smoothRotZ.current;
        }
        if (rSh && rEl && rSh.score > 0.25 && rEl.score > 0.25) {
          const rShW = videoPixelToWorld(rSh.x, rSh.y, vW, vH, cW, cH, cameraRef.current, mirrorX);
          const rElW = videoPixelToWorld(rEl.x, rEl.y, vW, vH, cW, cH, cameraRef.current, mirrorX);
          const worldAngle = Math.atan2(rElW.y - rShW.y, rElW.x - rShW.x);
          targetRight = Math.PI - worldAngle - smoothRotZ.current;
        }

        if (targetLeft !== null) {
          if (smoothLeftAngle.current === null) smoothLeftAngle.current = targetLeft;
          else {
            let da = targetLeft - smoothLeftAngle.current;
            while (da >  Math.PI) da -= Math.PI * 2;
            while (da < -Math.PI) da += Math.PI * 2;
            smoothLeftAngle.current += da * ARM_LERP;
          }
        } else if (smoothLeftAngle.current !== null) {
          let da = sleeveDataRef.current.leftRestAngle - smoothLeftAngle.current;
          while (da >  Math.PI) da -= Math.PI * 2;
          while (da < -Math.PI) da += Math.PI * 2;
          smoothLeftAngle.current += da * 0.1;
          if (Math.abs(da) < 0.03) smoothLeftAngle.current = null;
        }

        if (targetRight !== null) {
          if (smoothRightAngle.current === null) smoothRightAngle.current = targetRight;
          else {
            let da = targetRight - smoothRightAngle.current;
            while (da >  Math.PI) da -= Math.PI * 2;
            while (da < -Math.PI) da += Math.PI * 2;
            smoothRightAngle.current += da * ARM_LERP;
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

      // ── Bone driving ──
      if (lastPoseRef.current && videoElRef.current) {
        driveBones(lastPoseRef.current, videoElRef.current);
      }

      rendererRef.current.render(sceneRef.current, cameraRef.current);
    }

    renderLoop();

    function handleResize() {
      const w = container.clientWidth;
      const h = container.clientHeight;
      cameraRef.current.aspect = w / h;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(w, h);
    }
    window.addEventListener('resize', handleResize);

    // Orientation change support
    function handleOrientationChange() {
      setTimeout(handleResize, 200);
    }
    window.addEventListener('orientationchange', handleOrientationChange);

    return () => {
      cancelAnimationFrame(animFrameRef.current);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleOrientationChange);
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  // ── Load / unload garment ──

  useEffect(() => {
    if (clothMeshRef.current && sceneRef.current) {
      sceneRef.current.remove(clothMeshRef.current);
      clothMeshRef.current = null;
    }

    bonesRef.current = {};
    isRiggedRef.current = false;

    if (sleeveDataRef.current) {
      resetSleeves(sleeveDataRef.current);
      sleeveDataRef.current = null;
    }
    smoothLeftAngle.current = null;
    smoothRightAngle.current = null;
    firstFrame.current = true;
    poseAge.current = 0;

    if (currentCloth === 'none') return;

    const garment = GARMENTS.find((g) => g.id === currentCloth);
    if (!garment || !garment.modelPath) return;

    loadingClothRef.current = currentCloth;
    if (IS_DEV) console.log('[FitAR] Loading model:', garment.modelPath);

    loaderRef.current.load(
      garment.modelPath,
      (gltf) => {
        if (loadingClothRef.current !== currentCloth) return;

        const model = gltf.scene;

        // Center
        const box = new THREE.Box3().setFromObject(model);
        const center = box.getCenter(new THREE.Vector3());
        model.position.sub(center);

        // Auto-orient (Y = tallest)
        autoOrientModel(model);

        // Re-center after orientation
        const box2 = new THREE.Box3().setFromObject(model);
        model.position.sub(box2.getCenter(new THREE.Vector3()));

        // Check upside-down
        const cb = new THREE.Box3().setFromObject(model);
        if (cb.getCenter(new THREE.Vector3()).y < -0.3) {
          model.rotation.x += Math.PI;
          const fb = new THREE.Box3().setFromObject(model);
          model.position.sub(fb.getCenter(new THREE.Vector3()));
        }

        // Wrapper group separates orientation from pose transforms
        const wrapper = new THREE.Group();
        wrapper.add(model);

        const sizeBox = new THREE.Box3().setFromObject(wrapper);
        const size = sizeBox.getSize(new THREE.Vector3());
        clothModelDimsRef.current = { width: size.x, height: size.y, depth: size.z };

        wrapper.visible = false;

        // Fix materials: solid, opaque, front-side
        model.traverse(child => {
          if (child.isMesh && child.material) {
            const mats = Array.isArray(child.material) ? child.material : [child.material];
            mats.forEach(mat => {
              mat.transparent = false;
              mat.opacity = 1.0;
              mat.alphaTest = 0;
              mat.depthTest = true;
              mat.depthWrite = true;
              mat.side = THREE.FrontSide;
              mat.needsUpdate = true;
              if (mat.color) {
                const brightness = mat.color.r + mat.color.g + mat.color.b;
                if (brightness < 0.1) mat.color.setRGB(0.5, 0.5, 0.5);
              }
              if (mat.map) mat.map.encoding = THREE.sRGBEncoding;
            });
            if (child.geometry) {
              child.geometry.computeVertexNormals();
              child.geometry.computeBoundingBox();
              child.geometry.computeBoundingSphere();
            }
          }
        });

        sceneRef.current.add(wrapper);
        clothMeshRef.current = wrapper;

        // Sleeve deformation
        sleeveDataRef.current = prepareSleeveData(wrapper);

        // Discover bones
        const foundBones = {};
        model.traverse(child => {
          if (child.isBone) foundBones[child.name.toLowerCase()] = child;
        });
        bonesRef.current = foundBones;

        const garmentData = GARMENTS.find(g => g.id === currentClothRef.current);
        isRiggedRef.current = garmentData?.isRigged || false;

        if (IS_DEV) {
          console.log('[FitAR] Bones:', Object.keys(foundBones).join(', ') || 'none');
        }

        if (onBonesLoaded) onBonesLoaded(Object.keys(foundBones).join(', ') || 'NONE');

        baseRotationRef.current = model.rotation.clone();
        firstFrame.current = true;
        poseAge.current = 0;

        if (onModelLoaded) onModelLoaded(currentCloth);
      },
      undefined,
      (err) => {
        console.error('[FitAR] Model load failed:', garment.modelPath, err);
      },
    );
  }, [currentCloth]);

  return { rendererRef, sceneRef, cameraRef };
}
