#!/bin/bash
# Code Review Script for Task Factory CLI

echo "=== CODE REVIEW: Task Factory CLI Implementation ==="
echo ""

# Function to review a file
review_file() {
    echo "### Reviewing: $1"
    echo "```typescript"
    cat "$1"
    echo "```"
    echo ""
}

echo "## 1. API Client (src/api/api-client.ts)"
echo ""
echo "Focus areas:"
echo "- Error handling in fetch requests"
echo "- URL encoding of path parameters"
echo "- Type safety with generics"
echo "- Network error handling"
echo ""
review_file "packages/cli/src/api/api-client.ts"

echo "## 2. Command Handlers"
echo ""

for file in packages/cli/src/commands/*.ts; do
    echo "### $(basename $file)"
    echo ""
    review_file "$file"
done

echo "## 3. CLI Entry Point (src/cli.ts)"
echo ""
review_file "packages/cli/src/cli.ts"

echo "## 4. Types (src/types/index.ts)"
echo ""
review_file "packages/cli/src/types/index.ts"

echo "## 5. Utilities (src/utils/format.ts)"
echo ""
review_file "packages/cli/src/utils/format.ts"

echo "## 6. Tests (tests/api-client.test.ts)"
echo ""
echo "Sample of test structure:"
head -100 "packages/cli/tests/api-client.test.ts"
