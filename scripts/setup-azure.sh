#!/bin/bash

# Azure Web PubSub Setup Script

set -e

echo "☁️  Azure Web PubSub Setup"
echo "=========================="
echo ""

# Check if Azure CLI is installed
if ! command -v az &> /dev/null; then
    echo "❌ Azure CLI is not installed."
    echo "   Install from: https://docs.microsoft.com/en-us/cli/azure/install-azure-cli"
    exit 1
fi

echo "✅ Azure CLI found: $(az version --query '\"azure-cli\"' -o tsv)"
echo ""

# Login check
echo "🔐 Checking Azure login status..."
if ! az account show &> /dev/null; then
    echo "Please login to Azure:"
    az login
else
    ACCOUNT=$(az account show --query name -o tsv)
    echo "✅ Logged in as: $ACCOUNT"
fi

echo ""
read -p "Enter resource group name [sync-demo-rg]: " RESOURCE_GROUP
RESOURCE_GROUP=${RESOURCE_GROUP:-sync-demo-rg}

read -p "Enter Web PubSub service name [sync-demo-pubsub]: " PUBSUB_NAME
PUBSUB_NAME=${PUBSUB_NAME:-sync-demo-pubsub}

read -p "Enter location [eastus]: " LOCATION
LOCATION=${LOCATION:-eastus}

read -p "Enter hub name [sync-hub]: " HUB_NAME
HUB_NAME=${HUB_NAME:-sync-hub}

echo ""
echo "📋 Configuration:"
echo "   Resource Group: $RESOURCE_GROUP"
echo "   PubSub Name: $PUBSUB_NAME"
echo "   Location: $LOCATION"
echo "   Hub Name: $HUB_NAME"
echo ""
read -p "Continue? (y/n): " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Cancelled."
    exit 0
fi

echo ""
echo "🏗️  Creating resource group..."
az group create \
  --name "$RESOURCE_GROUP" \
  --location "$LOCATION" \
  --output table

echo ""
echo "🔧 Creating Web PubSub service (this may take a few minutes)..."
az webpubsub create \
  --name "$PUBSUB_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --location "$LOCATION" \
  --sku Free_F1 \
  --output table

echo ""
echo "🔑 Getting connection string..."
CONNECTION_STRING=$(az webpubsub key show \
  --name "$PUBSUB_NAME" \
  --resource-group "$RESOURCE_GROUP" \
  --query primaryConnectionString \
  --output tsv)

echo ""
echo "✅ Azure Web PubSub setup complete!"
echo ""
echo "📝 Update your .env file with:"
echo ""
echo "WEB_PUBSUB_CONNECTION_STRING=$CONNECTION_STRING"
echo "WEB_PUBSUB_HUB_NAME=$HUB_NAME"
echo ""
echo "💡 To update .env automatically, run:"
echo "   echo 'WEB_PUBSUB_CONNECTION_STRING=$CONNECTION_STRING' >> .env"
echo "   echo 'WEB_PUBSUB_HUB_NAME=$HUB_NAME' >> .env"
echo ""
