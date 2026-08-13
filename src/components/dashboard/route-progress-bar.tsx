"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

/**
 * 顶部 2px 进度条 — 仅在客户端路由切换时出现。
 *
 * 挂在 dashboard layout 里一次即可。
 *
 * 时序：
 *   pathname 变化 → 立即把进度条拉回 0 并显示 → 用 setInterval 按对数曲线
 *   推到 90% → 当 pathname 200ms 内没有再变（即上一段导航结束）→ 跳到
 *   100%，再 250ms 后淡出。
 */
export function RouteProgressBar() {
  const pathname = usePathname();
  const [progress, setProgress] = useState(0);
  const [visible, setVisible] = useState(false);

  const stateRef = useRef<{
    startedAt: number;
    tickTimer: ReturnType<typeof setInterval> | null;
    endTimer: ReturnType<typeof setTimeout> | null;
    lastPath: string;
  }>({
    startedAt: 0,
    tickTimer: null,
    endTimer: null,
    lastPath: "",
  });

  useEffect(() => {
    const s = stateRef.current;
    const isFirstMount = s.lastPath === "";
    s.lastPath = pathname;

    if (isFirstMount) {
      // 初始挂载不算导航
      return;
    }

    // 取消上一段可能还活着的结束定时器
    if (s.endTimer) {
      clearTimeout(s.endTimer);
      s.endTimer = null;
    }
    // 取消上一段的推进器
    if (s.tickTimer) {
      clearInterval(s.tickTimer);
      s.tickTimer = null;
    }

    // 重置 + 显示
    setProgress(0);
    setVisible(true);
    s.startedAt = Date.now();

    // 推进器：80ms 一帧，对数曲线逼近 90%
    s.tickTimer = setInterval(() => {
      const elapsed = Date.now() - s.startedAt;
      const next = Math.min(90, 6 + Math.log2(elapsed / 80 + 1) * 18);
      setProgress(next);
    }, 80);

    // "结束"判定：200ms 内 pathname 不再变 → 上一次导航结束
    s.endTimer = setTimeout(() => {
      if (s.tickTimer) {
        clearInterval(s.tickTimer);
        s.tickTimer = null;
      }
      setProgress(100);
      s.endTimer = setTimeout(() => {
        setVisible(false);
        setProgress(0);
        s.endTimer = null;
      }, 250);
    }, 200);

    return () => {
      // effect cleanup 在下次 pathname 变化时跑，cancel 上一段
      if (s.tickTimer) {
        clearInterval(s.tickTimer);
        s.tickTimer = null;
      }
      if (s.endTimer) {
        clearTimeout(s.endTimer);
        s.endTimer = null;
      }
    };
  }, [pathname]);

  if (!visible) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-50 h-0.5"
      aria-hidden
    >
      <div
        className="h-full bg-foreground/80"
        style={{
          width: `${progress}%`,
          opacity: progress >= 100 ? 0 : 1,
          transition:
            progress >= 100
              ? "width 200ms ease-out, opacity 250ms ease-out"
              : "width 80ms linear",
        }}
      />
    </div>
  );
}
