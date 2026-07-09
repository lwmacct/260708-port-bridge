#!/usr/bin/env bash
set -euo pipefail

__main() {
  test -n "${RELEASE_TAG:-}"

  shopt -s nullglob
  _artifacts=(artifacts/vsix/*.vsix)

  if [ "${#_artifacts[@]}" -eq 0 ]; then
    echo "No VSIX artifacts found." >&2
    exit 1
  fi

  if gh release view "${RELEASE_TAG}" >/dev/null 2>&1; then
    gh release upload "${RELEASE_TAG}" "${_artifacts[@]}" --clobber
  else
    gh release create "${RELEASE_TAG}" "${_artifacts[@]}" \
      --verify-tag \
      --title "${RELEASE_TAG}" \
      --notes "Release ${RELEASE_TAG}"
  fi

  {
    echo "## Publish summary"
    echo
    echo "| Item | Value |"
    echo "| --- | --- |"
    echo "| Tag | \`${RELEASE_TAG}\` |"
    echo
    echo "### Assets"
    echo

    for _artifact in "${_artifacts[@]}"; do
      echo "- \`$(basename "${_artifact}")\`"
    done
  } >> "${GITHUB_STEP_SUMMARY}"
}

__main "$@"
