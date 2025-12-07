/**
 * Demonstration of enhanced convertDatesToNative function
 *
 * This example shows how the function handles:
 * - Deeply nested objects
 * - Embedded objects at multiple levels
 * - Arrays and lists containing dates
 * - Mixed date formats (ISO-8601 strings and wrapped dates)
 */

import { convertDatesToNative } from "./utils";

// Example 1: Simple nested object with dates
console.log("\n=== Example 1: Nested Objects ===");
const nestedObject = {
  _id: "user123",
  name: "John Doe",
  createdAt: "2025-12-02T13:03:06.875Z",
  profile: {
    birthDate: "1990-01-15T00:00:00Z",
    lastLogin: "2025-12-04T10:30:00+05:30",
    preferences: {
      theme: "dark",
      lastUpdated: "2025-12-03T14:00:00Z",
    },
  },
};

const result1 = convertDatesToNative(nestedObject);
console.log("Input:", JSON.stringify(nestedObject, null, 2));
console.log("Result createdAt:", result1.createdAt);
console.log("Result profile.birthDate:", result1.profile.birthDate);
console.log("Result profile.lastLogin:", result1.profile.lastLogin);
console.log(
  "Result profile.preferences.lastUpdated:",
  result1.profile.preferences.lastUpdated
);

// Example 2: Arrays with embedded objects
console.log("\n=== Example 2: Arrays with Embedded Objects ===");
const arrayData = {
  tasks: [
    {
      id: "task1",
      title: "Complete project",
      createdAt: "2025-12-01T09:00:00Z",
      reminders: [
        { time: "2025-12-05T08:00:00Z", sent: false },
        { time: "2025-12-06T08:00:00Z", sent: false },
      ],
    },
    {
      id: "task2",
      title: "Review code",
      createdAt: "2025-12-02T10:00:00Z",
      reminders: [{ time: "2025-12-07T09:00:00Z", sent: true }],
    },
  ],
};

const result2 = convertDatesToNative(arrayData);
console.log("First task createdAt:", result2.tasks[0].createdAt);
console.log("First reminder time:", result2.tasks[0].reminders[0].time);
console.log("Second task first reminder:", result2.tasks[1].reminders[0].time);

// Example 3: Real-world MongoDB change record
console.log("\n=== Example 3: MongoDB Change Record ===");
const changeRecord = {
  id: "change_001",
  userId: "user456",
  timestamp: "2025-12-02T13:03:06.875Z",
  operation: "upsert",
  collection: "goals",
  documentId: "goal789",
  data: {
    _id: "goal789",
    title: "Learn TypeScript",
    createdAt: "2025-12-01T10:00:00Z",
    updatedAt: "2025-12-02T13:03:06.875Z",
    sync_updated_at: "2025-12-02T13:03:06.875Z",
    milestones: [
      {
        name: "Complete basics",
        dueDate: "2025-12-10T00:00:00Z",
        completed: false,
      },
      {
        name: "Build first app",
        dueDate: "2025-12-20T00:00:00Z",
        completed: false,
      },
    ],
    metadata: {
      lastModified: "2025-12-02T13:03:06.875Z",
      syncVersion: 3,
    },
  },
};

const result3 = convertDatesToNative(changeRecord);
console.log("Change timestamp:", result3.timestamp);
console.log("Data createdAt:", result3.data.createdAt);
console.log("Data sync_updated_at:", result3.data.sync_updated_at);
console.log("First milestone dueDate:", result3.data.milestones[0].dueDate);
console.log("Metadata lastModified:", result3.data.metadata.lastModified);

// Example 4: Wrapped date format
console.log("\n=== Example 4: Wrapped Date Format ===");
const wrappedData = {
  _id: "doc123",
  createdAt: { type: "date", value: "2025-12-02T13:03:06.875Z" },
  items: [
    { timestamp: { type: "date", value: "2025-12-03T14:00:00Z" } },
    { timestamp: "2025-12-04T15:00:00Z" }, // Mixed format
  ],
};

const result4 = convertDatesToNative(wrappedData);
console.log("Wrapped createdAt:", result4.createdAt);
console.log("Item 0 timestamp:", result4.items[0].timestamp);
console.log("Item 1 timestamp:", result4.items[1].timestamp);

// Example 5: Edge cases
console.log("\n=== Example 5: Edge Cases ===");
const edgeCases = {
  nullValue: null,
  undefinedValue: undefined,
  validDate: "2025-12-02T13:03:06.875Z",
  notADate: "hello world",
  number: 42,
  boolean: true,
  emptyArray: [],
  emptyObject: {},
  mixedArray: [
    null,
    "2025-12-02T13:03:06.875Z",
    "not a date",
    { nested: "2025-12-03T14:00:00Z" },
  ],
};

const result5 = convertDatesToNative(edgeCases);
console.log("Null remains null:", result5.nullValue === null);
console.log(
  "Undefined remains undefined:",
  result5.undefinedValue === undefined
);
console.log("Valid date converted:", result5.validDate instanceof Date);
console.log("Non-date string preserved:", result5.notADate === "hello world");
console.log("Number preserved:", result5.number === 42);
console.log("Boolean preserved:", result5.boolean === true);
console.log("Mixed array[1] is Date:", result5.mixedArray[1] instanceof Date);
console.log(
  "Mixed array nested date:",
  result5.mixedArray[3].nested instanceof Date
);

console.log("\n✅ All examples completed successfully!\n");

export {};
