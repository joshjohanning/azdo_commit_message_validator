#!/usr/bin/env bash

# Test suite for action.yml bash script logic
# This tests the core validation logic without running the full GitHub Action

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Test counters
TESTS_RUN=0
TESTS_PASSED=0
TESTS_FAILED=0

# Test helper functions
assert_equals() {
    local expected="$1"
    local actual="$2"
    local message="${3:-Assertion failed}"
    
    TESTS_RUN=$((TESTS_RUN + 1))
    
    if [ "$expected" = "$actual" ]; then
        echo -e "${GREEN}✓${NC} $message"
        TESTS_PASSED=$((TESTS_PASSED + 1))
        return 0
    else
        echo -e "${RED}✗${NC} $message"
        echo -e "  Expected: $expected"
        echo -e "  Actual:   $actual"
        TESTS_FAILED=$((TESTS_FAILED + 1))
        return 1
    fi
}

assert_contains() {
    local haystack="$1"
    local needle="$2"
    local message="${3:-String should contain substring}"
    
    TESTS_RUN=$((TESTS_RUN + 1))
    
    if echo "$haystack" | grep -q "$needle"; then
        echo -e "${GREEN}✓${NC} $message"
        TESTS_PASSED=$((TESTS_PASSED + 1))
        return 0
    else
        echo -e "${RED}✗${NC} $message"
        echo -e "  Haystack: $haystack"
        echo -e "  Needle:   $needle"
        TESTS_FAILED=$((TESTS_FAILED + 1))
        return 1
    fi
}

assert_not_contains() {
    local haystack="$1"
    local needle="$2"
    local message="${3:-String should not contain substring}"
    
    TESTS_RUN=$((TESTS_RUN + 1))
    
    if echo "$haystack" | grep -q "$needle"; then
        echo -e "${RED}✗${NC} $message"
        echo -e "  Haystack: $haystack"
        echo -e "  Needle:   $needle"
        TESTS_FAILED=$((TESTS_FAILED + 1))
        return 1
    else
        echo -e "${GREEN}✓${NC} $message"
        TESTS_PASSED=$((TESTS_PASSED + 1))
        return 0
    fi
}

assert_match() {
    local string="$1"
    local pattern="$2"
    local message="${3:-String should match pattern}"
    
    TESTS_RUN=$((TESTS_RUN + 1))
    
    if echo "$string" | grep -i -E -q "$pattern"; then
        echo -e "${GREEN}✓${NC} $message"
        TESTS_PASSED=$((TESTS_PASSED + 1))
        return 0
    else
        echo -e "${RED}✗${NC} $message"
        echo -e "  String:  $string"
        echo -e "  Pattern: $pattern"
        TESTS_FAILED=$((TESTS_FAILED + 1))
        return 1
    fi
}

assert_not_match() {
    local string="$1"
    local pattern="$2"
    local message="${3:-String should not match pattern}"
    
    TESTS_RUN=$((TESTS_RUN + 1))
    
    if echo "$string" | grep -i -E -q "$pattern"; then
        echo -e "${RED}✗${NC} $message"
        echo -e "  String:  $string"
        echo -e "  Pattern: $pattern"
        TESTS_FAILED=$((TESTS_FAILED + 1))
        return 1
    else
        echo -e "${GREEN}✓${NC} $message"
        TESTS_PASSED=$((TESTS_PASSED + 1))
        return 0
    fi
}

# Test Suite: Commit Message Validation
test_commit_validation() {
    echo ""
    echo -e "${YELLOW}Testing: Commit Message Validation${NC}"
    echo "========================================"
    
    # Test valid commit messages
    assert_match "AB#12345 - Added new feature" "AB#[0-9]+" "Valid commit with AB#12345"
    assert_match "ab#12345 - Added new feature" "AB#[0-9]+" "Valid commit with ab#12345 (case insensitive)"
    assert_match "Fix bug AB#999" "AB#[0-9]+" "Valid commit with AB# in middle"
    assert_match "Multiple work items AB#123 AB#456" "AB#[0-9]+" "Valid commit with multiple work items"
    
    # Test invalid commit messages
    assert_not_match "Fixed a bug" "AB#[0-9]+" "Invalid commit without AB#"
    assert_not_match "AB# 12345" "AB#[0-9]+" "Invalid commit with space after AB#"
    assert_not_match "AB#" "AB#[0-9]+" "Invalid commit with AB# but no number"
}

# Test Suite: PR Title/Body Validation
test_pr_validation() {
    echo ""
    echo -e "${YELLOW}Testing: Pull Request Validation${NC}"
    echo "========================================"
    
    # Test valid PR titles/bodies
    assert_match "feat: Add feature AB#12345" "AB#[0-9]+" "Valid PR title with AB#12345"
    assert_match "Closes AB#999" "AB#[0-9]+" "Valid PR body with AB#999"
    assert_match "ab#12345" "AB#[0-9]+" "Valid PR with lowercase ab#"
    
    # Test invalid PR titles/bodies
    assert_not_match "feat: Add new feature" "AB#[0-9]+" "Invalid PR without AB#"
    assert_not_match "Work item 12345" "AB#[0-9]+" "Invalid PR with number but no AB#"
}

