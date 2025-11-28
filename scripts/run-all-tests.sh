#!/bin/bash

# Automated Test Suite Runner for Sync Implementation
# Runs all tests in sequence with proper environment setup

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TEST_MONGODB_URI="${TEST_MONGODB_URI:-mongodb://localhost:27017}"
SERVER_PORT="${SERVER_PORT:-3000}"

echo -e "${BLUE}╔════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   Sync Implementation Automated Test Suite        ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════╝${NC}"
echo ""

# Function to print section headers
print_header() {
    echo ""
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}  $1${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
}

# Function to check if a service is running
check_service() {
    local service_name=$1
    local check_command=$2
    
    if eval "$check_command" > /dev/null 2>&1; then
        echo -e "${GREEN}✓${NC} $service_name is running"
        return 0
    else
        echo -e "${RED}✗${NC} $service_name is not running"
        return 1
    fi
}

# Function to run a test suite
run_test_suite() {
    local suite_name=$1
    local command=$2
    
    print_header "$suite_name"
    
    if eval "$command"; then
        echo -e "${GREEN}✓${NC} $suite_name passed"
        return 0
    else
        echo -e "${RED}✗${NC} $suite_name failed"
        return 1
    fi
}

# Change to project directory
cd "$PROJECT_ROOT"

# 1. Pre-flight checks
print_header "Pre-flight Checks"

# Check Node.js
if command -v node > /dev/null 2>&1; then
    NODE_VERSION=$(node --version)
    echo -e "${GREEN}✓${NC} Node.js installed: $NODE_VERSION"
else
    echo -e "${RED}✗${NC} Node.js not installed"
    exit 1
fi

# Check MongoDB
check_service "MongoDB" "mongosh --eval 'db.runCommand({ping: 1})' --quiet" || {
    echo -e "${YELLOW}⚠${NC}  Starting MongoDB with Docker..."
    docker run -d -p 27017:27017 --name sync-test-mongo mongo:7.0 || {
        echo -e "${RED}✗${NC} Failed to start MongoDB"
        exit 1
    }
    sleep 5
}

# Check npm dependencies
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}⚠${NC}  Installing dependencies..."
    npm install
fi

# Check if .env exists
if [ ! -f ".env" ]; then
    echo -e "${YELLOW}⚠${NC}  .env file not found, copying from .env.example"
    cp .env.example .env
fi

# 2. TypeScript Compilation
print_header "TypeScript Compilation"
npm run build || {
    echo -e "${RED}✗${NC} TypeScript compilation failed"
    exit 1
}
echo -e "${GREEN}✓${NC} TypeScript compilation successful"

# 3. Linting (if available)
if grep -q '"lint"' package.json; then
    print_header "Code Linting"
    npm run lint || echo -e "${YELLOW}⚠${NC}  Linting warnings found"
fi

# 4. Unit Tests
run_test_suite "Unit Tests" "npm test -- --testPathPattern=database.test.ts --silent" || TEST_FAILURES=1

# 5. Integration Tests (with mock Web PubSub)
export WEB_PUBSUB_CONNECTION_STRING="Endpoint=https://test.webpubsub.azure.com;AccessKey=testkey123;Version=1.0;"
run_test_suite "Integration Tests" "npm run test:integration --silent" || TEST_FAILURES=1

# 6. E2E Tests
print_header "End-to-End Tests"

# Start server in background
echo "Starting sync server..."
export MONGODB_URI="$TEST_MONGODB_URI/e2e_test"
export PORT=$SERVER_PORT

npm run dev:server > server.log 2>&1 &
SERVER_PID=$!

# Wait for server to start
echo "Waiting for server to be ready..."
for i in {1..30}; do
    if curl -s "http://localhost:$SERVER_PORT/health" > /dev/null 2>&1; then
        echo -e "${GREEN}✓${NC} Server is ready"
        break
    fi
    sleep 1
    if [ $i -eq 30 ]; then
        echo -e "${RED}✗${NC} Server failed to start"
        cat server.log
        kill $SERVER_PID 2>/dev/null || true
        exit 1
    fi
done

# Run E2E tests
npm test -- --testPathPattern=e2e --runInBand --silent || TEST_FAILURES=1

# Stop server
echo "Stopping sync server..."
kill $SERVER_PID 2>/dev/null || true
wait $SERVER_PID 2>/dev/null || true

# 7. Stress Tests (optional, quick version)
if [ "${RUN_STRESS_TESTS:-false}" = "true" ]; then
    print_header "Stress Tests (Quick)"
    
    # Start server again
    npm run dev:server > server.log 2>&1 &
    SERVER_PID=$!
    sleep 5
    
    npm test -- --testPathPattern=stress --runInBand --testTimeout=60000 --silent || TEST_FAILURES=1
    
    kill $SERVER_PID 2>/dev/null || true
    wait $SERVER_PID 2>/dev/null || true
fi

# 8. Security Audit
print_header "Security Audit"
npm audit --production --audit-level=moderate || {
    echo -e "${YELLOW}⚠${NC}  Security vulnerabilities found (non-critical)"
}

# 9. Generate Test Coverage Report
if [ "${GENERATE_COVERAGE:-false}" = "true" ]; then
    print_header "Test Coverage Report"
    npm test -- --coverage --silent
    echo -e "${GREEN}✓${NC} Coverage report generated in coverage/"
fi

# 10. Cleanup
print_header "Cleanup"
rm -f server.log
echo -e "${GREEN}✓${NC} Cleaned up temporary files"

# Stop Docker MongoDB if we started it
if docker ps | grep -q sync-test-mongo; then
    echo "Stopping test MongoDB container..."
    docker stop sync-test-mongo > /dev/null
    docker rm sync-test-mongo > /dev/null
fi

# Final Summary
echo ""
echo -e "${BLUE}╔════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║              Test Suite Summary                    ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════════╝${NC}"
echo ""

if [ "${TEST_FAILURES:-0}" = "1" ]; then
    echo -e "${RED}✗ Some tests failed${NC}"
    echo ""
    echo "To debug failures:"
    echo "  1. Check test output above"
    echo "  2. Run specific test: npm test -- --testPathPattern=<test-name>"
    echo "  3. Check server logs if E2E tests failed"
    echo ""
    exit 1
else
    echo -e "${GREEN}✓ All tests passed!${NC}"
    echo ""
    echo "Next steps:"
    echo "  • Run load tests: k6 run tests/load/k6-load-test.js"
    echo "  • Run stress tests: RUN_STRESS_TESTS=true ./scripts/run-all-tests.sh"
    echo "  • Generate coverage: GENERATE_COVERAGE=true ./scripts/run-all-tests.sh"
    echo ""
    exit 0
fi
