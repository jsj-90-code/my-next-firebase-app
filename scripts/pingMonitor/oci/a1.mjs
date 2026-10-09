// 측정 서버를 Oracle 무료 최대 A1(4 OCPU·24GB)로 — OCI API로 집/회사 어느 PC에서나(2026-10-08 밤 준비).
// 콘솔 로그인(2단계 패스키는 회사 노트북에만)을 안 거치려고 API 키(~/.oci/config DEFAULT)를 쓴다.
// 처음 한 번: cd scripts/pingMonitor/oci && npm install
//   node a1.mjs status            ← 서버 목록(모양·OCPU·메모리·상태·IP)
//   node a1.mjs reboot <IP>       ← 강제 재부팅(멈췄을 때)
//   node a1.mjs launch            ← A1 받기: 4·24 → 안 되면 2·12. 자리 없으면 종료 코드 2(재시도용)
//   node a1.mjs resize <IP>       ← 2·12로 받은 A1을 4·24로, 실제로 바뀔 때까지 확인
// 무료 한도(계정 전체): A1 합계 4 OCPU·24GB. 홈 리전(도쿄)에서만 무료 — 춘천 불가.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import common from "oci-common";
import core from "oci-core";
import identity from "oci-identity";

const provider = new common.ConfigFileAuthenticationDetailsProvider();
const tenancy = provider.getTenantId();
const compute = new core.ComputeClient({ authenticationDetailsProvider: provider });
const vnet = new core.VirtualNetworkClient({ authenticationDetailsProvider: provider });
const iam = new identity.IdentityClient({ authenticationDetailsProvider: provider });
const SHAPE = "VM.Standard.A1.Flex";
const NAME = "ping-agent-a1";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function instances() {
  const { items } = await compute.listInstances({ compartmentId: tenancy });
  const live = items.filter((i) => i.lifecycleState !== "TERMINATED");
  return Promise.all(
    live.map(async (i) => {
      const { items: att } = await compute.listVnicAttachments({ compartmentId: tenancy, instanceId: i.id });
      const vnics = await Promise.all(att.filter((a) => a.vnicId).map((a) => vnet.getVnic({ vnicId: a.vnicId }).then((r) => r.vnic)));
      return { ...i, publicIp: vnics.map((v) => v.publicIp).filter(Boolean)[0] ?? null, subnetId: vnics[0]?.subnetId ?? null };
    }),
  );
}
const byIp = async (ip) => {
  const found = (await instances()).find((i) => i.publicIp === ip);
  if (!found) throw new Error(`공개 IP ${ip} 서버가 없습니다.`);
  return found;
};

const [cmd, arg] = process.argv.slice(2);

if (cmd === "status") {
  for (const i of await instances())
    console.log(`${i.displayName} · ${i.shape} · ${i.shapeConfig?.ocpus ?? "?"} OCPU · ${i.shapeConfig?.memoryInGBs ?? "?"}GB · ${i.lifecycleState} · ${i.publicIp ?? "IP 없음"} · ${i.availabilityDomain}`);
} else if (cmd === "reboot") {
  const i = await byIp(arg);
  await compute.instanceAction({ instanceId: i.id, action: "RESET" });
  console.log(`${i.displayName}(${arg}) 강제 재부팅 요청함`);
} else if (cmd === "launch") {
  const all = await instances();
  const existing = all.find((i) => i.shape === SHAPE);
  if (existing) {
    console.log(`이미 A1 있음: ${existing.displayName} · ${existing.shapeConfig?.ocpus} OCPU · ${existing.lifecycleState} · ${existing.publicIp}`);
    process.exit(0);
  }
  const subnetId = all.find((i) => i.subnetId)?.subnetId; // 옛 측정 서버와 같은 네트워크(공개 IP 나오는 서브넷)
  if (!subnetId) throw new Error("기존 서버의 서브넷을 못 찾았습니다.");
  const { items: images } = await compute.listImages({
    compartmentId: tenancy, operatingSystem: "Oracle Linux", operatingSystemVersion: "9", shape: SHAPE,
    sortBy: "TIMECREATED", sortOrder: "DESC",
  });
  const image = images[0];
  if (!image) throw new Error("A1용 Oracle Linux 9 이미지가 없습니다.");
  const keys = ["oci_ping_monitor.pub"].map((f) => readFileSync(join(homedir(), ".ssh", f), "utf8").trim()).join("\n");
  const { items: ads } = await iam.listAvailabilityDomains({ compartmentId: tenancy });
  for (const [ocpus, memoryInGBs] of [[4, 24], [2, 12]]) {
    for (const ad of ads) {
      try {
        const { instance } = await compute.launchInstance({
          launchInstanceDetails: {
            compartmentId: tenancy, availabilityDomain: ad.name, displayName: NAME, shape: SHAPE,
            shapeConfig: { ocpus, memoryInGBs },
            sourceDetails: { sourceType: "image", imageId: image.id, bootVolumeSizeInGBs: 50 },
            createVnicDetails: { subnetId, assignPublicIp: true },
            metadata: { ssh_authorized_keys: keys },
          },
        });
        console.log(`받음: ${ocpus} OCPU·${memoryInGBs}GB · ${ad.name} · ${instance.id} — 켜지는 중`);
        for (let n = 0; n < 40; n++) {
          await sleep(15_000);
          const i = (await instances()).find((x) => x.id === instance.id);
          if (i?.lifecycleState === "RUNNING" && i.publicIp) {
            console.log(`RUNNING · 공개 IP ${i.publicIp} · 이미지 ${image.displayName}`);
            break;
          }
        }
        process.exit(0);
      } catch (e) {
        const msg = String(e.message ?? e);
        console.log(`${ocpus}·${memoryInGBs} ${ad.name}: ${msg.slice(0, 160)}`);
        if (!/capacity|LimitExceeded|limit/i.test(msg)) throw e;
      }
    }
  }
  console.log("자리 없음 — 나중에 다시(새벽·1시간 간격 권장)");
  process.exit(2);
} else if (cmd === "resize") {
  const i = await byIp(arg);
  if (i.shape !== SHAPE) throw new Error(`${arg}는 A1이 아닙니다(${i.shape}).`);
  await compute.updateInstance({ instanceId: i.id, updateInstanceDetails: { shapeConfig: { ocpus: 4, memoryInGBs: 24 } } });
  console.log("증설 요청 수락 — 실제로 바뀌는지 확인 중(요청 수락 ≠ 변경 완료)");
  for (let n = 0; n < 60; n++) {
    await sleep(20_000);
    const now = (await compute.getInstance({ instanceId: i.id })).instance;
    console.log(`${now.lifecycleState} · ${now.shapeConfig?.ocpus} OCPU · ${now.shapeConfig?.memoryInGBs}GB`);
    if (now.lifecycleState === "RUNNING" && now.shapeConfig?.ocpus === 4 && now.shapeConfig?.memoryInGBs === 24) {
      console.log("4 OCPU·24GB 확인");
      process.exit(0);
    }
  }
  console.log("20분 안에 안 바뀜 — 자리 부족일 수 있다. 나중에 다시");
  process.exit(2);
} else {
  console.log("node a1.mjs status | reboot <IP> | launch | resize <IP>");
}
