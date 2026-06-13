// Room Designer Component - AetherSense 3D Visualization
// Handles spawning furniture, custom zones, selection, and drag/rotate/scale gizmos

import { TransformControls } from 'three/addons/controls/TransformControls.js';

export class RoomDesigner {
  constructor(scene, camera, domElement, orbitControls, environment) {
    this.scene = scene;
    this.camera = camera;
    this.domElement = domElement;
    this.orbitControls = orbitControls;
    this.environment = environment;

    this.active = false;
    this.selectedObject = null;
    this.objects = [];

    // Raycasting for object selection
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();

    // Group to hold all designer-controlled objects
    this.designerGroup = new THREE.Group();
    this.designerGroup.name = 'designer-objects';
    this.scene.add(this.designerGroup);

    // Initialize Transform Controls
    this.transformControls = new TransformControls(this.camera, this.domElement);
    this.transformControls.size = 0.75;
    this.scene.add(this.transformControls);

    // Disable OrbitControls during transformation to avoid fighting
    this.transformControls.addEventListener('dragging-changed', (event) => {
      this.orbitControls.enabled = !event.value;
    });

    // Event listener when an object is transformed
    this.transformControls.addEventListener('change', () => {
      if (this.selectedObject && this.onObjectTransformed) {
        this.onObjectTransformed(this.selectedObject);
      }
    });

    // Bind event handlers
    this._onPointerDown = this._onPointerDown.bind(this);
    this._onKeyDown = this._onKeyDown.bind(this);

    // UI Callbacks
    this.onObjectSelected = null; // function(obj)
    this.onObjectTransformed = null; // function(obj)
  }

  // Activate / Deactivate Design Mode
  enable() {
    if (this.active) return;
    this.active = true;
    this.domElement.addEventListener('pointerdown', this._onPointerDown);
    window.addEventListener('keydown', this._onKeyDown);
    console.log('[Designer] Interactive Room Design mode enabled.');
  }

  disable() {
    if (!this.active) return;
    this.active = false;
    this.deselect();
    this.domElement.removeEventListener('pointerdown', this._onPointerDown);
    window.removeEventListener('keydown', this._onKeyDown);
    console.log('[Designer] Room Design mode disabled.');
  }

  // Spawn a furniture asset
  spawn(type, options = {}) {
    let mesh;
    const color = options.color || (type === 'zone' ? 0xffaa00 : 0x00aaff);

    // Styling materials
    const mainMaterial = new THREE.MeshPhongMaterial({
      color: color,
      emissive: color,
      emissiveIntensity: 0.1,
      transparent: true,
      opacity: 0.4,
      shininess: 30,
      side: THREE.DoubleSide
    });

    const wireframeMaterial = new THREE.MeshBasicMaterial({
      color: color,
      wireframe: true,
      transparent: true,
      opacity: 0.8
    });

    if (type === 'bed') {
      mesh = this._createBed(mainMaterial, wireframeMaterial);
    } else if (type === 'couch') {
      mesh = this._createCouch(mainMaterial, wireframeMaterial);
    } else if (type === 'desk') {
      mesh = this._createDesk(mainMaterial, wireframeMaterial);
    } else if (type === 'door') {
      mesh = this._createDoor(mainMaterial, wireframeMaterial);
    } else if (type === 'zone') {
      mesh = this._createZone(options.label || 'New Zone', options.radius || 1.5, color);
    } else {
      console.warn(`[Designer] Unknown object type: ${type}`);
      return;
    }

    // Assign metadata
    mesh.userData = {
      id: options.id || `${type}_${Date.now()}`,
      type: type,
      designable: true,
      label: options.label || type.charAt(0).toUpperCase() + type.slice(1),
      radius: options.radius || null,
      color: color
    };

    // Set position
    if (options.position) {
      mesh.position.set(options.position.x, options.position.y, options.position.z);
    } else {
      mesh.position.set(0, type === 'zone' ? 0.01 : 0.5, 0);
    }

    if (options.rotation) {
      mesh.rotation.set(options.rotation.x, options.rotation.y, options.rotation.z);
    }
    if (options.scale) {
      mesh.scale.set(options.scale.x, options.scale.y, options.scale.z);
    }

    this.designerGroup.add(mesh);
    this.objects.push(mesh);

    // If it's a zone, sync it with the environment
    if (type === 'zone') {
      this._syncZonesWithEnvironment();
    }

    this.select(mesh);
    return mesh;
  }

