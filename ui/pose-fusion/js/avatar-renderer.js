/**
 * AvatarRenderer — Renders a wireframe humanoid mannequin in 3D WebGL
 */
export class AvatarRenderer {
  constructor() {
    this.group = new THREE.Group();

    // Humanoid materials (gold themed wireframes and emissive orange joints)
    this.bodyMaterial = new THREE.MeshStandardMaterial({
      color: 0xffca28, // gold
      wireframe: true,
      transparent: true,
      opacity: 0.65
    });

    this.headMaterial = new THREE.MeshStandardMaterial({
      color: 0xffb300, // deep gold
      wireframe: true,
      transparent: true,
      opacity: 0.75
    });

    this.jointMaterial = new THREE.MeshStandardMaterial({
      color: 0xff7043, // warm coral orange for joints
      roughness: 0.2,
      metalness: 0.8,
      emissive: 0xff7043,
      emissiveIntensity: 0.1
    });
  }

  /**
   * Render or update the humanoid avatar meshes in the Three.js scene
   */
  update(scene, keypoints, faceLandmarks, minConf) {
    // Clear previous frames
    while (this.group.children.length > 0) {
      this.group.remove(this.group.children[0]);
    }

    if (!keypoints || keypoints.length === 0) return;

    const scale = 4.5;
    const offset = new THREE.Vector3(0, 0.5, 0);

    // Map 3D points
    const points = keypoints.map(kp => {
      if (!kp || kp.confidence < minConf) return null;
      return new THREE.Vector3(
        (0.5 - kp.x) * scale,
        (0.5 - kp.y) * scale * 1.25,
        -(kp.z || 0) * scale
      ).add(offset);
    });

    const checkPoints = (...indices) => indices.every(idx => points[idx] !== null);

    // Helper: Draw cylinder segment
    const drawVolumetricSegment = (pA, pB, radius) => {
      const dir = new THREE.Vector3().subVectors(pB, pA);
      const len = dir.length();
      if (len === 0) return;

      const geom = new THREE.CylinderGeometry(radius, radius, len, 8);
      geom.translate(0, len / 2, 0);
      geom.rotateX(Math.PI / 2);

      const mesh = new THREE.Mesh(geom, this.bodyMaterial);
      mesh.position.copy(pA);
      mesh.lookAt(pB);

      this.group.add(mesh);
    };

    // 1. Head (Volumetric Sphere)
    if (checkPoints(0, 3, 4)) {
      const pNose = points[0];
      const pLEar = points[3];
      const pREar = points[4];
      const headCenter = new THREE.Vector3().addVectors(pLEar, pREar).multiplyScalar(0.5);
      headCenter.y += 0.12;

      const headRadius = pLEar.distanceTo(pREar) * 0.72;
      const headGeom = new THREE.SphereGeometry(headRadius || 0.40, 12, 12);
      const headMesh = new THREE.Mesh(headGeom, this.headMaterial);
      headMesh.position.copy(headCenter);
      this.group.add(headMesh);
    } else if (points[0]) {
      const headGeom = new THREE.SphereGeometry(0.32, 10, 10);
      const headMesh = new THREE.Mesh(headGeom, this.headMaterial);
      headMesh.position.copy(points[0]);
      this.group.add(headMesh);
    }

    // 2. Torso cage (Box-cage humanoid chest)
    if (checkPoints(5, 6, 11, 12)) {
      const pLSh = points[5], pRSh = points[6], pLHp = points[11], pRHp = points[12];
      
      // Outer boundaries
      drawVolumetricSegment(pLSh, pRSh, 0.16); // Shoulder girder
      drawVolumetricSegment(pLHp, pRHp, 0.14); // Pelvic girdle
      drawVolumetricSegment(pLSh, pLHp, 0.12); // Left torso
      drawVolumetricSegment(pRSh, pRHp, 0.12); // Right torso

      // Cross braces for visual ribcage volume
      drawVolumetricSegment(pLSh, pRHp, 0.06);
      drawVolumetricSegment(pRSh, pLHp, 0.06);
    }

    // 3. Limbs (Capsules)
    // Arms
    if (checkPoints(5, 7)) drawVolumetricSegment(points[5], points[7], 0.09); // L Upper Arm
    if (checkPoints(7, 9)) drawVolumetricSegment(points[7], points[9], 0.07); // L Forearm
    if (checkPoints(6, 8)) drawVolumetricSegment(points[6], points[8], 0.09); // R Upper Arm
    if (checkPoints(8, 10)) drawVolumetricSegment(points[8], points[10], 0.07); // R Forearm

    // Legs
    if (checkPoints(11, 13)) drawVolumetricSegment(points[11], points[13], 0.14); // L Thigh
    if (checkPoints(13, 15)) drawVolumetricSegment(points[13], points[15], 0.11); // L Shin
    if (checkPoints(12, 14)) drawVolumetricSegment(points[12], points[14], 0.14); // R Thigh
    if (checkPoints(14, 16)) drawVolumetricSegment(points[14], points[16], 0.11); // R Shin

    // 4. Joint Connectors (Spherical nodes)
    const activeJoints = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
    activeJoints.forEach(idx => {
      const pt = points[idx];
      if (!pt) return;
      const geom = new THREE.SphereGeometry(0.12, 8, 8);
      const mesh = new THREE.Mesh(geom, this.jointMaterial);
      mesh.position.copy(pt);
      this.group.add(mesh);
    });

    // Ensure added to scene
    if (!scene.children.includes(this.group)) {
      scene.add(this.group);
    }
  }

  /**
   * Remove from scene
   */
  hide(scene) {
    if (scene.children.includes(this.group)) {
      scene.remove(this.group);
    }
  }
}
