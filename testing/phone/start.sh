#!/bin/bash
set -eu
trap "adb emu kill; exit 0" TERM
no() { echo "phone: $1; the emulator's log ends:"; tail -20 /emulator.log; exit 1; }
[ -w /dev/kvm ] || { echo "phone: no /dev/kvm: run it with --device /dev/kvm"; exit 1; }
adb start-server 2> /dev/null
emulator -avd phone -no-window -no-audio -no-boot-anim -no-snapshot -no-metrics -gpu swangle_indirect -feature -ModemSimulator > /emulator.log 2>&1 &
emu=$!
# up SECONDS COMMAND WHAT: waits until COMMAND succeeds
up() { for _ in $(seq "$1"); do sh -c "$2" > /dev/null 2>&1 && return; kill -0 $emu 2> /dev/null || no "the emulator stopped"; sleep 1; done; no "$3 in $1 s"; }
up 300 '[ "$(adb shell getprop sys.boot_completed | tr -d "\r")" = 1 ]' "Android did not start"
adb push /touch /data/local/tmp/touch > /dev/null 2>&1
adb shell svc power stayon true
adb shell settings put global hide_error_dialogs 1
adb shell settings put system screen_off_timeout 2147483647
adb shell wm dismiss-keyguard
adb shell input keyevent KEYCODE_WAKEUP
if [ "$(adb shell dumpsys package com.android.chrome | grep -m1 versionName= | cut -d= -f2 | tr -d '\r')" != "$(cat /chrome.version)" ]; then
  adb install -r /chrome.apk > /dev/null
fi
adb shell 'echo "_ --disable-fre --no-default-browser-check --no-first-run" > /data/local/tmp/chrome-command-line'
adb shell am set-debug-app --persistent com.android.chrome
adb shell pm grant com.android.chrome android.permission.POST_NOTIFICATIONS
adb reverse tcp:8788 tcp:8788 > /dev/null
adb shell am start -a android.intent.action.VIEW -d http://127.0.0.1:8788/ com.android.chrome > /dev/null
up 120 'adb shell cat /proc/net/unix | grep -q chrome_devtools_remote' "Chrome did not start"
adb forward tcp:9222 localabstract:chrome_devtools_remote > /dev/null
echo "phone up: Android $(adb shell getprop ro.build.version.release | tr -d '\r'), Chrome $(cat /chrome.version), 1080x2400 at 420 dpi; Ki at http://127.0.0.1:8788"
sleep infinity & wait
