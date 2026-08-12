#!/usr/bin/env bash
# install.sh — one-command bootstrap for this skill collection.
#
# Clones (or updates) this repository into a stable local checkout and installs its skills
# into ~/.claude, where Claude Code picks them up for every project on the machine.
#
# The repository is private, so the clone uses whatever GitHub credentials the machine
# already has (SSH key, gh auth, or a credential helper). Nothing here handles secrets.
#
#   bash tools/skill-installer/install.sh                       # install every skill
#   bash tools/skill-installer/install.sh continuous-improvement  # install just these
#   bash tools/skill-installer/install.sh --list
#   bash tools/skill-installer/install.sh --uninstall
#
# Environment overrides:
#   CLAUDE_SKILLS_REPO  git remote to clone (default: SSH URL below; set the https:// form
#                       if the machine authenticates over HTTPS instead of SSH)
#   CLAUDE_SKILLS_SRC   where the checkout lives (default: ~/.claude-src)
#
# Exit 0 on success; any failed step aborts (set -e) rather than half-installing.

set -euo pipefail

REPO="${CLAUDE_SKILLS_REPO:-git@github.com:IFEOMA-CLOUD360/.claude.git}"
SRC="${CLAUDE_SKILLS_SRC:-$HOME/.claude-src}"

command -v git >/dev/null 2>&1 || { echo "install.sh: git is required" >&2; exit 1; }
command -v node >/dev/null 2>&1 || { echo "install.sh: node (>=18) is required" >&2; exit 1; }

if [ -d "$SRC/.git" ]; then
  echo "· updating $SRC"
  git -C "$SRC" fetch --quiet origin
  # Fast-forward only: a local edit in the checkout should surface as a failure here rather
  # than being silently discarded or merged.
  git -C "$SRC" pull --ff-only --quiet
else
  echo "· cloning $REPO → $SRC"
  git clone --quiet "$REPO" "$SRC"
fi

exec node "$SRC/tools/skill-installer/install.mjs" "$@"
