/**
 * CanvasRenderer — Renders skeleton overlay on video, CSI heatmap,
 * embedding space visualization, and fusion confidence bars.
 *
 * Face:  Dense triangulated wireframe from FACEMESH_TESSELATION + all 468 dots
 * Body:  Kinematic color-coded skeleton (orange→green→blue top-to-bottom)
 * Hands: Full 21-joint finger/palm skeleton
 */

import { SKELETON_CONNECTIONS } from './pose-decoder.js';

// ── Hand bone connections (21 landmarks) ─────────────────────────
const HAND_BONES = [
  [0,1],[1,2],[2,3],[3,4],           // Thumb
  [0,5],[5,6],[6,7],[7,8],           // Index
  [5,9],[9,10],[10,11],[11,12],      // Middle
  [9,13],[13,14],[14,15],[15,16],    // Ring
  [13,17],[17,18],[18,19],[19,20],   // Pinky
  [0,17]                             // Palm base
];

// ── Fallback face contour paths (when FACEMESH_CONTOURS is absent) ──
const FACE_CONTOUR_PATHS = [
  // Face oval
  [10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,152,148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109,10],
  // Left eye
  [33,7,163,144,145,153,154,155,133,173,157,158,159,160,161,246,33],
  // Right eye
  [263,249,390,373,374,380,381,382,362,398,384,385,386,387,388,466,263],
  // Left eyebrow
  [70,63,105,66,107,55,65,52,53,46],
  // Right eyebrow
  [300,293,334,296,336,285,295,282,283,276],
  // Outer lips
  [61,146,91,181,84,17,314,405,321,375,291,409,270,269,267,0,37,39,40,185,61],
  // Inner lips
  [78,95,88,178,87,14,317,402,318,324,308,415,310,311,312,13,82,81,80,191,78],
  // Nose bridge
  [168,6,197,195,5,4],
  // Nose bottom
  [48,115,220,45,4,275,440,344,278],
  // Left cheek
  [116,123,147,187,207,206,205,36,142,126],
  // Right cheek
  [345,352,376,411,427,426,425,266,371,355],
  // Forehead horizontal
  [71,68,104,69,108,151,337,299,333,298,301],
  // Mid-nose wings
  [129,49,131,134,51,5,281,363,360,279,278],
];

export class CanvasRenderer {
  constructor() {
    this.colors = {
      joint:      '#00d878',
      jointGlow:  'rgba(0, 216, 120, 0.4)',
      limb:       '#3eff8a',
      limbGlow:   'rgba(62, 255, 138, 0.15)',
      csiJoint:   '#ffb020',
      csiLimb:    '#ffc850',
      fused:      '#00e5ff',
      confidence: 'rgba(255,255,255,0.3)',
      videoEmb:   '#00e5ff',
      csiEmb:     '#ffb020',
      fusedEmb:   '#00d878',
    };

    // Cached face mesh edges (nearest-neighbor fallback)
    this._cachedFaceMeshEdges = null;
    this._faceMeshCacheCounter = 0;
  }

  // ══════════════════════════════════════════════════════════════
  // Draw skeleton overlay on the video canvas
  // ══════════════════════════════════════════════════════════════
  drawSkeleton(ctx, keypoints, width, height, opts = {}) {
    const minConf = opts.minConfidence || 0.3;
    const hasFaceMesh = opts.faceLandmarks && opts.faceLandmarks.length > 100;
    const hasLeftHand = opts.leftHandLandmarks && opts.leftHandLandmarks.length > 10;
    const hasRightHand = opts.rightHandLandmarks && opts.rightHandLandmarks.length > 10;

    ctx.clearRect(0, 0, width, height);

    // ─────────────────────────────────────────────
    //  1. FACE MESH — Dense Triangulated Wireframe
    // ─────────────────────────────────────────────
    if (hasFaceMesh) {
      this._drawFaceMesh(ctx, opts.faceLandmarks, width, height);
    }

    // ─────────────────────────────────────────────
    //  2. HAND SKELETONS — Full Finger Bones
    // ─────────────────────────────────────────────
    if (hasLeftHand)  this._drawHand(ctx, opts.leftHandLandmarks, width, height);
    if (hasRightHand) this._drawHand(ctx, opts.rightHandLandmarks, width, height);

    if (!keypoints || keypoints.length === 0) return;

    // ─────────────────────────────────────────────
    //  3. BODY — Kinematic Color-Coded Skeleton
    // ─────────────────────────────────────────────
    this._drawBodySkeleton(ctx, keypoints, width, height, {
      minConf, hasFaceMesh, hasLeftHand, hasRightHand,
      color: opts.color || 'green',
      label: opts.label,
      faceLandmarks: opts.faceLandmarks,
    });
  }

