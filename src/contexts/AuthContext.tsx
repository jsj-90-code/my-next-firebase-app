"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";
import { auth } from "@/lib/firebase";

type AuthContextValue = {
  user: User | null;
  loading: boolean;
  configured: boolean;
  // 이메일/비밀번호와 익명 로그인은 2026-09-10에 Firebase 공급자 자체를 껐다(구글 전용).
  signInWithGoogle: (opts?: { hostedDomain?: string }) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(() => auth !== null);
  const configured = auth !== null;

  useEffect(() => {
    if (!auth) {
      return;
    }

    return onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setLoading(false);
    });
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      configured,
      async signInWithGoogle(opts) {
        if (!auth) throw new Error("Firebase is not configured.");
        const provider = new GoogleAuthProvider();
        if (opts?.hostedDomain) {
          provider.setCustomParameters({ hd: opts.hostedDomain });
        }
        await signInWithPopup(auth, provider);
      },
      async logout() {
        if (!auth) throw new Error("Firebase is not configured.");
        await signOut(auth);
      },
    }),
    [configured, loading, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider.");
  }
  return context;
}
