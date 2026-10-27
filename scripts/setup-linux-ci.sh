#!/usr/bin/env bash
set -euo pipefail
# Only temporary GitHub-hosted runners: permit user namespaces for the tested executables.
# Chromium's renderer sandbox stays enabled; no global AppArmor/sysctl override is used.
[[ "${GITHUB_ACTIONS:-}" == true && "${RUNNER_OS:-}" == Linux ]]
sudo tee /etc/apparmor.d/jab-ci >/dev/null <<PROFILE
abi <abi/4.0>,
include <tunables/global>
profile jab-ci-electron "${GITHUB_WORKSPACE}/node_modules/electron/dist/electron" flags=(unconfined) {
  userns,
}
profile jab-ci-package "${GITHUB_WORKSPACE}/release/linux-unpacked/jab" flags=(unconfined) {
  userns,
}
profile jab-ci-installed "/tmp/jab-installed-*/squashfs-root/jab" flags=(unconfined) {
  userns,
}
PROFILE
sudo apparmor_parser -r /etc/apparmor.d/jab-ci
