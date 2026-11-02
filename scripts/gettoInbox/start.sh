#!/bin/sh
# 게토 받는 프로그램이 안 떠 있으면 띄운다. crontab(@reboot + 5분마다)에서 부른다.
# 이미 떠 있으면 receiver.mjs가 포트 겹침으로 조용히 끝나므로 두 개가 돌지 않는다.
cd "$HOME/getto-receiver" || exit 1
mkdir -p "$HOME/getto-inbox"
nohup "$HOME/node/bin/node" receiver.mjs >> "$HOME/getto-inbox/receiver.out" 2>&1 &
