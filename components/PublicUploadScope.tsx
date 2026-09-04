"use client";
import { createContext, useContext, useRef, useState, type ReactNode } from "react";

const Context = createContext({ busy: false, change: (_key: string, _busy: boolean) => {} });
export function PublicUploadScope({ children }: { children: ReactNode }) {
  const active = useRef(new Set<string>());
  const [busy, setBusy] = useState(false);
  return <Context.Provider value={{ busy, change: (key, value) => {
    if (value) active.current.add(key); else active.current.delete(key);
    setBusy(active.current.size > 0);
  } }}>{children}</Context.Provider>;
}
export const usePublicUploads = () => useContext(Context);
