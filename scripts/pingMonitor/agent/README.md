# 경쟁점 가동률 측정 서버 (2026-10-06)

- Oracle Cloud 무료(Always Free) `VM.Standard.E2.1.Micro`, 도쿄(ap-tokyo-1, 서울·춘천은 가입 목록에 없었음), Oracle Linux 9.
  계정 이름(tenancy) `jsj90`, 공개 IP `168.110.12.33`(임시형 — 서버를 지웠다 만들면 바뀜), 사용자 `opc`.
- 접속 키: 이 저장소를 쓰는 회사 PC의 `~/.ssh/oci_ping_monitor`(git 밖). 다른 PC에서 접속하려면 그 PC의 공개 키를 서버 `~/.ssh/authorized_keys`에 더한다.
- 서명 열쇠: 서버 `~/ping-agent/agent.key`(서버 밖으로 안 나옴). 공개 열쇠는 `src/lib/pingMonitor/agentAuth.ts`.
- 과금 없음: Always Free 모양·기본 부트 볼륨(200GB 무료 한도 안)·임시 공개 IP·인터넷 게이트웨이만 썼다. "Upgrade to Pay As You Go"는 누르지 않는다.

## 설치 / 갱신

```
scp -i ~/.ssh/oci_ping_monitor scripts/pingMonitor/agent/agent.mjs opc@168.110.12.33:~/ping-agent/
ssh -i ~/.ssh/oci_ping_monitor opc@168.110.12.33
  # 처음 한 번: Node 공식 파일을 /usr/local/lib/nodejs에(dnf는 메모리 부족으로 두 번 죽어 안 씀 — fping 없이 시스템 ping)
  curl -fsSL -o node.tar.xz https://nodejs.org/dist/v22.20.0/node-v22.20.0-linux-x64.tar.xz && mkdir -p ~/node && tar -xJf node.tar.xz -C ~/node --strip-components=1
  sudo cp -r ~/node /usr/local/lib/nodejs && sudo ln -sf /usr/local/lib/nodejs/bin/node /usr/local/bin/node && sudo restorecon -R /usr/local/lib/nodejs /usr/local/bin/node
  # 보조 메모리: /.swapfile(498M) + /swapfile2(2G, fstab 등록)
  # 매시 5분: **사용자 cron**(crontab -l). systemd 서비스(ping-agent.service/.timer)는 SELinux가 Node의 JIT 메모리를 막아 죽어서 안 쓴다(2026-10-06).
  #   5 * * * * cd /home/opc/ping-agent && /usr/local/bin/node agent.mjs >> /home/opc/ping-agent/cron.log 2>&1
  node ~/ping-agent/agent.mjs --dry      # 보내지 않고 재기만(한 번에 약 10분)
  tail ~/ping-agent/cron.log             # 매시 기록
```

GitHub Actions(`.github/workflows/ping-monitor.yml`, Vercel TCP만)는 매시 35분에 예비로 돈다 — 같은 시(時)는 먼저 쓴 쪽만 남으니 서버가 살아 있으면 건너뛴다.
