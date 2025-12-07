/**
 * Convert ISO-8601 date strings and wrapped date objects to native Date objects
 * Recursively processes:
 * - Nested objects (including embedded objects)
 * - Arrays and lists at any depth
 * - Direct ISO-8601 strings: "2025-12-02T13:03:06.875789Z" or "2025-12-02T13:03:06+00:00"
 * - Wrapped format: {type: "date", value: "2025-12-02T13:03:06.875789Z"}
 *
 * @param obj - Any value to convert (primitives, objects, arrays, nested structures)
 * @param depth - Internal parameter to prevent infinite recursion (max 50 levels)
 * @returns Converted value with Date objects in place of date strings
 */
export function convertDatesToNative(obj: any, depth: number = 0): any {
  // Prevent infinite recursion
  if (depth > 50) {
    console.warn(`[convertDatesToNative] Max recursion depth reached`);
    return obj;
  }

  // Handle null/undefined
  if (obj === null || obj === undefined) return obj;

  // Handle primitives (string, number, boolean, bigint, symbol)
  const objType = typeof obj;
  if (
    objType === "string" ||
    objType === "number" ||
    objType === "boolean" ||
    objType === "bigint" ||
    objType === "symbol"
  ) {
    // Check if string is an ISO-8601 date
    if (objType === "string" && isIso8601DateString(obj)) {
      try {
        const date = new Date(obj);
        // Validate date is valid
        if (!isNaN(date.getTime())) {
          return date;
        }
      } catch (e) {
        // Not a valid date, return original string
      }
    }
    return obj;
  }

  // Handle Date objects (already native)
  if (obj instanceof Date) {
    return obj;
  }

  // Handle arrays and array-like objects (recursively process each element)
  if (Array.isArray(obj)) {
    return obj.map((item) => convertDatesToNative(item, depth + 1));
  }

  // Handle wrapped date format: {type: "date", value: "..."}
  if (
    typeof obj === "object" &&
    obj.type === "date" &&
    typeof obj.value === "string"
  ) {
    try {
      const date = new Date(obj.value);
      if (!isNaN(date.getTime())) {
        return date;
      }
    } catch (e) {
      console.warn(
        `[convertDatesToNative] Failed to parse wrapped date: ${obj.value}`
      );
    }
    return obj;
  }

  // Handle plain objects and embedded objects recursively
  if (typeof obj === "object") {
    // Create result object (preserve prototype for class instances)
    const result: any = Object.create(Object.getPrototypeOf(obj));

    // Process all enumerable properties
    for (const key of Object.keys(obj)) {
      try {
        const value = obj[key];

        // Recursively convert the value
        result[key] = convertDatesToNative(value, depth + 1);
      } catch (e) {
        console.warn(
          `[convertDatesToNative] Error processing key "${key}":`,
          e
        );
        // Preserve original value on error
        result[key] = obj[key];
      }
    }

    return result;
  }

  // Fallback: return as-is
  return obj;
}

/**
 * Check if a string matches ISO-8601 date format
 * Supports:
 * - 2025-12-02T13:03:06.875789Z (with milliseconds and Z)
 * - 2025-12-02T13:03:06Z (without milliseconds)
 * - 2025-12-02T13:03:06+00:00 (with timezone offset)
 * - 2025-12-02T13:03:06.875+05:30 (milliseconds + offset)
 * - 2025-12-02T13:03:06 (no timezone)
 *
 * @param str - String to check
 * @returns true if string matches ISO-8601 date pattern
 */
function isIso8601DateString(str: string): boolean {
  // ISO-8601 pattern with optional milliseconds and timezone
  // Format: YYYY-MM-DDTHH:mm:ss[.sss][Z|±HH:mm]
  const iso8601Pattern =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/;
  return iso8601Pattern.test(str);
}
