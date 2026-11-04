// 게토 연동 키 관리 (측정 서버에서 실행)
//
//   node keys.mjs init <prod|dev>              서버 키 만들기(없을 때만) → 공개키·지문 출력
//   node keys.mjs show <prod|dev>              서버 공개키·지문 보기(게토에 줄 값)
//   node keys.mjs rotate <prod|dev>            갱신 예정 키 만들기(기존 키와 같이 받음)
//   node keys.mjs promote <prod|dev>           예정 키를 현재 키로(옛 키는 더 안 받음)
//   node keys.mjs issue <prod|dev> <storeId> [이름] [유효일수=30]   매장 등록토큰 발급(원문은 이때 한 번만 보임)
//   node keys.mjs revoke <prod|dev> <storeId>  매장 폐기(다음 접속부터 E_REVOKED)
//   node keys.mjs list <prod|dev>              매장 등록부
//
// 개인키·토큰은 화면 밖으로 옮기지 말 것(위키·로그·메모리 금지). 공개키·지문은 게토에 줘도 된다.

import fs from "node:fs";
import {
  ENVS,
  createServerKey,
  promoteServerKey,
  loadServerKeys,
  fingerprint,
  issueToken,
  revokeStore,
  loadStores,
  serverKeyFile,
} from "./registry.mjs";

const [cmd, env, ...rest] = process.argv.slice(2);

function needEnv() {
  if (!ENVS.includes(env)) {
    console.error(`env는 ${ENVS.join(" | ")}`);
    process.exit(2);
  }
}

function printKey(pub, label) {
  console.log(`${label}`);
  console.log(`  공개키(hex)    ${pub.toString("hex")}`);
  console.log(`  공개키(base64) ${pub.toString("base64")}`);
  console.log(`  지문           ${fingerprint(pub)}`);
}

switch (cmd) {
  case "init": {
    needEnv();
    if (fs.existsSync(serverKeyFile(env))) {
      console.log("이미 있음 — show로 보세요");
      break;
    }
    printKey(createServerKey(env), `서버 키 생성 (${env})`);
    break;
  }
  case "show": {
    needEnv();
    const ks = loadServerKeys().filter((k) => k.env === env);
    if (!ks.length) console.log("키 없음 — init 먼저");
    for (const k of ks) printKey(k.pub, `${env} / ${k.slot}`);
    break;
  }
  case "rotate":
    needEnv();
    printKey(createServerKey(env, true), `갱신 예정 키 (${env}) — 게토에 미리 알리고, 다 바꾸면 promote`);
    break;
  case "promote":
    needEnv();
    promoteServerKey(env);
    console.log("예정 키를 현재 키로 바꿈. 받는 프로그램은 다음 접속부터 새 키만 받음(재시작 불필요).");
    break;
  case "issue": {
    needEnv();
    const [storeId, name = "", days = "30"] = rest;
    if (!storeId) {
      console.error("storeId 필요");
      process.exit(2);
    }
    const token = issueToken(env, storeId, name, Number(days));
    console.log(`등록토큰 (${env} / ${storeId} ${name}) — ${days}일, 1회용, 지금 한 번만 보임`);
    console.log(`  ${token}`);
    break;
  }
  case "revoke":
    needEnv();
    revokeStore(env, rest[0]);
    console.log(`폐기: ${env} / ${rest[0]}`);
    break;
  case "list": {
    needEnv();
    const reg = loadStores(env);
    const rows = Object.entries(reg.stores).map(([id, s]) => ({
      storeId: id,
      name: s.name,
      status: s.status,
      keyBound: s.pub ? fingerprint(Buffer.from(s.pub, "hex")) : "-",
      tokenPending: s.tokenHash ? `~${s.tokenExpires?.slice(0, 10)}` : "-",
    }));
    console.table(rows);
    break;
  }
  default:
    console.log(fs.readFileSync(new URL(import.meta.url), "utf8").split("\n").slice(0, 12).join("\n"));
}
