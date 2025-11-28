#!/bin/bash

# MongoDB Setup Helper Script

echo "🍃 MongoDB Setup Helper"
echo "======================"
echo ""

# Check if MongoDB is installed
if command -v mongod &> /dev/null; then
    echo "✅ MongoDB installed: $(mongod --version | head -n1)"
    MONGOD_PATH=$(which mongod)
    echo "   Location: $MONGOD_PATH"
else
    echo "❌ MongoDB is not installed."
    echo ""
    echo "📥 Installation options:"
    echo ""
    echo "macOS (Homebrew):"
    echo "  brew tap mongodb/brew"
    echo "  brew install mongodb-community"
    echo ""
    echo "Ubuntu/Debian:"
    echo "  sudo apt-get install mongodb"
    echo ""
    echo "Windows:"
    echo "  Download from: https://www.mongodb.com/try/download/community"
    echo ""
    exit 1
fi

echo ""
echo "📁 Checking data directory..."

# Default data directory
DATA_DIR="${HOME}/mongodb-data"

if [ ! -d "$DATA_DIR" ]; then
    echo "Creating data directory: $DATA_DIR"
    mkdir -p "$DATA_DIR"
else
    echo "✅ Data directory exists: $DATA_DIR"
fi

echo ""
echo "🚀 Starting MongoDB..."
echo "   Data directory: $DATA_DIR"
echo "   Port: 27017"
echo ""
echo "   Press Ctrl+C to stop MongoDB"
echo ""

# Start MongoDB
mongod --dbpath "$DATA_DIR" --port 27017

# Note: This will block until Ctrl+C
