#!/bin/bash
# implementation-search.sh - Script to spot check implementation patterns

# Enable strict mode
set -euo pipefail

# Check if search term is provided
if [ $# -eq 0 ]; then
    echo "Usage: $0 <search_term>"
    exit 1
fi

# Directories to exclude
EXCLUDE_DIRS=(
    ".venv"
    ".git"
    "./diagnostic_results"
    "./.pytest_cache"
    "./.ruff_cache"
    "./.mypy_cache"
    "./tests/__pycache__"
    "./__pycache__"
    "./src/mcp_server_tree_sitter/__pycache__"
    "./src/*/bootstrap/__pycache__"
    "./src/*/__pycache__"
)

# Files to exclude
EXCLUDE_FILES=(
    "./.gitignore"
    "./TODO.md"
    "./FEATURES.md"
)

# Build exclude arguments for grep
EXCLUDE_ARGS=""
for dir in "${EXCLUDE_DIRS[@]}"; do
    EXCLUDE_ARGS+="--exclude-dir=${dir} "
done

for file in "${EXCLUDE_FILES[@]}"; do
    EXCLUDE_ARGS+="--exclude=${file} "
done

# Run grep with all exclusions
grep -r "${1}" . ${EXCLUDE_ARGS} --binary-files=without-match
