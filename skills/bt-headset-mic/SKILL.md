---
name: bt-headset-mic
description: Turn a connected Bluetooth headset's microphone on or off on Linux (PulseAudio or PipeWire) by switching it between playback-only A2DP and headset (HFP/HSP) mode, and make it the default mic. Use when the user asks whether their Bluetooth earbuds or headphones mic is being used, wants to dictate or call through them, or wants the high-quality playback back.
---

# Bluetooth headset mic on Linux

A Bluetooth headset runs in one profile at a time.
In **A2DP** (high-fidelity playback) the headset's mic is off and does not appear as an input at all; the laptop's built-in mic stays the default.
In **HFP/HSP** (headset or handsfree) the mic works, but playback drops to phone-call quality.
So "use my headset mic" always means switching the profile, and "make it sound good again" means switching back.

## Check first

```bash
scripts/bt-mic.sh status
```

It prints the Bluetooth card, its active profile, and the default sink and source.
`a2dp_sink` or `a2dp-sink` as the profile means the mic is off.
If several Bluetooth cards are connected, every command takes part of a card name as a second argument.

## Turn the mic on

```bash
scripts/bt-mic.sh on
```

It picks the best headset profile the device offers (PipeWire `headset-head-unit-msbc`, then `headset-head-unit`, then PulseAudio `handsfree_head_unit` or `headset_head_unit`), switches to it, and makes the headset both the default mic and the default output.
A device with no headset profile has no usable mic on Linux; the script says so and lists what it does offer.

To confirm sound is arriving, record a few seconds while the user speaks and check the peak level (silence stays near zero; speech reaches thousands):

```bash
src=$(pactl get-default-source)
timeout 3 parecord --device="$src" --raw --format=s16le --channels=1 --rate=16000 \
  | od -An -td2 -w2 -v | awk '{v=$1<0?-$1:$1; if(v>m)m=v}END{print "peak", m}'
```

Apps that were already recording keep their old input until they reopen it or are moved: `pactl move-source-output <id> <source>` (ids from `pactl list short source-outputs`).

## Undo: back to high-quality playback

```bash
scripts/bt-mic.sh off
```

It switches the card back to A2DP, keeps the headset as the output, and sets the default mic back to the first built-in input.

## Without the script

The same steps by hand, with the names `pactl list cards` shows:

```bash
pactl list short cards                                    # find bluez_card.<ADDRESS>
pactl list cards | grep -A12 'Name: bluez_card'           # its profiles and the active one
pactl set-card-profile bluez_card.<ADDRESS> handsfree_head_unit   # PulseAudio; PipeWire: headset-head-unit
pactl set-default-source bluez_source.<ADDRESS>.handsfree_head_unit
# undo
pactl set-card-profile bluez_card.<ADDRESS> a2dp_sink             # PipeWire: a2dp-sink
pactl set-default-source <built-in source from: pactl list short sources>
```

The GUI equivalent is Settings > Sound (or `pavucontrol` > Configuration): change the headset's profile from "High Fidelity Playback (A2DP)" to "Headset/Handsfree Head Unit".

## Notes

- The choice does not persist: reconnecting the headset usually brings it back in A2DP, so run `on` again after a reconnect.
- PulseAudio offers only the narrowband handsfree profile on most systems; PipeWire with mSBC sounds noticeably better for calls and dictation.
- Dictation tools that pick an input device themselves (rather than following the system default) need the headset selected in their own settings.
