import { Change } from "./types";
import { QueryTranslator } from "../server/query-translator";
import { Socket } from "socket.io";

/**
 * Configuration for subscription matching
 */
export interface SubscriptionMatchConfig {
  userSubscriptions: Map<string, any>; // userId -> SubscriptionSet
  activeConnections: Map<string, Set<string>>; // userId -> Set<socketId>
  queryTranslator: QueryTranslator;
  io?: any; // Socket.IO server instance (for transient subscriptions)
}

/**
 * Subscription matching result
 */
export interface SubscriptionMatchResult {
  shouldReceive: boolean;
  reason: string;
  matchedSubscription?: string;
  tier: "flx" | "transient" | "legacy" | "none";
}

/**
 * Shared subscription matching utilities
 * Provides consistent subscription evaluation logic for both sync-server.ts and routes.ts
 */
export class SubscriptionMatcher {
  private config: SubscriptionMatchConfig;

  constructor(config: SubscriptionMatchConfig) {
    this.config = config;
  }

  /**
   * Main entry point: Check if a user should receive a change based on their subscriptions
   *
   * Three-tier evaluation:
   * 1. FLX subscriptions (per-user, persistent in DB)
   * 2. Transient subscriptions (per-socket, temporary)
   * 3. Legacy broadcast-all (fallback when no subscriptions exist)
   */
  shouldReceiveChange(userId: string, change: Change): SubscriptionMatchResult {
    console.log(
      `🔍 [SubscriptionMatcher] Checking userId=${userId} for change ${change.collection}/${change.documentId}`
    );
    console.log(
      `🔍 [SubscriptionMatcher] userSubscriptions map size: ${this.config.userSubscriptions.size}, keys: [${Array.from(this.config.userSubscriptions.keys()).join(", ")}]`
    );

    // Tier 1: Check FLX subscriptions (per-user, stored in DB)
    const flxResult = this.checkFlxSubscriptions(userId, change);
    if (flxResult.shouldReceive !== undefined) {
      return flxResult;
    }

    // Tier 2: Check transient subscriptions (per-socket)
    const transientResult = this.checkTransientSubscriptions(userId, change);
    if (transientResult.shouldReceive !== undefined) {
      return transientResult;
    }

    // Tier 3: Legacy broadcast-all (no subscriptions)
    console.log(
      `✅ [SubscriptionMatcher] No subscriptions for userId=${userId}, broadcasting (legacy behavior)`
    );
    return {
      shouldReceive: true,
      reason: "No subscriptions - legacy broadcast-all",
      tier: "legacy",
    };
  }

