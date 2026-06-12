/**
 * CanvasRenderer — Renders skeleton overlay on video, CSI heatmap,
 * embedding space visualization, and fusion confidence bars.
 */

import { SKELETON_CONNECTIONS } from './pose-decoder.js';

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
  }

  /**
   * Draw skeleton overlay on the video canvas
   * @param {CanvasRenderingContext2D} ctx
   * @param {Array<{x,y,confidence}>} keypoints - Normalized [0,1] coordinates
   * @param {number} width - Canvas width
   * @param {number} height - Canvas height
   * @param {object} opts
   */
  drawSkeleton(ctx, keypoints, width, height, opts = {}) {
    const minConf = opts.minConfidence || 0.3;
    const color = opts.color || 'green';
    const jointColor = color === 'amber' ? this.colors.csiJoint : this.colors.joint;
    const limbColor = color === 'amber' ? this.colors.csiLimb : this.colors.limb;
    const glowColor = color === 'amber' ? 'rgba(255,176,32,0.4)' : this.colors.jointGlow;

    // Extended keypoint styling
    const fingerColor = '#ff6ef0';    // Cyber pink/magenta for fingers
    const fingerGlow = 'rgba(255,110,240,0.4)';
    const fingerLimb = 'rgba(255,110,240,0.5)';
    const toeColor = '#6ef0ff';       // Cyan for toes
    const neckColor = '#ffffff';       // White for neck

    ctx.clearRect(0, 0, width, height);

    // 1. Draw Face Mesh (if available)
    if (opts.faceLandmarks) {
      const lm = opts.faceLandmarks;
      
      // A. Dense Face Mesh Tessellation (subtle glowing triangles)
      const tesselation = window.FACEMESH_TESSELATION || [];
      if (tesselation.length > 0) {
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(0, 229, 255, 0.12)';
        ctx.lineWidth = 0.5;
        for (let i = 0; i < tesselation.length; i++) {
          const conn = tesselation[i];
          const startIdx = (conn.start !== undefined) ? conn.start : conn[0];
          const endIdx = (conn.end !== undefined) ? conn.end : conn[1];
          const start = lm[startIdx];
          const end = lm[endIdx];
          if (start && end) {
            ctx.moveTo(start.x * width, start.y * height);
            ctx.lineTo(end.x * width, end.y * height);
          }
        }
        ctx.stroke();
      }

      // B. Face Contours (brow, eyes, nose, lips, boundary)
      const contours = window.FACEMESH_CONTOURS || [];
      if (contours.length > 0) {
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(0, 229, 255, 0.45)';
        ctx.lineWidth = 1.0;
        for (let i = 0; i < contours.length; i++) {
          const conn = contours[i];
          const startIdx = (conn.start !== undefined) ? conn.start : conn[0];
          const endIdx = (conn.end !== undefined) ? conn.end : conn[1];
          const start = lm[startIdx];
          const end = lm[endIdx];
          if (start && end) {
            ctx.moveTo(start.x * width, start.y * height);
            ctx.lineTo(end.x * width, end.y * height);
          }
        }
        ctx.stroke();
      } else {
        // Fallback custom contours paths if FACEMESH_CONTOURS is missing
        const fallbackPaths = [
          [70, 63, 105, 66, 107], // Left eyebrow
          [336, 296, 334, 293, 300], // Right eyebrow
          [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246, 33], // Left eye
          [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466, 263], // Right eye
          [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185, 61], // Lips
          [168, 6, 197, 195, 5], // Nose bridge
          [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109, 10] // Face boundary
        ];
        
        ctx.strokeStyle = 'rgba(0, 229, 255, 0.45)';
        ctx.lineWidth = 1.0;
        for (const p of fallbackPaths) {
          ctx.beginPath();
          let first = true;
          for (const idx of p) {
            const pt = lm[idx];
            if (!pt) continue;
            if (first) {
              ctx.moveTo(pt.x * width, pt.y * height);
              first = false;
            } else {
              ctx.lineTo(pt.x * width, pt.y * height);
            }
          }
          ctx.stroke();
        }
      }
      
      // C. Major Face Anchor Nodes (glowing centers)
      const dotIndices = [4, 6, 1, 168, 197, 195, 5, 33, 263, 0, 17, 152];
      for (const idx of dotIndices) {
        const pt = lm[idx];
        if (pt) {
          const px = pt.x * width;
          const py = pt.y * height;
          ctx.beginPath();
          ctx.arc(px, py, 3.5, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(0, 229, 255, 0.35)';
          ctx.fill();

          ctx.beginPath();
          ctx.arc(px, py, 1.2, 0, Math.PI * 2);
          ctx.fillStyle = '#ffffff';
          ctx.fill();
        }
      }
    }

    // 2. Draw Hand skeletons (if available)
    const drawHand = (handLm, color, outerGlowColor) => {
      if (!handLm) return;
      const connections = window.HAND_CONNECTIONS || [
        [0, 1], [1, 2], [2, 3], [3, 4], // Thumb
        [0, 5], [5, 6], [6, 7], [7, 8], // Index
        [5, 9], [9, 10], [10, 11], [11, 12], // Middle
        [9, 13], [13, 14], [14, 15], [15, 16], // Ring
        [13, 17], [17, 18], [18, 19], [19, 20], // Pinky
        [0, 17] // Palm bottom
      ];
      
      ctx.beginPath();
      for (let i = 0; i < connections.length; i++) {
        const conn = connections[i];
        const startIdx = (conn.start !== undefined) ? conn.start : conn[0];
        const endIdx = (conn.end !== undefined) ? conn.end : conn[1];
        const start = handLm[startIdx];
        const end = handLm[endIdx];
        if (start && end) {
          ctx.moveTo(start.x * width, start.y * height);
          ctx.lineTo(end.x * width, end.y * height);
        }
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      
      // Draw joint dots with subtle cyber-pink glow
      for (let i = 0; i < 21; i++) {
        const pt = handLm[i];
        if (pt) {
          const px = pt.x * width;
          const py = pt.y * height;
          ctx.beginPath();
          ctx.arc(px, py, 3.5, 0, Math.PI * 2);
          ctx.fillStyle = outerGlowColor;
          ctx.fill();

          ctx.beginPath();
          ctx.arc(px, py, 1.2, 0, Math.PI * 2);
          ctx.fillStyle = '#ffffff';
          ctx.fill();
        }
      }
    };
    
    if (opts.leftHandLandmarks) {
      drawHand(opts.leftHandLandmarks, 'rgba(255, 110, 240, 0.75)', 'rgba(255, 110, 240, 0.35)');
    }
    if (opts.rightHandLandmarks) {
      drawHand(opts.rightHandLandmarks, 'rgba(255, 110, 240, 0.75)', 'rgba(255, 110, 240, 0.35)');
    }

    if (!keypoints || keypoints.length === 0) return;

    // 3. Draw Limbs (first, behind joints)
    ctx.lineCap = 'round';

    for (const [i, j] of SKELETON_CONNECTIONS) {
      // If face landmarks are active, hide the sparse pose face connections (0-4)
      if (opts.faceLandmarks) {
        const isFaceA = i >= 0 && i <= 4;
        const isFaceB = j >= 0 && j <= 4;
        if (isFaceA || isFaceB) continue;
      }

      // Hide simple finger lines if detailed hand mesh is present
      const isFingerLink = (i >= 17 && i <= 22) || (j >= 17 && j <= 22);
      if (isFingerLink) {
        const isLeftFinger = (i >= 17 && i <= 19) || (j >= 17 && j <= 19);
        const isRightFinger = (i >= 20 && i <= 22) || (j >= 20 && j <= 22);
        if (isLeftFinger && opts.leftHandLandmarks) continue;
        if (isRightFinger && opts.rightHandLandmarks) continue;
      }

      const kpA = keypoints[i];
      const kpB = keypoints[j];
      if (!kpA || !kpB || kpA.confidence < minConf || kpB.confidence < minConf) continue;

      const ax = kpA.x * width, ay = kpA.y * height;
      const bx = kpB.x * width, by = kpB.y * height;
      const avgConf = (kpA.confidence + kpB.confidence) / 2;
      const isToeLink = i >= 23 && i <= 24 || j >= 23 && j <= 24;

      // Glow behind
      ctx.strokeStyle = isFingerLink ? fingerLimb : this.colors.limbGlow;
      ctx.lineWidth = isFingerLink ? 4 : 8;
      ctx.globalAlpha = avgConf * (isFingerLink ? 0.3 : 0.4);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();

      // Main sharp connection line
      ctx.strokeStyle = isFingerLink ? fingerColor : isToeLink ? toeColor : limbColor;
      ctx.lineWidth = isFingerLink || isToeLink ? 1.5 : 2.5;
      ctx.globalAlpha = avgConf;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
    }

    // Kinematic Chin-to-Neck connection when Face Mesh is present
    if (opts.faceLandmarks && keypoints[25]) {
      const neckKp = keypoints[25];
      const chinLm = opts.faceLandmarks[152]; // Chin tip index
      if (neckKp && chinLm && neckKp.confidence >= minConf) {
        const nx = neckKp.x * width, ny = neckKp.y * height;
        const cx = chinLm.x * width, cy = chinLm.y * height;
        
        ctx.strokeStyle = this.colors.limbGlow;
        ctx.lineWidth = 8;
        ctx.globalAlpha = neckKp.confidence * 0.4;
        ctx.beginPath();
        ctx.moveTo(nx, ny);
        ctx.lineTo(cx, cy);
        ctx.stroke();

        ctx.strokeStyle = limbColor;
        ctx.lineWidth = 2.5;
        ctx.globalAlpha = neckKp.confidence;
        ctx.beginPath();
        ctx.moveTo(nx, ny);
        ctx.lineTo(cx, cy);
        ctx.stroke();
      }
    }

    // 4. Draw Joints
    ctx.globalAlpha = 1;
    for (let idx = 0; idx < keypoints.length; idx++) {
      // If face landmarks are active, hide the sparse pose face joints (0-4)
      if (opts.faceLandmarks && idx >= 0 && idx <= 4) continue;

      // Skip simple finger joints if detailed hand mesh is present
      const isFinger = idx >= 17 && idx <= 22;
      if (isFinger) {
        const isLeftFinger = idx >= 17 && idx <= 19;
        const isRightFinger = idx >= 20 && idx <= 22;
        if (isLeftFinger && opts.leftHandLandmarks) continue;
        if (isRightFinger && opts.rightHandLandmarks) continue;
      }

      const kp = keypoints[idx];
      if (!kp || kp.confidence < minConf) continue;

      const x = kp.x * width;
      const y = kp.y * height;
      const isToe = idx >= 23 && idx <= 24;
      const isNeck = idx === 25;
      const r = isFinger ? 2 + kp.confidence * 2 : isToe ? 2 : 3 + kp.confidence * 3;
      const jColor = isFinger ? fingerColor : isToe ? toeColor : isNeck ? neckColor : jointColor;
      const gColor = isFinger ? fingerGlow : glowColor;

      // Glow behind
      ctx.beginPath();
      ctx.arc(x, y, r + (isFinger ? 3 : 4), 0, Math.PI * 2);
      ctx.fillStyle = gColor;
      ctx.globalAlpha = kp.confidence * (isFinger ? 0.5 : 0.6);
      ctx.fill();

      // High-tech holographic target ring styling for body joints
      if (!isFinger && !isToe) {
        ctx.strokeStyle = jColor;
        ctx.globalAlpha = kp.confidence * 0.85;
        ctx.lineWidth = 1.0;
        ctx.beginPath();
        ctx.arc(x, y, r + 4, 0, Math.PI * 2);
        ctx.stroke();

        ctx.strokeStyle = jColor;
        ctx.globalAlpha = kp.confidence * 0.4;
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.arc(x, y, r + 7, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Solid joint dot
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = jColor;
      ctx.globalAlpha = kp.confidence;
      ctx.fill();

      // White center (body joints only)
      if (!isFinger && !isToe) {
        ctx.beginPath();
        ctx.arc(x, y, r * 0.45, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.globalAlpha = kp.confidence * 0.95;
        ctx.fill();
      }
    }

    ctx.globalAlpha = 1;

    // Confidence label + keypoint count
    if (opts.label) {
      const visCount = keypoints.filter(kp => kp && kp.confidence >= minConf).length;
      ctx.font = '11px "JetBrains Mono", monospace';
      ctx.fillStyle = jointColor;
      ctx.globalAlpha = 0.8;
      ctx.fillText(`${opts.label} · ${visCount} joints`, 8, height - 8);
      ctx.globalAlpha = 1;
    }
  }

  /**
   * Draw CSI amplitude heatmap
   * @param {CanvasRenderingContext2D} ctx
   * @param {{ data: Float32Array, width: number, height: number }} heatmap
   * @param {number} canvasW
   * @param {number} canvasH
   */
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

  /**
   * Draw embedding space 2D projection
   * @param {CanvasRenderingContext2D} ctx
   * @param {{ video: Array, csi: Array, fused: Array }} points
   * @param {number} w
   * @param {number} h
   */
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
