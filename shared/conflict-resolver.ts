import { Change, ConflictResolutionStrategy } from "./types";

/**
 * Last Write Wins - Change with higher timestamp wins
 */
export class LastWriteWinsResolver implements ConflictResolutionStrategy {
  resolve(local: Change, remote: Change): Change {
    return local.timestamp > remote.timestamp ? local : remote;
  }
}

/**
 * Client Wins - Local client's changes always win
 */
export class ClientWinsResolver implements ConflictResolutionStrategy {
  constructor(private clientUserId: string) {}

  resolve(local: Change, remote: Change): Change {
    return local.userId === this.clientUserId ? local : remote;
  }
}

/**
 * Server Wins - Remote (server) changes always win
 */
export class ServerWinsResolver implements ConflictResolutionStrategy {
  resolve(local: Change, remote: Change): Change {
    return remote;
  }
}

/**
 * Custom resolver - allows application-specific logic
 */
export class CustomResolver implements ConflictResolutionStrategy {
  constructor(private resolverFn: (local: Change, remote: Change) => Change) {}

  resolve(local: Change, remote: Change): Change {
    return this.resolverFn(local, remote);
  }
}
