/**
 * CanvasRenderer — Renders skeleton overlay on video, CSI heatmap,
 * embedding space visualization, and fusion confidence bars.
 *
 * Face:  Dense triangulated wireframe from FACEMESH_TESSELATION + all 468 dots
 * Body:  Kinematic color-coded skeleton (orange→green→blue top-to-bottom)
 * Hands: Full 21-joint finger/palm skeleton
 */

import { SKELETON_CONNECTIONS } from './pose-decoder.js';
import { GestureRecognizer } from './gesture-recognizer.js?v=15';

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
    this.poseHistory = [];
    this.gestureRecognizer = new GestureRecognizer();
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

    // Initialize textOverlays array for this frame
    this.textOverlays = [];

    // Manage pose history for motion trails (deep copy to avoid mutation issues)
    if (!this.poseHistory) this.poseHistory = [];
    if (keypoints && keypoints.length > 0) {
      this.poseHistory.push(JSON.parse(JSON.stringify(keypoints)));
      if (this.poseHistory.length > 8) {
        this.poseHistory.shift();
      }
    }

    // ── Render Ghost Trails ──
    const historyLen = this.poseHistory.length;
    for (let i = 0; i < historyLen - 1; i++) {
      const ghostKeypoints = this.poseHistory[i];
      const age = historyLen - 1 - i;
      const opacity = Math.max(0.02, 0.40 - age * 0.05);
      ctx.save();
      ctx.globalAlpha = opacity;
      this._drawGhostSkeleton(ctx, ghostKeypoints, width, height, minConf);
      ctx.restore();
    }

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

    // ─────────────────────────────────────────────
    //  4. JOINT ANGLES & POSE RECOGNITION HUD
    // ─────────────────────────────────────────────
    this._drawJointAngles(ctx, keypoints, width, height, minConf);

    // Render accumulated text overlays & Pose Classification card (unmirrored)
    ctx.save();
    ctx.translate(width, 0);
    ctx.scale(-1, 1);

    // Render Pose Classification HUD Card (Bottom-Right, which is cardX = 12 in flipped coords)
    const poseRes = this._classifyPose(keypoints, minConf);
    const pCardW = 160;
    const pCardH = 55;
    const pCardX = 12;
    const pCardY = height - pCardH - 12;

    ctx.shadowBlur = 8;
    ctx.shadowColor = 'rgba(0, 216, 120, 0.3)';

    ctx.fillStyle = 'rgba(5, 12, 24, 0.85)';
    ctx.strokeStyle = 'rgba(0, 216, 120, 0.35)';
    ctx.lineWidth = 1.0;
    this._roundRect(ctx, pCardX, pCardY, pCardW, pCardH, 6);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.stroke();

    ctx.font = 'bold 8px "JetBrains Mono", monospace';
    ctx.fillStyle = '#00d878';
    ctx.fillText('POSE RECOGNITION', pCardX + 10, pCardY + 16);

    ctx.font = 'bold 13px "Inter", sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(poseRes.label, pCardX + 10, pCardY + 34);

    ctx.font = '9px "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(232, 236, 224, 0.6)';
    ctx.fillText(`Conf: ${Math.round(poseRes.confidence * 100)}%`, pCardX + 10, pCardY + 46);

    // Draw all accumulated text overlays
    for (const item of this.textOverlays) {
      ctx.font = item.font || '9px "JetBrains Mono", monospace';
      ctx.fillStyle = item.color || '#00e5ff';
      ctx.textAlign = item.align || 'left';
      ctx.fillText(item.text, item.x, item.y);
    }

    ctx.restore();
  }

  // ══════════════════════════════════════════════════════════════
  //  FACE MESH RENDERER
  // ══════════════════════════════════════════════════════════════
  _drawFaceMesh(ctx, lm, w, h) {
    const n = lm.length;
    if (n === 0) return;

    // Helper: get iterable size (works for both Set and Array)
    const getSize = (col) => col ? (col.size !== undefined ? col.size : col.length) || 0 : 0;

    // ── A. Compute minZ/maxZ for Depth Coloring ───────
    let minZ = Infinity, maxZ = -Infinity;
    for (let i = 0; i < n; i++) {
      if (lm[i]) {
        const z = lm[i].z || 0;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
      }
    }
    if (minZ === Infinity || minZ === maxZ) {
      minZ = -0.1;
      maxZ = 0.1;
    }

    const binCount = 8;
    const tessBins = Array.from({ length: binCount }, () => []);

    // ── B. Group FACEMESH_TESSELLATION by Z depth ──────
    const tess = window.FACEMESH_TESSELLATION || window.FACEMESH_TESSELATION;
    if (tess && getSize(tess) > 100) {
      for (const c of tess) {
        const si = (c.start !== undefined) ? c.start : c[0];
        const ei = (c.end !== undefined) ? c.end : c[1];
        if (si < n && ei < n && lm[si] && lm[ei]) {
          const avgZ = ((lm[si].z || 0) + (lm[ei].z || 0)) / 2;
          let pct = (avgZ - minZ) / (maxZ - minZ || 1);
          pct = Math.max(0, Math.min(1, pct));
          const binIndex = Math.min(binCount - 1, Math.floor(pct * binCount));
          tessBins[binIndex].push([lm[si], lm[ei]]);
        }
      }

      // Draw each bin in a single path (gold-orange depth colors)
      for (let b = 0; b < binCount; b++) {
        const edges = tessBins[b];
        if (edges.length === 0) continue;
        const pct = b / (binCount - 1 || 1);
        const g = Math.floor(215 - pct * (215 - 120));
        const bl = Math.floor(80 - pct * 80);
        ctx.strokeStyle = `rgba(255, ${g}, ${bl}, 0.38)`;
        ctx.lineWidth = 0.55;
        ctx.beginPath();
        for (const [p1, p2] of edges) {
          ctx.moveTo(p1.x * w, p1.y * h);
          ctx.lineTo(p2.x * w, p2.y * h);
        }
        ctx.stroke();
      }
    } else {
      // Fallback: nearest-neighbor dense mesh (gold/yellow)
      this._drawFallbackMesh(ctx, lm, w, h);
    }

    // ── C. Contours by depth ──────────────────────────
    const contours = window.FACEMESH_CONTOURS;
    const contourBins = Array.from({ length: binCount }, () => []);

    if (contours && getSize(contours) > 0) {
      for (const c of contours) {
        const si = (c.start !== undefined) ? c.start : c[0];
        const ei = (c.end !== undefined) ? c.end : c[1];
        if (si < n && ei < n && lm[si] && lm[ei]) {
          const avgZ = ((lm[si].z || 0) + (lm[ei].z || 0)) / 2;
          let pct = (avgZ - minZ) / (maxZ - minZ || 1);
          pct = Math.max(0, Math.min(1, pct));
          const binIndex = Math.min(binCount - 1, Math.floor(pct * binCount));
          contourBins[binIndex].push([lm[si], lm[ei]]);
        }
      }
      for (let b = 0; b < binCount; b++) {
        const edges = contourBins[b];
        if (edges.length === 0) continue;
        const pct = b / (binCount - 1 || 1);
        const g = Math.floor(215 - pct * (215 - 120));
        const bl = Math.floor(80 - pct * 80);
        ctx.strokeStyle = `rgba(255, ${g}, ${bl}, 0.70)`;
        ctx.lineWidth = 1.0;
        ctx.beginPath();
        for (const [p1, p2] of edges) {
          ctx.moveTo(p1.x * w, p1.y * h);
          ctx.lineTo(p2.x * w, p2.y * h);
        }
        ctx.stroke();
      }
    } else {
      // Fallback contour paths (gold/yellow)
      ctx.strokeStyle = 'rgba(255, 213, 79, 0.65)';
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

    // ── D. Iris rings (gold) ────────────────────────────────
    if (n > 476) {
      ctx.strokeStyle = 'rgba(255, 193, 7, 0.85)';
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

    // ── E. ALL face landmark dots (colored by depth, gold-orange) ──
    for (let i = 0; i < n; i++) {
      if (!lm[i]) continue;
      const z = lm[i].z || 0;
      let pct = (z - minZ) / (maxZ - minZ || 1);
      pct = Math.max(0, Math.min(1, pct));
      const g = Math.floor(215 - pct * (215 - 120));
      const bl = Math.floor(80 - pct * 80);
      ctx.fillStyle = `rgba(255, ${g}, ${bl}, 0.65)`;
      ctx.beginPath();
      ctx.arc(lm[i].x * w, lm[i].y * h, 1.0, 0, Math.PI * 2);
      ctx.fill();
    }

    // ── F. Key anchor dots (larger, bright gold) ───────
    const anchors = [4,6,1,168,197,195,5,33,263,0,17,152,10,338];
    ctx.fillStyle = '#ffd54f';
    for (const idx of anchors) {
      if (idx < n && lm[idx]) {
        ctx.beginPath();
        ctx.arc(lm[idx].x * w, lm[idx].y * h, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // ── G. Head Pose Estimation (Yaw, Pitch, Roll) ────
    const pNose = lm[1] || lm[4];
    const pChin = lm[152];
    const pForehead = lm[10];
    const pLeftEar = lm[234];
    const pRightEar = lm[454];

    let yaw = 0, pitch = 0, roll = 0;
    let headPoseValid = false;

    if (pNose && pChin && pForehead && pLeftEar && pRightEar) {
      // 1. Roll: Angle of the left-to-right ear line in the screen plane
      const dx = pRightEar.x - pLeftEar.x;
      const dy = pRightEar.y - pLeftEar.y;
      roll = Math.atan2(dy, dx) * (180 / Math.PI);

      // 2. Yaw and Pitch using 3D normal vector
      const vx = {
        x: pRightEar.x - pLeftEar.x,
        y: pRightEar.y - pLeftEar.y,
        z: (pRightEar.z || 0) - (pLeftEar.z || 0)
      };
      const lenX = Math.sqrt(vx.x*vx.x + vx.y*vx.y + vx.z*vx.z);
      vx.x /= lenX; vx.y /= lenX; vx.z /= lenX;

      const vy = {
        x: pForehead.x - pChin.x,
        y: pForehead.y - pChin.y,
        z: (pForehead.z || 0) - (pChin.z || 0)
      };
      const lenY = Math.sqrt(vy.x*vy.x + vy.y*vy.y + vy.z*vy.z);
      vy.x /= lenY; vy.y /= lenY; vy.z /= lenY;

      const vz = {
        x: vx.y * vy.z - vx.z * vy.y,
        y: vx.z * vy.x - vx.x * vy.z,
        z: vx.x * vy.y - vx.y * vy.x
      };
      const lenZ = Math.sqrt(vz.x*vz.x + vz.y*vz.y + vz.z*vz.z);
      vz.x /= lenZ; vz.y /= lenZ; vz.z /= lenZ;

      yaw = Math.atan2(vz.x, -vz.z) * (180 / Math.PI);
      pitch = Math.atan2(vz.y, -vz.z) * (180 / Math.PI);
      headPoseValid = true;

      // Draw 3D Nose direction pointer
      ctx.strokeStyle = '#00ffff';
      ctx.lineWidth = 2.0;
      ctx.beginPath();
      ctx.moveTo(pNose.x * w, pNose.y * h);
      ctx.lineTo((pNose.x - vz.x * 0.15) * w, (pNose.y + vz.y * 0.15) * h);
      ctx.stroke();

      // Endpoint circle
      ctx.fillStyle = '#00ffff';
      ctx.beginPath();
      ctx.arc((pNose.x - vz.x * 0.15) * w, (pNose.y + vz.y * 0.15) * h, 3.0, 0, Math.PI * 2);
      ctx.fill();
    }

    // ── H. Expression Detection ───────────────────────
    let expression = '😐 Neutral';
    if (lm[13] && lm[14] && lm[78] && lm[308] && lm[234] && lm[454] && lm[159] && lm[145] && lm[386] && lm[374] && lm[70] && lm[63] && lm[33] && lm[133]) {
      const dFaceWidth = Math.sqrt((lm[454].x - lm[234].x)**2 + (lm[454].y - lm[234].y)**2);
      const dMouthWidth = Math.sqrt((lm[308].x - lm[78].x)**2 + (lm[308].y - lm[78].y)**2);
      const mouthRatio = dMouthWidth / dFaceWidth;

      const mouthCenterY = (lm[13].y + lm[14].y) / 2;
      const cornerY = (lm[78].y + lm[308].y) / 2;
      const smileElevation = mouthCenterY - cornerY;
      const smileScore = (smileElevation / dFaceWidth) * 10 + (mouthRatio - 0.32) * 5;

      const dLeftEye = Math.sqrt((lm[159].x - lm[145].x)**2 + (lm[159].y - lm[145].y)**2);
      const dRightEye = Math.sqrt((lm[386].x - lm[374].x)**2 + (lm[386].y - lm[374].y)**2);
      const earLeft = dLeftEye / dFaceWidth;
      const earRight = dRightEye / dFaceWidth;
      const avgEAR = (earLeft + earRight) / 2;
      const eyesClosed = avgEAR < 0.022;

      const browLeftY = (lm[70].y + lm[63].y) / 2;
      const eyeLeftY = (lm[33].y + lm[133].y) / 2;
      const distBrowLeft = eyeLeftY - browLeftY;
      const browRightY = (lm[300].y + lm[293].y) / 2;
      const eyeRightY = (lm[263].y + lm[362].y) / 2;
      const distBrowRight = eyeRightY - browRightY;
      const avgBrowDist = (distBrowLeft + distBrowRight) / 2;
      const browRatio = avgBrowDist / dFaceWidth;
      const browsRaised = browRatio > 0.22;

      const dMouthVert = Math.sqrt((lm[13].x - lm[14].x)**2 + (lm[13].y - lm[14].y)**2);
      const mouthVertRatio = dMouthVert / dFaceWidth;

      if (eyesClosed) {
        expression = '😴 Eyes Closed';
      } else if (browsRaised && mouthVertRatio > 0.06) {
        expression = '😮 Surprise';
      } else if (smileScore > 0.45) {
        expression = '😊 Smile';
      }
    }

    // ── I. Draw Unmirrored Face Telemetry Overlay ──────
    ctx.save();
    ctx.translate(w, 0);
    ctx.scale(-1, 1);

    const cardW = 190;
    const cardH = 85;
    const cardX = 12;
    const cardY = 12;

    ctx.shadowBlur = 12;
    ctx.shadowColor = 'rgba(0, 229, 255, 0.4)';

    ctx.fillStyle = 'rgba(5, 12, 24, 0.85)';
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.4)';
    ctx.lineWidth = 1.0;
    this._roundRect(ctx, cardX, cardY, cardW, cardH, 6);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.stroke();

    ctx.font = 'bold 9px "JetBrains Mono", monospace';
    ctx.fillStyle = '#00e5ff';
    ctx.fillText('FACE TELEMETRY', cardX + 10, cardY + 18);

    ctx.font = '20px "Inter", -apple-system, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(expression, cardX + 10, cardY + 45);

    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(232, 236, 224, 0.7)';
    const yawStr = headPoseValid ? `${Math.round(yaw)}°` : '--';
    const pitchStr = headPoseValid ? `${Math.round(pitch)}°` : '--';
    const rollStr = headPoseValid ? `${Math.round(roll)}°` : '--';
    ctx.fillText(`Yaw:${yawStr} | Pitch:${pitchStr} | Roll:${rollStr}`, cardX + 10, cardY + 68);

    ctx.restore();
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
      ctx.strokeStyle = 'rgba(255, 213, 79, 0.38)';
      ctx.lineWidth = 0.55;
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
    const threshold = faceSize * 0.045; // Increased threshold for more robust fallback mesh connection
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

    // ── Bone lines (gold/yellow) ──
    ctx.strokeStyle = 'rgba(255, 213, 79, 0.75)';
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

    // Classify gesture and fingers
    const res = this.gestureRecognizer.classify(handLm);

    // ── Joint dots ──
    const fingerTips = [4, 8, 12, 16, 20];
    for (let i = 0; i < 21; i++) {
      const pt = handLm[i];
      if (!pt) continue;
      const px = pt.x * w, py = pt.y * h;
      
      // Determine if joint is a tip
      const tipIndex = fingerTips.indexOf(i);
      const isTip = tipIndex !== -1;

      // Glow color: gold/orange by default, green/red for tip status
      let glowColor = 'rgba(255, 193, 7, 0.28)';
      let centerColor = '#ffffff';

      if (isTip) {
        glowColor = res.fingers[tipIndex] ? 'rgba(0, 216, 120, 0.45)' : 'rgba(255, 48, 64, 0.45)';
        centerColor = res.fingers[tipIndex] ? '#00d878' : '#ff3040';
      }

      ctx.beginPath();
      ctx.arc(px, py, isTip ? 4.5 : 3.5, 0, Math.PI * 2);
      ctx.fillStyle = glowColor;
      ctx.fill();

      ctx.beginPath();
      ctx.arc(px, py, isTip ? 2.0 : 1.5, 0, Math.PI * 2);
      ctx.fillStyle = centerColor;
      ctx.fill();
    }

    // Queue unmirrored wrist label
    const wrist = handLm[0];
    if (wrist) {
      const wx = wrist.x * w;
      const wy = wrist.y * h;
      this.textOverlays.push({
        text: `${res.emoji} ${res.gesture}`,
        x: wx,
        y: wy - 14,
        color: '#ffffff',
        font: 'bold 11px "Inter", sans-serif',
        align: 'center'
      });
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  BODY SKELETON RENDERER — Kinematic Color-Coded
  // ══════════════════════════════════════════════════════════════
  _drawBodySkeleton(ctx, keypoints, w, h, opts) {
    const { minConf, hasFaceMesh, hasLeftHand, hasRightHand, color, label, faceLandmarks, renderMode = 'kinematic' } = opts;
    const isCSI = color === 'amber';

    if (renderMode === 'planar') {
      this._drawPlanarBody(ctx, keypoints, w, h, minConf, hasFaceMesh, isCSI);
      return;
    } else if (renderMode === 'volumetric') {
      this._drawVolumetricBody(ctx, keypoints, w, h, minConf, hasFaceMesh, isCSI);
      return;
    }

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
      ctx.save();
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
      ctx.font = '11px "JetBrains Mono", monospace';
      ctx.fillStyle = '#00e5ff';
      ctx.globalAlpha = 0.8;
      ctx.fillText(`${label} · ${visCount} joints`, 8, h - 8);
      ctx.restore();
    }
  }

  // ══════════════════════════════════════════════════════════════
  //  CSI HEATMAP
  // ══════════════════════════════════════════════════════════════
  drawCsiHeatmap(ctx, heatmap, canvasW, canvasH) {
    ctx.clearRect(0, 0, canvasW, canvasH);

    if (!heatmap || !heatmap.data || heatmap.height < 2) {
      ctx.fillStyle = '#050810';
      ctx.fillRect(0, 0, canvasW, canvasH);
      ctx.font = '11px "JetBrains Mono", monospace';
      ctx.fillStyle = 'rgba(255,255,255,0.3)';
      ctx.fillText('Waiting for CSI data...', 8, canvasH / 2);
      return;
    }

    ctx.fillStyle = '#050810';
    ctx.fillRect(0, 0, canvasW, canvasH);

    const { data, width: dw, height: dh } = heatmap;

    const skewX = 0.65;
    const skewY = 0.35;
    const scaleX = (canvasW * 0.65) / dw;
    const scaleY = (canvasH * 0.45) / dh;
    const ampScale = 25; // height multiplier for peaks

    const project = (x, y, val) => {
      const rx = x * scaleX + y * skewX + canvasW * 0.08;
      const ry = canvasH * 0.40 + y * scaleY - val * ampScale;
      return { x: rx, y: ry };
    };

    // Draw rows back to front (y = 0 is oldest, back; y = dh - 1 is newest, front)
    for (let y = 0; y < dh; y++) {
      ctx.beginPath();
      const startPt = project(0, y, 0);
      ctx.moveTo(startPt.x, canvasH);
      
      const pts = [];
      for (let x = 0; x < dw; x++) {
        const val = data[y * dw + x] || 0;
        const pt = project(x, y, val);
        pts.push({ pt, val });
        ctx.lineTo(pt.x, pt.y);
      }
      
      const endPt = project(dw - 1, y, 0);
      ctx.lineTo(endPt.x, canvasH);
      ctx.closePath();

      // Mask block background
      ctx.fillStyle = '#050810';
      ctx.fill();

      // Draw the multicolored line segments
      for (let x = 0; x < dw - 1; x++) {
        const p1 = pts[x];
        const p2 = pts[x+1];
        const avgVal = (p1.val + p2.val) / 2;
        ctx.strokeStyle = this._heatmapColor(avgVal);
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(p1.pt.x, p1.pt.y);
        ctx.lineTo(p2.pt.x, p2.pt.y);
        ctx.stroke();
      }
    }

    ctx.font = '9px "JetBrains Mono", monospace';
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.fillText('Subcarrier Index →', 8, canvasH - 6);
    ctx.fillText('Time (Waterfall) ↗', canvasW - 120, 16);
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

  // Rounded rectangle helper
  _roundRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }

  // ── Ghost Skeleton Renderer (Trails) ──
  _drawGhostSkeleton(ctx, keypoints, w, h, minConf) {
    ctx.strokeStyle = 'rgba(180, 195, 210, 0.25)';
    ctx.lineWidth = 1.2;
    ctx.lineCap = 'round';
    for (const [i, j] of SKELETON_CONNECTIONS) {
      // Skip face/hand details for clean trails
      if (i <= 4 || j <= 4) continue;
      const kpA = keypoints[i], kpB = keypoints[j];
      if (!kpA || !kpB || kpA.confidence < minConf || kpB.confidence < minConf) continue;
      ctx.beginPath();
      ctx.moveTo(kpA.x * w, kpA.y * h);
      ctx.lineTo(kpB.x * w, kpB.y * h);
      ctx.stroke();
    }
  }

  // ── Joint Angles ──
  _drawJointAngles(ctx, keypoints, w, h, minConf) {
    const checkConf = (...indices) => indices.every(idx => keypoints[idx] && keypoints[idx].confidence >= minConf);
    
    const jointsToMeasure = [
      { name: 'L_Elbow', vertex: 7, p1: 5, p2: 9 },
      { name: 'R_Elbow', vertex: 8, p1: 6, p2: 10 },
      { name: 'L_Knee', vertex: 13, p1: 11, p2: 15 },
      { name: 'R_Knee', vertex: 14, p1: 12, p2: 16 },
      { name: 'L_Shoulder', vertex: 5, p1: 25, p2: 7 },
      { name: 'R_Shoulder', vertex: 6, p1: 25, p2: 8 }
    ];
    
    for (const j of jointsToMeasure) {
      if (checkConf(j.p1, j.vertex, j.p2)) {
        const kp1 = keypoints[j.p1];
        const kpV = keypoints[j.vertex];
        const kp2 = keypoints[j.p2];
        const angle = this._computeAngle(kp1, kpV, kp2);
        
        // Draw arc around joint
        this._drawJointArc(ctx, kp1, kpV, kp2, w, h);
        
        // Store text overlay coordinates (drawn unmirrored in flipped context)
        const bx = kpV.x * w;
        const by = kpV.y * h;
        this.textOverlays.push({
          text: `${Math.round(angle)}°`,
          x: bx + 10,
          y: by - 4,
          color: '#00e5ff',
          font: 'bold 9px "JetBrains Mono", monospace'
        });
      }
    }
  }

  _drawJointArc(ctx, p1, pV, p2, w, h) {
    const vx = pV.x * w;
    const vy = pV.y * h;
    const startAngle = Math.atan2(p1.y - pV.y, p1.x - pV.x);
    const endAngle = Math.atan2(p2.y - pV.y, p2.x - pV.x);
    
    ctx.strokeStyle = 'rgba(0, 229, 255, 0.45)';
    ctx.lineWidth = 1.0;
    ctx.beginPath();
    ctx.arc(vx, vy, 12, startAngle, endAngle);
    ctx.stroke();
  }

  _computeAngle(pA, pB, pC) {
    if (!pA || !pB || !pC) return 0;
    const vax = pA.x - pB.x;
    const vay = pA.y - pB.y;
    const vcx = pC.x - pB.x;
    const vcy = pC.y - pB.y;
    const dot = vax * vcx + vay * vcy;
    const lenA = Math.sqrt(vax * vax + vay * vay);
    const lenC = Math.sqrt(vcx * vcx + vcy * vcy);
    if (lenA === 0 || lenC === 0) return 0;
    const cosTheta = Math.max(-1, Math.min(1, dot / (lenA * lenC)));
    return Math.acos(cosTheta) * (180 / Math.PI);
  }

  // ── Pose Heuristic Classifier ──
  _classifyPose(keypoints, minConf) {
    const checkConf = (...indices) => indices.every(idx => keypoints[idx] && keypoints[idx].confidence >= minConf);
    if (!keypoints || keypoints.length < 17) return { label: 'Unknown', confidence: 0 };
    
    const nose = keypoints[0];
    const lSh = keypoints[5];
    const rSh = keypoints[6];
    const lEl = keypoints[7];
    const rEl = keypoints[8];
    const lWr = keypoints[9];
    const rWr = keypoints[10];
    const lHp = keypoints[11];
    const rHp = keypoints[12];
    const lKn = keypoints[13];
    const rKn = keypoints[14];
    const lAn = keypoints[15];
    const rAn = keypoints[16];
    const neck = keypoints[25];

    const lElbowAngle = checkConf(5, 7, 9) ? this._computeAngle(lSh, lEl, lWr) : 180;
    const rElbowAngle = checkConf(6, 8, 10) ? this._computeAngle(rSh, rEl, rWr) : 180;
    const lKneeAngle = checkConf(11, 13, 15) ? this._computeAngle(lHp, lKn, lAn) : 180;
    const rKneeAngle = checkConf(12, 14, 16) ? this._computeAngle(rHp, rKn, rAn) : 180;

    // 1. T-Pose: Arms horizontal, elbows straight
    if (checkConf(5, 6, 7, 8, 9, 10)) {
      const lArmHoriz = Math.abs(lSh.y - lWr.y) < 0.12 && Math.abs(lSh.y - lEl.y) < 0.08;
      const rArmHoriz = Math.abs(rSh.y - rWr.y) < 0.12 && Math.abs(rSh.y - rEl.y) < 0.08;
      if (lArmHoriz && rArmHoriz && lElbowAngle > 140 && rElbowAngle > 140) {
        return { label: 'T-Pose', confidence: 0.95 };
      }
    }

    // 2. Waving: One wrist is above shoulder, elbow is somewhat bent or moving
    if (checkConf(5, 6)) {
      const leftWaving = checkConf(7, 9) && lWr.y < lSh.y && lWr.y < nose.y;
      const rightWaving = checkConf(8, 10) && rWr.y < rSh.y && rWr.y < nose.y;
      if (leftWaving || rightWaving) {
        return { label: 'Waving', confidence: 0.88 };
      }
    }

    // 3. Arms Crossed: Wrists near opposite shoulders
    if (checkConf(5, 6, 9, 10)) {
      const lWrToRSh = Math.sqrt((lWr.x - rSh.x)**2 + (lWr.y - rSh.y)**2);
      const rWrToLSh = Math.sqrt((rWr.x - lSh.x)**2 + (rWr.y - lSh.y)**2);
      if (lWrToRSh < 0.18 && rWrToLSh < 0.18) {
        return { label: 'Arms Crossed', confidence: 0.85 };
      }
    }

    // 4. Sitting: Hip-to-Knee and Knee-to-Ankle have a bent knee angle
    if (checkConf(11, 12, 13, 14, 15, 16)) {
      const leftKneeBent = lKneeAngle < 135;
      const rightKneeBent = rKneeAngle < 135;
      const torsoUpright = Math.abs(lHp.x - lSh.x) < 0.12 && Math.abs(rHp.x - rSh.x) < 0.12;
      if (leftKneeBent && rightKneeBent && torsoUpright) {
        return { label: 'Sitting', confidence: 0.82 };
      }
    }

    // 5. Standing: Legs straight, ankles below hips
    if (checkConf(11, 12, 15, 16)) {
      const legsStraight = lKneeAngle > 150 && rKneeAngle > 150;
      const anklesBelowHips = lAn.y > lHp.y && rAn.y > rHp.y;
      if (legsStraight && anklesBelowHips) {
        return { label: 'Standing', confidence: 0.90 };
      }
    }

    if (checkConf(5, 6, 11, 12)) {
      return { label: 'Active Pose', confidence: 0.50 };
    }

    return { label: 'Calibrating...', confidence: 0.30 };
  }

  // ── Planar Skeleton Body Blocks ──
  _drawPlanarBody(ctx, keypoints, w, h, minConf, hasFaceMesh, isCSI) {
    const checkConf = (...indices) => indices.every(idx => keypoints[idx] && keypoints[idx].confidence >= minConf);

    // 1. Torso Block
    if (checkConf(5, 6, 11, 12)) {
      const pLSh = keypoints[5], pRSh = keypoints[6], pLHp = keypoints[11], pRHp = keypoints[12];
      ctx.fillStyle = isCSI ? 'rgba(255, 176, 32, 0.3)' : 'rgba(255, 213, 79, 0.35)';
      ctx.strokeStyle = isCSI ? 'rgba(255, 176, 32, 0.6)' : 'rgba(255, 213, 79, 0.6)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(pLSh.x * w, pLSh.y * h);
      ctx.lineTo(pRSh.x * w, pRSh.y * h);
      ctx.lineTo(pRHp.x * w, pRHp.y * h);
      ctx.lineTo(pLHp.x * w, pLHp.y * h);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }

    const drawPlanarSegment = (p1, p2, widthPx, colorFill, colorStroke) => {
      const ax = p1.x * w, ay = p1.y * h;
      const bx = p2.x * w, by = p2.y * h;
      const dx = bx - ax, dy = by - ay;
      const len = Math.sqrt(dx*dx + dy*dy);
      if (len === 0) return;

      const nx = -dy / len * (widthPx / 2);
      const ny = dx / len * (widthPx / 2);

      ctx.fillStyle = colorFill;
      ctx.strokeStyle = colorStroke;
      ctx.lineWidth = 1.0;
      ctx.beginPath();
      ctx.moveTo(ax + nx, ay + ny);
      ctx.lineTo(ax - nx, ay - ny);
      ctx.lineTo(bx - nx, by - ny);
      ctx.lineTo(bx + nx, by + ny);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    };

    const leftFill = isCSI ? 'rgba(255, 176, 32, 0.25)' : 'rgba(255, 213, 79, 0.3)';
    const leftStroke = isCSI ? 'rgba(255, 176, 32, 0.5)' : 'rgba(255, 213, 79, 0.6)';
    const rightFill = isCSI ? 'rgba(255, 176, 32, 0.25)' : 'rgba(255, 152, 0, 0.25)';
    const rightStroke = isCSI ? 'rgba(255, 176, 32, 0.5)' : 'rgba(255, 152, 0, 0.55)';

    // Arms
    if (checkConf(5, 7)) drawPlanarSegment(keypoints[5], keypoints[7], 14, leftFill, leftStroke);
    if (checkConf(7, 9)) drawPlanarSegment(keypoints[7], keypoints[9], 12, leftFill, leftStroke);
    if (checkConf(6, 8)) drawPlanarSegment(keypoints[6], keypoints[8], 14, rightFill, rightStroke);
    if (checkConf(8, 10)) drawPlanarSegment(keypoints[8], keypoints[10], 12, rightFill, rightStroke);

    // Legs
    if (checkConf(11, 13)) drawPlanarSegment(keypoints[11], keypoints[13], 20, leftFill, leftStroke);
    if (checkConf(13, 15)) drawPlanarSegment(keypoints[13], keypoints[15], 16, leftFill, leftStroke);
    if (checkConf(12, 14)) drawPlanarSegment(keypoints[12], keypoints[14], 20, rightFill, rightStroke);
    if (checkConf(14, 16)) drawPlanarSegment(keypoints[14], keypoints[16], 16, rightFill, rightStroke);
  }

  // ── Volumetric Skeleton Body Tubes (Gradients) ──
  _drawVolumetricBody(ctx, keypoints, w, h, minConf, hasFaceMesh, isCSI) {
    const checkConf = (...indices) => indices.every(idx => keypoints[idx] && keypoints[idx].confidence >= minConf);

    const baseColor = isCSI ? '255, 176, 32' : '255, 193, 7';

    const drawVolumetricSegment = (p1, p2, widthPx) => {
      const ax = p1.x * w, ay = p1.y * h;
      const bx = p2.x * w, by = p2.y * h;
      const dx = bx - ax, dy = by - ay;
      const len = Math.sqrt(dx*dx + dy*dy);
      if (len === 0) return;

      const nx = -dy / len;
      const ny = dx / len;

      const midX = (ax + bx) / 2;
      const midY = (ay + by) / 2;

      const grad = ctx.createLinearGradient(
        midX - nx * widthPx, midY - ny * widthPx,
        midX + nx * widthPx, midY + ny * widthPx
      );
      grad.addColorStop(0, `rgba(${baseColor}, 0)`);
      grad.addColorStop(0.2, `rgba(${baseColor}, 0.25)`);
      grad.addColorStop(0.5, `rgba(255, 255, 255, 0.85)`);
      grad.addColorStop(0.8, `rgba(${baseColor}, 0.25)`);
      grad.addColorStop(1, `rgba(${baseColor}, 0)`);

      ctx.strokeStyle = grad;
      ctx.lineWidth = widthPx * 2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
    };

    // Torso cylinders
    if (checkConf(5, 6)) drawVolumetricSegment(keypoints[5], keypoints[6], 20); // Shoulders
    if (checkConf(11, 12)) drawVolumetricSegment(keypoints[11], keypoints[12], 20); // Hips
    if (checkConf(5, 6, 11, 12)) {
      const midSh = { x: (keypoints[5].x + keypoints[6].x) / 2, y: (keypoints[5].y + keypoints[6].y) / 2 };
      const midHp = { x: (keypoints[11].x + keypoints[12].x) / 2, y: (keypoints[11].y + keypoints[12].y) / 2 };
      drawVolumetricSegment(midSh, midHp, 22); // Spine
    }

    // Arms
    if (checkConf(5, 7)) drawVolumetricSegment(keypoints[5], keypoints[7], 14);
    if (checkConf(7, 9)) drawVolumetricSegment(keypoints[7], keypoints[9], 12);
    if (checkConf(6, 8)) drawVolumetricSegment(keypoints[6], keypoints[8], 14);
    if (checkConf(8, 10)) drawVolumetricSegment(keypoints[8], keypoints[10], 12);

    // Legs
    if (checkConf(11, 13)) drawVolumetricSegment(keypoints[11], keypoints[13], 18);
    if (checkConf(13, 15)) drawVolumetricSegment(keypoints[13], keypoints[15], 16);
    if (checkConf(12, 14)) drawVolumetricSegment(keypoints[12], keypoints[14], 18);
    if (checkConf(14, 16)) drawVolumetricSegment(keypoints[14], keypoints[16], 16);
  }
}

