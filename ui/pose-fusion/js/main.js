/**
 * AetherSense — Dual-Modal Pose Estimation Demo
 *
 * Main orchestration: video capture → CNN embedding → CSI processing → fusion → rendering
 */

import { VideoCapture } from './video-capture.js?v=13';
import { CsiSimulator } from './csi-simulator.js?v=13';
import { CnnEmbedder } from './cnn-embedder.js?v=13';
import { FusionEngine } from './fusion-engine.js?v=13';
import { PoseDecoder, KEYPOINT_NAMES } from './pose-decoder.js?v=13';
import { CanvasRenderer } from './canvas-renderer.js?v=16';
import { Skeleton3D } from './skeleton-3d.js?v=16';
import { ActivityClassifier } from './activity-classifier.js?v=15';
import { SessionRecorder } from './session-recorder.js?v=15';

// === MediaPipe State ===
let mpHolistic = null;
let latestMpResults = null;
let isMpProcessing = false;

function initMediaPipe() {
  if (typeof Holistic === 'undefined') {
    console.warn('[PoseFusion] MediaPipe Holistic library not loaded yet, retrying in 500ms...');
    setTimeout(initMediaPipe, 500);
    return;
  }
  
  try {
    mpHolistic = new Holistic({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/holistic/${file}`
    });
    
    mpHolistic.setOptions({
      modelComplexity: 1,
      smoothLandmarks: true,
      refineFaceLandmarks: true,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5
    });
    
    mpHolistic.onResults((results) => {
      latestMpResults = results;
    });
    
    console.log('[PoseFusion] MediaPipe Holistic initialized successfully');
  } catch (err) {
    console.error('[PoseFusion] Failed to initialize MediaPipe Holistic:', err);
  }
}

async function processMediaPipe() {
  if (!mpHolistic || isMpProcessing || !videoCapture.isActive || isPaused) return;
  isMpProcessing = true;
  try {
    await mpHolistic.send({ image: videoCapture.video });
  } catch (err) {
    console.error('[MediaPipe] Error processing frame:', err);
  } finally {
    isMpProcessing = false;
  }
}

function mapMediaPipeToAetherSense(landmarks) {
  if (!landmarks) return null;
  
  const getKp = (idx, confidence = 0.9) => {
    const lm = landmarks[idx];
    if (!lm) return { x: 0.5, y: 0.5, confidence: 0 };
    return {
      x: lm.x,
      y: lm.y,
      confidence: lm.visibility || confidence
    };
  };

  const lSh = landmarks[11];
  const rSh = landmarks[12];
  const neck = (lSh && rSh) 
    ? { x: (lSh.x + rSh.x) / 2, y: (lSh.y + rSh.y) / 2 - 0.03, confidence: Math.min(lSh.visibility || 0.9, rSh.visibility || 0.9) }
    : { x: 0.5, y: 0.5, confidence: 0 };

  const keypoints = [
    getKp(0),  // nose
    getKp(2),  // left_eye
    getKp(5),  // right_eye
    getKp(7),  // left_ear
    getKp(8),  // right_ear
    getKp(11), // left_shoulder
    getKp(12), // right_shoulder
    getKp(13), // left_elbow
    getKp(14), // right_elbow
    getKp(15), // left_wrist
    getKp(16), // right_wrist
    getKp(23), // left_hip
    getKp(24), // right_hip
    getKp(25), // left_knee
    getKp(26), // right_knee
    getKp(27), // left_ankle
    getKp(28), // right_ankle
    
    // Hand keypoints
    getKp(21), // left_thumb
    getKp(19), // left_index
    getKp(17), // left_pinky
    getKp(22), // right_thumb
    getKp(20), // right_index
    getKp(18), // right_pinky
    
    // Foot keypoints
    getKp(31), // left_foot_index (toe tip)
    getKp(32), // right_foot_index (toe tip)
    
    // Neck
    neck
  ];

  // Assign names
  for (let i = 0; i < keypoints.length; i++) {
    keypoints[i].name = KEYPOINT_NAMES[i];
  }

  return keypoints;
}

// === State ===
let mode = 'dual';  // 'dual' | 'video' | 'csi'
let isRunning = false;
let isPaused = false;
let startTime = 0;
let frameCount = 0;
let fps = 0;
let lastFpsTime = 0;
let confidenceThreshold = 0.3;
let renderMode = 'kinematic';
let avatarMode = false;

// Latency tracking
const latency = { video: 0, csi: 0, fusion: 0, total: 0 };

// === Components ===
const videoCapture = new VideoCapture(document.getElementById('webcam'));
const csiSimulator = new CsiSimulator({ subcarriers: 52, timeWindow: 56 });
const visualCnn = new CnnEmbedder({ inputSize: 56, embeddingDim: 128, seed: 42 });
const csiCnn = new CnnEmbedder({ inputSize: 56, embeddingDim: 128, seed: 137 });
const fusionEngine = new FusionEngine(128);
const poseDecoder = new PoseDecoder(128);
const renderer = new CanvasRenderer();
const skeleton3D = new Skeleton3D('skeleton-3d');
const activityClassifier = new ActivityClassifier();
const sessionRecorder = new SessionRecorder();

// === Canvas Elements ===
const skeletonCanvas = document.getElementById('skeleton-canvas');
const skeletonCtx = skeletonCanvas.getContext('2d');
const csiCanvas = document.getElementById('csi-canvas');
const csiCtx = csiCanvas.getContext('2d');
const embeddingCanvas = document.getElementById('embedding-canvas');
const embeddingCtx = embeddingCanvas.getContext('2d');

// === UI Elements ===
const modeSelect = document.getElementById('mode-select');
const statusDot = document.getElementById('status-dot');
const statusLabel = document.getElementById('status-label');
const fpsDisplay = document.getElementById('fps-display');
const cameraPrompt = document.getElementById('camera-prompt');
const startCameraBtn = document.getElementById('start-camera-btn');
const pauseBtn = document.getElementById('pause-btn');
const confSlider = document.getElementById('confidence-slider');
const confValue = document.getElementById('confidence-value');
const wsUrlInput = document.getElementById('ws-url');
const connectWsBtn = document.getElementById('connect-ws-btn');
const csiActivityLabel = document.getElementById('csi-activity-label');

// Fusion bar elements
const videoBar = document.getElementById('video-bar');
const csiBar = document.getElementById('csi-bar');
const fusedBar = document.getElementById('fused-bar');
const videoBarVal = document.getElementById('video-bar-val');
const csiBarVal = document.getElementById('csi-bar-val');
const fusedBarVal = document.getElementById('fused-bar-val');

// Latency elements
const latVideoEl = document.getElementById('lat-video');
const latCsiEl = document.getElementById('lat-csi');
const latFusionEl = document.getElementById('lat-fusion');
const latTotalEl = document.getElementById('lat-total');

// Cross-modal similarity
const crossModalEl = document.getElementById('cross-modal-sim');

// RSSI elements
const rssiBarEl = document.getElementById('rssi-bar');
const rssiValueEl = document.getElementById('rssi-value');
const rssiQualityEl = document.getElementById('rssi-quality');
const rssiSparkCanvas = document.getElementById('rssi-sparkline');
const rssiSparkCtx = rssiSparkCanvas ? rssiSparkCanvas.getContext('2d') : null;
const rssiHistory = [];
const RSSI_HISTORY_MAX = 80;

// === Initialize ===
function init() {
  console.log(`[PoseFusion] init() v4 — CsiSimulator=${CsiSimulator.VERSION || 'OLD'}, starting...`);
  resizeCanvases();
  console.log(`[PoseFusion] canvases: skeleton=${skeletonCanvas.width}x${skeletonCanvas.height}, csi=${csiCanvas.width}x${csiCanvas.height}, emb=${embeddingCanvas.width}x${embeddingCanvas.height}`);
  window.addEventListener('resize', resizeCanvases);

  // Mode change
  modeSelect.addEventListener('change', (e) => {
    mode = e.target.value;
    updateModeUI();
  });

  // Camera start
  startCameraBtn.addEventListener('click', startCamera);

  // Render mode change
  const renderModeSelect = document.getElementById('render-mode-select');
  if (renderModeSelect) {
    renderModeSelect.addEventListener('change', (e) => {
      renderMode = e.target.value;
    });
  }

  // Pause
  pauseBtn.addEventListener('click', () => {
    isPaused = !isPaused;
    pauseBtn.textContent = isPaused ? '▶ Resume' : '⏸ Pause';
    pauseBtn.classList.toggle('active', isPaused);
  });

  // Confidence slider
  confSlider.addEventListener('input', (e) => {
    confidenceThreshold = parseFloat(e.target.value);
    confValue.textContent = confidenceThreshold.toFixed(2);
  });

  // WebSocket connect
  connectWsBtn.addEventListener('click', async () => {
    const url = wsUrlInput.value.trim();
    if (!url) return;
    connectWsBtn.textContent = 'Connecting...';
    const ok = await csiSimulator.connectLive(url);
    connectWsBtn.textContent = ok ? '✓ Connected' : 'Connect';
    if (ok) {
      connectWsBtn.classList.add('active');
    }
  });

  // Avatar mode toggle
  const avatarModeChk = document.getElementById('avatar-mode-chk');
  if (avatarModeChk) {
    avatarModeChk.addEventListener('change', (e) => {
      avatarMode = e.target.checked;
    });
  }

  // Telemetry Recorder controls
  const recordBtn = document.getElementById('record-btn');
  const playBtn = document.getElementById('play-btn');
  const exportBtn = document.getElementById('export-btn');
  const screenshotBtn = document.getElementById('screenshot-btn');

  if (recordBtn) {
    recordBtn.addEventListener('click', () => {
      if (!sessionRecorder.isRecording) {
        sessionRecorder.startRecording();
        recordBtn.textContent = '⏹ Stop';
        recordBtn.classList.add('active');
        if (playBtn) playBtn.disabled = true;
        if (exportBtn) exportBtn.disabled = true;
      } else {
        sessionRecorder.stopRecording();
        recordBtn.textContent = '🔴 Record';
        recordBtn.classList.remove('active');
        if (playBtn && sessionRecorder.frames.length > 0) playBtn.disabled = false;
        if (exportBtn && sessionRecorder.frames.length > 0) exportBtn.disabled = false;
      }
    });
  }

  if (playBtn) {
    playBtn.addEventListener('click', () => {
      if (!sessionRecorder.isPlaying) {
        playBtn.textContent = '⏹ Stop';
        playBtn.classList.add('active');
        if (recordBtn) recordBtn.disabled = true;
        if (exportBtn) exportBtn.disabled = true;

        sessionRecorder.startPlayback(
          (frame) => {
            renderer.drawSkeleton(skeletonCtx, frame.keypoints, skeletonCanvas.width, skeletonCanvas.height, {
              minConfidence: confidenceThreshold,
              color: 'green',
              label: 'REPLAY',
              faceLandmarks: frame.faceLandmarks,
              leftHandLandmarks: frame.leftHandLandmarks,
              rightHandLandmarks: frame.rightHandLandmarks,
              renderMode: renderMode
            });
            if (skeleton3D) {
              skeleton3D.update(frame.keypoints, frame.faceLandmarks, confidenceThreshold, avatarMode);
            }
          },
          () => {
            playBtn.textContent = '▶ Replay';
            playBtn.classList.remove('active');
            if (recordBtn) recordBtn.disabled = false;
            if (exportBtn && sessionRecorder.frames.length > 0) exportBtn.disabled = false;
          }
        );
      } else {
        sessionRecorder.stopPlayback();
        playBtn.textContent = '▶ Replay';
        playBtn.classList.remove('active');
        if (recordBtn) recordBtn.disabled = false;
        if (exportBtn && sessionRecorder.frames.length > 0) exportBtn.disabled = false;
      }
    });
  }

  if (exportBtn) {
    exportBtn.addEventListener('click', () => {
      sessionRecorder.exportJson();
    });
  }

  if (screenshotBtn) {
    screenshotBtn.addEventListener('click', () => {
      // Create a combined canvas to render both video feed and skeleton overlay
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = skeletonCanvas.width;
      tempCanvas.height = skeletonCanvas.height;
      const tempCtx = tempCanvas.getContext('2d');

      // 1. Draw camera video (corrected for CSS mirror scaling)
      if (videoCapture.isActive) {
        tempCtx.save();
        tempCtx.translate(tempCanvas.width, 0);
        tempCtx.scale(-1, 1);
        tempCtx.drawImage(videoCapture.video, 0, 0, tempCanvas.width, tempCanvas.height);
        tempCtx.restore();
      } else {
        tempCtx.fillStyle = '#050810';
        tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
      }

      // 2. Draw 2D canvas skeleton overlay on top
      tempCtx.drawImage(skeletonCanvas, 0, 0);

      // 3. Trigger screenshot download
      sessionRecorder.takeScreenshot(tempCanvas);
    });
  }

  // Try to load RuVector Attention WASM embedders (non-blocking)
  const wasmBase = new URL('../pkg/ruvector-attention', import.meta.url).href;
  visualCnn.tryLoadWasm(wasmBase).then((ok) => {
    // Share the WASM module with FusionEngine for cosine_similarity, normalize, etc.
    if (visualCnn.rvModule) fusionEngine.setWasmModule(visualCnn.rvModule);
    // Update footer backend label
    const backendEl = document.getElementById('cnn-backend');
    if (backendEl) {
      backendEl.textContent = ok && visualCnn.useRuVector
        ? `RuVector WASM v${visualCnn.rvModule.version()} — 6 attention mechanisms`
        : 'ruvector-cnn (JS fallback)';
    }
  });
  csiCnn.tryLoadWasm(wasmBase);

  // Auto-connect to local sensing server WebSocket if available
  const defaultWsUrl = 'ws://localhost:8765/ws/sensing';
  if (wsUrlInput) wsUrlInput.value = defaultWsUrl;
  csiSimulator.connectLive(defaultWsUrl).then(ok => {
    if (ok && connectWsBtn) {
      connectWsBtn.textContent = '✓ Live ESP32';
      connectWsBtn.classList.add('active');
      statusLabel.textContent = 'LIVE CSI';
      statusDot.classList.remove('offline');
    }
  });

  // Initialize MediaPipe Pose
  initMediaPipe();

  // Auto-start camera for video/dual modes
  updateModeUI();
  startTime = performance.now() / 1000;
  isRunning = true;
  requestAnimationFrame(mainLoop);
}

async function startCamera() {
  cameraPrompt.style.display = 'none';
  const ok = await videoCapture.start();
  if (ok) {
    statusDot.classList.remove('offline');
    statusLabel.textContent = 'LIVE';
    resizeCanvases();
  } else {
    cameraPrompt.style.display = 'flex';
    cameraPrompt.querySelector('p').textContent = 'Camera access denied. Try CSI-only mode.';
  }
}

function updateModeUI() {
  const needsVideo = mode !== 'csi';

  // Show/hide camera prompt
  if (needsVideo && !videoCapture.isActive) {
    cameraPrompt.style.display = 'flex';
  } else {
    cameraPrompt.style.display = 'none';
  }

  // Update mode label in both the overlay and the camera prompt
  const labelMap = { dual: 'DUAL FUSION', video: 'VIDEO ONLY', csi: 'CSI ONLY' };
  const modeLabel = document.getElementById('mode-label');
  const promptLabel = document.getElementById('prompt-mode-label');
  if (modeLabel) modeLabel.textContent = labelMap[mode] || mode;
  if (promptLabel) promptLabel.textContent = labelMap[mode] || mode;
}

function resizeCanvases() {
  const videoPanel = document.querySelector('.video-panel');
  if (videoPanel) {
    const rect = videoPanel.getBoundingClientRect();
    skeletonCanvas.width = rect.width;
    skeletonCanvas.height = rect.height;

    // Resize 3D canvas
    const canvas3D = document.getElementById('skeleton-3d');
    if (canvas3D && typeof skeleton3D !== 'undefined' && skeleton3D) {
      skeleton3D.resize(rect.width, rect.height);
    }
  }

  // CSI canvas (min 200px width)
  csiCanvas.width = Math.max(200, csiCanvas.parentElement.clientWidth);
  csiCanvas.height = 120;

  // Embedding canvas (min 200px width)
  embeddingCanvas.width = Math.max(200, embeddingCanvas.parentElement.clientWidth);
  embeddingCanvas.height = 140;
}

// === Main Loop ===
let _loopErrorShown = false;
let _diagDone = false;
function mainLoop(timestamp) {
  if (!isRunning) return;
  requestAnimationFrame(mainLoop);

  if (isPaused || (typeof sessionRecorder !== 'undefined' && sessionRecorder.isPlaying)) return;

  try {
  const elapsed = performance.now() / 1000 - startTime;
  const totalStart = performance.now();

  // --- Video Pipeline ---
  let videoEmb = null;
  let motionRegion = null;
  if (mode !== 'csi' && videoCapture.isActive) {
    // Start MediaPipe Pose processing in background (non-blocking)
    processMediaPipe();

    const t0 = performance.now();
    const frame = videoCapture.captureFrame(56, 56);
    if (frame) {
      videoEmb = visualCnn.extract(frame.rgb, frame.width, frame.height);
      motionRegion = videoCapture.detectMotionRegion(56, 56);

      // Feed motion to CSI simulator for correlated demo data
      // When detected=false, CSI simulator handles through-wall persistence
      csiSimulator.updatePersonState(
        motionRegion.detected ? 1.0 : 0,
        motionRegion.detected ? motionRegion.x + motionRegion.w / 2 : 0.5,
        motionRegion.detected ? motionRegion.y + motionRegion.h / 2 : 0.5,
        frame.motion
      );

      fusionEngine.updateConfidence(
        frame.brightness, frame.motion,
        0, csiSimulator.isLive || mode === 'dual'
      );
    }
    if (!isMpProcessing) {
      latency.video = performance.now() - t0;
    }
  }

  // --- CSI Pipeline ---
  let csiEmb = null;
  if (mode !== 'video') {
    const t0 = performance.now();
    const csiFrame = csiSimulator.nextFrame(elapsed);
    const pseudoImage = csiSimulator.buildPseudoImage(56);
    csiEmb = csiCnn.extract(pseudoImage, 56, 56);

    fusionEngine.updateConfidence(
      videoCapture.brightnessScore,
      videoCapture.motionScore,
      csiFrame.snr,
      true
    );

    // Draw CSI heatmap
    const heatmap = csiSimulator.getHeatmapData();
    renderer.drawCsiHeatmap(csiCtx, heatmap, csiCanvas.width, csiCanvas.height);

    // Classify CSI Activity
    if (activityClassifier && csiActivityLabel && csiSimulator.amplitudeBuffer.length >= 10) {
      const actRes = activityClassifier.classify(csiSimulator.amplitudeBuffer);
      csiActivityLabel.textContent = `${actRes.activity.toUpperCase()} (${Math.round(actRes.confidence * 100)}%)`;
      if (actRes.activity === 'Walking') {
        csiActivityLabel.style.color = 'var(--red-alert)';
      } else if (actRes.activity === 'Gesture/Movement') {
        csiActivityLabel.style.color = 'var(--amber)';
      } else if (actRes.activity === 'Standing Still') {
        csiActivityLabel.style.color = 'var(--green-glow)';
      } else {
        csiActivityLabel.style.color = 'var(--text-secondary)';
      }
    }

    latency.csi = performance.now() - t0;
  }

  // --- Fusion ---
  const t0f = performance.now();
  const fusedEmb = fusionEngine.fuse(videoEmb, csiEmb, mode);
  latency.fusion = performance.now() - t0f;

  // --- Pose Decode ---
  // For CSI-only mode, generate a synthetic motion region from CSI energy
  if (mode === 'csi' && (!motionRegion || !motionRegion.detected)) {
    const csiPresence = csiSimulator.personPresence;
    if (csiPresence > 0.1) {
      motionRegion = {
        detected: true,
        x: 0.25, y: 0.15, w: 0.5, h: 0.7,
        coverage: csiPresence,
        motionGrid: null,
        gridCols: 10,
        gridRows: 8
      };
    }
  }

  // CSI state for through-wall tracking
  const csiState = {
    csiPresence: csiSimulator.personPresence,
    isLive: csiSimulator.isLive
  };

  // Decode CSI keypoints
  const csiKeypoints = poseDecoder.decode(fusedEmb, motionRegion, elapsed, csiState);

  // Extract MediaPipe webcam landmarks if active
  let videoKeypoints = null;
  if (mode !== 'csi' && latestMpResults && latestMpResults.poseLandmarks) {
    videoKeypoints = mapMediaPipeToAetherSense(latestMpResults.poseLandmarks);
  }

  // Dual-modal pose keypoints fusion
  let keypoints = [];
  if (mode === 'video') {
    keypoints = videoKeypoints || csiKeypoints;
  } else if (mode === 'dual' && videoKeypoints) {
    const fusedKeypoints = [];
    const alpha = fusionEngine.videoConfidence / (fusionEngine.videoConfidence + fusionEngine.csiConfidence || 1.0);
    
    for (let i = 0; i < 26; i++) {
      const vk = videoKeypoints[i];
      const ck = csiKeypoints[i];
      if (vk && ck) {
        fusedKeypoints.push({
          x: alpha * vk.x + (1 - alpha) * ck.x,
          y: alpha * vk.y + (1 - alpha) * ck.y,
          confidence: alpha * vk.confidence + (1 - alpha) * ck.confidence,
          name: vk.name
        });
      } else if (vk) {
        fusedKeypoints.push(vk);
      } else if (ck) {
        fusedKeypoints.push(ck);
      }
    }
    keypoints = fusedKeypoints;
  } else {
    // Fallback to CSI only when no video landmarks are detected
    keypoints = csiKeypoints;
  }

  // --- Render Skeleton ---
  const labelMap = { dual: 'DUAL FUSION', video: 'VIDEO ONLY', csi: 'CSI ONLY' };
  renderer.drawSkeleton(skeletonCtx, keypoints, skeletonCanvas.width, skeletonCanvas.height, {
    minConfidence: confidenceThreshold,
    color: mode === 'csi' ? 'amber' : 'green',
    label: labelMap[mode],
    faceLandmarks: (mode !== 'csi' && latestMpResults) ? latestMpResults.faceLandmarks : null,
    leftHandLandmarks: (mode !== 'csi' && latestMpResults) ? latestMpResults.leftHandLandmarks : null,
    rightHandLandmarks: (mode !== 'csi' && latestMpResults) ? latestMpResults.rightHandLandmarks : null,
    renderMode: renderMode
  });

  // --- Render 3D Skeleton ---
  if (typeof skeleton3D !== 'undefined' && skeleton3D) {
    const faceLms = (mode !== 'csi' && latestMpResults) ? latestMpResults.faceLandmarks : null;
    skeleton3D.update(keypoints, faceLms, confidenceThreshold, avatarMode);
  }

  // --- Record Telemetry Frame ---
  if (typeof sessionRecorder !== 'undefined' && sessionRecorder.isRecording) {
    const faceLms = (mode !== 'csi' && latestMpResults) ? latestMpResults.faceLandmarks : null;
    const lHand = (mode !== 'csi' && latestMpResults) ? latestMpResults.leftHandLandmarks : null;
    const rHand = (mode !== 'csi' && latestMpResults) ? latestMpResults.rightHandLandmarks : null;
    sessionRecorder.recordFrame(keypoints, faceLms, lHand, rHand);
  }

  // --- Render Embedding Space ---
  const embPoints = fusionEngine.getEmbeddingPoints();
  renderer.drawEmbeddingSpace(embeddingCtx, embPoints, embeddingCanvas.width, embeddingCanvas.height);

  // --- Update UI ---
  latency.total = performance.now() - totalStart;

  // FPS
  frameCount++;
  if (timestamp - lastFpsTime > 500) {
    fps = Math.round(frameCount * 1000 / (timestamp - lastFpsTime));
    lastFpsTime = timestamp;
    frameCount = 0;
    fpsDisplay.textContent = `${fps} FPS`;
  }

  // Fusion bars
  const vc = fusionEngine.videoConfidence;
  const cc = fusionEngine.csiConfidence;
  const fc = fusionEngine.fusedConfidence;
  videoBar.style.width = `${vc * 100}%`;
  csiBar.style.width = `${cc * 100}%`;
  fusedBar.style.width = `${fc * 100}%`;
  videoBarVal.textContent = `${Math.round(vc * 100)}%`;
  csiBarVal.textContent = `${Math.round(cc * 100)}%`;
  fusedBarVal.textContent = `${Math.round(fc * 100)}%`;

  // Latency
  latVideoEl.textContent = `${latency.video.toFixed(1)}ms`;
  latCsiEl.textContent = `${latency.csi.toFixed(1)}ms`;
  latFusionEl.textContent = `${latency.fusion.toFixed(1)}ms`;
  latTotalEl.textContent = `${latency.total.toFixed(1)}ms`;

  // Cross-modal similarity
  const sim = fusionEngine.getCrossModalSimilarity();
  crossModalEl.textContent = sim.toFixed(3);

  // RuVector attention pipeline stats
  const rvStats = poseDecoder.attentionStats;
  const rvEnergyEl = document.getElementById('rv-energy');
  const rvRefineEl = document.getElementById('rv-refine');
  const rvImpactEl = document.getElementById('rv-impact');
  if (rvEnergyEl) rvEnergyEl.textContent = (rvStats.energy || 0).toFixed(2);
  if (rvRefineEl) rvRefineEl.textContent = ((rvStats.refinementMag || 0) * 1000).toFixed(1) + 'px';
  if (rvImpactEl) {
    const impact = Math.min(100, (rvStats.refinementMag || 0) * 5000);
    rvImpactEl.textContent = impact.toFixed(0) + '%';
  }
  // Pulse the pipeline stages when active
  if (visualCnn.useRuVector && rvStats.energy > 0.1) {
    document.querySelectorAll('.rv-stage').forEach(el => el.classList.add('active'));
  }

  // RSSI update
  updateRssi(csiSimulator.rssiDbm);

  // One-time diagnostic
  if (!_diagDone) {
    _diagDone = true;
    console.log(`[PoseFusion] frame 1 OK — mode=${mode}, csi.bufLen=${csiSimulator.amplitudeBuffer.length}, embPts=${embPoints?.fused?.length ?? 0}, rssi=${(csiSimulator.rssiDbm ?? -99).toFixed(1)}`);
  }

  } catch (err) {
    if (!_loopErrorShown) {
      _loopErrorShown = true;
      console.error('[MainLoop]', err);
      // Show error visually on page
      const errDiv = document.createElement('div');
      errDiv.style.cssText = 'position:fixed;bottom:60px;left:24px;right:24px;background:rgba(255,48,64,0.95);color:#fff;padding:12px 16px;border-radius:8px;font:12px/1.4 "JetBrains Mono",monospace;z-index:9999;max-height:120px;overflow:auto';
      errDiv.textContent = `[MainLoop Error] ${err.message}\n${err.stack?.split('\n').slice(0,3).join('\n')}`;
      document.body.appendChild(errDiv);
    }
  }
}

// === RSSI Visualization ===
function updateRssi(dbm) {
  if (!rssiBarEl) return;

  // Clamp to typical WiFi range: -100 (worst) to -30 (best)
  const clamped = Math.max(-100, Math.min(-30, dbm));
  const pct = ((clamped + 100) / 70) * 100; // 0-100%

  rssiBarEl.style.width = `${pct}%`;
  rssiValueEl.textContent = `${Math.round(clamped)} dBm`;

  // Quality label
  let quality;
  if (clamped > -50) quality = 'Excellent';
  else if (clamped > -60) quality = 'Good';
  else if (clamped > -70) quality = 'Fair';
  else if (clamped > -80) quality = 'Weak';
  else quality = 'Poor';
  rssiQualityEl.textContent = quality;

  // Color the dBm value based on quality
  if (clamped > -60) rssiValueEl.style.color = 'var(--green-glow)';
  else if (clamped > -75) rssiValueEl.style.color = 'var(--amber)';
  else rssiValueEl.style.color = 'var(--red-alert)';

  // Sparkline history
  rssiHistory.push(clamped);
  if (rssiHistory.length > RSSI_HISTORY_MAX) rssiHistory.shift();
  drawRssiSparkline();
}

function drawRssiSparkline() {
  if (!rssiSparkCtx || rssiHistory.length < 2) return;
  const w = rssiSparkCanvas.width;
  const h = rssiSparkCanvas.height;
  const ctx = rssiSparkCtx;

  ctx.clearRect(0, 0, w, h);

  // Draw signal strength line
  const len = rssiHistory.length;
  const step = w / (RSSI_HISTORY_MAX - 1);

  // Gradient fill under line
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, 'rgba(0,210,120,0.3)');
  grad.addColorStop(1, 'rgba(0,210,120,0)');

  ctx.beginPath();
  for (let i = 0; i < len; i++) {
    const x = (RSSI_HISTORY_MAX - len + i) * step;
    const y = h - ((rssiHistory[i] + 100) / 70) * h;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  // Fill area
  const lastX = (RSSI_HISTORY_MAX - 1) * step;
  const firstX = (RSSI_HISTORY_MAX - len) * step;
  ctx.lineTo(lastX, h);
  ctx.lineTo(firstX, h);
  ctx.closePath();
  ctx.fillStyle = grad;
  ctx.fill();

  // Draw line on top
  ctx.beginPath();
  for (let i = 0; i < len; i++) {
    const x = (RSSI_HISTORY_MAX - len + i) * step;
    const y = h - ((rssiHistory[i] + 100) / 70) * h;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = '#00d878';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Pulsing dot at latest value
  const latestX = lastX;
  const latestY = h - ((rssiHistory[len - 1] + 100) / 70) * h;
  const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 300);
  ctx.beginPath();
  ctx.arc(latestX, latestY, 2 + pulse, 0, Math.PI * 2);
  ctx.fillStyle = '#00d878';
  ctx.fill();
  ctx.beginPath();
  ctx.arc(latestX, latestY, 4 + pulse * 2, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(0,216,120,${0.3 + pulse * 0.3})`;
  ctx.lineWidth = 1;
  ctx.stroke();
}

// Boot
document.addEventListener('DOMContentLoaded', init);
