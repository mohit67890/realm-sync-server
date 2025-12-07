# Multi-Provider Authentication - Environment Configuration Examples

## JWT-Only Configuration

```bash
# Server
MONGODB_URI=mongodb://localhost:27017/syncdb
WEB_PUBSUB_CONNECTION_STRING=your-web-pubsub-connection-string
WEB_PUBSUB_HUB_NAME=sync-hub
AUTH_JWT_SECRET=your-super-secret-jwt-key
NODE_ENV=production
AUTH_MODE=jwt-only
```

## Firebase-Only Configuration

```bash
# Server
MONGODB_URI=mongodb://localhost:27017/syncdb
WEB_PUBSUB_CONNECTION_STRING=your-web-pubsub-connection-string
WEB_PUBSUB_HUB_NAME=sync-hub
NODE_ENV=production
AUTH_MODE=firebase-only

# Firebase credentials - Choose one method:

# Method 1: Base64 encoded service account JSON
FIREBASE_ADMIN_CREDENTIALS_B64=eyJ0eXBlIjoic2VydmljZV9hY2NvdW50IiwicHJvamVjdF9pZCI6Im15LWFwcCIsLi4ufQ==

# Method 2: File path
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json

# Method 3: JSON string
FIREBASE_ADMIN_CREDENTIALS='{"type":"service_account","project_id":"my-app",...}'
```

## JWT + Firebase Fallback Configuration

```bash
# Server
MONGODB_URI=mongodb://localhost:27017/syncdb
WEB_PUBSUB_CONNECTION_STRING=your-web-pubsub-connection-string
WEB_PUBSUB_HUB_NAME=sync-hub
NODE_ENV=production
AUTH_MODE=jwt-firebase-fallback

# JWT
AUTH_JWT_SECRET=your-super-secret-jwt-key

# Firebase (choose one)
FIREBASE_ADMIN_CREDENTIALS_B64=eyJ0eXBlIjoic2VydmljZV9hY2NvdW50IiwicHJvamVjdF9pZCI6Im15LWFwcCIsLi4ufQ==
# OR
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
```

## Custom API Key Provider Configuration

```bash
# Server
MONGODB_URI=mongodb://localhost:27017/syncdb
WEB_PUBSUB_CONNECTION_STRING=your-web-pubsub-connection-string
WEB_PUBSUB_HUB_NAME=sync-hub
NODE_ENV=production
AUTH_MODE=custom

# Custom provider
VALID_API_KEYS=key1,key2,key3

# Also support JWT fallback
AUTH_JWT_SECRET=your-super-secret-jwt-key
```

## Multi-Factor Auth Configuration

```bash
# Server
MONGODB_URI=mongodb://localhost:27017/syncdb
WEB_PUBSUB_CONNECTION_STRING=your-web-pubsub-connection-string
WEB_PUBSUB_HUB_NAME=sync-hub
NODE_ENV=production
AUTH_MODE=multi-factor

# Both JWT and Firebase required
AUTH_JWT_SECRET=your-super-secret-jwt-key
FIREBASE_ADMIN_CREDENTIALS_B64=eyJ0eXBlIjoic2VydmljZV9hY2NvdW50IiwicHJvamVjdF9pZCI6Im15LWFwcCIsLi4ufQ==
```

## Development Configuration (Anonymous Allowed)

```bash
# Server
MONGODB_URI=mongodb://localhost:27017/syncdb
WEB_PUBSUB_CONNECTION_STRING=your-web-pubsub-connection-string
WEB_PUBSUB_HUB_NAME=sync-hub
NODE_ENV=development
AUTH_MODE=jwt-firebase-fallback

# Optional: Auth providers (will allow anonymous if not provided)
# AUTH_JWT_SECRET=your-jwt-secret
# FIREBASE_ADMIN_CREDENTIALS_B64=...
```

## Rate Limiting Configuration

```bash
# Rate limiting (optional)
RATE_LIMIT_DISABLED=0  # 1 to disable
SYNC_RATE_LIMIT_MAX=50  # Max changes per window
SYNC_RATE_LIMIT_WINDOW_MS=10000  # 10 seconds
MAX_CONNECTIONS_PER_USER=10
MAX_CONNECTIONS_PER_IP=50
```

## Complete Production Example

