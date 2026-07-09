#!/usr/bin/env bash
set -euo pipefail

__package_field() {
  _package_json="$1"
  _field="$2"

  node -e "
    const fs = require('fs');
    const pkg = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
    const value = pkg[process.argv[2]];

    if (typeof value !== 'string' || value.length === 0) {
      console.error(process.argv[1] + ' is missing string field ' + process.argv[2]);
      process.exit(1);
    }

    console.log(value);
  " "${_package_json}" "${_field}"
}

__package_extension() {
  _package_json="$1"
  _artifact_dir="$2"
  _package_dir="$(dirname "${_package_json}")"
  _package_name="$(__package_field "${_package_json}" name)"
  _package_version="$(__package_field "${_package_json}" version)"
  _artifact_path="${_artifact_dir}/${_package_name}-${_package_version}.vsix"

  pnpm --dir "${_package_dir}" exec vsce package \
    --allow-missing-repository \
    --out "../../${_artifact_path}"
}

__main() {
  _repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  cd "${_repo_root}"

  _artifact_dir="artifacts/vsix"

  rm -rf "${_artifact_dir}"
  mkdir -p "${_artifact_dir}"

  shopt -s nullglob
  _package_jsons=(extensions/*/package.json)

  if [ "${#_package_jsons[@]}" -eq 0 ]; then
    echo "No extension packages found." >&2
    exit 1
  fi

  for _package_json in "${_package_jsons[@]}"; do
    __package_extension "${_package_json}" "${_artifact_dir}"
  done

  ls -lh "${_artifact_dir}"/*.vsix
}

__main "$@"