  // ══════════════════════════════════════════════════════════════
  //  FACE MESH RENDERER
  // ══════════════════════════════════════════════════════════════
  _drawFaceMesh(ctx, lm, w, h) {
    const n = lm.length;

    // Helper: get iterable size (works for both Set and Array)
    const getSize = (col) => col ? (col.size !== undefined ? col.size : col.length) || 0 : 0;

    // ── A. Dense Tessellation ─────────────────────────
    const tess = window.FACEMESH_TESSELATION;
    if (tess && getSize(tess) > 100) {
      // MediaPipe's own triangulation (≈2800 edges) — may be a Set or Array
      ctx.strokeStyle = 'rgba(0, 229, 255, 0.35)';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      for (const c of tess) {
        const si = (c.start !== undefined) ? c.start : c[0];
        const ei = (c.end !== undefined) ? c.end : c[1];
        if (si < n && ei < n && lm[si] && lm[ei]) {
          ctx.moveTo(lm[si].x * w, lm[si].y * h);
          ctx.lineTo(lm[ei].x * w, lm[ei].y * h);
        }
      }
      ctx.stroke();
    } else {
      // Fallback: nearest-neighbor dense mesh
      this._drawFallbackMesh(ctx, lm, w, h);
    }

    // ── B. Contours (eyes, brows, lips, oval) ────────
    const contours = window.FACEMESH_CONTOURS;
    if (contours && getSize(contours) > 0) {
      ctx.strokeStyle = 'rgba(0, 229, 255, 0.65)';
      ctx.lineWidth = 1.0;
      ctx.beginPath();
      for (const c of contours) {
        const si = (c.start !== undefined) ? c.start : c[0];
        const ei = (c.end !== undefined) ? c.end : c[1];
        if (si < n && ei < n && lm[si] && lm[ei]) {
          ctx.moveTo(lm[si].x * w, lm[si].y * h);
          ctx.lineTo(lm[ei].x * w, lm[ei].y * h);
        }
      }
      ctx.stroke();
    } else {
      // Fallback contour paths
      ctx.strokeStyle = 'rgba(0, 229, 255, 0.65)';
      ctx.lineWidth = 1.0;
      for (const path of FACE_CONTOUR_PATHS) {
        ctx.beginPath();
        let first = true;
        for (const idx of path) {
          if (idx < n && lm[idx]) {
            if (first) { ctx.moveTo(lm[idx].x * w, lm[idx].y * h); first = false; }
            else ctx.lineTo(lm[idx].x * w, lm[idx].y * h);
          }
        }
        ctx.stroke();
      }
    }

    // ── C. Iris rings ────────────────────────────────
    if (n > 476) {
      ctx.strokeStyle = 'rgba(0, 229, 255, 0.7)';
      ctx.lineWidth = 1.2;
      for (const iris of [[468,469,470,471,468],[473,474,475,476,473]]) {
        ctx.beginPath();
        let first = true;
        for (const idx of iris) {
          if (idx < n && lm[idx]) {
            if (first) { ctx.moveTo(lm[idx].x * w, lm[idx].y * h); first = false; }
            else ctx.lineTo(lm[idx].x * w, lm[idx].y * h);
          }
        }
        ctx.stroke();
      }
    }

    // ── D. ALL face landmark dots ────────────────────
    ctx.fillStyle = 'rgba(0, 229, 255, 0.65)';
    for (let i = 0; i < n; i++) {
      if (!lm[i]) continue;
      ctx.beginPath();
      ctx.arc(lm[i].x * w, lm[i].y * h, 1.0, 0, Math.PI * 2);
      ctx.fill();
    }

    // ── E. Key anchor dots (larger, brighter) ───────
    const anchors = [4,6,1,168,197,195,5,33,263,0,17,152,10,338];
    ctx.fillStyle = '#00e5ff';
    for (const idx of anchors) {
      if (idx < n && lm[idx]) {
        ctx.beginPath();
        ctx.arc(lm[idx].x * w, lm[idx].y * h, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  // ── Fallback: build dense mesh by nearest-neighbor edges ──
  _drawFallbackMesh(ctx, lm, w, h) {
    const n = lm.length;

    // Recompute edge cache every ~150 frames
    this._faceMeshCacheCounter++;
    if (!this._cachedFaceMeshEdges || this._faceMeshCacheCounter > 150) {
      this._faceMeshCacheCounter = 0;
      this._buildFaceMeshEdges(lm);
    }

    if (this._cachedFaceMeshEdges && this._cachedFaceMeshEdges.length > 0) {
      ctx.strokeStyle = 'rgba(0, 229, 255, 0.35)';
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      for (const [si, ei] of this._cachedFaceMeshEdges) {
        if (si < n && ei < n && lm[si] && lm[ei]) {
          ctx.moveTo(lm[si].x * w, lm[si].y * h);
          ctx.lineTo(lm[ei].x * w, lm[ei].y * h);
        }
      }
      ctx.stroke();
    }
  }

  // ── Build edges by connecting nearby face landmarks ──
  _buildFaceMeshEdges(landmarks) {
    const n = landmarks.length;
    if (n < 100) return;

    // Estimate face bounding box for adaptive threshold
    let minX = 1, maxX = 0, minY = 1, maxY = 0;
    for (let i = 0; i < n; i++) {
      if (!landmarks[i]) continue;
      minX = Math.min(minX, landmarks[i].x);
      maxX = Math.max(maxX, landmarks[i].x);
      minY = Math.min(minY, landmarks[i].y);
      maxY = Math.max(maxY, landmarks[i].y);
    }
    const faceSize = Math.max(maxX - minX, maxY - minY) || 0.3;
    const threshold = faceSize * 0.038;
    const threshSq = threshold * threshold;

    const edges = [];
    for (let i = 0; i < n; i++) {
      if (!landmarks[i]) continue;
      for (let j = i + 1; j < n; j++) {
        if (!landmarks[j]) continue;
        const dx = landmarks[i].x - landmarks[j].x;
        const dy = landmarks[i].y - landmarks[j].y;
        if (dx * dx + dy * dy < threshSq) {
          edges.push([i, j]);
        }
      }
    }

    this._cachedFaceMeshEdges = edges;
  }

  // ══════════════════════════════════════════════════════════════
  //  HAND SKELETON RENDERER
  // ══════════════════════════════════════════════════════════════
  _drawHand(ctx, handLm, w, h) {
    if (!handLm || handLm.length < 21) return;

    // Use window.HAND_CONNECTIONS if available, otherwise hardcoded
    const connections = window.HAND_CONNECTIONS || HAND_BONES;

    // ── Bone lines ──
    ctx.strokeStyle = 'rgba(255, 110, 240, 0.7)';
    ctx.lineWidth = 1.8;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const conn of connections) {
      const a = (conn.start !== undefined) ? conn.start : conn[0];
      const b = (conn.end !== undefined) ? conn.end : conn[1];
      if (a < handLm.length && b < handLm.length && handLm[a] && handLm[b]) {
        ctx.moveTo(handLm[a].x * w, handLm[a].y * h);
        ctx.lineTo(handLm[b].x * w, handLm[b].y * h);
      }
    }
    ctx.stroke();

    // ── Joint dots ──
    for (let i = 0; i < 21; i++) {
      const pt = handLm[i];
      if (!pt) continue;
      const px = pt.x * w, py = pt.y * h;
      // Glow
      ctx.beginPath();
      ctx.arc(px, py, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 110, 240, 0.25)';
      ctx.fill();
      // Center dot
      ctx.beginPath();
      ctx.arc(px, py, 1.5, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  BODY SKELETON RENDERER — Kinematic Color-Coded
  // ══════════════════════════════════════════════════════════════
  _drawBodySkeleton(ctx, keypoints, w, h, opts) {
    const { minConf, hasFaceMesh, hasLeftHand, hasRightHand, color, label, faceLandmarks } = opts;
    const isCSI = color === 'amber';

    // ── Joint color by body region (kinematic gradient) ──
    const getJointColor = (idx) => {
      if (isCSI) return '#ffb020';
      if (idx <= 4) return '#ff6040';   // Head — warm red
      if (idx <= 6) return '#ff8c00';   // Shoulders — orange
      if (idx <= 8) return '#ff8c00';   // Elbows — orange
      if (idx <= 10) return '#ffaa00';  // Wrists — yellow-orange
      if (idx <= 12) return '#44cc66';  // Hips — green
      if (idx <= 14) return '#44cc66';  // Knees — green
      if (idx <= 16) return '#4488ff';  // Ankles — blue
      if (idx <= 22) return '#ff6ef0';  // Fingers — magenta
      if (idx <= 24) return '#4488ff';  // Toes — blue
      return '#ffffff';                 // Neck — white
    };

    ctx.lineCap = 'round';

    // ── 3a. Draw limb connection lines ──
    for (const [i, j] of SKELETON_CONNECTIONS) {
      // Skip face connections when face mesh is active
      if (hasFaceMesh && (i <= 4 || j <= 4)) continue;

      // Skip finger connections when detailed hand mesh active
      if ((i >= 17 && i <= 19 || j >= 17 && j <= 19) && hasLeftHand) continue;
      if ((i >= 20 && i <= 22 || j >= 20 && j <= 22) && hasRightHand) continue;

      const kpA = keypoints[i], kpB = keypoints[j];
      if (!kpA || !kpB || kpA.confidence < minConf || kpB.confidence < minConf) continue;

      const ax = kpA.x * w, ay = kpA.y * h;
      const bx = kpB.x * w, by = kpB.y * h;
      const avgConf = (kpA.confidence + kpB.confidence) / 2;

      // Subtle glow behind
      ctx.strokeStyle = 'rgba(180, 200, 220, 0.12)';
      ctx.lineWidth = 7;
      ctx.globalAlpha = avgConf;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();

      // Main connection (light gray / silver like kinematic reference)
      ctx.strokeStyle = isCSI ? 'rgba(255, 200, 80, 0.6)' : 'rgba(180, 195, 210, 0.65)';
      ctx.lineWidth = 2.2;
      ctx.globalAlpha = avgConf;
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
    }

    // ── 3b. Chin-to-Neck kinematic link ──
    if (hasFaceMesh && keypoints[25] && faceLandmarks && faceLandmarks[152]) {
      const nk = keypoints[25], chin = faceLandmarks[152];
      if (nk && nk.confidence >= minConf) {
        const nx = nk.x * w, ny = nk.y * h;
        const cx = chin.x * w, cy = chin.y * h;
        // Glow
        ctx.strokeStyle = 'rgba(180, 200, 220, 0.12)';
        ctx.lineWidth = 7;
        ctx.globalAlpha = nk.confidence;
        ctx.beginPath(); ctx.moveTo(nx, ny); ctx.lineTo(cx, cy); ctx.stroke();
        // Line
        ctx.strokeStyle = 'rgba(180, 195, 210, 0.65)';
        ctx.lineWidth = 2.2;
        ctx.globalAlpha = nk.confidence;
        ctx.beginPath(); ctx.moveTo(nx, ny); ctx.lineTo(cx, cy); ctx.stroke();
      }
    }

    // ── 3c. Draw joints (color-coded filled circles) ──
    ctx.globalAlpha = 1;
    for (let idx = 0; idx < keypoints.length; idx++) {
      // Skip face joints when face mesh active
      if (hasFaceMesh && idx <= 4) continue;

      // Skip finger joints when detailed hand active
      const isFinger = idx >= 17 && idx <= 22;
      if (isFinger) {
        if (idx <= 19 && hasLeftHand) continue;
        if (idx >= 20 && hasRightHand) continue;
      }

      const kp = keypoints[idx];
      if (!kp || kp.confidence < minConf) continue;

      const x = kp.x * w, y = kp.y * h;
      const jColor = getJointColor(idx);
      const isToe = idx >= 23 && idx <= 24;
      const r = isFinger ? 3 : isToe ? 3.5 : 6;

      // Outer glow
      ctx.beginPath();
      ctx.arc(x, y, r + 3, 0, Math.PI * 2);
      ctx.fillStyle = jColor;
      ctx.globalAlpha = kp.confidence * 0.2;
      ctx.fill();

      // Filled joint circle
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = jColor;
      ctx.globalAlpha = kp.confidence * 0.85;
      ctx.fill();

      // Thin white outline ring
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1;
      ctx.globalAlpha = kp.confidence * 0.6;
      ctx.stroke();

      // White center highlight
      if (!isFinger && !isToe) {
        ctx.beginPath();
        ctx.arc(x, y, r * 0.32, 0, Math.PI * 2);
        ctx.fillStyle = '#ffffff';
        ctx.globalAlpha = kp.confidence * 0.85;
        ctx.fill();
      }
    }

    ctx.globalAlpha = 1;

    // ── Label ──
    if (label) {
      const visCount = keypoints.filter(kp => kp && kp.confidence >= minConf).length;
      ctx.font = '11px "JetBrains Mono", monospace';
      ctx.fillStyle = '#00e5ff';
      ctx.globalAlpha = 0.8;
      ctx.fillText(`${label} · ${visCount} joints`, 8, h - 8);
      ctx.globalAlpha = 1;
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  CSI HEATMAP
  // ══════════════════════════════════════════════════════════════
  drawCsiHeatmap(ctx, heatmap, canvasW, canvasH) {
    ctx.clearRect(0, 0, canvasW, canvasH);

    if (!heatmap || !heatmap.data || heatmap.height < 2) {
      ctx.fillStyle = '#0a0e18';
      ctx.fillRect(0, 0, canvasW, canvasH);
      ctx.font = '11px "JetBrains Mono", monospace';
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.fillText('Waiting for CSI data...', 8, canvasH / 2);
      return;
    }

    const { data, width: dw, height: dh } = heatmap;
    const cellW = canvasW / dw;
    const cellH = canvasH / dh;

    for (let y = 0; y < dh; y++) {
      for (let x = 0; x < dw; x++) {
        const val = Math.min(1, Math.max(0, data[y * dw + x]));
        ctx.fillStyle = this._heatmapColor(val);
        ctx.fillRect(x * cellW, y * cellH, cellW + 0.5, cellH + 0.5);
      }
    }

    // Axis labels
    ctx.font = '9px "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.fillText('Subcarrier →', 4, canvasH - 4);
    ctx.save();
    ctx.translate(canvasW - 4, canvasH - 4);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('Time ↑', 0, 0);
    ctx.restore();
  }

  // ══════════════════════════════════════════════════════════════
  //  EMBEDDING SPACE
  // ══════════════════════════════════════════════════════════════
  drawEmbeddingSpace(ctx, points, w, h) {
    ctx.fillStyle = '#050810';
    ctx.fillRect(0, 0, w, h);

    // Grid
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 4; i++) {
      const x = (i / 4) * w;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
      const y = (i / 4) * h;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }

    // Axes
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(w / 2, 0); ctx.lineTo(w / 2, h); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();

    // Auto-scale: find max extent across all point sets
    let maxExtent = 0.01;
    for (const pts of [points.video, points.csi, points.fused]) {
      if (!pts) continue;
      for (const p of pts) {
        if (!p) continue;
        maxExtent = Math.max(maxExtent, Math.abs(p[0]), Math.abs(p[1]));
      }
    }
    const scale = 0.42 / maxExtent; // Fill ~84% of half-width

    const drawPoints = (pts, color, size) => {
      if (!pts || pts.length === 0) return;
      const len = pts.length;

      // Draw trail line connecting recent points
      if (len >= 2) {
        ctx.beginPath();
        let started = false;
        for (let i = 0; i < len; i++) {
          const p = pts[i];
          if (!p) continue;
          const px = w / 2 + p[0] * scale * w;
          const py = h / 2 + p[1] * scale * h;
          if (px < -10 || px > w + 10 || py < -10 || py > h + 10) continue;
          if (!started) { ctx.moveTo(px, py); started = true; }
          else ctx.lineTo(px, py);
        }
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.2;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // Draw dots with glow on newest
      for (let i = 0; i < len; i++) {
        const p = pts[i];
        if (!p) continue;
        const age = 1 - (i / len) * 0.7;
        const px = w / 2 + p[0] * scale * w;
        const py = h / 2 + p[1] * scale * h;

        if (px < -10 || px > w + 10 || py < -10 || py > h + 10) continue;

        // Glow on newest point
        if (i === len - 1) {
          ctx.beginPath();
          ctx.arc(px, py, size + 4, 0, Math.PI * 2);
          ctx.fillStyle = color;
          ctx.globalAlpha = 0.3;
          ctx.fill();
        }

        ctx.beginPath();
        ctx.arc(px, py, i === len - 1 ? size + 1 : size, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.globalAlpha = age * 0.8;
        ctx.fill();
      }
    };

    drawPoints(points.video, this.colors.videoEmb, 3);
    drawPoints(points.csi, this.colors.csiEmb, 3);
    drawPoints(points.fused, this.colors.fusedEmb, 4);
    ctx.globalAlpha = 1;

    // Legend
    ctx.font = '9px "JetBrains Mono", monospace';
    const legends = [
      { color: this.colors.videoEmb, label: 'Video' },
      { color: this.colors.csiEmb, label: 'CSI' },
      { color: this.colors.fusedEmb, label: 'Fused' },
    ];
    legends.forEach((l, i) => {
      const ly = 12 + i * 14;
      ctx.fillStyle = l.color;
      ctx.beginPath();
      ctx.arc(10, ly - 3, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.fillText(l.label, 18, ly);
    });
  }

  _heatmapColor(val) {
    // Dark blue → cyan → green → yellow → red
    if (val < 0.25) {
      const t = val / 0.25;
      return `rgb(${Math.floor(t * 20)}, ${Math.floor(20 + t * 60)}, ${Math.floor(60 + t * 100)})`;
    } else if (val < 0.5) {
      const t = (val - 0.25) / 0.25;
      return `rgb(${Math.floor(20 + t * 20)}, ${Math.floor(80 + t * 100)}, ${Math.floor(160 - t * 60)})`;
    } else if (val < 0.75) {
      const t = (val - 0.5) / 0.25;
      return `rgb(${Math.floor(40 + t * 180)}, ${Math.floor(180 + t * 75)}, ${Math.floor(100 - t * 80)})`;
    } else {
      const t = (val - 0.75) / 0.25;
      return `rgb(${Math.floor(220 + t * 35)}, ${Math.floor(255 - t * 120)}, ${Math.floor(20 - t * 20)})`;
    }
  }
}
