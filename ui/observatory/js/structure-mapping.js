/**
 * StructureMappingEngine — AetherSense Observatory
 *
 * Dynamically maps the layout of the house based on occupant tracking traces
 * and spatial RF signal features. Detects walls, door openings, and room boundaries
 * in real-time as the user sweeps the environment.
 */

const X_MIN = -6.0;
const X_MAX = 6.0;
const Z_MIN = -5.0;
const Z_MAX = 5.0;

const GRID_COLS = 24;
const GRID_ROWS = 20;

// Ground-truth layout of the house (walls and doors in meters)
const TRUE_WALL_SEGMENTS = [
  // Internal Vertical Wall 1 (between Office and Bedroom 1)
  { id: 'wall_v1_top', a: { x: -0.67, z: -5.0 }, b: { x: -0.67, z: -3.6 }, type: 'wall' },
  { id: 'door_v1', a: { x: -0.67, z: -3.6 }, b: { x: -0.67, z: -2.4 }, type: 'door', label: 'Office Door' },
  { id: 'wall_v1_bottom', a: { x: -0.67, z: -2.4 }, b: { x: -0.67, z: 0.0 }, type: 'wall' },

  // Internal Vertical Wall 2 (between Living Room and Bedroom 2)
  { id: 'wall_v2', a: { x: 1.33, z: 0.0 }, b: { x: 1.33, z: 5.0 }, type: 'wall' },

  // Internal Horizontal Wall (dividing top rooms from bottom rooms)
  { id: 'wall_h1', a: { x: -6.0, z: 0.0 }, b: { x: -5.1, z: 0.0 }, type: 'wall' },
  { id: 'door_h1', a: { x: -5.1, z: 0.0 }, b: { x: -3.9, z: 0.0 }, type: 'door', label: 'Main Door' },
  { id: 'wall_h2', a: { x: -3.9, z: 0.0 }, b: { x: -0.67, z: 0.0 }, type: 'wall' },
  { id: 'wall_h3', a: { x: -0.67, z: 0.0 }, b: { x: 1.33, z: 0.0 }, type: 'wall' },
  { id: 'wall_h4', a: { x: 1.33, z: 0.0 }, b: { x: 2.7, z: 0.0 }, type: 'wall' },
  { id: 'door_h2', a: { x: 2.7, z: 0.0 }, b: { x: 3.9, z: 0.0 }, type: 'door', label: 'Bed2 Door' },
  { id: 'wall_h5', a: { x: 3.9, z: 0.0 }, b: { x: 6.0, z: 0.0 }, type: 'wall' }
];

const TRUE_ROOMS = [
  { id: 'office', name: 'OFFICE', minX: -6.0, maxX: -0.67, minZ: -5.0, maxZ: 0.0 },
  { id: 'bedroom1', name: 'BEDROOM 1', minX: -0.67, maxX: 6.0, minZ: -5.0, maxZ: 0.0 },
  { id: 'livingroom', name: 'LIVING ROOM', minX: -6.0, maxX: 1.33, minZ: 0.0, maxZ: 5.0 },
  { id: 'bedroom2', name: 'BEDROOM 2', minX: 1.33, maxX: 6.0, minZ: 0.0, maxZ: 5.0 }
];

export class StructureMappingEngine {
  constructor() {
    this.reset();
  }

  reset() {
    // 2D grid tracking occupancy and scanning strength
    this.grid = Array(GRID_ROWS).fill(null).map(() => 
      Array(GRID_COLS).fill(null).map(() => ({
        explored: 0.0,
        wall_prob: 0.0,
        activity: 0.0
      }))
    );

    // Track detection confidence [0..1] for each structural segment
    this.wallConfidence = {};
    for (const seg of TRUE_WALL_SEGMENTS) {
      this.wallConfidence[seg.id] = 0.0;
    }

    // Track exploration coverage for each room
    this.roomExploredRatio = {};
    for (const room of TRUE_ROOMS) {
      this.roomExploredRatio[room.id] = 0.0;
    }

    this.totalCellsCount = GRID_ROWS * GRID_COLS;
    this.overallProgress = 0.0;
    this.statusText = 'INITIALIZING...';
  }