  // Select an object
  select(object) {
    if (this.selectedObject === object) return;
    this.deselect();

    this.selectedObject = object;
    this.transformControls.attach(object);

    // Highlight wireframe material or show bounding box
    object.traverse((child) => {
      if (child.material && child.material.emissive) {
        child.material.emissiveIntensity = 0.4; // Brighter highlights
      }
    });

    if (this.onObjectSelected) {
      this.onObjectSelected(object);
    }
  }

  // Deselect current object
  deselect() {
    if (this.selectedObject) {
      this.selectedObject.traverse((child) => {
        if (child.material && child.material.emissive) {
          child.material.emissiveIntensity = 0.1; // Restore normal state
        }
      });
      this.selectedObject = null;
    }
    this.transformControls.detach();
    if (this.onObjectSelected) {
      this.onObjectSelected(null);
    }
  }

  // Delete selected object
  deleteSelected() {
    if (!this.selectedObject) return;
    const obj = this.selectedObject;
    this.deselect();

    this.designerGroup.remove(obj);
    this.objects = this.objects.filter(o => o !== obj);

    // Dispose geometries and materials
    obj.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    });

    if (obj.userData.type === 'zone') {
      this._syncZonesWithEnvironment();
    }
  }

  // Change color of selected object
  setSelectedColor(hexColor) {
    if (!this.selectedObject) return;
    const color = new THREE.Color(hexColor);
    this.selectedObject.userData.color = hexColor;

    this.selectedObject.traverse((child) => {
      if (child.material) {
        child.material.color = color;
        if (child.material.emissive) {
          child.material.emissive = color;
        }
      }
    });

    if (this.selectedObject.userData.type === 'zone') {
      this._syncZonesWithEnvironment();
    }
  }

  // Change label of selected object
  setSelectedLabel(label) {
    if (!this.selectedObject) return;
    this.selectedObject.userData.label = label;

    if (this.selectedObject.userData.type === 'zone') {
      // Re-create the label sprite inside the group
      const textSprite = this.selectedObject.getObjectByName('label-sprite');
      if (textSprite) {
        this.selectedObject.remove(textSprite);
        textSprite.geometry.dispose();
        textSprite.material.map.dispose();
        textSprite.material.dispose();
      }

      const newSprite = this._createLabelSprite(label, this.selectedObject.userData.color);
      newSprite.name = 'label-sprite';
      newSprite.position.set(0, 0.15, this.selectedObject.userData.radius + 0.25);
      newSprite.scale.set(1.0, 0.25, 1);
      this.selectedObject.add(newSprite);

      this._syncZonesWithEnvironment();
    }
  }

  // Change radius of selected zone
  setSelectedZoneRadius(radius) {
    if (!this.selectedObject || this.selectedObject.userData.type !== 'zone') return;
    const oldRadius = this.selectedObject.userData.radius;
    this.selectedObject.userData.radius = radius;

    // Rescale geometries or recreate rings
    const ringMesh = this.selectedObject.getObjectByName('zone-ring');
    const fillMesh = this.selectedObject.getObjectByName('zone-fill');

    if (ringMesh) {
      ringMesh.geometry.dispose();
      ringMesh.geometry = new THREE.RingGeometry(radius * 0.96, radius, 48);
    }
    if (fillMesh) {
      fillMesh.geometry.dispose();
      fillMesh.geometry = new THREE.CircleGeometry(radius * 0.96, 48);
    }

    // Reposition label sprite
    const textSprite = this.selectedObject.getObjectByName('label-sprite');
    if (textSprite) {
      textSprite.position.set(0, 0.15, radius + 0.25);
    }

    this._syncZonesWithEnvironment();
  }

  // Export layout to JSON object
  exportJSON() {
    const config = this.objects.map(obj => ({
      id: obj.userData.id,
      type: obj.userData.type,
      label: obj.userData.label,
      radius: obj.userData.radius,
      color: obj.userData.color,
      position: { x: obj.position.x, y: obj.position.y, z: obj.position.z },
      rotation: { x: obj.rotation.x, y: obj.rotation.y, z: obj.rotation.z },
      scale: { x: obj.scale.x, y: obj.scale.y, z: obj.scale.z }
    }));
    return JSON.stringify(config, null, 2);
  }

  // Load layout from JSON object list
  loadJSON(jsonStr) {
    try {
      const config = JSON.parse(jsonStr);
      this.clearAll();

      for (const item of config) {
        this.spawn(item.type, item);
      }
      console.log(`[Designer] Loaded ${config.length} objects from config.`);
    } catch (e) {
      console.error('[Designer] Failed to parse layout JSON:', e);
    }
  }

  // Clear all designer-controlled objects
  clearAll() {
    this.deselect();
    while (this.objects.length > 0) {
      const obj = this.objects.pop();
      this.designerGroup.remove(obj);
      obj.traverse((child) => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
      });
    }
    this._syncZonesWithEnvironment();
  }

  // Private Builders for Furniture Primatives
  _createBed(mat, wireMat) {
    const group = new THREE.Group();

    // Mattress frame
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.3, 2.0), mat);
    base.position.y = 0.15;
    base.castShadow = true;
    base.receiveShadow = true;
    group.add(base);

    const baseWire = new THREE.Mesh(new THREE.BoxGeometry(1.405, 0.305, 2.005), wireMat);
    baseWire.position.y = 0.15;
    group.add(baseWire);

    // Pillows (x2)
    const pillowGeom = new THREE.BoxGeometry(0.5, 0.08, 0.35);
    const pillow1 = new THREE.Mesh(pillowGeom, mat);
    pillow1.position.set(-0.3, 0.32, -0.75);
    group.add(pillow1);

    const pillow2 = new THREE.Mesh(pillowGeom, mat);
    pillow2.position.set(0.3, 0.32, -0.75);
    group.add(pillow2);

    // Headboard
    const headboard = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.9, 0.1), mat);
    headboard.position.set(0, 0.45, -1.0);
    group.add(headboard);

    const headboardWire = new THREE.Mesh(new THREE.BoxGeometry(1.405, 0.905, 0.105), wireMat);
    headboardWire.position.set(0, 0.45, -1.0);
    group.add(headboardWire);

    return group;
  }

  _createCouch(mat, wireMat) {
    const group = new THREE.Group();

    // Cushion seating base
    const seat = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.3, 0.8), mat);
    seat.position.y = 0.15;
    seat.castShadow = true;
    seat.receiveShadow = true;
    group.add(seat);

    const seatWire = new THREE.Mesh(new THREE.BoxGeometry(1.805, 0.305, 0.805), wireMat);
    seatWire.position.y = 0.15;
    group.add(seatWire);

    // Backrest
    const back = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.7, 0.2), mat);
    back.position.set(0, 0.5, -0.35);
    group.add(back);

    const backWire = new THREE.Mesh(new THREE.BoxGeometry(1.805, 0.705, 0.205), wireMat);
    backWire.position.set(0, 0.5, -0.35);
    group.add(backWire);

    // Left Armrest
    const armL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.5, 0.8), mat);
    armL.position.set(-0.9, 0.25, 0);
    group.add(armL);

    // Right Armrest
    const armR = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.5, 0.8), mat);
    armR.position.set(0.9, 0.25, 0);
    group.add(armR);

    return group;
  }

  _createDesk(mat, wireMat) {
    const group = new THREE.Group();

    // Tabletop
    const top = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.05, 0.8), mat);
    top.position.y = 0.75;
    top.castShadow = true;
    group.add(top);

    const topWire = new THREE.Mesh(new THREE.BoxGeometry(1.505, 0.055, 0.805), wireMat);
    topWire.position.y = 0.75;
    group.add(topWire);

    // Table Legs (x4 cylinders)
    const legGeom = new THREE.CylinderGeometry(0.02, 0.02, 0.75);
    const legPositions = [
      [-0.7, 0.375, -0.35],
      [0.7, 0.375, -0.35],
      [-0.7, 0.375, 0.35],
      [0.7, 0.375, 0.35]
    ];

    for (const pos of legPositions) {
      const leg = new THREE.Mesh(legGeom, mat);
      leg.position.set(...pos);
      group.add(leg);
    }

    return group;
  }

  _createDoor(mat, wireMat) {
    const group = new THREE.Group();

    // Door Frame
    const frameGeo = new THREE.BoxGeometry(1.0, 2.0, 0.05);
    const frame = new THREE.Mesh(frameGeo, mat);
    frame.position.y = 1.0;
    group.add(frame);

    const frameWire = new THREE.Mesh(new THREE.BoxGeometry(1.01, 2.01, 0.06), wireMat);
    frameWire.position.y = 1.0;
    group.add(frameWire);

    // Styled open panel (representing rotation swing direction)
    const swingGeo = new THREE.RingGeometry(0.85, 0.9, 32, 1, 0, Math.PI / 2);
    const swing = new THREE.Mesh(swingGeo, wireMat);
    swing.rotation.x = -Math.PI / 2;
    swing.position.set(-0.5, 0.01, 0);
    group.add(swing);

    return group;
  }

  _createZone(label, radius, color) {
    const group = new THREE.Group();

    // Zone outer boundary ring
    const ringGeo = new THREE.RingGeometry(radius * 0.96, radius, 48);
    const ringMat = new THREE.MeshBasicMaterial({
      color: color,
      transparent: true,
      opacity: 0.2,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.name = 'zone-ring';
    ring.rotation.x = -Math.PI / 2;
    group.add(ring);

    // Zone floor fill
    const fillGeo = new THREE.CircleGeometry(radius * 0.96, 48);
    const fillMat = new THREE.MeshBasicMaterial({
      color: color,
      transparent: true,
      opacity: 0.05,
      side: THREE.DoubleSide,
      depthWrite: false
    });
    const fill = new THREE.Mesh(fillGeo, fillMat);
    fill.name = 'zone-fill';
    fill.rotation.x = -Math.PI / 2;
    group.add(fill);

    // Vertical holographic cylinder column
    const cylinderGeo = new THREE.CylinderGeometry(radius, radius, 2.0, 24, 1, true);
    const cylinderMat = new THREE.MeshBasicMaterial({
      color: color,
      transparent: true,
      opacity: 0.02,
      side: THREE.DoubleSide,
      wireframe: true,
      depthWrite: false
    });
    const cylinder = new THREE.Mesh(cylinderGeo, cylinderMat);
    cylinder.position.y = 1.0;
    group.add(cylinder);

    // Label Sprite
    const labelSprite = this._createLabelSprite(label, color);
    labelSprite.name = 'label-sprite';
    labelSprite.position.set(0, 0.15, radius + 0.25);
    labelSprite.scale.set(1.0, 0.25, 1);
    group.add(labelSprite);

    return group;
  }

  _createLabelSprite(text, color) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 128;
    canvas.height = 32;

    ctx.font = 'bold 13px monospace';
    ctx.fillStyle = '#' + new THREE.Color(color).getHexString();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, canvas.width / 2, canvas.height / 2);

    const texture = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthWrite: false
    });
    return new THREE.Sprite(mat);
  }

  // Synchronize dynamic zones with environment zone logic
  _syncZonesWithEnvironment() {
    if (!this.environment) return;

    // Filter spawned zones
    const spawnedZones = this.objects
      .filter(o => o.userData.type === 'zone')
      .map(o => ({
        id: o.userData.id,
        center: [o.position.x, o.position.y, o.position.z],
        radius: o.userData.radius,
        color: o.userData.color,
        label: o.userData.label
      }));

    // Update the environment's internal zones structure
    // If user has defined custom zones, clear standard ones and feed custom ones
    this.environment.zones = spawnedZones;
    this.environment._rebuildCustomZones();
  }

  // Pointer interaction
  _onPointerDown(event) {
    // Only raycast if click was on the webgl viewport and not on TransformControls gizmo
    if (this.transformControls.dragging) return;

    // Get normalize mouse coordinates
    const rect = this.domElement.getBoundingClientRect();
    this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    this.raycaster.setFromCamera(this.mouse, this.camera);

    // Test intersections with spawned objects group (recursive)
    const intersects = this.raycaster.intersectObjects(this.designerGroup.children, true);

    if (intersects.length > 0) {
      // Find top-level object in our designer Group
      let obj = intersects[0].object;
      while (obj.parent && obj.parent !== this.designerGroup) {
        obj = obj.parent;
      }
      this.select(obj);
    } else {
      // Clicked empty space - deselect unless we clicked a gizmo axis
      // (TransformControls intercepts clicks, but double check)
      const gizmoIntersects = this.raycaster.intersectObjects(this.transformControls.children, true);
      if (gizmoIntersects.length === 0) {
        this.deselect();
      }
    }
  }

  // Key shortcuts
  _onKeyDown(event) {
    if (!this.active) return;
    
    // Ignore keyboard shortcuts if user is typing inside an input field
    if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'SELECT')) {
      return;
    }

    switch (event.key.toLowerCase()) {
      case 'w':
        this.transformControls.setMode('translate');
        break;
      case 'e':
        this.transformControls.setMode('rotate');
        break;
      case 'r':
        this.transformControls.setMode('scale');
        break;
      case 'delete':
      case 'backspace':
        this.deleteSelected();
        break;
      case 'escape':
        this.deselect();
        break;
    }
  }
}
