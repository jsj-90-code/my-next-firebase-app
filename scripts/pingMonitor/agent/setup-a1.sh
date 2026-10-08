#!/bin/bash
# 새 측정 서버(Oracle 무료 최대 Ampere A1 4 OCPU·24GB, ARM) 한 번에 세팅(2026-10-08 — 옛 Micro 498MB가 메모리 부족으로 두 번 멈춤).
# 회사 PC에서(NEW=새 서버 공개 IP, 옛 서버 168.110.12.33):
#   K=~/.ssh/oci_ping_monitor; NEW=새IP
#   ssh -i $K opc@$NEW 'mkdir -p ~/ping-agent'
#   scp -3 -i $K opc@168.110.12.33:~/ping-agent/agent.key opc@$NEW:~/ping-agent/      # 서명 열쇠 그대로 옮김(웹 수정 불필요)
#   scp -i $K scripts/pingMonitor/agent/{agent.mjs,timestamp.mjs,timestamp_probe.py} opc@$NEW:~/ping-agent/
#   ssh -i $K opc@$NEW 'bash -s' < scripts/pingMonitor/agent/setup-a1.sh
#   ssh -i $K opc@168.110.12.33 'crontab -r'                                          # 옛 서버 매시 실행 끄기(새 서버 첫 회차 확인 뒤)
# 옛 서버가 안 살아나 agent.key를 못 옮기면: 새 서버에서 openssl genpkey -algorithm ed25519 -out ~/ping-agent/agent.key
#   → openssl pkey -in ~/ping-agent/agent.key -pubout 결과를 src/lib/pingMonitor/agentAuth.ts 공개 열쇠에 붙여 배포.
set -eu

echo "== 1. Node 22 (ARM)"
if ! /usr/local/bin/node -v 2>/dev/null; then
  curl -fsSL -o /tmp/node.tar.xz https://nodejs.org/dist/v22.20.0/node-v22.20.0-linux-arm64.tar.xz
  sudo mkdir -p /usr/local/lib/nodejs && sudo tar -xJf /tmp/node.tar.xz -C /usr/local/lib/nodejs --strip-components=1
  sudo ln -sf /usr/local/lib/nodejs/bin/node /usr/local/bin/node && sudo restorecon -R /usr/local/lib/nodejs /usr/local/bin/node || true
  /usr/local/bin/node -v
fi
python3 --version

echo "== 2. 파일 확인"
ls -l ~/ping-agent/{agent.key,agent.mjs,timestamp.mjs,timestamp_probe.py}

echo "== 3. 감시견(굳으면 스스로 재부팅)"
sudo modprobe softdog && echo softdog | sudo tee /etc/modules-load.d/softdog.conf >/dev/null
sudo mkdir -p /etc/systemd/system.conf.d
printf '[Manager]\nRuntimeWatchdogSec=60s\nRebootWatchdogSec=5min\n' | sudo tee /etc/systemd/system.conf.d/watchdog.conf >/dev/null
sudo systemctl daemon-reexec

echo "== 4. 집 PC 접속 키"
KEY='ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOnytoJe/oxDuBaYeJbmGBM8uHpsjhLRTIFng5GDwyWM home-pc-ping-monitor'
grep -qF "$KEY" ~/.ssh/authorized_keys || echo "$KEY" >> ~/.ssh/authorized_keys

echo "== 5. 시험 측정(보내지 않음, 약 10분)"
cd ~/ping-agent && /usr/local/bin/node agent.mjs --dry

echo "== 6. 매시 5분 실행 등록 (메모리 넉넉 — 힙 제한 1GB)"
LINE='5 * * * * cd /home/opc/ping-agent && flock -n /tmp/ping-agent.lock timeout -k 60 3000 /usr/local/bin/node --max-old-space-size=1024 agent.mjs >> /home/opc/ping-agent/cron.log 2>&1'
( crontab -l 2>/dev/null | grep -v 'agent.mjs'; echo "$LINE" ) | crontab -
crontab -l
free -m; nproc
