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
      const mongoQuery = this.parseRQL(trimmed);
      // console.log(
      //   `🔍 [QueryTranslator] RQL: "${rql}" → MongoDB:`,
      //   JSON.stringify(mongoQuery)
      // );
      return mongoQuery;
    } catch (error) {
      console.error(`Failed to parse RQL query: ${rql}`, error);
      // Security fix: Fail closed instead of open
      // Don't match all documents on parse error
      throw new Error(
        `Invalid query syntax: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Parse RQL expression and convert to MongoDB query
   */
  private parseRQL(rql: string): any {
    // Strip outer parentheses first
    const stripped = this.stripOuterParens(rql);

    // Handle logical operators with proper precedence

    // First handle OR (lowest precedence)
    if (this.containsLogicalOp(stripped, "OR")) {
      return this.parseLogicalOp(stripped, "OR", "$or");
    }

    // Then handle AND
    if (this.containsLogicalOp(stripped, "AND")) {
      return this.parseLogicalOp(stripped, "AND", "$and");
    }

    // Then handle NOT (highest precedence)
    if (stripped.trim().toUpperCase().startsWith("NOT ")) {
      const innerQuery = stripped.substring(4).trim();
      const parsed = this.parseRQL(innerQuery);
      return { $nor: [parsed] };
    }

    // Parse simple comparison
    return this.parseComparison(stripped);
  }

  /**
   * Remove a single pair of outer parentheses if they wrap the whole expression
   */
  private stripOuterParens(expr: string): string {
    let s = expr.trim();
    while (s.startsWith("(") && s.endsWith(")")) {
      // Ensure parentheses are balanced
      let depth = 0;
      let balanced = true;
      for (let i = 0; i < s.length; i++) {
        if (s[i] === "(") depth++;
        else if (s[i] === ")") {
          depth--;
          if (depth < 0) {
            balanced = false;
            break;
          }
        }
      }
      if (balanced && depth === 0) {
        s = s.substring(1, s.length - 1).trim();
      } else {
        break;
      }
    }
    return s;
  }

  /**
   * Check if string contains logical operator (outside of quotes and at depth 0)
   */
  private containsLogicalOp(str: string, op: "AND" | "OR"): boolean {
    let inQuotes = false;
    let quoteChar = "";
    let parenDepth = 0;

    for (let i = 0; i < str.length; i++) {
      const char = str[i];

      if ((char === "'" || char === '"') && !inQuotes) {
        inQuotes = true;
        quoteChar = char;
      } else if (char === quoteChar && inQuotes) {
        inQuotes = false;
        quoteChar = "";
      } else if (!inQuotes) {
        if (char === "(") {
          parenDepth++;
        } else if (char === ")") {
          parenDepth--;
        } else if (parenDepth === 0) {
          // Check if we're at the operator at depth 0
          const remaining = str.substring(i);
          const opPattern = new RegExp(`^\\s+${op}\\s+`, "i");
          if (opPattern.test(remaining)) {
            return true;
          }
        }
      }
    }

    return false;
  }

  /**
   * Parse logical operator (AND/OR)
   * Note: rql is already stripped of outer parens by parseRQL
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
    let parenDepth = 0;

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
      } else if (!inQuotes) {
        if (char === "(") {
          parenDepth++;
          currentPart += char;
        } else if (char === ")") {
          parenDepth--;
          currentPart += char;
        } else if (parenDepth === 0) {
          // Check if we're at the operator (only at depth 0)
          const remaining = rql.substring(i);
          const opPattern = new RegExp(`^\\s+${op}\\s+`, "i");
          const match = remaining.match(opPattern);

          if (match) {
            parts.push(currentPart.trim());
            currentPart = "";
            i += match[0].length - 1; // Skip the operator and surrounding spaces
            continue;
          }
          currentPart += char;
        } else {
          currentPart += char;
        }
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
      /^([a-zA-Z_][a-zA-Z0-9_.]*)\s*(==|!=|>=|<=|>|<|CONTAINS\[c\]|CONTAINS)\s*(.+)$/i;
    const match = expr.match(comparisonPattern);

    if (!match) {
      console.warn(`Could not parse comparison: ${expr}`);
      return {};
    }

    const [, field, opRaw, valueStr] = match;
    const operator = opRaw.toUpperCase();
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
      case "CONTAINS": {
        // Case-sensitive contains: for arrays, MongoDB directly supports matching array elements
        // For equality: { field: value } matches if any array element equals value
        // This is MongoDB's default behavior for arrays
        return { [field]: value };
      }
      case "CONTAINS[C]": {
        // Case-insensitive contains for array membership
        // For arrays in MongoDB, regex on a field automatically checks each array element
        if (typeof value === "string") {
          // MongoDB applies regex to each array element automatically
          // Use anchors to ensure exact match (not substring)
          // For case-insensitive exact match: /^value$/i
          return {
            [field]: {
              $regex: `^${this.escapeRegex(value)}$`,
              $options: "i",
            },
          };
        }
        // For non-string values, fall back to direct equality
        return { [field]: value };
      }
      default:
        return { [field]: value };
    }
  }

  /**
   * Escape special regex characters for literal matching
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
    if (query.$not) {
      return !this.evaluateMongoQuery(doc, query.$not);
    }

    // Check each field condition
    for (const [field, condition] of Object.entries(query)) {
      const docValue = this.getNestedValue(doc, field);

      if (typeof condition === "object" && condition !== null) {
        // Handle comparison operators
        const cond = condition as any;

        if ("$ne" in cond) {
          if (Array.isArray(docValue)) {
            // For arrays, $ne means "does not contain"
            if (docValue.includes(cond.$ne)) return false;
          } else {
            if (docValue === cond.$ne) return false;
          }
        }

        if ("$gt" in cond && !(docValue > cond.$gt)) return false;
        if ("$gte" in cond && !(docValue >= cond.$gte)) return false;
        if ("$lt" in cond && !(docValue < cond.$lt)) return false;
        if ("$lte" in cond && !(docValue <= cond.$lte)) return false;

        // Handle regex conditions - MongoDB applies regex to array elements automatically
        if ("$regex" in cond) {
          const pattern = new RegExp(cond.$regex, cond.$options || "");
          // console.log(
          //   `🔍 [QueryTranslator] Regex match: field="${field}", pattern="${cond.$regex}", options="${cond.$options}", docValue=`,
          //   docValue
          // );

          if (typeof docValue === "string") {
            const matches = pattern.test(docValue);
            // console.log(`🔍 [QueryTranslator] String match result: ${matches}`);
            if (!matches) return false;
          } else if (Array.isArray(docValue)) {
            // MongoDB behavior: regex matches if ANY array element matches
            // console.log(
            //   `🔍 [QueryTranslator] Testing regex against array elements:`,
            //   docValue
            // );
            const anyMatch = docValue.some((el) => {
              const isString = typeof el === "string";
              const matches = isString ? pattern.test(el) : false;
              console.log(
                `  - Element "${el}" (type: ${typeof el}): ${matches}`
              );
              return matches;
            });
            // console.log(`🔍 [QueryTranslator] Array match result: ${anyMatch}`);
            if (!anyMatch) return false;
          } else {
            // console.log(
            //   `🔍 [QueryTranslator] Value is neither string nor array, returning false`
            // );
            return false;
          }
        }
      } else {
        // Direct equality - MongoDB behavior for arrays
        if (Array.isArray(docValue)) {
          // For arrays, { field: value } matches if array contains value
          if (!docValue.includes(condition)) return false;
        } else {
          if (docValue !== condition) return false;
        }
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
