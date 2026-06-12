/**
 * SessionRecorder — Handles recording, playback, and export of dual-modal pose sessions
 * and screenshot capturing.
 */
export class SessionRecorder {
  constructor() {
    this.isRecording = false;
    this.isPlaying = false;
    this.frames = [];
    this.playbackIndex = 0;
    this.onFrameCallback = null;
    this.onEndCallback = null;
  }

  startRecording() {
    this.isRecording = true;
    this.isPlaying = false;
    this.frames = [];
    console.log('[SessionRecorder] Recording started');
  }

  stopRecording() {
    this.isRecording = false;
    console.log(`[SessionRecorder] Recording stopped. Captured ${this.frames.length} frames.`);
    return this.frames;
  }

  recordFrame(keypoints, faceLandmarks, leftHandLandmarks, rightHandLandmarks) {
    if (!this.isRecording) return;
    this.frames.push({
      keypoints: keypoints ? JSON.parse(JSON.stringify(keypoints)) : null,
      faceLandmarks: faceLandmarks ? JSON.parse(JSON.stringify(faceLandmarks)) : null,
      leftHandLandmarks: leftHandLandmarks ? JSON.parse(JSON.stringify(leftHandLandmarks)) : null,
      rightHandLandmarks: rightHandLandmarks ? JSON.parse(JSON.stringify(rightHandLandmarks)) : null,
      timestamp: performance.now()
    });
  }

  startPlayback(onFrame, onEnd) {
    if (this.frames.length === 0) {
      console.warn('[SessionRecorder] No frames to play back');
      return;
    }
    this.isPlaying = true;
    this.isRecording = false;
    this.playbackIndex = 0;
    this.onFrameCallback = onFrame;
    this.onEndCallback = onEnd;
    this._playbackLoop();
    console.log('[SessionRecorder] Playback started');
  }

  stopPlayback() {
    this.isPlaying = false;
    console.log('[SessionRecorder] Playback stopped');
  }

  _playbackLoop() {
    if (!this.isPlaying) return;

    if (this.playbackIndex >= this.frames.length) {
      this.isPlaying = false;
      if (this.onEndCallback) this.onEndCallback();
      console.log('[SessionRecorder] Playback finished');
      return;
    }

    const frame = this.frames[this.playbackIndex];
    if (this.onFrameCallback) {
      this.onFrameCallback(frame);
    }

    this.playbackIndex++;
    
    // Auto throttle playback speed (average 30fps)
    setTimeout(() => this._playbackLoop(), 33);
  }

  exportJson() {
    if (this.frames.length === 0) return;
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(this.frames, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `aethersense_session_${Date.now()}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    console.log('[SessionRecorder] Exported JSON file');
  }

  takeScreenshot(canvasElement) {
    if (!canvasElement) return;
    const dataUrl = canvasElement.toDataURL("image/png");
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataUrl);
    downloadAnchor.setAttribute("download", `aethersense_capture_${Date.now()}.png`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    console.log('[SessionRecorder] Took canvas screenshot');
  }
}
