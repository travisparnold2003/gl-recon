"use client";

import { useCallback, useState } from "react";
import type { ToastItem } from "@/types/dashboard";

export function useToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [seed, setSeed] = useState(1);

  const pushToast = useCallback((type: ToastItem["type"], message: string) => {
    const id = Date.now() + seed;
    setSeed((v) => v + 1);
    setToasts((current) => [...current, { id, type, message }].slice(-4));
    window.setTimeout(() => {
      setToasts((current) => current.filter((t) => t.id !== id));
    }, 4200);
  }, [seed]);

  return { toasts, pushToast };
}
