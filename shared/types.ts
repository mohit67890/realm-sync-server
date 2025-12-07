/**
 * Core types for the sync system
 */

export interface Change {
  id: string;
  userId: string;
  timestamp: number;
  operation: "insert" | "update" | "delete";
  collection: string;
  documentId: string;
  data?: any;
  changeset?: string; // Base64-encoded Realm binary changeset (optional, for advanced sync)
  version?: number;
  synced?: boolean;
}

export interface SyncRequest {
  userId: string;
  since: number;
  limit?: number;
}

export interface SyncResponse {
  changes?: Change[]; // Optional: changes sent via individual emits to stay under 1MB
  latestTimestamp: number;
  hasMore: boolean;
  count?: number; // Number of changes sent (when changes not included in response)
  error?: string; // Error message if request failed
}

export interface ChangeAck {
  changeId: string;
  success: boolean;
  timestamp?: number;
  error?: string;
}

export interface SyncState {
  userId: string;
  lastSyncTimestamp: number;
  pendingChanges: Change[];
  updatedAt: number;
}

export interface ConflictResolutionStrategy {
  resolve(local: Change, remote: Change): Change;
}

// FLX Subscription Types
export interface Subscription {
  id: string;
  name?: string;
  collection: string;
  query: string; // RQL query string or "TRUEPREDICATE"
  version: number;
  state: "pending" | "bootstrapping" | "complete" | "error";
  createdAt: number;
  updatedAt: number;
}

export interface SubscriptionSet {
  userId: string;
  version: number;
  subscriptions: Subscription[];
  updatedAt: number;
}

export interface UpdateSubscriptionsRequest {
  subscriptions: Array<{
    collection: string;
    query: string;
    name?: string;
  }>;
}

export interface BootstrapData {
  subscription: string;
  collection: string;
  data: any[];
  hasMore: boolean;
}