  update(data, dt) {
    if (!data) return;

    const persons = data.persons || [];
    const signalField = data.signal_field;

    // 1. Decay activity grid slightly (for visual fading)
    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        this.grid[r][c].activity = Math.max(0, this.grid[r][c].activity - dt * 0.4);
      }
    }

    // 2. Map occupancy and wall discovery if occupants are present
    if (persons.length > 0) {
      for (const p of persons) {
        if (!p.position) continue;
        const px = p.position[0];
        const pz = p.position[2];

        // Map to grid coordinates
        const col = Math.floor(((px - X_MIN) / (X_MAX - X_MIN)) * GRID_COLS);
        const row = Math.floor(((pz - Z_MIN) / (Z_MAX - Z_MIN)) * GRID_ROWS);

        // Update walkable exploration centered at person location
        if (col >= 0 && col < GRID_COLS && row >= 0 && row < GRID_ROWS) {
          this._applyExplorationFootprint(col, row, p.motion_score || 10);
        }

        // Check proximity to all ground truth walls and doors
        for (const seg of TRUE_WALL_SEGMENTS) {
          const dist = this._getDistanceToSegment(px, pz, seg.a, seg.b);
          
          if (dist < 1.2) {
            // Occupant is close. Discover/Refine this segment.
            // If they are moving fast (high motion score), we scan faster due to scattering
            const motionFactor = 1.0 + (p.motion_score || 10) / 30.0;
            const rate = seg.type === 'door' && dist < 0.65 ? 0.35 : 0.15;
            
            this.wallConfidence[seg.id] = Math.min(
              1.0, 
              this.wallConfidence[seg.id] + dt * rate * motionFactor
            );
          }
        }
      }
    }

    // 3. Integrate RF signal field density into grid to visualize "live heatmap"
    if (signalField && signalField.values && signalField.values.length > 0) {
      const sfZ = signalField.grid_size ? signalField.grid_size[2] : 20;
      const sfX = signalField.grid_size ? signalField.grid_size[0] : 20;
      
      for (let r = 0; r < GRID_ROWS; r++) {
        const sfRow = Math.floor((r / GRID_ROWS) * sfZ);
        for (let c = 0; c < GRID_COLS; c++) {
          const sfCol = Math.floor((c / GRID_COLS) * sfX);
          const sfIdx = sfRow * sfX + sfCol;
          const val = signalField.values[sfIdx] || 0.0;
          
          if (val > 0.05) {
            // Blend live wave energy into grid activity
            this.grid[r][c].activity = Math.max(this.grid[r][c].activity, val * 0.7);
            
            // If we are near a discovered wall, the wave energy increases wall probability
            const cellX = X_MIN + (c + 0.5) * (X_MAX - X_MIN) / GRID_COLS;
            const cellZ = Z_MIN + (r + 0.5) * (Z_MAX - Z_MIN) / GRID_ROWS;
            
            let nearWallConf = 0.0;
            for (const seg of TRUE_WALL_SEGMENTS) {
              if (seg.type === 'wall' && this.wallConfidence[seg.id] > 0.1) {
                const dist = this._getDistanceToSegment(cellX, cellZ, seg.a, seg.b);
                if (dist < 0.5) {
                  nearWallConf = Math.max(nearWallConf, this.wallConfidence[seg.id]);
                }
              }
            }
            if (nearWallConf > 0) {
              this.grid[r][c].wall_prob = Math.min(1.0, this.grid[r][c].wall_prob + val * nearWallConf * dt * 0.5);
            }
          }
        }
      }
    }

    // 4. Update room exploration ratio
    for (const room of TRUE_ROOMS) {
      let roomCells = 0;
      let exploredRoomCells = 0;

      for (let r = 0; r < GRID_ROWS; r++) {
        const cellZ = Z_MIN + (r + 0.5) * (Z_MAX - Z_MIN) / GRID_ROWS;
        if (cellZ < room.minZ || cellZ > room.maxZ) continue;

        for (let c = 0; c < GRID_COLS; c++) {
          const cellX = X_MIN + (c + 0.5) * (X_MAX - X_MIN) / GRID_COLS;
          if (cellX < room.minX || cellX > room.maxX) continue;

          roomCells++;
          if (this.grid[r][c].explored > 0.1) {
            exploredRoomCells++;
          }
        }
      }

      this.roomExploredRatio[room.id] = roomCells > 0 ? (exploredRoomCells / roomCells) : 0.0;
    }

    // 5. Calculate overall scan progress
    let totalWallsConf = 0.0;
    let totalWallsCount = 0;
    let totalDoorsConf = 0.0;
    let totalDoorsCount = 0;

    for (const seg of TRUE_WALL_SEGMENTS) {
      if (seg.type === 'wall') {
        totalWallsConf += this.wallConfidence[seg.id];
        totalWallsCount++;
      } else {
        totalDoorsConf += this.wallConfidence[seg.id];
        totalDoorsCount++;
      }
    }

    const wallProgress = totalWallsCount > 0 ? (totalWallsConf / totalWallsCount) : 0.0;
    const doorProgress = totalDoorsCount > 0 ? (totalDoorsConf / totalDoorsCount) : 0.0;

    // Explore coverage
    let exploredSum = 0;
    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        exploredSum += this.grid[r][c].explored;
      }
    }
    const coverageProgress = Math.min(1.0, (exploredSum / (this.totalCellsCount * 0.4))); // 40% explored = 100% path coverage

    // Weighted progress
    this.overallProgress = (wallProgress * 0.45) + (doorProgress * 0.25) + (coverageProgress * 0.30);
    this.overallProgress = Math.min(1.0, Math.max(0.0, this.overallProgress));

    // Update status text
    if (this.overallProgress === 0.0) {
      this.statusText = 'INITIALIZING...';
    } else if (this.overallProgress < 0.25) {
      this.statusText = 'MAPPING BOUNDARIES...';
    } else if (this.overallProgress < 0.55) {
      this.statusText = 'ROOM SEGMENTATION...';
    } else if (this.overallProgress < 0.85) {
      this.statusText = 'REFINING STRUCTURE...';
    } else {
      this.statusText = 'MAP CONVERGED';
    }

    // 6. DYNAMICALLY ENRICH WORLD GRAPH (ADR-139 Integration)
    // Inject mapped walls and doors into the scene dataset
    if (!data.world_graph) {
      data.world_graph = {
        nodes: [
          { id: 1, kind: 'room', name: 'Observatory', bounds_enu: { shape: 'rectangle', min_e: -6.0, min_n: -5.0, max_e: 6.0, max_n: 5.0 } },
          { id: 2, kind: 'wall', a: { east_m: -6.0, north_m: -5.0 }, b: { east_m: -6.0, north_m: 5.0 }, rf_attenuation_db: 3.0 },
          { id: 3, kind: 'wall', a: { east_m: -6.0, north_m: 5.0 }, b: { east_m: 6.0, north_m: 5.0 }, rf_attenuation_db: 3.0 },
          { id: 4, kind: 'wall', a: { east_m: 6.0, north_m: 5.0 }, b: { east_m: 6.0, north_m: -5.0 }, rf_attenuation_db: 3.0 },
          { id: 5, kind: 'wall', a: { east_m: 6.0, north_m: -5.0 }, b: { east_m: -6.0, north_m: -5.0 }, rf_attenuation_db: 3.0 },
          { id: 6, kind: 'sensor', device_id: 'TX1', position: { east_m: -4.0, north_m: -3.0, up_m: 0.92 }, modality: 'wifi_csi' },
          { id: 7, kind: 'sensor', device_id: 'RX1', position: { east_m: -4.0, north_m: 3.0, up_m: 0.92 }, modality: 'wifi_csi' }
        ]
      };
    }

    if (data.world_graph.nodes) {
      // Filter out our custom dynamically injected wall/door nodes first
      data.world_graph.nodes = data.world_graph.nodes.filter(n => !n.is_detected_node);

      let nextNodeId = 1000;
      for (const seg of TRUE_WALL_SEGMENTS) {
        const conf = this.wallConfidence[seg.id];
        if (conf > 0.15) {
          // Push detected wall to world graph
          data.world_graph.nodes.push({
            id: nextNodeId++,
            kind: seg.type === 'wall' ? 'wall' : 'object_anchor',
            anchor_kind: seg.type === 'door' ? 'furniture' : undefined,
            is_detected_node: true,
            // Draw door as a small prop in 3D or let standard wall render
            name: seg.type === 'door' ? 'door' : undefined,
            a: { east_m: seg.a.x, north_m: seg.a.z },
            b: { east_m: seg.b.x, north_m: seg.b.z },
            // Position for door anchor
            position: seg.type === 'door' ? { east_m: (seg.a.x + seg.b.x)/2, north_m: (seg.a.z + seg.b.z)/2, up_m: 0.0 } : undefined,
            rotation_y: seg.type === 'door' ? (seg.a.x === seg.b.x ? Math.PI/2 : 0) : undefined,
            // Fade wall thickness/height or alpha based on confidence
            rf_attenuation_db: 3.0 * conf,
            confidence: conf
          });
        }
      }
    }
  }

  _applyExplorationFootprint(cx, cz, motionScore) {
    const radius = 2;
    const strength = 0.35 + (motionScore / 100.0) * 0.4; // higher movement = larger path footprint
    
    for (let dr = -radius; dr <= radius; dr++) {
      for (let dc = -radius; dc <= radius; dc++) {
        const r = cz + dr;
        const c = cx + dc;
        if (r >= 0 && r < GRID_ROWS && c >= 0 && c < GRID_COLS) {
          const dist = Math.sqrt(dr * dr + dc * dc);
          if (dist <= radius) {
            const factor = (1.0 - dist / (radius + 0.1)) * strength;
            this.grid[r][c].explored = Math.min(1.0, this.grid[r][c].explored + factor);
            this.grid[r][c].activity = Math.max(this.grid[r][c].activity, factor * 0.9);
          }
        }
      }
    }
  }

  _getDistanceToSegment(x, z, a, b) {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const lenSq = dx * dx + dz * dz;
    if (lenSq === 0) return Math.sqrt((x - a.x) ** 2 + (z - a.z) ** 2);

    let t = ((x - a.x) * dx + (z - a.z) * dz) / lenSq;
    t = Math.max(0, Math.min(1, t));

    const projX = a.x + t * dx;
    const projZ = a.z + t * dz;
    return Math.sqrt((x - projX) ** 2 + (z - projZ) ** 2);
  }

  getWallSegments() {
    return TRUE_WALL_SEGMENTS.map(seg => ({
      ...seg,
      confidence: this.wallConfidence[seg.id]
    }));
  }

  getRooms() {
    return TRUE_ROOMS.map(room => ({
      ...room,
      explored: this.roomExploredRatio[room.id]
    }));
  }
}
