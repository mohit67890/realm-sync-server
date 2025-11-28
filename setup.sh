#!/bin/bash

# Quick Start Script for Sync Demo
# This script sets up and starts the sync demo

set -e

echo "🚀 Sync Demo Quick Start"
echo "========================"
echo ""

# Check prerequisites
echo "📋 Checking prerequisites..."

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18+ first."
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo "❌ Node.js version must be 18 or higher. Current: $(node -v)"
    exit 1
fi
echo "✅ Node.js $(node -v)"

# Check npm
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed."
    exit 1
fi
echo "✅ npm $(npm -v)"

# Check MongoDB
if ! command -v mongosh &> /dev/null && ! command -v mongo &> /dev/null; then
    echo "⚠️  MongoDB CLI not found. Make sure MongoDB is running."
    echo "   You can install MongoDB from: https://www.mongodb.com/try/download/community"
else
    echo "✅ MongoDB CLI found"
fi

echo ""
echo "📦 Installing dependencies..."
npm install

echo ""
echo "⚙️  Setting up environment..."

if [ ! -f .env ]; then
    echo "Creating .env file from .env.example..."
    cp .env.example .env
    echo ""
    echo "⚠️  IMPORTANT: Edit .env file with your settings:"
    echo "   1. MONGODB_URI - Your MongoDB connection string"
    echo "   2. WEB_PUBSUB_CONNECTION_STRING - Your Azure Web PubSub connection string"
    echo "   3. WEB_PUBSUB_HUB_NAME - Your hub name"
    echo ""
    echo "   For Azure Web PubSub setup, run:"
    echo "   ./scripts/setup-azure.sh"
    echo ""
    read -p "Press Enter when you've updated .env file..."
else
    echo "✅ .env file exists"
fi

echo ""
echo "🔧 Building TypeScript..."
npm run build

echo ""
echo "✅ Setup complete!"
echo ""
echo "📚 Next steps:"
echo ""
echo "1. Start MongoDB (if not running):"
echo "   mongod --dbpath /path/to/data"
echo ""
echo "2. Start the sync server:"
echo "   npm run dev:server"
echo ""
echo "3. In a new terminal, run a client:"
echo "   npm run dev:client"
echo ""
echo "4. In another terminal, run a second client:"
echo "   ts-node client/example.ts demo-user-2"
echo ""
echo "💡 For detailed instructions, see:"
echo "   - IMPLEMENTATION_GUIDE.md (step-by-step)"
echo "   - README.md (quick reference)"
echo ""