```bash
# Application
NODE_ENV=production
APP_VERSION=1.0.0
PORT=3000

# Database
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/syncdb?retryWrites=true&w=majority

# Azure Web PubSub
WEB_PUBSUB_CONNECTION_STRING=Endpoint=https://your-pubsub.webpubsub.azure.com;AccessKey=your-key;Version=1.0;
WEB_PUBSUB_HUB_NAME=sync-hub

# Authentication Mode
AUTH_MODE=jwt-firebase-fallback

# JWT Authentication
AUTH_JWT_SECRET=your-super-secret-256-bit-key-here

# Firebase Authentication
FIREBASE_ADMIN_CREDENTIALS_B64=eyJ0eXBlIjoic2VydmljZV9hY2NvdW50IiwicHJvamVjdF9pZCI6Im15LWFwcCIsInByaXZhdGVfa2V5X2lkIjoiMTIzNDU2Nzg5MCIsInByaXZhdGVfa2V5IjoiLS0tLS1CRUdJTiBQUklWQVRFIEtFWS0tLS0tXG5NSUlFdlFJQkFEQU5CZ2txaGtpRzl3MEJBUUVGQUFTQ0JLY3dnZ1NqQWdFQUFvSUJBUUM4c2VjcmV0XG4tLS0tLUVORCBQUklWQVRFIEtFWS0tLS0tXG4iLCJjbGllbnRfZW1haWwiOiJmaXJlYmFzZS1hZG1pbnNkay0xMjM0NUBteS1hcHAuaWFtLmdzZXJ2aWNlYWNjb3VudC5jb20iLCJjbGllbnRfaWQiOiIxMjM0NTY3ODkwIiwiYXV0aF91cmkiOiJodHRwczovL2FjY291bnRzLmdvb2dsZS5jb20vby9vYXV0aDIvYXV0aCIsInRva2VuX3VyaSI6Imh0dHBzOi8vb2F1dGgyLmdvb2dsZWFwaXMuY29tL3Rva2VuIiwiYXV0aF9wcm92aWRlcl94NTA5X2NlcnRfdXJsIjoiaHR0cHM6Ly93d3cuZ29vZ2xlYXBpcy5jb20vb2F1dGgyL3YxL2NlcnRzIiwiY2xpZW50X3g1MDlfY2VydF91cmwiOiJodHRwczovL3d3dy5nb29nbGVhcGlzLmNvbS9yb2JvdC92MS9tZXRhZGF0YS94NTA5L2ZpcmViYXNlLWFkbWluc2RrLTEyMzQ1JTQwbXktYXBwLmlhbS5nc2VydmljZWFjY291bnQuY29tIn0=

# CORS
ALLOWED_ORIGINS=https://myapp.com,https://www.myapp.com

# Rate Limiting
SYNC_RATE_LIMIT_MAX=100
SYNC_RATE_LIMIT_WINDOW_MS=10000
MAX_CONNECTIONS_PER_USER=5
MAX_CONNECTIONS_PER_IP=25

# Broadcasting
BROADCAST_TO_SENDER=false
```

## Client Connection Examples

### JWT Client (Socket.IO)

```javascript
import { io } from "socket.io-client";

const socket = io("https://sync.myapp.com", {
  auth: {
    token: userJwtToken,
  },
  transports: ["websocket"],
});
```

### Firebase Client (Socket.IO)

```javascript
import { io } from "socket.io-client";
import { getAuth } from "firebase/auth";

const auth = getAuth();
const idToken = await auth.currentUser.getIdToken();

const socket = io("https://sync.myapp.com", {
  query: {
    idToken: idToken,
    uuid: auth.currentUser.uid, // Fallback
  },
  transports: ["websocket"],
});
```

### API Key Client (Custom Provider)

```javascript
import { io } from "socket.io-client";

const socket = io("https://sync.myapp.com", {
  query: {
    apiKey: "my-secret-api-key",
  },
  transports: ["websocket"],
});
```

### Multi-Factor Client (JWT + Firebase)

```javascript
import { io } from "socket.io-client";
import { getAuth } from "firebase/auth";

const auth = getAuth();
const idToken = await auth.currentUser.getIdToken();

const socket = io("https://sync.myapp.com", {
  auth: {
    token: userJwtToken, // JWT
  },
  query: {
    idToken: idToken, // Firebase ID token
  },
  transports: ["websocket"],
});
```

### Anonymous Client (Development Only)

```javascript
import { io } from "socket.io-client";

const socket = io("http://localhost:3000", {
  query: {
    uuid: "user-12345", // Generates anon-xxx userId
  },
  transports: ["websocket"],
});
```

## Flutter Client Examples

### JWT Client

```dart
import 'package:socket_io_client/socket_io_client.dart' as IO;

final socket = IO.io('https://sync.myapp.com',
  IO.OptionBuilder()
    .setTransports(['websocket'])
    .setAuth({'token': userJwtToken})
    .build()
);

socket.connect();
```

### Firebase Client

```dart
import 'package:socket_io_client/socket_io_client.dart' as IO;
import 'package:firebase_auth/firebase_auth.dart';

final user = FirebaseAuth.instance.currentUser;
final idToken = await user?.getIdToken();

final socket = IO.io('https://sync.myapp.com',
  IO.OptionBuilder()
    .setTransports(['websocket'])
    .setQuery({'idToken': idToken, 'uuid': user?.uid})
    .build()
);

socket.connect();
```

## Testing

### Test JWT Token Generation

```bash
# Install jwt-cli
npm install -g jwt-cli

# Generate test token
jwt encode --secret "your-jwt-secret" '{"sub":"user123","iat":1234567890}'
```

### Test Firebase Connection

```bash
# Use Firebase CLI to get ID token
firebase login
firebase auth:export --project your-project-id
```

### Test With cURL

```bash
# Test negotiate endpoint
curl http://localhost:3000/api/negotiate \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Test health endpoint
curl http://localhost:3000/health

# Test stats endpoint
curl http://localhost:3000/stats
```

## Troubleshooting

### Check Provider Status

```bash
# Start server and check logs for enabled providers
npm start

# Look for line:
# 🔐 Auth Providers: jwt, firebase
```

### Debug Auth Failures

```javascript
socket.on("connect_error", (err) => {
  console.error("Connection failed:", err.message);
  // Check: Token format, expiration, provider configuration
});
```

### Verify Environment Variables

```bash
# Print loaded env vars (exclude secrets in production)
node -e "console.log(process.env)"
```
