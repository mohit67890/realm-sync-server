# Azure Web App Deployment Guide

## Prerequisites

1. **Azure CLI**: Install from https://docs.microsoft.com/en-us/cli/azure/install-azure-cli
2. **Azure Subscription**: Active Azure subscription
3. **MongoDB Atlas**: Database connection string
4. **Azure Web PubSub**: Service connection string

## Option 1: Deploy via Azure CLI (Recommended)

### Step 1: Login to Azure

```bash
az login
```

### Step 2: Create Resource Group (if not exists)

```bash
az group create \
  --name emotionly-rg \
  --location eastus
```

### Step 3: Create App Service Plan

```bash
az appservice plan create \
  --name emotionly-plan \
  --resource-group emotionly-rg \
  --sku B1 \
  --is-linux
```

### Step 4: Create Web App

```bash
az webapp create \
  --name emotionly-sync-server \
  --resource-group emotionly-rg \
  --plan emotionly-plan \
  --runtime "NODE:18-lts"
```

### Step 5: Configure Environment Variables

```bash
az webapp config appsettings set \
  --name emotionly-sync-server \
  --resource-group emotionly-rg \
  --settings \
    MONGODB_URI="<your-mongodb-connection-string>" \
    WEB_PUBSUB_CONNECTION_STRING="<your-pubsub-connection-string>" \
    WEB_PUBSUB_HUB_NAME="sync-hub" \
    AUTH_JWT_SECRET="<your-jwt-secret>" \
    PORT="8080" \
    NODE_ENV="production" \
    WEBSITE_NODE_DEFAULT_VERSION="18-lts" \
    SCM_DO_BUILD_DURING_DEPLOYMENT="true"
```

### Step 6: Configure Startup Command

```bash
az webapp config set \
  --name emotionly-sync-server \
  --resource-group emotionly-rg \
  --startup-file "node dist/server/emo-server.js"
```

### Step 7: Deploy from Local Git

```bash
# Configure local git deployment
az webapp deployment source config-local-git \
  --name emotionly-sync-server \
  --resource-group emotionly-rg

# Get deployment credentials
az webapp deployment list-publishing-credentials \
  --name emotionly-sync-server \
  --resource-group emotionly-rg \
  --query "{username:publishingUserName, password:publishingPassword}"

# Add Azure remote to your git
git remote add azure <git-url-from-previous-command>

# Push to deploy
git push azure main
```

### Step 8: Enable WebSockets

```bash
az webapp config set \
  --name emotionly-sync-server \
  --resource-group emotionly-rg \
  --web-sockets-enabled true
```

## Option 2: Deploy via GitHub Actions

### Step 1: Get Publish Profile

```bash
az webapp deployment list-publishing-profiles \
  --name emotionly-sync-server \
  --resource-group emotionly-rg \
  --xml
```

### Step 2: Add Secret to GitHub

1. Go to your GitHub repository
2. Navigate to Settings → Secrets and variables → Actions
3. Add new secret: `AZURE_WEBAPP_PUBLISH_PROFILE`
4. Paste the XML content from Step 1

### Step 3: Create Workflow File

Create `.github/workflows/azure-deploy.yml` (see file below)

### Step 4: Configure Secrets in GitHub

Add these secrets in GitHub repository settings:

- `AZURE_WEBAPP_PUBLISH_PROFILE` (from Step 1)
- `MONGODB_URI`
- `WEB_PUBSUB_CONNECTION_STRING`
- `AUTH_JWT_SECRET`

## Option 3: Deploy via VS Code

### Step 1: Install Azure App Service Extension

Install the "Azure App Service" extension in VS Code

### Step 2: Sign in to Azure

Click the Azure icon and sign in

### Step 3: Deploy

1. Right-click the `sync-implementation` folder
2. Select "Deploy to Web App"
3. Choose your subscription and web app
4. Confirm deployment

### Step 4: Configure Settings

