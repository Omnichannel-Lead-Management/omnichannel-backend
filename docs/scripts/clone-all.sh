#!/bin/bash
set -euo pipefail

ORG="${GITHUB_ORG:-Omnichannel-Lead-Management}"
TARGET="${1:-.}"

mkdir -p "$TARGET"
cd "$TARGET"

repos=(
  "omnichannel-backend"
  "chatbot-builder"
  "web-dashboard"
)

for repo in "${repos[@]}"; do
  if [ -d "$repo/.git" ]; then
    echo "Already cloned: $repo"
    continue
  fi
  echo "Cloning $repo..."
  git clone "https://github.com/${ORG}/${repo}.git"
done

echo "All repositories cloned."
