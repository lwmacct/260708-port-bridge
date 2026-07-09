#!/usr/bin/env bash
set -euo pipefail

__main() {
  test -n "${SOURCE_TAG:-}"

  node -e "
    const fs = require('fs');
    const tag = process.env.SOURCE_TAG;
    const packageJsons = [
      'package.json',
      ...fs.readdirSync('extensions', { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => 'extensions/' + entry.name + '/package.json'),
    ];

    const versions = packageJsons.map((path) => {
      const pkg = JSON.parse(fs.readFileSync(path, 'utf8'));
      if (typeof pkg.version !== 'string' || pkg.version.length === 0) {
        throw new Error(path + ' is missing version');
      }
      return [path, pkg.version];
    });

    const expected = tag.replace(/^v/, '');
    const mismatches = versions.filter(([, version]) => version !== expected);

    if (!/^v[0-9]+\\.[0-9]+\\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?$/.test(tag)) {
      throw new Error('Release tag must look like v1.2.3.');
    }

    if (mismatches.length > 0) {
      for (const [path, version] of mismatches) {
        console.error(path + ' version ' + version + ' does not match ' + tag + '.');
      }
      process.exit(1);
    }
  "
}

__main "$@"