  /**
   * Tier 1: Check FLX (Flexible Sync) subscriptions
   * Returns undefined shouldReceive if no FLX subscriptions exist (proceed to next tier)
   */
  private checkFlxSubscriptions(
    userId: string,
    change: Change
  ): SubscriptionMatchResult {
    const subscriptionSet = this.config.userSubscriptions?.get(userId);

    console.log(
      `🔍 [SubscriptionMatcher] FLX subscriptionSet for userId=${userId}:`,
      subscriptionSet
        ? `Found ${subscriptionSet.subscriptions?.length || 0} subscriptions (version ${subscriptionSet.version})`
        : "NULL/UNDEFINED"
    );

    // If FLX subscriptions exist and have filters, check them
    if (
      !subscriptionSet ||
      !subscriptionSet.subscriptions ||
      subscriptionSet.subscriptions.length === 0
    ) {
      return {
        shouldReceive: undefined as any,
        reason: "No FLX subscriptions",
        tier: "flx",
      };
    }

    console.log(
      `🔍 [SubscriptionMatcher] Processing ${subscriptionSet.subscriptions.length} FLX subscriptions for collection: ${change.collection}`
    );

    // Check if any FLX subscription matches this change
    for (const sub of subscriptionSet.subscriptions) {
      console.log(
        `🔍 [SubscriptionMatcher] Checking subscription: ${sub.name}, collection: ${sub.collection}, query: ${sub.query}, args: ${JSON.stringify(sub.args)}`
      );

      // Check collection match
      if (sub.collection !== change.collection) {
        console.log(
          `⏭️ [SubscriptionMatcher] Skipping subscription ${sub.name} - collection mismatch (expected: ${change.collection}, got: ${sub.collection})`
        );
        continue;
      }

      try {
        const document = change.data || { _id: change.documentId };

        // console.log(
        //   `🔍 [SubscriptionMatcher] Document to match:`,
        //   JSON.stringify(document, null, 2)
        // );

        // Handle query argument substitution
        const finalQuery = this.substituteQueryArgs(sub.query, sub.args);

        // console.log(`🔍 [SubscriptionMatcher] Matching query: ${finalQuery}`);

        // Empty or missing query means match-all
        if (!finalQuery || finalQuery.trim() === "") {
          // console.log(
          //   `✅ [SubscriptionMatcher] Empty FLX query -> match-all for subscription ${sub.name}`
          // );
          return {
            shouldReceive: true,
            reason: `FLX subscription "${sub.name}" matched (match-all)`,
            matchedSubscription: sub.name,
            tier: "flx",
          };
        }

        if (this.config.queryTranslator.matchesQuery(document, finalQuery)) {
          // console.log(
          //   `✅ [SubscriptionMatcher] FLX subscription ${sub.name} MATCHED for user ${userId}`
          // );
          return {
            shouldReceive: true,
            reason: `FLX subscription "${sub.name}" matched query: ${finalQuery}`,
            matchedSubscription: sub.name,
            tier: "flx",
          };
        } else {
          console.log(
            `❌ [SubscriptionMatcher] Subscription ${sub.name} did NOT match`
          );
        }
      } catch (error) {
        console.warn(
          `⚠️ [SubscriptionMatcher] Error evaluating query for subscription ${sub.name}:`,
          error
        );
        // On error, be permissive and send the change
        return {
          shouldReceive: true,
          reason: `FLX subscription "${sub.name}" evaluation error (permissive)`,
          matchedSubscription: sub.name,
          tier: "flx",
        };
      }
    }

    // FLX subscriptions exist but none matched
    console.log(
      `❌ [SubscriptionMatcher] NO FLX subscriptions matched for user ${userId}`
    );
    return {
      shouldReceive: false,
      reason: "FLX subscriptions exist but none matched",
      tier: "flx",
    };
  }

  /**
   * Tier 2: Check transient subscriptions (per-socket, temporary)
   * Returns undefined shouldReceive if no active connections exist (proceed to next tier)
   */
  private checkTransientSubscriptions(
    userId: string,
    change: Change
  ): SubscriptionMatchResult {
    const userSockets = this.config.activeConnections.get(userId);

    if (!userSockets || userSockets.size === 0) {
      return {
        shouldReceive: undefined as any,
        reason: "No active connections",
        tier: "transient",
      };
    }

    // console.log(
    //   `🔍 [SubscriptionMatcher] Checking transient subscriptions for ${userSockets.size} socket(s) of userId=${userId}`
    // );

    // Check each socket's transient subscriptions
    for (const socketId of userSockets) {
      const matchResult = this.matchesTransientForSocket(socketId, change);
      if (matchResult.matched) {
        // console.log(
        //   `✅ [SubscriptionMatcher] Transient subscription matched on socket ${socketId} for userId=${userId}`
        // );
        return {
          shouldReceive: true,
          reason: `Transient subscription matched on socket ${socketId}`,
          tier: "transient",
        };
      }
    }

    console.log(
      `❌ [SubscriptionMatcher] No transient subscriptions matched for userId=${userId}`
    );
    return {
      shouldReceive: false,
      reason: "Transient subscriptions exist but none matched",
      tier: "transient",
    };
  }

