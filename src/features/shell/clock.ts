import { useEffect, useState } from "react";

// 期限・相対日付の表示に使う現在時刻。1 分ごとと、window の focus / online で更新する。
export function useClockNow(): number {
  const [clockNow, setClockNow] = useState(() => Date.now());
  useEffect(() => {
    const updateCalendarNow = () => setClockNow(Date.now());
    const timer = window.setInterval(updateCalendarNow, 60_000);
    window.addEventListener("focus", updateCalendarNow);
    window.addEventListener("online", updateCalendarNow);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", updateCalendarNow);
      window.removeEventListener("online", updateCalendarNow);
    };
  }, []);
  return clockNow;
}