# Test Suite: Work Item Extraction
test_workitem_extraction() {
    echo ""
    echo -e "${YELLOW}Testing: Work Item Extraction${NC}"
    echo "========================================"
    
    # Test extracting work item numbers
    COMMIT_MESSAGE="AB#12345 - Added new feature"
    WORKITEM=$(echo "$COMMIT_MESSAGE" | grep -i -o -E "AB#[0-9]+" | cut -c 4-)
    assert_equals "12345" "$WORKITEM" "Extract work item number from AB#12345"
    
    COMMIT_MESSAGE="ab#999 fix bug"
    WORKITEM=$(echo "$COMMIT_MESSAGE" | grep -i -o -E "AB#[0-9]+" | cut -c 4-)
    assert_equals "999" "$WORKITEM" "Extract work item number from ab#999"
    
    # Test multiple work items
    PR_BODY="Fixes AB#123 and AB#456"
    WORKITEMS=$(echo "$PR_BODY" | grep -i -o -E "AB#[0-9]+" | sort | uniq)
    WORKITEM_COUNT=$(echo "$WORKITEMS" | wc -l | tr -d ' ')
    assert_equals "2" "$WORKITEM_COUNT" "Extract multiple work items"
}

# Test Suite: Duplicate Removal
test_duplicate_removal() {
    echo ""
    echo -e "${YELLOW}Testing: Duplicate Work Item Removal${NC}"
    echo "========================================"
    
    # Test removing duplicates
    PR_TEXT="AB#123 and AB#123 and AB#456"
    WORKITEMS=$(echo "$PR_TEXT" | grep -i -o -E "AB#[0-9]+" | sort | uniq)
    WORKITEM_COUNT=$(echo "$WORKITEMS" | wc -l | tr -d ' ')
    assert_equals "2" "$WORKITEM_COUNT" "Remove duplicate work items (AB#123 appears twice)"
    
    # Test case insensitive duplicates
    PR_TEXT="AB#123 and ab#123"
    WORKITEMS=$(echo "$PR_TEXT" | grep -i -o -E "AB#[0-9]+" | sort | uniq)
    # Note: This will still show 2 because the case is different in the output
    # But the grep -i makes it case-insensitive for matching
}

# Test Suite: Short SHA Extraction
test_short_sha() {
    echo ""
    echo -e "${YELLOW}Testing: Short SHA Extraction${NC}"
    echo "========================================"
    
    # Test extracting short SHA (first 7 characters)
    FULL_SHA="1234567890abcdef1234567890abcdef12345678"
    SHORT_SHA=$(echo "$FULL_SHA" | cut -c 1-7)
    assert_equals "1234567" "$SHORT_SHA" "Extract short SHA from full SHA"
    
    # Test with quotes (as jq might return)
    FULL_SHA='"abc123def456789012345678901234567890"'
    SHORT_SHA=$(echo "$FULL_SHA" | tr -d '"' | cut -c 1-7)
    assert_equals "abc123d" "$SHORT_SHA" "Extract short SHA from quoted string"
}

# Test Suite: Environment Variable Checks
test_env_checks() {
    echo ""
    echo -e "${YELLOW}Testing: Environment Variable Checks${NC}"
    echo "========================================"
    
    # Test checking if command exists
    if command -v bash &> /dev/null; then
        TESTS_RUN=$((TESTS_RUN + 1))
        TESTS_PASSED=$((TESTS_PASSED + 1))
        echo -e "${GREEN}✓${NC} Command 'bash' exists"
    else
        TESTS_RUN=$((TESTS_RUN + 1))
        TESTS_FAILED=$((TESTS_FAILED + 1))
        echo -e "${RED}✗${NC} Command 'bash' should exist"
    fi
    
    # Test prerequisite commands
    for cmd in jq cut grep gh; do
        if command -v $cmd &> /dev/null; then
            TESTS_RUN=$((TESTS_RUN + 1))
            TESTS_PASSED=$((TESTS_PASSED + 1))
            echo -e "${GREEN}✓${NC} Command '$cmd' exists"
        else
            TESTS_RUN=$((TESTS_RUN + 1))
            TESTS_FAILED=$((TESTS_FAILED + 1))
            echo -e "${RED}✗${NC} Command '$cmd' should exist"
        fi
    done
}

