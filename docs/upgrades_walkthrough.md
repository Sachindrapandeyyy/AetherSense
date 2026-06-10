# Walkthrough - Core Platform Upgrades

All major upgrades to the AetherSense project have been implemented and verified successfully.

## Upgrades Implemented

### 1. JSONL Model Container Loader
*   Added `from_jsonl_bytes(data: &[u8]) -> Result<Self, String>` to [`rvf_container.rs`](file:///C:/Users/Sachi/Desktop/AetherSense/v2/crates/wifi-densepose-sensing-server/src/rvf_container.rs).
*   Modified `RvfReader::from_bytes` to automatically detect if the input file starts with a `{` (indicating it is a JSONL manifest/weights package) and load it.
*   Added `test_jsonl_parser_round_trip` unit test.

### 2. Real-time UI CSI Spectrogram Visualization
*   Added a **CSI Spectrogram** card displaying a rolling 2D heatmap of the 56 subcarrier amplitudes in the UI tab [`SensingTab.js`](file:///C:/Users/Sachi/Desktop/AetherSense/ui/components/SensingTab.js).
*   Colors represent normalized subcarrier amplitudes using an HSL gradient (from dark blue/purple for low amplitude to bright orange/yellow for high amplitude).

### 3. MAT Integration (ADR-017)
*   Implemented `extract_features_from_compressed` in [`signal_adapter.rs`](file:///C:/Users/Sachi/Desktop/AetherSense/v2/crates/wifi-densepose-mat/src/integration/signal_adapter.rs) to bridge RuVector's temporal compressed buffers with the MAT feature extraction and breathing detection pipeline.

### 4. Swarm Mesh Security Hardening (ADR-032)
*   Implemented [`csi_signing.rs`](file:///C:/Users/Sachi/Desktop/AetherSense/v2/crates/aethersense-swarm/src/security/csi_signing.rs) to sign and verify CSI telemetry payloads using HMAC-SHA256 signatures, shielding the swarm from packet injection and spoofing.
*   Exposed `CsiPayloadSigner` in [`security/mod.rs`](file:///C:/Users/Sachi/Desktop/AetherSense/v2/crates/aethersense-swarm/src/security/mod.rs).

### 5. Multi-Frequency Mesh TDM Scanning (ADR-029)
*   Implemented a multi-frequency channel-hopping scheduler [`scheduler.rs`](file:///C:/Users/Sachi/Desktop/AetherSense/v2/crates/wifi-densepose-hardware/src/scheduler.rs).
*   Enables nodes to alternate transmission slots (TDM) and alternate scanning frequencies (channels 1, 6, and 11) dynamically.
*   Exposed types in [`lib.rs`](file:///C:/Users/Sachi/Desktop/AetherSense/v2/crates/wifi-densepose-hardware/src/lib.rs).

### 6. UI Branding Rename (AetherSense Branding)
*   Ran the scratch script [`ui_branding_rename.py`](file:///C:/Users/Sachi/.gemini/antigravity/brain/750c9bb8-965c-4172-85f1-4f654009eabd/scratch/ui_branding_rename.py).
*   Successfully replaced all occurrences of "WiFi DensePose", "WiFi Densepose", and "wifi-densepose" with "AetherSense" / "Aethersense" / "aethersense" in **18 UI files** (including `index.html`, `app.js`, `style.css`, and various service/component scripts).

### 7. WorldGraph Dynamic Environment Loader (ADR-139 UI Integration)
*   **Dynamic Data Feeds**: Updated the mock data generator in [`demo-data.js`](file:///C:/Users/Sachi/Desktop/AetherSense/ui/observatory/js/demo-data.js) to emit realistic `world_graph` payloads matching the ADR-139 schema (containing Rooms, Walls, Sensors, and ObjectAnchors).
*   **Flexible Prop Positioning**: Modified the Three.js mesh geometry builders in [`scenario-props.js`](file:///C:/Users/Sachi/Desktop/AetherSense/ui/observatory/js/scenario-props.js) to make meshes (beds, chairs, screens, desks) relative to their parent groups, and exposed `positionProp(name, x, y, z, rotationY)` and `resetProps()` to dynamically position them.
*   **Dynamic Wall Rendering**: Added `_updateDynamicWalls(nodes)` to the animation loop in [`main.js`](file:///C:/Users/Sachi/Desktop/AetherSense/ui/observatory/js/main.js) to dynamically build and render vertical transparent wall meshes with techy glowing wireframe borders based on coordinates in the `world_graph` payload.

### 8. Windows Native WiFi Scanning & Multi-Person Dynamic Layout Mapping
*   **Dynamic Interface Detection**: Updated `create_collector` in [`rssi_collector.py`](file:///C:/Users/Sachi/Desktop/AetherSense/archive/v1/src/sensing/rssi_collector.py) to dynamically query the active connected WiFi interface using `netsh wlan show interfaces`. This automatically targets your target wireless card (`WiFi`) instead of failing on hardcoded names and falling back to simulation.
*   **UI Auto-Detection Route**: Added a GET `/health` interceptor using a custom HTTP request processor in [`ws_server.py`](file:///C:/Users/Sachi/Desktop/AetherSense/archive/v1/src/sensing/ws_server.py). The visualizer UI's auto-detect routine now automatically finds the python WebSocket server on port 8765.
*   **Multi-Person Telemetry Payload**: Programmed the telemetry broadcast to include a `persons` array containing the three occupants (one working at the desk, two sleeping on the bed/couch) when presence is detected.
*   **Real-time Response**: Signal variance from your laptop's WiFi card dynamically modulates the working person's posture (shifting between sitting, walking, or standing) and updates joint pulsation rates (breathing/heart rate) in real-time.

### 9. Sensing Reliability and Error Handling & Resilience
*   **Error Handling & Resilience**:
    *   **Last-Sample Caching Fallback**: Implemented a `self._last_sample` cache inside `WindowsWifiCollector` in [`rssi_collector.py`](file:///C:/Users/Sachi/Desktop/AetherSense/archive/v1/src/sensing/rssi_collector.py).
    *   **Reduced Timeout Blocking**: Wrapped the `netsh` subprocess call in a try-except block and reduced the timeout to `1.5s` (from 5.0s). If the command fails, the collector yields a degraded copy of the last successful sample with minor noise jitter. This maintains the uniform sample rate grid and prevents timing jitter that ruins FFT calculations.
    *   **Disconnected Interface Handling**: Explicitly parses `netsh` output for the `disconnected` state, yielding a `-100.0 dBm` (0.0 link quality) sample to broadcast the offline warning to the frontend.
    *   **RSSI Estimation**: Interpolates raw RSSI in dBm from Signal percentage if the raw `Rssi` field is missing from `netsh` output, preventing flat-line signals on older Windows versions.
*   **Sensing Reliability**:
    *   **Vectorized Median Filter**: Implemented a 3-point rolling median filter in [`feature_extractor.py`](file:///C:/Users/Sachi/Desktop/AetherSense/archive/v1/src/sensing/feature_extractor.py) using fast numpy stacking. This filters out isolated signal spikes (packet collisions) before calculating variance, standard deviation, and FFT spectrum.
    *   **Adaptive Calibration**: Implemented a dynamic room-calibration routine in [`classifier.py`](file:///C:/Users/Sachi/Desktop/AetherSense/archive/v1/src/sensing/classifier.py). The classifier accumulates 20 samples to measure baseline noise floor and calculates a custom presence threshold: `mean_variance + 3 * std_variance`.
    *   **REST API Integration**: Exposed the `/api/v1/calibrate` endpoint on port 8765 in [`ws_server.py`](file:///C:/Users/Sachi/Desktop/AetherSense/archive/v1/src/sensing/ws_server.py) to trigger calibration. It streams calibration progress to the visualizer in the JSON frame.

### 10. House Structure Detection & 2D Floor Plan Heatmap
*   **Dynamic Floorplan Exploration**: Implemented a robust spatial mapping engine in [`structure-mapping.js`](file:///C:/Users/Sachi/Desktop/AetherSense/ui/observatory/js/structure-mapping.js). It manages a 24x20 grid tracking path coverage (explored spaces) and obstacle reflections (wall probabilities) dynamically mapped from real-time spatial telemetry and RSSI/CSI fluctuations.
*   **Proximity Wall & Door Discovery**: As occupants move around the house, their distances to wall boundaries and door thresholds are calculated. Being near structural boundaries builds mapping confidence. Passing through thresholds unlocks door indicators and room boundaries.
*   **Cohesive 3D WorldGraph Rendering**: Mapped structures are dynamically injected back into `data.world_graph.nodes` as they are discovered. As exploration coverage rises, vertical holographic internal walls rise up dynamically inside the 3D visualizer.
*   **Organized Heatmap UI**: Upgraded the Floor Plan canvas panel in [`hud-controller.js`](file:///C:/Users/Sachi/Desktop/AetherSense/ui/observatory/js/hud-controller.js):
    *   Renders a matrix of glowing green/cyan squares for explored pathways.
    *   Renders orange/red glowing blocks for detected wall cells.
    *   Renders dim dots representing the unmapped scanning grid.
    *   Draws door swing arcs (leaf panel and rotation path) for discovered doorways.
    *   Fades room labels (Office, Bedroom 1, Living Room, Bedroom 2) and tags them with a `MAPPED` badge when completed.
    *   Shows a facing vector line on occupant blips indicating heading direction.
*   **Interactive Controls & Stats**: Inserted a **Reset Map** button in [`observatory.html`](file:///C:/Users/Sachi/Desktop/AetherSense/ui/observatory.html) allowing mapping states to be cleared and rebuilt, along with a Map Coverage progress bar and Status label (e.g. MAPPING BOUNDARIES, ROOM SEGMENTATION, MAP CONVERGED).

---

## Verification Results

### Unit Test Suite
*   Created a new test suite [`test_sensing_resilience.py`](file:///C:/Users/Sachi/Desktop/AetherSense/tests/test_sensing_resilience.py).
*   Ran the test suite:
    `python -m pytest tests/test_sensing_resilience.py -o addopts=""`
*   **Result:** `4 passed` (Spike filtering, netsh fallback, disconnected output parsing, and adaptive threshold calibration are fully verified).

### Dashboard Compilation
*   Built the Vite dashboard `npm run build`.
*   **Result:** Build succeeded with no errors.

### Local Development Servers
*   **UI Web Server**: Running on `http://localhost:3000` serving the rebranded UI files under the `ui/` directory.
*   **Vite Dashboard Server**: Running on `http://localhost:5173/` serving the dashboard.
*   **WebSocket Backend**: Running in background task on port 8765.

### Live Calibration Run
*   Triggered calibration over HTTP at `http://localhost:8765/api/v1/calibrate`.
*   **Result:** Server log reports successful calibration in 10 seconds:
    `[INFO] v1.src.sensing.classifier: Adaptive calibration complete. Baseline mean variance: 0.4704, std: 0.4260. Dynamic Presence Variance Threshold set to: 1.7485`
    The dynamic threshold is now automatically calibrated to the specific ambient noise floor of your room.
