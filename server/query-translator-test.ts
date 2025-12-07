/**
 * Test suite for QueryTranslator to verify all operators work correctly
 */

import { QueryTranslator } from "./query-translator";

const translator = new QueryTranslator();

console.log("=== Testing QueryTranslator ===\n");

// Test data
const testDoc = {
  id: "user123",
  userId: "ciOeGUkXvFX1UUKqaSYEZdP7uj82",
  to: "ciOeGUkXvFX1UUKqaSYEZdP7uj82",
  from: "otherUser",
  fromSynced: true,
  age: 25,
  members: ["ciOeGUkXvFX1UUKqaSYEZdP7uj82", "user2", "User3"],
  status: "active",
  tags: ["important", "urgent"],
};

// Test functions
function testQuery(description: string, rql: string, shouldMatch: boolean) {
  try {
    const mongoQuery = translator.toMongoQuery(rql);
    const matches = translator.matchesQuery(testDoc, rql);
    const status = matches === shouldMatch ? "✅" : "❌";
    console.log(`${status} ${description}`);
    console.log(`   RQL: ${rql}`);
    console.log(`   MongoDB: ${JSON.stringify(mongoQuery)}`);
    console.log(`   Expected: ${shouldMatch}, Got: ${matches}\n`);
    return matches === shouldMatch;
  } catch (error) {
    console.log(`❌ ${description}`);
    console.log(`   RQL: ${rql}`);
    console.log(
      `   Error: ${error instanceof Error ? error.message : String(error)}\n`
    );
    return false;
  }
}

let passed = 0;
let total = 0;

// Test 1: Simple equality
total++;
if (
  testQuery(
    "Simple equality (==)",
    "userId == 'ciOeGUkXvFX1UUKqaSYEZdP7uj82'",
    true
  )
)
  passed++;

// Test 2: Simple inequality
total++;
if (testQuery("Simple inequality (!=)", "status != 'deleted'", true)) passed++;

// Test 3: Greater than
total++;
if (testQuery("Greater than (>)", "age > 20", true)) passed++;

// Test 4: Greater than or equal
total++;
if (testQuery("Greater than or equal (>=)", "age >= 25", true)) passed++;

// Test 5: Less than
total++;
if (testQuery("Less than (<)", "age < 30", true)) passed++;

// Test 6: Less than or equal
total++;
if (testQuery("Less than or equal (<=)", "age <= 25", true)) passed++;

// Test 7: CONTAINS (case-sensitive)
total++;
if (
  testQuery(
    "CONTAINS case-sensitive (array membership)",
    "members CONTAINS 'ciOeGUkXvFX1UUKqaSYEZdP7uj82'",
    true
  )
)
  passed++;

// Test 8: CONTAINS[c] (case-insensitive) - lowercase version should match the mixed case in array
total++;
if (
  testQuery(
    "CONTAINS[c] case-insensitive (lowercase matches mixed case)",
    "members CONTAINS[c] 'cioegukxvfx1uukqasyezdp7uj82'",
    true
  )
)
  passed++;

// Test 9: CONTAINS[c] with different case
total++;
if (
  testQuery(
    "CONTAINS[c] matches User3 case-insensitively",
    "members CONTAINS[c] 'user3'",
    true
  )
)
  passed++;

// Test 10: Simple OR
total++;
if (
  testQuery(
    "Simple OR (first condition true)",
    "to == 'ciOeGUkXvFX1UUKqaSYEZdP7uj82' OR from == 'ciOeGUkXvFX1UUKqaSYEZdP7uj82'",
    true
  )
)
  passed++;

// Test 11: Parenthesized OR
total++;
if (
  testQuery(
    "Parenthesized OR",
    "(to == 'ciOeGUkXvFX1UUKqaSYEZdP7uj82' OR from == 'ciOeGUkXvFX1UUKqaSYEZdP7uj82')",
    true
  )
)
  passed++;

// Test 12: Simple AND
total++;
if (
  testQuery(
    "Simple AND (both true)",
    "to == 'ciOeGUkXvFX1UUKqaSYEZdP7uj82' AND fromSynced == true",
    true
  )
)
  passed++;

// Test 13: Parenthesized AND
total++;
if (
  testQuery(
    "Parenthesized AND",
    "(to == 'ciOeGUkXvFX1UUKqaSYEZdP7uj82' AND fromSynced == true)",
    true
  )
)
  passed++;

// Test 14: Complex: OR within AND
total++;
if (
  testQuery(
    "Complex: OR within AND",
    "(to == 'ciOeGUkXvFX1UUKqaSYEZdP7uj82' OR from == 'otherUser') AND fromSynced == true",
    true
  )
)
  passed++;

// Test 15: Complex: Parenthesized OR within AND
total++;
if (
  testQuery(
    "Complex: Parenthesized OR within AND (original failing query)",
    "(to == 'ciOeGUkXvFX1UUKqaSYEZdP7uj82' OR from == 'ciOeGUkXvFX1UUKqaSYEZdP7uj82') AND fromSynced == true",
    true
  )
)
  passed++;

// Test 16: NOT operator
total++;
if (testQuery("NOT operator", "NOT status == 'deleted'", true)) passed++;

// Test 17: Double parentheses
total++;
if (
  testQuery(
    "Double parentheses",
    "((to == 'ciOeGUkXvFX1UUKqaSYEZdP7uj82'))",
    true
  )
)
  passed++;

// Test 18: Triple nested OR
total++;
if (
  testQuery(
    "Triple nested OR",
    "(to == 'ciOeGUkXvFX1UUKqaSYEZdP7uj82' OR from == 'otherUser' OR userId == 'ciOeGUkXvFX1UUKqaSYEZdP7uj82')",
    true
  )
)
  passed++;

// Test 19: Multiple AND conditions
total++;
if (
  testQuery(
    "Multiple AND conditions",
    "userId == 'ciOeGUkXvFX1UUKqaSYEZdP7uj82' AND fromSynced == true AND age >= 25",
    true
  )
)
  passed++;

// Test 20: CONTAINS with non-array field (should not match)
total++;
if (
  testQuery(
    "CONTAINS on string field (should fail)",
    "status CONTAINS 'act'",
    false
  )
)
  passed++;

// Test 21: Negative test - should not match
total++;
if (
  testQuery(
    "Should NOT match (from != userId)",
    "from == 'ciOeGUkXvFX1UUKqaSYEZdP7uj82'",
    false
  )
)
  passed++;

// Test 22: Negative test - OR both false
total++;
if (
  testQuery(
    "Should NOT match (OR both false)",
    "to == 'wrongUser' OR from == 'wrongUser2'",
    false
  )
)
  passed++;

// Test 23: TRUEPREDICATE
total++;
if (testQuery("TRUEPREDICATE matches all", "TRUEPREDICATE", true)) passed++;

// Test 24: Empty members check
total++;
if (
  testQuery(
    "CONTAINS non-existent member",
    "members CONTAINS 'nonExistent'",
    false
  )
)
  passed++;

console.log("\n=== Test Results ===");
console.log(`Passed: ${passed}/${total}`);
console.log(`Failed: ${total - passed}/${total}`);

if (passed === total) {
  console.log("\n🎉 All tests passed!");
  process.exit(0);
} else {
  console.log("\n❌ Some tests failed");
  process.exit(1);
}
