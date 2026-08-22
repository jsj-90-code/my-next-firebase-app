// Firestore 쓰기 할당량(무료 Spark 플랜 일일 20,000건)을 아끼기 위한 공용 유틸.
//
// 문제: syncSalesFromRevenueSheet.mjs/migrateFullExistingStoreProfiles.mjs는 매번 실행할 때마다
// 값이 바뀌지 않은 문서까지 전부 다시 write했다(순수 재실행이라도 매출DB 6000여 건 + 경쟁점
// 160여 건 + ... 를 매번 통째로 씀). 읽기는 하루 50,000건으로 훨씬 넉넉하므로, 컬렉션을 한 번에
// 읽어 메모리에 올려두고 실제로 달라진 문서만 write하면 재실행 비용이 거의 0에 가까워진다.
//
// 사용법:
//   const existingMap = await loadCollectionMap(db, "storeEvalExistingStoreSales");
//   ...
//   if (needsWrite(existingMap.get(id), newData, { merge: true })) {
//     await ref.set(newData, { merge: true });
//   }

export async function loadCollectionMap(db, collectionName) {
  const snap = await db.collection(collectionName).get();
  const map = new Map();
  snap.forEach((doc) => map.set(doc.id, doc.data()));
  return map;
}

// updatedAt/createdAt류 타임스탬프 필드는 매 실행마다 값이 달라지는 게 당연하므로 비교에서
// 제외해야 한다 — 안 그러면 "실제로 바뀐 것"과 "타임스탬프만 새로 찍은 것"을 구분 못 해 diff가
// 무의미해진다.
const DEFAULT_IGNORE_KEYS = ["updatedAt", "createdAt", "updatedBy"];

// existing: loadCollectionMap으로 읽어온 기존 문서(없으면 undefined).
// data: 이번에 쓰려는 값. merge:true면 data에 있는 키만 비교(나머지 필드는 안 건드리므로),
// merge:false(전체 덮어쓰기)면 양쪽 문서 전체를 비교한다.
export function needsWrite(existing, data, { merge = false, ignoreKeys = DEFAULT_IGNORE_KEYS } = {}) {
  if (!existing) return true;
  const keys = merge ? Object.keys(data) : new Set([...Object.keys(data), ...Object.keys(existing)]);
  for (const key of keys) {
    if (ignoreKeys.includes(key)) continue;
    const a = data[key] ?? null;
    const b = existing[key] ?? null;
    if (a !== b) return true;
  }
  return false;
}

export function makeWriteCounter() {
  let written = 0;
  let skipped = 0;
  return {
    mark(didWrite) {
      if (didWrite) written++;
      else skipped++;
    },
    summary() {
      return `${written}건 write, ${skipped}건 변경 없어 건너뜀`;
    },
  };
}
