# Goal: Add a 2D Floor Plan Heatmap Overlay (House Structural Radar)

This plan details the addition of a 2D Floor Plan Heatmap panel to the AetherSense Observatory. The heatmap will display a 2D architectural blueprint of the house (walls, doors, room boundaries) overlaid with real-time RF heat intensity zones driven by live or demo signal field data.

## User Review Required

> [!IMPORTANT]
> * We will add a new visual panel `#panel-floorplan` on the bottom-left of the AetherSense Observatory screen.
> * The panel renders a 2D canvas depicting four rooms: **Office**, **Bedroom 1**, **Living Room**, and **Bedroom 2**, along with open door indicators and labeled boundaries.
> * A 20x20 grid of real-time signal intensity heat zones will be overlaid on top of this blueprint.
> * Tracked people will be displayed as pulsing orange/red radar blips moving across the map in sync with their 3D positions.

## Proposed Changes

---

### 1. HTML Overlay

#### [MODIFY] [observatory.html](file:///C:/Users/Sachi/Desktop/AetherSense/ui/observatory.html)
* Insert a new `#panel-floorplan` container right below `#panel-vitals` on the left side of the screen.
* Inside the panel, add a canvas element `<canvas id="floorplan-canvas" width="200" height="150"></canvas>`.

---

### 2. Stylesheet Layout

#### [MODIFY] [observatory.css](file:///C:/Users/Sachi/Desktop/AetherSense/ui/observatory/css/observatory.css)
* Adjust `#panel-vitals` positioning to float at `top: 115px` instead of `top: 50%` (removing the vertical center transform).
* Add style rules for `#panel-floorplan` at `bottom: 74px; left: 28px;` to balance the layout.
* Add CSS styling for `.floorplan-container` and `#floorplan-canvas` to fit the warm dark neon glow palette.

---

### 3. Canvas Rendering Logic

#### [MODIFY] [hud-controller.js](file:///C:/Users/Sachi/Desktop/AetherSense/ui/observatory/js/hud-controller.js)
* In the constructor:
  * Cache `this._floorplanCanvas = document.getElementById('floorplan-canvas')`.
  * Cache `this._floorplanCtx = this._floorplanCanvas?.getContext('2d')`.
* Implement a new method `updateFloorplan(data)`:
  * Clear the canvas on every tick.
  * Draw the live 20x20 signal field values as colored rectangles (blue for quiet, cyan/green for moderate, orange/red for high activity).
  * Draw 2D structural lines representing outer walls, inner walls, and door swing arcs.
  * Draw text labels for rooms (Office, Bedroom 1, Living Room, Bedroom 2).
  * Draw TX and RX node coordinates on the map.
  * Loop through the tracked `persons` list and draw them as pulsing radar blips with identification tags (`P0`, `P1`, etc.).
* In `updateHUD(data, demoData)`, call `this.updateFloorplan(data)`.

---

## Verification Plan

### Manual Verification
1. Start the WebSocket server and UI server.
2. Load `http://localhost:3000/observatory.html` in Chrome.
3. Verify that the brand new "House Structural Radar" card displays on the bottom-left of the screen.
4. Verify that switching scenarios dynamically changes the heatmap intensity zones across the rooms (e.g. high heat in the bedroom during sleep monitoring, high heat in the living room during two-person walking).
5. Verify that tracked people appear as pulsing radar dots in the correct rooms.
