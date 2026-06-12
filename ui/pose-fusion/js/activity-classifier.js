/**
 * ActivityClassifier — Heuristic WiFi CSI activity recognition based on
 * temporal variance analysis across OFDM subcarriers.
 */
export class ActivityClassifier {
  constructor() {}

  /**
   * Classify user activity from sliding CSI amplitude buffer
   * @param {Array<Float32Array>} amplitudeBuffer - history of subcarrier amplitudes
   * @returns {Object} { activity, confidence, avgVariance }
   */
  classify(amplitudeBuffer) {
    if (!amplitudeBuffer || amplitudeBuffer.length < 10) {
      return { activity: 'Calibrating...', confidence: 0.5, avgVariance: 0 };
    }

    const numFrames = amplitudeBuffer.length;
    const numSubcarriers = amplitudeBuffer[0].length;

    // Calculate mean temporal variance across all subcarriers
    let totalVariance = 0;
    for (let s = 0; s < numSubcarriers; s++) {
      let sum = 0;
      let sumSq = 0;
      for (let f = 0; f < numFrames; f++) {
        const val = amplitudeBuffer[f][s] || 0;
        sum += val;
        sumSq += val * val;
      }
      const mean = sum / numFrames;
      const variance = (sumSq / numFrames) - (mean * mean);
      totalVariance += Math.max(0, variance);
    }

    const avgVariance = totalVariance / numSubcarriers;

    let activity = 'Empty Room';
    let confidence = 0.90;

    // Calibrated thresholds for both live hardware and demo simulator modes
    if (avgVariance < 0.0005) {
      activity = 'Empty Room';
      confidence = Math.min(0.99, 0.85 + (0.0005 - avgVariance) * 200);
    } else if (avgVariance < 0.0042) {
      activity = 'Standing Still';
      confidence = 0.88;
    } else if (avgVariance < 0.0125) {
      activity = 'Gesture/Movement';
      confidence = 0.85;
    } else {
      activity = 'Walking';
      confidence = Math.min(0.98, 0.75 + (avgVariance - 0.0125) * 5);
    }

    return { activity, confidence, avgVariance };
  }
}