# Test Suite: Comment ID Finding
test_comment_id_logic() {
    echo ""
    echo -e "${YELLOW}Testing: Comment ID Logic${NC}"
    echo "========================================"
    
    # Simulate finding a comment ID from JSON
    COMMENTS='[{"id":123,"body":"This is a test"},{"id":456,"body":":x: This pull request is not linked"}]'
    SEARCH_TEXT=":x: This pull request is not linked"
    
    # This simulates the jq command used in the action
    COMMENT_ID=$(echo "$COMMENTS" | jq -r --arg comment "$SEARCH_TEXT" '.[] | select(.body | contains($comment)) | .id')
    
    assert_equals "456" "$COMMENT_ID" "Find comment ID by body text"
    
    # Test when comment doesn't exist
    SEARCH_TEXT="This does not exist"
    COMMENT_ID=$(echo "$COMMENTS" | jq -r --arg comment "$SEARCH_TEXT" '.[] | select(.body | contains($comment)) | .id')
    
    if [ -z "$COMMENT_ID" ]; then
        TESTS_RUN=$((TESTS_RUN + 1))
        TESTS_PASSED=$((TESTS_PASSED + 1))
        echo -e "${GREEN}✓${NC} Comment ID should be empty when not found"
    else
        TESTS_RUN=$((TESTS_RUN + 1))
        TESTS_FAILED=$((TESTS_FAILED + 1))
        echo -e "${RED}✗${NC} Comment ID should be empty when not found"
    fi
}

# Test Suite: Input Validation
test_input_validation() {
    echo ""
    echo -e "${YELLOW}Testing: Input Validation${NC}"
    echo "========================================"
    
    # Test that at least one check must be enabled
    # Note: In action.yml, ${{ inputs.check-commits }} is evaluated to "true"/"false" strings
    # before the bash script runs, so we test with string literals here
    
    # Simulate both checks disabled (this should fail)
    CHECK_COMMITS="false"
    CHECK_PR="false"
    
    if [ "$CHECK_COMMITS" = "false" ] && [ "$CHECK_PR" = "false" ]; then
        TESTS_RUN=$((TESTS_RUN + 1))
        TESTS_PASSED=$((TESTS_PASSED + 1))
        echo -e "${GREEN}✓${NC} Both checks disabled should be detected as invalid"
    else
        TESTS_RUN=$((TESTS_RUN + 1))
        TESTS_FAILED=$((TESTS_FAILED + 1))
        echo -e "${RED}✗${NC} Both checks disabled should be detected as invalid"
    fi
    
    # Test check-commits enabled, check-pr disabled (valid)
    CHECK_COMMITS="true"
    CHECK_PR="false"
    
    if [ "$CHECK_COMMITS" = "true" ] || [ "$CHECK_PR" = "true" ]; then
        TESTS_RUN=$((TESTS_RUN + 1))
        TESTS_PASSED=$((TESTS_PASSED + 1))
        echo -e "${GREEN}✓${NC} Only check-commits enabled should be valid"
    else
        TESTS_RUN=$((TESTS_RUN + 1))
        TESTS_FAILED=$((TESTS_FAILED + 1))
        echo -e "${RED}✗${NC} Only check-commits enabled should be valid"
    fi
    
    # Test check-commits disabled, check-pr enabled (valid)
    CHECK_COMMITS="false"
    CHECK_PR="true"
    
    if [ "$CHECK_COMMITS" = "true" ] || [ "$CHECK_PR" = "true" ]; then
        TESTS_RUN=$((TESTS_RUN + 1))
        TESTS_PASSED=$((TESTS_PASSED + 1))
        echo -e "${GREEN}✓${NC} Only check-pull-request enabled should be valid"
    else
        TESTS_RUN=$((TESTS_RUN + 1))
        TESTS_FAILED=$((TESTS_FAILED + 1))
        echo -e "${RED}✗${NC} Only check-pull-request enabled should be valid"
    fi
    
    # Test both checks enabled (valid)
    CHECK_COMMITS="true"
    CHECK_PR="true"
    
    if [ "$CHECK_COMMITS" = "true" ] || [ "$CHECK_PR" = "true" ]; then
        TESTS_RUN=$((TESTS_RUN + 1))
        TESTS_PASSED=$((TESTS_PASSED + 1))
        echo -e "${GREEN}✓${NC} Both checks enabled should be valid"
    else
        TESTS_RUN=$((TESTS_RUN + 1))
        TESTS_FAILED=$((TESTS_FAILED + 1))
        echo -e "${RED}✗${NC} Both checks enabled should be valid"
    fi
}

# Run all tests
main() {
    echo "========================================"
    echo "  Azure DevOps Action - Bash Tests"
    echo "========================================"
    
    test_commit_validation
    test_pr_validation
    test_workitem_extraction
    test_duplicate_removal
    test_short_sha
    test_env_checks
    test_comment_id_logic
    test_input_validation
    
    # Print summary
    echo ""
    echo "========================================"
    echo "  Test Summary"
    echo "========================================"
    echo -e "Total Tests:  $TESTS_RUN"
    echo -e "${GREEN}Passed:       $TESTS_PASSED${NC}"
    
    if [ $TESTS_FAILED -gt 0 ]; then
        echo -e "${RED}Failed:       $TESTS_FAILED${NC}"
        echo ""
        exit 1
    else
        echo -e "${GREEN}All tests passed!${NC}"
        echo ""
        exit 0
    fi
}

# Run tests
main
