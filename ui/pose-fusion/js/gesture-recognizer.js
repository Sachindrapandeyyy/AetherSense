/**
 * GestureRecognizer — Analyzes 21-landmark hand mesh, detects individual
 * finger curl/extension states, and classifies gestures (Thumbs Up, Fist, Peace, etc.)
 */
export class GestureRecognizer {
  constructor() {}

  /**
   * Classify hand gesture based on 21 landmarks
   * @param {Array} lm - 21 hand landmarks ({x, y, z})
   * @returns {Object} { gesture, emoji, fingers: [thumb, index, middle, ring, pinky] }
   */
  classify(lm) {
    if (!lm || lm.length < 21) {
      return { gesture: 'Unknown', emoji: '❓', fingers: [false, false, false, false, false] };
    }

    // Helper: calculate distance in 3D
    const dist3D = (p1, p2) => {
      return Math.sqrt(
        (p1.x - p2.x) ** 2 +
        (p1.y - p2.y) ** 2 +
        ((p1.z || 0) - (p2.z || 0)) ** 2
      );
    };

    // ── Finger Extension Heuristic ──
    const isFingerExtended = (knuckle, pip, dip, tip) => {
      const dTotal = dist3D(lm[knuckle], lm[pip]) + dist3D(lm[pip], lm[dip]) + dist3D(lm[dip], lm[tip]);
      const dDirect = dist3D(lm[knuckle], lm[tip]);
      return dDirect / dTotal > 0.65;
    };

    // ── Thumb Extension Heuristic ──
    const isThumbExtended = () => {
      // Compare distance from thumb tip (4) to index MCP (5) vs thumb MCP (2) to index MCP (5)
      const dTipIndex = dist3D(lm[4], lm[5]);
      const dMcp2Index = dist3D(lm[2], lm[5]);
      return dTipIndex > dMcp2Index * 1.15;
    };

    const thumb = isThumbExtended();
    const index = isFingerExtended(5, 6, 7, 8);
    const middle = isFingerExtended(9, 10, 11, 12);
    const ring = isFingerExtended(13, 14, 15, 16);
    const pinky = isFingerExtended(17, 18, 19, 20);

    const fingers = [thumb, index, middle, ring, pinky];

    let gesture = 'Unknown';
    let emoji = '❓';

    if (thumb && !index && !middle && !ring && !pinky) {
      gesture = 'Thumbs Up';
      emoji = '👍';
    } else if (!thumb && index && middle && !ring && !pinky) {
      gesture = 'Peace';
      emoji = '✌️';
    } else if (!thumb && !index && !middle && !ring && !pinky) {
      gesture = 'Fist';
      emoji = '✊';
    } else if (thumb && index && middle && ring && pinky) {
      gesture = 'Open Palm';
      emoji = '🖐️';
    } else if (!thumb && index && !middle && !ring && !pinky) {
      gesture = 'Pointing';
      emoji = '👆';
    } else if (index && pinky && !middle && !ring) {
      gesture = 'Rock';
      emoji = '🤟';
    } else if (!thumb && index && middle && ring && pinky) {
      gesture = 'Open Palm';
      emoji = '🖐️';
    } else {
      const count = fingers.filter(f => f).length;
      gesture = `${count} Fingers`;
      emoji = '🖐️';
    }

    return { gesture, emoji, fingers };
  }
}
