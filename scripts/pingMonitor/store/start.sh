#!/bin/sh
# 사내 저장소가 안 떠 있으면 띄운다. crontab(@reboot + 5분마다)에서 부른다.
# 이미 떠 있으면 server.mjs가 포트 겹침으로 조용히 끝나므로 두 개가 돌지 않는다.
cd "$HOME/ping-store" || exit 1
nohup "$HOME/node/bin/node" --disable-warning=ExperimentalWarning server.mjs >> "$HOME/ping-store/server.out" 2>&1 &
