"use client";

import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/contexts/AuthContext";

// 운영설정(12_운영판정 계수) 화면은 관리자만 값을 바꿀 수 있어야 한다(요청사항).
// firestore.rules의 storeEvalAdmins 컬렉션이 실제 권한 판단의 최종 기준이고, 이 훅은 화면에서
// "저장" 버튼을 보여줄지 말지 결정하는 용도일 뿐이다 - 진짜 보안은 규칙 파일에서 강제된다.
export function useIsStoreEvalAdmin(): { isAdmin: boolean; loading: boolean } {
  const { user } = useAuth();
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function check() {
      if (!user?.email || !db) {
        if (!cancelled) {
          setIsAdmin(false);
          setLoading(false);
        }
        return;
      }
      setLoading(true);
      try {
        const snap = await getDoc(doc(db, "storeEvalAdmins", user.email));
        if (!cancelled) setIsAdmin(snap.exists());
      } catch {
        if (!cancelled) setIsAdmin(false);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    check();
    return () => {
      cancelled = true;
    };
  }, [user?.email]);

  return { isAdmin, loading };
}
