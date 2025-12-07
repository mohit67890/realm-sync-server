import { convertDatesToNative } from "./utils";

describe("convertDatesToNative", () => {
  describe("Basic types", () => {
    it("should handle null and undefined", () => {
      expect(convertDatesToNative(null)).toBeNull();
      expect(convertDatesToNative(undefined)).toBeUndefined();
    });

    it("should handle primitives", () => {
      expect(convertDatesToNative("hello")).toBe("hello");
      expect(convertDatesToNative(42)).toBe(42);
      expect(convertDatesToNative(true)).toBe(true);
      expect(convertDatesToNative(false)).toBe(false);
    });

    it("should preserve existing Date objects", () => {
      const date = new Date("2025-12-02T13:03:06.875Z");
      const result = convertDatesToNative(date);
      expect(result).toBeInstanceOf(Date);
      expect(result.getTime()).toBe(date.getTime());
    });
  });

  describe("ISO-8601 date strings", () => {
    it("should convert ISO-8601 string with milliseconds and Z", () => {
      const result = convertDatesToNative("2025-12-02T13:03:06.875Z");
      expect(result).toBeInstanceOf(Date);
      expect(result.toISOString()).toBe("2025-12-02T13:03:06.875Z");
    });

    it("should convert ISO-8601 string without milliseconds", () => {
      const result = convertDatesToNative("2025-12-02T13:03:06Z");
      expect(result).toBeInstanceOf(Date);
      expect(result.toISOString()).toBe("2025-12-02T13:03:06.000Z");
    });

    it("should convert ISO-8601 string with timezone offset", () => {
      const result = convertDatesToNative("2025-12-02T13:03:06+00:00");
      expect(result).toBeInstanceOf(Date);
      expect(result.toISOString()).toBe("2025-12-02T13:03:06.000Z");
    });

    it("should convert ISO-8601 string with milliseconds and offset", () => {
      const result = convertDatesToNative("2025-12-02T18:33:06.875+05:30");
      expect(result).toBeInstanceOf(Date);
      expect(result.toISOString()).toBe("2025-12-02T13:03:06.875Z");
    });

    it("should not convert non-date strings", () => {
      expect(convertDatesToNative("not a date")).toBe("not a date");
      expect(convertDatesToNative("2025-12-02")).toBe("2025-12-02");
      expect(convertDatesToNative("12:34:56")).toBe("12:34:56");
    });
  });

  describe("Wrapped date format", () => {
    it("should convert wrapped date object", () => {
      const wrapped = { type: "date", value: "2025-12-02T13:03:06.875Z" };
      const result = convertDatesToNative(wrapped);
      expect(result).toBeInstanceOf(Date);
      expect(result.toISOString()).toBe("2025-12-02T13:03:06.875Z");
    });

    it("should handle invalid wrapped date gracefully", () => {
      const wrapped = { type: "date", value: "invalid" };
      const result = convertDatesToNative(wrapped);
      expect(result).toEqual(wrapped);
    });
  });

  describe("Arrays and lists", () => {
    it("should convert dates in flat arrays", () => {
      const arr = [
        "2025-12-02T13:03:06.875Z",
        "hello",
        42,
        "2025-12-03T14:00:00Z",
      ];
      const result = convertDatesToNative(arr);
      expect(result[0]).toBeInstanceOf(Date);
      expect(result[1]).toBe("hello");
      expect(result[2]).toBe(42);
      expect(result[3]).toBeInstanceOf(Date);
    });

    it("should convert dates in nested arrays", () => {
      const arr = [
        ["2025-12-02T13:03:06.875Z", "test"],
        [42, ["2025-12-03T14:00:00Z"]],
      ];
      const result = convertDatesToNative(arr);
      expect(result[0][0]).toBeInstanceOf(Date);
      expect(result[0][1]).toBe("test");
      expect(result[1][0]).toBe(42);
      expect(result[1][1][0]).toBeInstanceOf(Date);
    });

    it("should convert dates in arrays of objects", () => {
      const arr = [
        { date: "2025-12-02T13:03:06.875Z", name: "item1" },
        { date: "2025-12-03T14:00:00Z", name: "item2" },
      ];
      const result = convertDatesToNative(arr);
      expect(result[0].date).toBeInstanceOf(Date);
      expect(result[0].name).toBe("item1");
      expect(result[1].date).toBeInstanceOf(Date);
      expect(result[1].name).toBe("item2");
    });
  });

  describe("Objects and embedded objects", () => {
    it("should convert dates in flat objects", () => {
      const obj = {
        createdAt: "2025-12-02T13:03:06.875Z",
        name: "test",
        count: 42,
        updatedAt: "2025-12-03T14:00:00Z",
      };
      const result = convertDatesToNative(obj);
      expect(result.createdAt).toBeInstanceOf(Date);
      expect(result.name).toBe("test");
      expect(result.count).toBe(42);
      expect(result.updatedAt).toBeInstanceOf(Date);
    });

    it("should convert dates in nested objects", () => {
      const obj = {
        user: {
          createdAt: "2025-12-02T13:03:06.875Z",
          profile: {
            birthDate: "2025-12-03T14:00:00Z",
            name: "John",
          },
        },
        metadata: {
          timestamp: "2025-12-04T15:00:00Z",
        },
      };
      const result = convertDatesToNative(obj);
      expect(result.user.createdAt).toBeInstanceOf(Date);
      expect(result.user.profile.birthDate).toBeInstanceOf(Date);
      expect(result.user.profile.name).toBe("John");
      expect(result.metadata.timestamp).toBeInstanceOf(Date);
    });

    it("should convert dates in objects with array properties", () => {
      const obj = {
        name: "test",
        timestamps: ["2025-12-02T13:03:06.875Z", "2025-12-03T14:00:00Z"],
        events: [
          { date: "2025-12-04T15:00:00Z", type: "login" },
          { date: "2025-12-05T16:00:00Z", type: "logout" },
        ],
      };
      const result = convertDatesToNative(obj);
      expect(result.timestamps[0]).toBeInstanceOf(Date);
      expect(result.timestamps[1]).toBeInstanceOf(Date);
      expect(result.events[0].date).toBeInstanceOf(Date);
      expect(result.events[1].date).toBeInstanceOf(Date);
    });
  });

  describe("Complex nested structures", () => {
    it("should handle deeply nested mixed structures", () => {
      const complex = {
        _id: "123",
        name: "Complex Document",
        createdAt: "2025-12-02T13:03:06.875Z",
        metadata: {
          sync_updated_at: "2025-12-03T14:00:00Z",
          tags: ["tag1", "tag2"],
        },
        embeddedList: [
          {
            id: "item1",
            timestamp: "2025-12-04T15:00:00Z",
            nested: {
              deepDate: "2025-12-05T16:00:00Z",
              values: [1, 2, 3],
            },
          },
          {
            id: "item2",
            timestamp: "2025-12-06T17:00:00Z",
            nested: {
              deepDate: "2025-12-07T18:00:00Z",
              values: [4, 5, 6],
            },
          },
        ],
        history: [
          {
            date: "2025-12-08T19:00:00Z",
            changes: [
              { field: "name", at: "2025-12-09T20:00:00Z" },
              { field: "status", at: "2025-12-10T21:00:00Z" },
            ],
          },
        ],
      };

      const result = convertDatesToNative(complex);

      // Top level
      expect(result._id).toBe("123");
      expect(result.createdAt).toBeInstanceOf(Date);

      // Nested metadata
      expect(result.metadata.sync_updated_at).toBeInstanceOf(Date);
      expect(result.metadata.tags).toEqual(["tag1", "tag2"]);

      // Embedded list
      expect(result.embeddedList[0].timestamp).toBeInstanceOf(Date);
      expect(result.embeddedList[0].nested.deepDate).toBeInstanceOf(Date);
      expect(result.embeddedList[1].timestamp).toBeInstanceOf(Date);
      expect(result.embeddedList[1].nested.deepDate).toBeInstanceOf(Date);

      // History with nested changes
      expect(result.history[0].date).toBeInstanceOf(Date);
      expect(result.history[0].changes[0].at).toBeInstanceOf(Date);
      expect(result.history[0].changes[1].at).toBeInstanceOf(Date);
    });

    it("should handle objects with circular-like structures (limited depth)", () => {
      const obj: any = {
        level: 1,
        date: "2025-12-02T13:03:06.875Z",
        child: {
          level: 2,
          date: "2025-12-03T14:00:00Z",
          child: {
            level: 3,
            date: "2025-12-04T15:00:00Z",
          },
        },
      };

      const result = convertDatesToNative(obj);
      expect(result.date).toBeInstanceOf(Date);
      expect(result.child.date).toBeInstanceOf(Date);
      expect(result.child.child.date).toBeInstanceOf(Date);
    });
  });

  describe("Real-world sync scenarios", () => {
    it("should handle MongoDB change record", () => {
      const changeRecord = {
        id: "change123",
        userId: "user456",
        timestamp: "2025-12-02T13:03:06.875Z",
        operation: "upsert",
        collection: "goals",
        documentId: "doc789",
        data: {
          _id: "doc789",
          title: "My Goal",
          createdAt: "2025-12-01T10:00:00Z",
          updatedAt: "2025-12-02T13:03:06.875Z",
          sync_updated_at: "2025-12-02T13:03:06.875Z",
          reminders: [
            { date: "2025-12-10T09:00:00Z", message: "Reminder 1" },
            { date: "2025-12-11T09:00:00Z", message: "Reminder 2" },
          ],
          metadata: {
            lastModified: "2025-12-02T13:03:06.875Z",
            version: 5,
          },
        },
        synced: false,
      };

      const result = convertDatesToNative(changeRecord);

      expect(result.timestamp).toBeInstanceOf(Date);
      expect(result.data.createdAt).toBeInstanceOf(Date);
      expect(result.data.updatedAt).toBeInstanceOf(Date);
      expect(result.data.sync_updated_at).toBeInstanceOf(Date);
      expect(result.data.reminders[0].date).toBeInstanceOf(Date);
      expect(result.data.reminders[1].date).toBeInstanceOf(Date);
      expect(result.data.metadata.lastModified).toBeInstanceOf(Date);
      expect(result.data.metadata.version).toBe(5);
    });

    it("should handle wrapped dates in sync data", () => {
      const syncData = {
        _id: "123",
        createdAt: { type: "date", value: "2025-12-02T13:03:06.875Z" },
        items: [
          { timestamp: { type: "date", value: "2025-12-03T14:00:00Z" } },
          { timestamp: "2025-12-04T15:00:00Z" }, // Mixed format
        ],
      };

      const result = convertDatesToNative(syncData);
      expect(result.createdAt).toBeInstanceOf(Date);
      expect(result.items[0].timestamp).toBeInstanceOf(Date);
      expect(result.items[1].timestamp).toBeInstanceOf(Date);
    });
  });

  describe("Edge cases", () => {
    it("should handle empty objects and arrays", () => {
      expect(convertDatesToNative({})).toEqual({});
      expect(convertDatesToNative([])).toEqual([]);
    });

    it("should handle objects with null values", () => {
      const obj = {
        date: null,
        value: "2025-12-02T13:03:06.875Z",
      };
      const result = convertDatesToNative(obj);
      expect(result.date).toBeNull();
      expect(result.value).toBeInstanceOf(Date);
    });

    it("should handle mixed null and date arrays", () => {
      const arr = [null, "2025-12-02T13:03:06.875Z", undefined, "test"];
      const result = convertDatesToNative(arr);
      expect(result[0]).toBeNull();
      expect(result[1]).toBeInstanceOf(Date);
      expect(result[2]).toBeUndefined();
      expect(result[3]).toBe("test");
    });

    it("should not crash on invalid date strings", () => {
      const obj = {
        validDate: "2025-12-02T13:03:06.875Z",
        invalidDate: "2025-13-45T99:99:99Z", // Invalid date
        notADate: "hello",
      };
      const result = convertDatesToNative(obj);
      expect(result.validDate).toBeInstanceOf(Date);
      expect(result.invalidDate).toBe("2025-13-45T99:99:99Z"); // Preserved as string
      expect(result.notADate).toBe("hello");
    });
  });
});
