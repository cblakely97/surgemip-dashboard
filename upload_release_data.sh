#!/usr/bin/env bash
# Upload timeseries data to a GitHub Release so the repo stays under the
# GitHub Pages size limit. Run this once after initial setup, and again
# whenever you rebuild the station data with a new release tag.
#
# Requirements: gh CLI authenticated (`gh auth login` or GITHUB_TOKEN env var)
#
# Usage:
#   bash upload_release_data.sh                    # creates/replaces data-v1
#   bash upload_release_data.sh data-v2            # use a different tag
#
set -euo pipefail

REPO="cblakely97/surgemip-dashboard"
TAG="${1:-data-v1}"
TITLE="Station timeseries data ${TAG}"
DATA_DIR="$(dirname "$0")/data"

GH="${GH_BIN:-gh}"

echo "==> Checking gh auth..."
"$GH" auth status

# Create or overwrite the release (--clobber replaces existing assets with same name)
echo "==> Creating release ${TAG} ..."
if "$GH" release view "$TAG" --repo "$REPO" &>/dev/null; then
  echo "    Release ${TAG} already exists — will upload/overwrite assets."
else
  "$GH" release create "$TAG" \
    --repo "$REPO" \
    --title "$TITLE" \
    --notes "Timeseries JSON data for the SurgeMIP dashboard. Hosted here to keep the Pages repo under size limits." \
    --prerelease
fi

# Upload stations.json and station_node_map.json
echo "==> Uploading metadata files..."
"$GH" release upload "$TAG" \
  --repo "$REPO" \
  --clobber \
  "${DATA_DIR}/stations.json" \
  "${DATA_DIR}/station_node_map.json"

# Upload all timeseries JSONs in parallel batches
TIMESERIES_DIR="${DATA_DIR}/timeseries"
FILES=("${TIMESERIES_DIR}"/*.json)
TOTAL=${#FILES[@]}
BATCH=50   # gh release upload accepts multiple files at once; 50 is safe

echo "==> Uploading ${TOTAL} timeseries files in batches of ${BATCH}..."
for ((i=0; i<TOTAL; i+=BATCH)); do
  BATCH_FILES=("${FILES[@]:i:BATCH}")
  echo "    Batch $((i/BATCH + 1)) / $(( (TOTAL + BATCH - 1) / BATCH )) (files $((i+1))–$((i+${#BATCH_FILES[@]})))"
  "$GH" release upload "$TAG" \
    --repo "$REPO" \
    --clobber \
    "${BATCH_FILES[@]}"
done

echo "==> Done! ${TOTAL} files uploaded to release ${TAG}."
echo "    Dashboard will fetch from:"
echo "    https://github.com/${REPO}/releases/download/${TAG}/<station_id>.json"
