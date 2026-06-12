#!/bin/bash

# AetherSense UI Startup Script
# This script starts the UI on port 3000

echo "🚀 Starting AetherSense UI..."
echo ""
echo "📋 Configuration:"
echo "   - UI Server: http://localhost:3000"
echo "   - Backend API: http://localhost:8765 (make sure it's running)"
echo "   - Test Runner: http://localhost:3000/tests/test-runner.html"
echo "   - Integration Tests: http://localhost:3000/tests/integration-test.html"
echo ""

# Check if port 3000 is already in use
if lsof -Pi :3000 -sTCP:LISTEN -t >/dev/null ; then
    echo "⚠️  Port 3000 is already in use. Please stop the existing server or use a different port."
    echo "   You can manually start with: python -m http.server 3001"
    exit 1
fi

# Check if WebSocket backend is running on port 8765
if lsof -Pi :8765 -sTCP:LISTEN -t >/dev/null ; then
    echo "✅ Sensing backend detected on port 8765"
else
    echo "⚠️  Sensing backend not detected on port 8765"
    echo "   Please start it with: cd archive && python -m v1.src.sensing.ws_server"
    echo ""
    echo "   The UI will still work with the client-side mock/simulated fallback."
fi

echo ""
echo "🌐 Starting HTTP server on port 3000..."
echo "   Press Ctrl+C to stop"
echo ""

# Start the HTTP server
python -m http.server 3000