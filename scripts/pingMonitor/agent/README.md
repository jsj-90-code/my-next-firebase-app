# 경쟁점 가동률 측정 서버 (2026-10-06)

- Oracle Cloud 무료(Always Free) `VM.Standard.E2.1.Micro`, 도쿄(ap-tokyo-1, 서울·춘천은 가입 목록에 없었음), Oracle Linux 9.
  계정 이름(tenancy) `jsj90`, 공개 IP `168.110.12.33`(임시형 — 서버를 지웠다 만들면 바뀜), 사용자 `opc`.
- 접속 키: 이 저장소를 쓰는 회사 PC의 `~/.ssh/oci_ping_monitor`(git 밖). 다른 PC에서 접속하려면 그 PC의 공개 키를 서버 `~/.ssh/authorized_keys`에 더한다.
- 서명 열쇠: 서버 `~/ping-agent/agent.key`(서버 밖으로 안 나옴). 공개 열쇠는 `src/lib/pingMonitor/agentAuth.ts`.
- 과금 없음: Always Free 모양·기본 부트 볼륨(200GB 무료 한도 안)·임시 공개 IP·인터넷 게이트웨이만 썼다. "Upgrade to Pay As You Go"는 누르지 않는다.

## 설치 / 갱신

### 회차 빠짐 막기 (2026-10-08 저녁 — 서버가 또 멈춰 19·20시가 빠짐)

- 증상: 22번 포트는 열리는데 ssh 인사말이 30초 넘게 안 옴 = 10-07 08시와 같은 멈춤. 콘솔에서 **Force reboot**.
- `agent.mjs`: 웹 요청 90초 제한·4번 시도, 못 보낸 결과는 `pending/`에 두고 다음 회차에 다시 보냄(웹은 6시간까지 받음),
  시작할 때 지난 회차가 남긴 타임스탬프 helper를 정리(`timeout`은 node만 죽여서 sudo python이 남을 수 있다).
- 예비 GitHub는 매시 32·42·52분 세 번. 서버가 이미 쓴 시·30분 전 도착은 Vercel이 읽기 1번으로 건너뛴다.
- **재부팅 뒤 서버에서 할 일**(회사 PC, 키 있음) — 감시견·crontab `timeout -k 60`·집 PC 키·멈춘 원인 출력을 `harden.sh` 하나로 묶음(여러 번 돌려도 같음):
  ```
  scp -i ~/.ssh/oci_ping_monitor scripts/pingMonitor/agent/agent.mjs opc@168.110.12.33:~/ping-agent/
  ssh -i ~/.ssh/oci_ping_monitor opc@168.110.12.33 'bash -s' < scripts/pingMonitor/agent/harden.sh
  ```
  Oracle 콘솔 로그인은 2단계가 회사 노트북 FIDO(Windows Hello)뿐이라 집에서 안 됐다(10-08) — 휴대폰 인증 앱·우회 코드를 추가할 것.
  원인이 스왑 몸살(2G 스왑에서 몇 시간 허우적)이면 `/swapfile2`를 끄는 것도 검토 — 그러면 메모리가 모자랄 때 서버가 굳는 대신 그 회차만 죽고 다음 회차는 돈다.

### 무료 최대 사양으로 옮기기 (2026-10-08 결정, 회사에서 실행)

- 옛 Micro(메모리 498MB)가 멈춤 두 번 → Always Free 최대 **Ampere A1 4 OCPU·24GB**(ARM)로 새 서버를 만들어 옮긴다. 도쿄는 A1 재고 부족(Out of capacity)이 잦다 — 다시 시도.
- 콘솔: Compute → Instances → Create → Shape `VM.Standard.A1.Flex` 4 OCPU·24GB · Oracle Linux 9 · 같은 VCN · 공개 키는 회사 PC `~/.ssh/oci_ping_monitor.pub`.
- 세팅: `setup-a1.sh` 맨 위 명령 그대로(서명 열쇠는 옛 서버에서 옮겨 웹 수정 불필요). 새 서버 첫 회차가 기록되면 옛 서버 `crontab -r`. 이 README의 IP도 새 것으로.
- 이걸 하면 `harden.sh`(옛 서버용)는 건너뛰어도 된다.

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

### OCI CLI(API 키) — 집 PC에서도 재부팅·서버 생성 (2026-10-08)

- 콘솔은 2단계가 회사 노트북 FIDO뿐이라 집에서 못 들어간다. API 키는 2단계를 안 거친다.
- 집 PC가 만든 키(비밀 키는 집 PC `~/.oci/oci_api_key.pem`, 밖으로 안 나감). 아래 공개 키를 회사에서 콘솔 → 프로필 → 내 프로필 → API 키 → API 키 추가 → "공개 키 붙여넣기"로 등록. 지문 `8d:37:62:80:95:67:06:b1:9e:56:29:d6:30:8a:ee:fa`.
- 등록 뒤 화면에 뜨는 "구성 파일 미리보기"(tenancy·user OCID, region) 내용을 Claude에게 주면 집 PC에서 CLI 설정.

```
-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAxnEhOmDxhCUuvdAqgEej
/tx6xvyBAY61TTBy106btbtgMrv/3dctfn8FQ1dq70Yar3gvIvdACQSvf/nryxel
uuxBSz9kNOdk3w2yI7McI/5zFfmqArcMFqVlQLl7c8Za9vvNh2Smt0usa41//si4
iSsYLKIKDrhSql7BHhM3l55Z/Jnt4sSyzl3CJVzAYozhfnyvHXaYZQV9aSJT0eXZ
772Qlm53ePPgluD+8/Nd1ixHdOqkYfh4Q1BLPExQiOb/ArFcKSHtAsLO4KuG7UrQ
sxnMHmQOB2r/ziUAcpUXjbJ0/7I4PLB4DRfucHnaK+whbqXa2dOTfuYy4UagTb4i
MQIDAQAB
-----END PUBLIC KEY-----
```
