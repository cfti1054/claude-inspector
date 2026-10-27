// 일일 상한, 일일 요약, 화면 표시는 모두 KST(Asia/Seoul) 기준이다.

export const TZ = 'Asia/Seoul';

// SQL에서 "오늘(KST) 0시"를 나타내는 식
export const KST_TODAY_START = "(date_trunc('day', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul')";

const dateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });
const timeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const secFmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

export function kstDate(d: Date): string {
  return dateFmt.format(d);
}

export function kstTime(d: Date): string {
  return timeFmt.format(d);
}

export function kstTimeSec(d: Date): string {
  return secFmt.format(d);
}

export function kstDateTime(d: Date): string {
  return `${kstDate(d)} ${kstTime(d)}`;
}

// 오늘이면 "15:21", 아니면 "10-25 15:21"
export function kstShort(d: Date, now = new Date()): string {
  if (kstDate(d) === kstDate(now)) return kstTime(d);
  return `${kstDate(d).slice(5)} ${kstTime(d)}`;
}

export function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}초`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}분 ${String(s % 60).padStart(2, '0')}초`;
  return `${Math.floor(m / 60)}시간 ${m % 60}분`;
}

export function ago(d: Date, now = new Date()): string {
  const s = Math.max(0, Math.round((now.getTime() - d.getTime()) / 1000));
  if (s < 60) return '방금';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}
