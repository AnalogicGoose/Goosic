#!/bin/sh
# Cargo `runner` for local macOS development.
#
# Debug builds are ad-hoc signed, and an ad-hoc signature is just a hash of the
# binary — so every rebuild produces a new code identity. The login Keychain
# binds its "Always Allow" decision to the signature, which is why answering the
# prompt never sticks: the next `cargo build` invalidates it. Re-signing each
# build with one *stable* identity makes the ACL match across rebuilds, so the
# Keychain prompt is answered once and stays answered.
#
# Any stable identity works — an Apple Development certificate, or a self-signed
# Code Signing one from Keychain Access -> Certificate Assistant. Nothing about
# it needs to be trusted for distribution; it only has to stop changing.
#
# By default the first code-signing identity in the keychain is used, so this
# works with no setup at all. Set GOOSIC_DEV_SIGN_IDENTITY to pick a specific
# one when the keychain holds several:
#   export GOOSIC_DEV_SIGN_IDENTITY="Apple Development: you@example.com (TEAMID)"
#
# With no identity available the script signs nothing and just runs the binary,
# so it stays a no-op on CI and for anyone who has not set one up.
set -eu

BIN="$1"
shift

IDENTITY="${GOOSIC_DEV_SIGN_IDENTITY:-}"
if [ -z "$IDENTITY" ]; then
	# `security` prints `  1) <40-char SHA1> "Name"`. The hash is taken rather
	# than the name because it is unambiguous when two certificates share a
	# common name, and `codesign` accepts either.
	IDENTITY=$(security find-identity -v -p codesigning 2>/dev/null |
		awk '/^ *[0-9]+\) [0-9A-F]{40} /{print $2; exit}')
fi

if [ "$(uname -s)" = "Darwin" ] && [ -n "$IDENTITY" ]; then
	codesign --force --sign "$IDENTITY" "$BIN" >/dev/null 2>&1 ||
		echo "[dev-sign] codesign failed; continuing with the ad-hoc signature" >&2
fi

exec "$BIN" "$@"
