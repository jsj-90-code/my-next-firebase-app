#!/bin/bash
# 측정 서버 멈춤 대비(2026-10-08 저녁 19·20시 빠짐 후속). 회사 PC에서 한 번:
#   scp -i ~/.ssh/oci_ping_monitor scripts/pingMonitor/agent/agent.mjs opc@168.110.12.33:~/ping-agent/
#   ssh -i ~/.ssh/oci_ping_monitor opc@168.110.12.33 'bash -s' < scripts/pingMonitor/agent/harden.sh
# 여러 번 돌려도 같은 결과(이미 된 건 건너뜀). 출력 맨 아래 "멈춘 원인" 부분을 Claude에게 보여줄 것.
set -u

echo "== 1. 감시견: 시스템이 60초 넘게 굳으면 스스로 재부팅"
sudo modprobe softdog && echo softdog | sudo tee /etc/modules-load.d/softdog.conf >/dev/null
sudo mkdir -p /etc/systemd/system.conf.d
printf '[Manager]\nRuntimeWatchdogSec=60s\nRebootWatchdogSec=5min\n' | sudo tee /etc/systemd/system.conf.d/watchdog.conf >/dev/null
sudo systemctl daemon-reexec
ls -l /dev/watchdog* 2>/dev/null; systemctl show -p RuntimeWatchdogUSec

echo "== 2. crontab: timeout이 안 죽으면 60초 뒤 강제 종료"
crontab -l | sed 's/timeout 3000 /timeout -k 60 3000 /' | crontab -
crontab -l | grep agent.mjs

echo "== 3. 집 PC 접속 키"
KEY='ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOnytoJe/oxDuBaYeJbmGBM8uHpsjhLRTIFng5GDwyWM home-pc-ping-monitor'
grep -qF "$KEY" ~/.ssh/authorized_keys || echo "$KEY" >> ~/.ssh/authorized_keys
grep -c home-pc-ping-monitor ~/.ssh/authorized_keys

echo "== 4. 에이전트 문법 확인(올린 agent.mjs)"
/usr/local/bin/node --check ~/ping-agent/agent.mjs && grep -c "pending" ~/ping-agent/agent.mjs

echo "== 5. 멈춘 원인 (직전 부팅 로그 · 메모리)"
journalctl --list-boots --no-pager | tail -4
journalctl -b -1 -p warning --no-pager | grep -iE "oom|out of memory|hung|blocked|soft lockup|killed" | tail -30
journalctl -b -1 --no-pager | tail -15
free -m; swapon --show
tail -15 ~/ping-agent/cron.log
