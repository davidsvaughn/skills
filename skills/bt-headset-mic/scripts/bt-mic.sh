#!/usr/bin/env bash
# Switch a connected Bluetooth headset between playback-only (A2DP) and headset mode (HFP/HSP, which enables its mic).
# Works with PulseAudio and with PipeWire's pulse server; needs pactl.
# Usage: bt-mic.sh status | on | off   [card-name-substring]
set -euo pipefail

cmd=${1:-status}
match=${2:-}

cards=$(pactl list short cards | awk '{print $2}' | grep '^bluez_card\.' | grep -F -- "$match" || true)
if [ -z "$cards" ]; then
  echo "No connected Bluetooth audio card${match:+ matching '$match'}." >&2
  exit 1
fi
if [ "$(printf '%s\n' "$cards" | wc -l)" -gt 1 ]; then
  echo "Several Bluetooth cards are connected; pass part of one name as the second argument:" >&2
  printf '  %s\n' $cards >&2
  exit 1
fi
card=$cards

profiles() { pactl list cards | awk -v c="$card" '$0 ~ "Name: "c {f=1; next} f && /^\tName: / {exit} f && /^\tProfiles:/ {p=1; next} p && /^\t\t/ {sub(/^\t+/,""); sub(/:.*/,""); print; next} p {exit}'; }
active() { pactl list cards | awk -v c="$card" '$0 ~ "Name: "c {f=1} f && /Active Profile:/ {print $3; exit}'; }
# First available profile from a preference list.
pick() { local avail; avail=$(profiles); for p in "$@"; do grep -qx -- "$p" <<<"$avail" && { echo "$p"; return; }; done; return 1; }

case $cmd in
  status)
    echo "card:    $card"
    echo "profile: $(active)"
    pactl info | grep -E '^(Server Name|Default Sink|Default Source)'
    ;;
  on)
    # PipeWire names first (mSBC is the better-sounding wideband variant), then PulseAudio names.
    prof=$(pick headset-head-unit-msbc headset-head-unit handsfree_head_unit headset_head_unit) || {
      echo "This headset offers no headset/handsfree profile, so its mic cannot be used. Profiles: $(profiles | tr '\n' ' ')" >&2; exit 1; }
    pactl set-card-profile "$card" "$prof"
    sleep 1
    src=$(pactl list short sources | awk '{print $2}' | grep "^bluez_.*${card#bluez_card.}" | grep -v '\.monitor$' | head -1)
    [ -n "$src" ] || { echo "Profile $prof is active but no headset source appeared." >&2; exit 1; }
    sink=$(pactl list short sinks | awk '{print $2}' | grep "^bluez_.*${card#bluez_card.}" | head -1)
    pactl set-default-source "$src"
    [ -n "$sink" ] && pactl set-default-sink "$sink"
    echo "Headset mode on ($prof). Default mic: $src"
    ;;
  off)
    prof=$(pick a2dp-sink a2dp_sink a2dp-sink-aac a2dp-sink-sbc) || { echo "No A2DP profile offered. Profiles: $(profiles | tr '\n' ' ')" >&2; exit 1; }
    pactl set-card-profile "$card" "$prof"
    sleep 1
    sink=$(pactl list short sinks | awk '{print $2}' | grep "^bluez_.*${card#bluez_card.}" | head -1)
    [ -n "$sink" ] && pactl set-default-sink "$sink"
    # Back to the first built-in (non-Bluetooth, non-monitor) mic.
    src=$(pactl list short sources | awk '{print $2}' | grep -v '^bluez_' | grep -v '\.monitor$' | head -1)
    [ -n "$src" ] && pactl set-default-source "$src"
    echo "Playback mode restored ($prof). Default mic: ${src:-unchanged}"
    ;;
  *)
    echo "usage: $0 status|on|off [card-name-substring]" >&2; exit 2 ;;
esac