  /**
   * Check if a specific socket's transient subscriptions match the change
   */
  private matchesTransientForSocket(
    socketId: string,
    change: Change
  ): { matched: boolean; reason?: string } {
    try {
      if (!this.config.io) {
        return { matched: false, reason: "Socket.IO instance not available" };
      }

      const socket = this.config.io.sockets.sockets.get(socketId);
      if (!socket) {
        return { matched: false, reason: "Socket not found" };
      }

      // Get transient subscriptions from socket
      const subs: Map<string, Array<{ query: string; args?: any[] }>> = (socket
        .data?.transientSubscriptions as any) ||
      (socket as any).transientSubscriptions;

      if (!subs || subs.size === 0) {
        return { matched: false, reason: "No transient subscriptions" };
      }

      const list = subs.get(change.collection);
      if (!list || list.length === 0) {
        return { matched: false, reason: "No subscriptions for collection" };
      }

      const doc = change.data || { _id: change.documentId };

      for (const s of list) {
        try {
          // Empty query means match-all
          if (!s.query || s.query.trim() === "") {
            return {
              matched: true,
              reason: "Match-all transient subscription",
            };
          }

          // Substitute args into query
          const finalQuery = this.substituteQueryArgs(s.query, s.args);

          if (this.config.queryTranslator?.matchesQuery(doc, finalQuery)) {
            return { matched: true, reason: `Matched query: ${finalQuery}` };
          }
        } catch (e) {
          console.warn(
            `⚠️ [SubscriptionMatcher] Transient subscription match error:`,
            e
          );
        }
      }

      return { matched: false, reason: "No matching transient subscriptions" };
    } catch (e) {
      console.warn(
        `⚠️ [SubscriptionMatcher] Error checking transient subscriptions:`,
        e
      );
      return {
        matched: false,
        reason: "Error checking transient subscriptions",
      };
    }
  }

  /**
   * Substitute $0, $1, $2... placeholders in query with actual argument values
   */
  private substituteQueryArgs(
    query: string | undefined,
    args: any[] | undefined
  ): string {
    if (!query) return "";
    if (!args || !Array.isArray(args) || args.length === 0) return query;

    let finalQuery = query;
    console.log(
      `🔍 [SubscriptionMatcher] Substituting args in query: ${query}`
    );

    args.forEach((arg: any, idx: number) => {
      const placeholder = `$${idx}`;
      const value = typeof arg === "string" ? `'${arg}'` : String(arg);
      finalQuery = finalQuery.replace(
        new RegExp(`\\${placeholder}\\b`, "g"),
        value
      );
    });

    console.log(
      `🔍 [SubscriptionMatcher] Final query after substitution: ${finalQuery}`
    );

    return finalQuery;
  }

  /**
   * Validate subscription query syntax
   */
  static validateSubscriptionQuery(
    query: string,
    queryTranslator: QueryTranslator
  ): { valid: boolean; error?: string } {
    try {
      if (!query || query.trim() === "") {
        return { valid: true }; // Empty queries are valid (match-all)
      }

      // Try to translate to MongoDB query to validate syntax
      queryTranslator.toMongoQuery(query);
      return { valid: true };
    } catch (error) {
      return {
        valid: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Check if a collection has any active subscriptions (FLX or transient)
   */
  hasActiveSubscriptionsForCollection(
    userId: string,
    collection: string
  ): boolean {
    // Check FLX subscriptions
    const subscriptionSet = this.config.userSubscriptions?.get(userId);
    if (
      subscriptionSet?.subscriptions?.some(
        (sub: any) => sub.collection === collection
      )
    ) {
      return true;
    }

    // Check transient subscriptions on any socket
    const userSockets = this.config.activeConnections.get(userId);
    if (userSockets && userSockets.size > 0) {
      for (const socketId of userSockets) {
        if (!this.config.io) continue;
        const socket = this.config.io.sockets.sockets.get(socketId);
        if (!socket) continue;

        const subs: Map<
          string,
          Array<{ query: string; args?: any[] }>
        > = (socket.data?.transientSubscriptions as any) ||
        (socket as any).transientSubscriptions;

        if (subs?.has(collection)) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Get all collections that have active subscriptions for a user
   */
  getActiveCollections(userId: string): Set<string> {
    const collections = new Set<string>();

    // Add FLX subscription collections
    const subscriptionSet = this.config.userSubscriptions?.get(userId);
    if (subscriptionSet?.subscriptions) {
      subscriptionSet.subscriptions.forEach((sub: any) => {
        collections.add(sub.collection);
      });
    }

    // Add transient subscription collections
    const userSockets = this.config.activeConnections.get(userId);
    if (userSockets && userSockets.size > 0) {
      for (const socketId of userSockets) {
        if (!this.config.io) continue;
        const socket = this.config.io.sockets.sockets.get(socketId);
        if (!socket) continue;

        const subs: Map<
          string,
          Array<{ query: string; args?: any[] }>
        > = (socket.data?.transientSubscriptions as any) ||
        (socket as any).transientSubscriptions;

        if (subs) {
          subs.forEach((_, collection) => collections.add(collection));
        }
      }
    }

    return collections;
  }
}
