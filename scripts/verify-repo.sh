#!/usr/bin/env bash
set -euo pipefail

git diff --check

if [[ -n "${GITHUB_BASE_REF:-}" ]]; then
  git diff --check "origin/${GITHUB_BASE_REF}...HEAD"
else
  git show --check --format= HEAD
fi

required_files=(
  LICENSE
  README.md
  CONTRIBUTING.md
  docs/product-direction.md
  docs/team-work-split.md
  .github/pull_request_template.md
  .github/workflows/ci.yml
)

for required_file in "${required_files[@]}"; do
  if [[ ! -s "${required_file}" ]]; then
    echo "Required repository file is missing or empty: ${required_file}" >&2
    exit 1
  fi
done

for owner in Gnanasekaran Anandh Vasanth; do
  if ! grep -q "${owner}" docs/team-work-split.md; then
    echo "Team work split is missing owner: ${owner}" >&2
    exit 1
  fi
done

if grep -R "agent-native-runtime-solo" README.md CONTRIBUTING.md docs .github; then
  echo "Stale solo-work references remain." >&2
  exit 1
fi

echo "Repository foundation verified."
