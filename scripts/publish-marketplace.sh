#!/usr/bin/env bash
set -euo pipefail

__main() {
  shopt -s nullglob
  _artifacts=(artifacts/vsix/*.vsix)

  if [ "${#_artifacts[@]}" -eq 0 ]; then
    echo "No VSIX artifacts found." >&2
    exit 1
  fi

  pnpm exec vsce publish --azure-credential --skip-duplicate --packagePath "${_artifacts[@]}"

  {
    echo "### Marketplace"
    echo

    for _artifact in "${_artifacts[@]}"; do
      echo "- Published \`$(basename "${_artifact}")\`"
    done
  } >> "${GITHUB_STEP_SUMMARY:-/dev/null}"
}

__main "$@"
