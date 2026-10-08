# 경쟁점 가동률 측정 서버 (2026-10-06)

- Oracle Cloud 무료(Always Free) `VM.Standard.E2.1.Micro`, 도쿄(ap-tokyo-1, 서울·춘천은 가입 목록에 없었음), Oracle Linux 9.
  계정 이름(tenancy) `jsj90`, 공개 IP `168.110.12.33`(임시형 — 서버를 지웠다 만들면 바뀜), 사용자 `opc`.
- 접속 키: 이 저장소를 쓰는 회사 PC의 `~/.ssh/oci_ping_monitor`(git 밖). 다른 PC에서 접속하려면 그 PC의 공개 키를 서버 `~/.ssh/authorized_keys`에 더한다.
- 서명 열쇠: 서버 `~/ping-agent/agent.key`(서버 밖으로 안 나옴). 공개 열쇠는 `src/lib/pingMonitor/agentAuth.ts`.
- 과금 없음: Always Free 모양·기본 부트 볼륨(200GB 무료 한도 안)·임시 공개 IP·인터넷 게이트웨이만 썼다. "Upgrade to Pay As You Go"는 누르지 않는다.

## 설치 / 갱신

### 타임스탬프 추가 (2026-10-08)

- 모든 활성 매장의 등록 IP에 핑·TCP와 함께 ICMP timestamp(type 13)를 보내며,
  요청한 IP의 type 14 응답에서 식별자·순번·체크섬까지 일치해야 집계한다. 중간 라우터 오류는 제외한다.
- `agent.mjs`, `timestamp.mjs`, `timestamp_probe.py`를 **함께** 배포한다. Python 3 표준 라이브러리만 사용한다.
  helper는 `sudo -n /usr/bin/python3`로 실행한다(기존 Oracle sudo 권한 사용). Node 전체를 root로 실행하지 않는다.
- 초당 최대 100개, 미응답 IP에 한 번 재시도. 핑·TCP와 병렬이며 IP 합집합으로 중복을 제거한다.
  helper가 실패하면 로그에 오류를 남기고 기존 `icmp+tcp`로 측정한다. 성공한 회차는 `icmp+tcp+timestamp`로 기록한다.
- 서버 로그의 `타임스탬프만`은 기존 두 방식에서 놓쳤던 추가 응답 수다. 실제 이용 좌석 수의 검증을 뜻하지 않는다.
- 과거 기록·매시 5분 cron·중복 회차 방지 방식은 그대로다. 웹의 즉석 확인과 예비 GitHub 경로는 TCP만 가능하다.
- 검증: `node --test scripts/pingMonitor/agent/timestamp.test.mjs`,
  `python3 scripts/pingMonitor/agent/test_timestamp_probe.py`. 배포 전 등록 IP로 helper 실측을 확인한다.

```
scp -i ~/.ssh/oci_ping_monitor scripts/pingMonitor/agent/agent.mjs scripts/pingMonitor/agent/timestamp.mjs scripts/pingMonitor/agent/timestamp_probe.py opc@168.110.12.33:~/ping-agent/
ssh -i ~/.ssh/oci_ping_monitor opc@168.110.12.33
  # 처음 한 번: Node 공식 파일을 /usr/local/lib/nodejs에(dnf는 메모리 부족으로 두 번 죽어 안 씀 — fping 없이 시스템 ping)
  curl -fsSL -o node.tar.xz https://nodejs.org/dist/v22.20.0/node-v22.20.0-linux-x64.tar.xz && mkdir -p ~/node && tar -xJf node.tar.xz -C ~/node --strip-components=1
  sudo cp -r ~/node /usr/local/lib/nodejs && sudo ln -sf /usr/local/lib/nodejs/bin/node /usr/local/bin/node && sudo restorecon -R /usr/local/lib/nodejs /usr/local/bin/node
  # 보조 메모리: /.swapfile(498M) + /swapfile2(2G, fstab 등록)
  # 매시 5분: **사용자 cron**(crontab -l). systemd 서비스(ping-agent.service/.timer)는 SELinux가 Node의 JIT 메모리를 막아 죽어서 안 쓴다(2026-10-06).
  #   5 * * * * cd /home/opc/ping-agent && flock -n /tmp/ping-agent.lock timeout 3000 /usr/local/bin/node --max-old-space-size=256 agent.mjs >> /home/opc/ping-agent/cron.log 2>&1
  #   2026-10-07: 08시 회차에 서버가 통째로 멈춤(ssh 응답 없음 → 콘솔 재부팅, 일반 재부팅이 Stopping에서 15분 걸림).
  #   실제 메모리는 498MB이고, 05시 회차가 3,148초(52분)나 걸린 적이 있다 → 회차가 겹치면 node 두 개 + 스왑으로 멈춘다고 보고
  #   flock(겹치면 건너뜀)·timeout 50분·힙 256MB를 걸었다. 다음엔 원인을 보려고 journald를 디스크에 남기게 함(/var/log/journal).
  #   멈추면: 콘솔 → 인스턴스 → Actions → Reboot → **"Force reboot" 체크**(안 하면 정상 종료를 15분 기다린다).
  node ~/ping-agent/agent.mjs --dry      # 보내지 않고 재기만(한 번에 약 10분)
  tail ~/ping-agent/cron.log             # 매시 기록
```

GitHub Actions(`.github/workflows/ping-monitor.yml`, Vercel TCP만)는 매시 35분에 예비로 돈다 — 같은 시(時)는 먼저 쓴 쪽만 남으니 서버가 살아 있으면 건너뛴다.
