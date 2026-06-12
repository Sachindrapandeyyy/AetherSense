/**
 * Skeleton3D — WebGL 3D Skeleton visualizer using Three.js
 */
import { AvatarRenderer } from './avatar-renderer.js?v=16';

export class Skeleton3D {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    if (!this.canvas) {
      console.warn(`[Skeleton3D] Canvas #${canvasId} not found`);
      return;
    }

    // Scene setup
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x050810);

    // Camera setup
    this.camera = new THREE.PerspectiveCamera(40, this.canvas.clientWidth / this.canvas.clientHeight, 0.1, 100);
    this.camera.position.set(0, 0, 7.5);

    // WebGL Renderer
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setSize(this.canvas.clientWidth, this.canvas.clientHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // Orbit Controls
    if (typeof THREE.OrbitControls !== 'undefined') {
      this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
      this.controls.enableDamping = true;
      this.controls.dampingFactor = 0.05;
      this.controls.maxPolarAngle = Math.PI / 2 + 0.1; // floor boundary
      this.controls.minDistance = 2;
      this.controls.maxDistance = 15;
    } else {
      console.warn('[Skeleton3D] THREE.OrbitControls not loaded, interaction disabled');
    }

    // Lights (gold/warm orange ambient and directional lights)
    const ambientLight = new THREE.AmbientLight(0x181008, 2.0);
    this.scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffb300, 2.0);
    dirLight.position.set(5, 10, 7);
    this.scene.add(dirLight);

    const dirLight2 = new THREE.DirectionalLight(0xff7043, 1.2);
    dirLight2.position.set(-5, 5, -5);
    this.scene.add(dirLight2);

    // Grid Floor (styled to match premium gold/yellow theme)
    const gridHelper = new THREE.GridHelper(20, 24, 0xffca28, 0x1c120c);
    gridHelper.position.y = -2.0;
    this.scene.add(gridHelper);

    // Groups
    this.skeletonGroup = new THREE.Group();
    this.scene.add(this.skeletonGroup);

    this.faceGroup = new THREE.Group();
    this.scene.add(this.faceGroup);

    // Geometries & Materials (gold joint spheres and limbs)
    this.jointGeom = new THREE.SphereGeometry(0.12, 16, 16);
    this.jointMaterial = new THREE.MeshStandardMaterial({
      color: 0xffca28,
      roughness: 0.1,
      metalness: 0.8,
      emissive: 0xffca28,
      emissiveIntensity: 0.15
    });

    this.limbMaterial = new THREE.MeshStandardMaterial({
      color: 0xffb300,
      roughness: 0.4,
      metalness: 0.5,
      transparent: true,
      opacity: 0.85
    });

    this.facePoints = null;

    // Initialize Avatar
    this.avatarRenderer = new AvatarRenderer();

    // Start rendering
    this.animate();
  }

  /**
   * Handle resize
   */
  resize(w, h) {
    if (!this.renderer) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  }

  /**
   * Animation loop
   */
  animate() {
    requestAnimationFrame(() => this.animate());
    if (this.controls) this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Update 3D elements based on pose keypoints
   */
  update(keypoints, faceLandmarks, minConf, avatarMode = false) {
    if (avatarMode) {
      // Clear skeleton meshes
      while (this.skeletonGroup.children.length > 0) {
        this.skeletonGroup.remove(this.skeletonGroup.children[0]);
      }
      if (this.facePoints) {
        this.faceGroup.remove(this.facePoints);
        this.facePoints = null;
      }
      this.avatarRenderer.update(this.scene, keypoints, faceLandmarks, minConf);
      return;
    } else {
      this.avatarRenderer.hide(this.scene);
    }

    // Clear current skeleton meshes
    while (this.skeletonGroup.children.length > 0) {
      this.skeletonGroup.remove(this.skeletonGroup.children[0]);
    }

    if (!keypoints || keypoints.length === 0) {
      // Clear face mesh points if pose is lost
      if (this.facePoints) {
        this.faceGroup.remove(this.facePoints);
        this.facePoints = null;
      }
      return;
    }

    const scale = 4.5;
    const offset = new THREE.Vector3(0, 0.5, 0); // Center skeleton slightly above grid floor

    // Map landmarks to 3D vectors
    const points = keypoints.map(kp => {
      if (!kp || kp.confidence < minConf) return null;
      // MediaPipe: X [0,1] left-to-right (mirrored), Y [0,1] top-to-bottom.
      // We flip X to match camera orientation, invert Y to match WebGL +Y = Up.
      return new THREE.Vector3(
        (0.5 - kp.x) * scale,
        (0.5 - kp.y) * scale * 1.25,
        -(kp.z || 0) * scale
      ).add(offset);
    });

    // 1. Draw joints
    points.forEach((pt, idx) => {
      if (!pt) return;
      // Skip face joints (first 5) if detailed 3D face mesh is active
      if (faceLandmarks && idx <= 4) return;

      const mesh = new THREE.Mesh(this.jointGeom, this.jointMaterial.clone());
      mesh.position.copy(pt);

      // Color-code joints matching 2D kinematic gradients (themed around gold/orange/red)
      if (idx <= 4) mesh.material.color.setHex(0xff5252); // Head (red-orange)
      else if (idx <= 10) mesh.material.color.setHex(0xffa726); // Arms (orange)
      else if (idx <= 16) mesh.material.color.setHex(0xffd54f); // Legs (warm gold)
      else mesh.material.color.setHex(0xffb300); // Hand/feet (deep gold)

      this.skeletonGroup.add(mesh);
    });

    // 2. Draw limbs as cylinders
    const connections = [
      [5, 6], [5, 7], [7, 9], [6, 8], [8, 10],   // Upper body
      [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], // Lower body
      [5, 11], [6, 12] // Hips to Shoulders
    ];

    connections.forEach(([i, j]) => {
      const pA = points[i];
      const pB = points[j];
      if (!pA || !pB) return;

      const dir = new THREE.Vector3().subVectors(pB, pA);
      const len = dir.length();
      if (len === 0) return;

      const cylinderGeom = new THREE.CylinderGeometry(0.04, 0.04, len, 8);
      cylinderGeom.translate(0, len / 2, 0);
      cylinderGeom.rotateX(Math.PI / 2);

      const mesh = new THREE.Mesh(cylinderGeom, this.limbMaterial);
      mesh.position.copy(pA);
      mesh.lookAt(pB);

      this.skeletonGroup.add(mesh);
    });

    // 3. Draw 3D Face Point Cloud
    if (faceLandmarks && faceLandmarks.length > 100) {
      this._updateFaceMesh(faceLandmarks, scale, offset);
    } else {
      if (this.facePoints) {
        this.faceGroup.remove(this.facePoints);
        this.facePoints = null;
      }
    }
  }

  /**
   * Render face mesh points
   */
  _updateFaceMesh(lm, scale, offset) {
    if (this.facePoints) {
      this.faceGroup.remove(this.facePoints);
    }

    const n = lm.length;
    const vertices = new Float32Array(n * 3);
    const colors = new Float32Array(n * 3);

    for (let i = 0; i < n; i++) {
      const pt = lm[i];
      const x = (0.5 - pt.x) * scale;
      const y = (0.5 - pt.y) * scale * 1.25;
      const z = -(pt.z || 0) * scale;

      vertices[i * 3] = x + offset.x;
      vertices[i * 3 + 1] = y + offset.y;
      vertices[i * 3 + 2] = z + offset.z;

      // Color based on relative depth (gold/yellow near, orange/red far)
      const pct = Math.max(0, Math.min(1, (pt.z + 0.05) / 0.1));
      colors[i * 3] = 1.0;
      colors[i * 3 + 1] = 0.85 - pct * 0.45;
      colors[i * 3 + 2] = 0.3 - pct * 0.3;
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.PointsMaterial({
      size: 0.035,
      vertexColors: true,
      transparent: true,
      opacity: 0.8
    });

    this.facePoints = new THREE.Points(geom, mat);
    this.faceGroup.add(this.facePoints);
  }
}
