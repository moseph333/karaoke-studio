#!/usr/bin/env bash
set -e

# YouTube Karaoke Studio Launcher Script
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_DIR"

echo "=================================================="
echo "    🎤 Launching YouTube Karaoke Studio           "
echo "=================================================="

# 1. Verify FFmpeg installation
if ! command -v ffmpeg &> /dev/null; then
    echo "❌ Error: ffmpeg is not installed on this system."
    echo "Please install ffmpeg (e.g., sudo dnf install ffmpeg or sudo apt install ffmpeg)"
    exit 1
fi
echo "✅ FFmpeg detected: $(ffmpeg -version | head -n 1)"

# 2. Check Python environment
if [ -d "$PROJECT_DIR/venv" ]; then
    PYTHON="$PROJECT_DIR/venv/bin/python"
elif command -v python3.12 &> /dev/null; then
    echo "Creating virtual environment using python3.12..."
    python3.12 -m venv venv
    PYTHON="$PROJECT_DIR/venv/bin/python"
elif command -v python3 &> /dev/null; then
    echo "Creating virtual environment using python3..."
    python3 -m venv venv
    PYTHON="$PROJECT_DIR/venv/bin/python"
else
    echo "❌ Error: Python 3 is required."
    exit 1
fi

echo "✅ Using Python: $($PYTHON --version)"

# 3. Check and build frontend if needed
if [ ! -d "$PROJECT_DIR/frontend/dist" ]; then
    echo "📦 Building frontend UI..."
    if command -v npm &> /dev/null; then
        (cd "$PROJECT_DIR/frontend" && npm install && npm run build)
    else
        echo "⚠️ Warning: npm not found. Frontend dist not built."
    fi
fi

# 4. Start FastAPI server
echo "🚀 Starting server at http://localhost:8000 ..."

# Attempt to open browser in background after 1.5 seconds
(sleep 2 && ($PYTHON -m webbrowser "http://localhost:8000" 2>/dev/null || xdg-open "http://localhost:8000" 2>/dev/null || true)) &

exec $PYTHON -m uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload --reload-dir "$PROJECT_DIR/backend"
