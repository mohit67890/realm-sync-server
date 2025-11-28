/**
 * RQL (Realm Query Language) to MongoDB Query Translator
 * Converts client-side FLX queries to MongoDB queries
 */

export class QueryTranslator {
  /**
   * Translate RQL query to MongoDB query
   */
  toMongoQuery(rql: string): any {
    const trimmed = rql.trim();

    // TRUEPREDICATE = match all documents
    if (trimmed.toUpperCase() === "TRUEPREDICATE") {
      return {};
    }

    try {
      return this.parseRQL(trimmed);
    } catch (error) {
      console.error(`Failed to parse RQL query: ${rql}`, error);
      // Security fix: Fail closed instead of open
      // Don't match all documents on parse error
      throw new Error(`Invalid query syntax: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Parse RQL expression and convert to MongoDB query
   */
  private parseRQL(rql: string): any {
    // Handle logical operators with proper precedence

    // First handle OR (lowest precedence)
    if (this.containsLogicalOp(rql, "OR")) {
      return this.parseLogicalOp(rql, "OR", "$or");
    }

    // Then handle AND
    if (this.containsLogicalOp(rql, "AND")) {
      return this.parseLogicalOp(rql, "AND", "$and");
    }

    // Then handle NOT (highest precedence)
    if (rql.trim().toUpperCase().startsWith("NOT ")) {
      const innerQuery = rql.substring(4).trim();
      const parsed = this.parseRQL(innerQuery);
      return { $nor: [parsed] };
    }

    // Parse simple comparison
    return this.parseComparison(rql);
  }

  /**
   * Check if string contains logical operator (outside of quotes)
   */
  private containsLogicalOp(str: string, op: "AND" | "OR"): boolean {
    const pattern = new RegExp(`\\s+${op}\\s+`, "i");
    let inQuotes = false;
    let cleanStr = "";

    for (const char of str) {
      if (char === "'" || char === '"') {
        inQuotes = !inQuotes;
      } else if (!inQuotes) {
        cleanStr += char;
      }
    }

    return pattern.test(cleanStr);
  }

  /**
   * Parse logical operator (AND/OR)
   */
  private parseLogicalOp(
    rql: string,
    op: "AND" | "OR",
    mongoOp: "$and" | "$or"
  ): any {
    const parts: string[] = [];
    let currentPart = "";
    let inQuotes = false;
    let quoteChar = "";

    const opPattern = new RegExp(`\\s+${op}\\s+`, "i");

    for (let i = 0; i < rql.length; i++) {
      const char = rql[i];

      if ((char === "'" || char === '"') && !inQuotes) {
        inQuotes = true;
        quoteChar = char;
        currentPart += char;
      } else if (char === quoteChar && inQuotes) {
        inQuotes = false;
        quoteChar = "";
        currentPart += char;
      } else if (!inQuotes && i <= rql.length - op.length - 2) {
        // Check if this is the operator
        const remaining = rql.substring(i);
        if (opPattern.test(remaining.substring(0, op.length + 2))) {
          parts.push(currentPart.trim());
          currentPart = "";
          i += op.length + 1; // Skip the operator and surrounding spaces
          continue;
        }
        currentPart += char;
      } else {
        currentPart += char;
      }
    }

    if (currentPart.trim()) {
      parts.push(currentPart.trim());
    }

    // Parse each part recursively
    const conditions = parts.map((part) => this.parseRQL(part));

    return { [mongoOp]: conditions };
  }

  /**
   * Parse simple comparison expression
   * Examples: "userId == 'user_123'", "age > 18", "status != 'deleted'"
   */
  private parseComparison(expr: string): any {
    // Extract field, operator, and value
    const comparisonPattern =
      /^([a-zA-Z_][a-zA-Z0-9_.]*)\s*(==|!=|>=|<=|>|<)\s*(.+)$/;
    const match = expr.match(comparisonPattern);

    if (!match) {
      console.warn(`Could not parse comparison: ${expr}`);
      return {};
    }

    const [, field, operator, valueStr] = match;
    const value = this.parseValue(valueStr.trim());

    // Map RQL operator to MongoDB operator
    switch (operator) {
      case "==":
        return { [field]: value };
      case "!=":
        return { [field]: { $ne: value } };
      case ">":
        return { [field]: { $gt: value } };
      case ">=":
        return { [field]: { $gte: value } };
      case "<":
        return { [field]: { $lt: value } };
      case "<=":
        return { [field]: { $lte: value } };
      default:
        return { [field]: value };
    }
  }

  /**
   * Parse value from string
   */
  private parseValue(valueStr: string): any {
    // Remove quotes from strings
    if (
      (valueStr.startsWith("'") && valueStr.endsWith("'")) ||
      (valueStr.startsWith('"') && valueStr.endsWith('"'))
    ) {
      return valueStr.slice(1, -1);
    }

    // Parse boolean
    if (valueStr === "true") return true;
    if (valueStr === "false") return false;

    // Parse number
    const num = Number(valueStr);
    if (!isNaN(num)) return num;

    // Return as string
    return valueStr;
  }

  /**
   * Evaluate if a document matches a subscription query
   */
  matchesQuery(document: any, rql: string): boolean {
    const mongoQuery = this.toMongoQuery(rql);
    return this.evaluateMongoQuery(document, mongoQuery);
  }

  /**
   * Evaluate MongoDB query against a document (simplified implementation)
   */
  private evaluateMongoQuery(doc: any, query: any): boolean {
    // Empty query matches all
    if (Object.keys(query).length === 0) {
      return true;
    }

    // Handle logical operators
    if (query.$and) {
      return query.$and.every((q: any) => this.evaluateMongoQuery(doc, q));
    }
    if (query.$or) {
      return query.$or.some((q: any) => this.evaluateMongoQuery(doc, q));
    }
    if (query.$nor) {
      return !query.$nor.some((q: any) => this.evaluateMongoQuery(doc, q));
    }

    // Check each field condition
    for (const [field, condition] of Object.entries(query)) {
      const docValue = this.getNestedValue(doc, field);

      if (typeof condition === "object" && condition !== null) {
        // Handle comparison operators
        const cond = condition as any;
        if ("$ne" in cond && docValue === cond.$ne) return false;
        if ("$gt" in cond && !(docValue > cond.$gt)) return false;
        if ("$gte" in cond && !(docValue >= cond.$gte)) return false;
        if ("$lt" in cond && !(docValue < cond.$lt)) return false;
        if ("$lte" in cond && !(docValue <= cond.$lte)) return false;
      } else {
        // Direct equality
        if (docValue !== condition) return false;
      }
    }

    return true;
  }

  /**
   * Get nested value from document using dot notation
   */
  private getNestedValue(obj: any, path: string): any {
    const keys = path.split(".");
    let value = obj;

    for (const key of keys) {
      if (value && typeof value === "object" && key in value) {
        value = value[key];
      } else {
        return undefined;
      }
    }

    return value;
  }
}
