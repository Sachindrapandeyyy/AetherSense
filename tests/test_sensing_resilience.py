import sys
import os
import unittest
import numpy as np
import time
from unittest.mock import MagicMock, patch

# Ensure paths are set correctly for import
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'archive')))

from v1.src.sensing.rssi_collector import WifiSample, WindowsWifiCollector
from v1.src.sensing.feature_extractor import RssiFeatureExtractor
from v1.src.sensing.classifier import PresenceClassifier, MotionLevel


class TestSensingResilience(unittest.TestCase):

    def test_median_filter_spikes(self):
        """Verify that the 3-point median filter removes isolated spikes."""
        # Setup signals
        extractor = RssiFeatureExtractor()
        
        # A clean constant signal with a single extreme spike (drop to -100 dBm)
        raw_rssi = np.array([-50.0, -50.0, -50.0, -100.0, -50.0, -50.0, -50.0], dtype=np.float64)
        
        # Apply the median filter
        filtered = extractor._apply_median_filter(raw_rssi)
        
        # The spike should be completely removed, leaving a flat -50.0 dBm line
        np.testing.assert_allclose(filtered, -50.0)

    @patch('subprocess.run')
    def test_windows_wifi_collector_fallback(self, mock_run):
        """Verify that WindowsWifiCollector yields degraded last sample on failure."""
        collector = WindowsWifiCollector(interface="WiFi")
        
        # Create a successful initial sample
        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = "Name: WiFi\nState: connected\nSignal: 90%\nRSSI: -45\n"
        mock_run.return_value = mock_result
        
        initial_sample = collector._read_sample()
        self.assertEqual(initial_sample.rssi_dbm, -45.0)
        self.assertEqual(initial_sample.retry_count, 0)
        
        # Now mock a failed execution (timeout or error code)
        mock_run.side_effect = Exception("netsh command timed out")
        
        # Read next sample: should fallback to initial sample with some degradation
        fallback_sample = collector._read_sample()
        self.assertNotEqual(fallback_sample.timestamp, initial_sample.timestamp)
        self.assertAlmostEqual(fallback_sample.rssi_dbm, -45.0, delta=1.0)
        self.assertEqual(fallback_sample.retry_count, 1)

    @patch('subprocess.run')
    def test_windows_wifi_collector_disconnected(self, mock_run):
        """Verify wlan disconnected status yields a deep-attenuation sample."""
        collector = WindowsWifiCollector(interface="WiFi")
        
        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = "Name: WiFi\nState: disconnected\nSignal: 0%\n"
        mock_run.return_value = mock_result
        
        sample = collector._read_sample()
        self.assertEqual(sample.rssi_dbm, -100.0)
        self.assertEqual(sample.link_quality, 0.0)
        self.assertEqual(sample.retry_count, 1)

    def test_adaptive_calibration(self):
        """Verify classifier adaptive calibration thresholding."""
        classifier = PresenceClassifier()
        classifier.start_calibration()
        
        self.assertTrue(classifier._is_calibrating)
        self.assertEqual(classifier._calibration_progress, 0.0)
        
        # Feed 20 variance samples with very low noise (around 0.1 variance)
        for _ in range(20):
            completed = classifier.update_calibration(0.1 + np.random.normal(0, 0.01))
            
        self.assertFalse(classifier._is_calibrating)
        self.assertEqual(classifier._calibration_progress, 1.0)
        
        # Dynamic threshold should be computed: mean + 3*std
        # It should be close to 0.15 (our minimum threshold cap)
        self.assertGreaterEqual(classifier.presence_variance_threshold, 0.15)
        self.assertLessEqual(classifier.presence_variance_threshold, 0.3)


if __name__ == '__main__':
    unittest.main()