After deployment, go to Azure Portal → App Service → Configuration and add environment variables

## Post-Deployment Steps

### 1. Verify Deployment

```bash
# Check logs
az webapp log tail \
  --name emotionly-sync-server \
  --resource-group emotionly-rg

# Check app status
az webapp show \
  --name emotionly-sync-server \
  --resource-group emotionly-rg \
  --query "state"
```

### 2. Test Health Endpoint

```bash
curl https://emotionly-sync-server.azurewebsites.net/health
```

### 3. Enable Application Insights (Optional)

```bash
az monitor app-insights component create \
  --app emotionly-sync-insights \
  --location eastus \
  --resource-group emotionly-rg

az webapp config appsettings set \
  --name emotionly-sync-server \
  --resource-group emotionly-rg \
  --settings APPLICATIONINSIGHTS_CONNECTION_STRING="<connection-string>"
```

## Troubleshooting

### Check Logs

```bash
# Stream logs
az webapp log tail \
  --name emotionly-sync-server \
  --resource-group emotionly-rg

# Download logs
az webapp log download \
  --name emotionly-sync-server \
  --resource-group emotionly-rg \
  --log-file logs.zip
```

### Common Issues

1. **Build Fails**: Ensure `SCM_DO_BUILD_DURING_DEPLOYMENT=true` is set
2. **App Won't Start**: Check startup command and Node version
3. **WebSocket Issues**: Ensure WebSockets are enabled
4. **Environment Variables**: Verify all required env vars are set

### Restart App

```bash
az webapp restart \
  --name emotionly-sync-server \
  --resource-group emotionly-rg
```

## Cost Optimization

- **B1 Tier**: ~$13/month (Basic, 1 instance)
- **S1 Tier**: ~$70/month (Standard, auto-scaling)
- **P1v2 Tier**: ~$146/month (Premium, production)

## Security Best Practices

1. Use Azure Key Vault for secrets
2. Enable HTTPS only
3. Configure CORS appropriately
4. Enable managed identity
5. Set up Application Insights for monitoring

## Scaling

### Manual Scale

```bash
az appservice plan update \
  --name emotionly-plan \
  --resource-group emotionly-rg \
  --number-of-workers 2
```

### Auto-scale (requires S1 or higher)

```bash
az monitor autoscale create \
  --resource emotionly-plan \
  --resource-group emotionly-rg \
  --resource-type Microsoft.Web/serverfarms \
  --min-count 1 \
  --max-count 5 \
  --count 1
```

## Environment Variables Reference

| Variable                         | Required    | Description                          |
| -------------------------------- | ----------- | ------------------------------------ |
| `MONGODB_URI`                    | Yes         | MongoDB connection string            |
| `WEB_PUBSUB_CONNECTION_STRING`   | Yes         | Azure Web PubSub connection string   |
| `WEB_PUBSUB_HUB_NAME`            | Yes         | Hub name (e.g., "sync-hub")          |
| `AUTH_JWT_SECRET`                | Recommended | JWT secret for authentication        |
| `PORT`                           | No          | Port number (default: 8080 on Azure) |
| `NODE_ENV`                       | No          | Environment (set to "production")    |
| `FIREBASE_ADMIN_CREDENTIALS_B64` | Optional    | Base64 Firebase credentials          |

## Useful Commands

```bash
# View app details
az webapp show --name emotionly-sync-server --resource-group emotionly-rg

# List all environment variables
az webapp config appsettings list --name emotionly-sync-server --resource-group emotionly-rg

# Delete environment variable
az webapp config appsettings delete --name emotionly-sync-server --resource-group emotionly-rg --setting-names PORT

# Stop app
az webapp stop --name emotionly-sync-server --resource-group emotionly-rg

# Start app
az webapp start --name emotionly-sync-server --resource-group emotionly-rg

# Delete app (careful!)
az webapp delete --name emotionly-sync-server --resource-group emotionly-rg
```
