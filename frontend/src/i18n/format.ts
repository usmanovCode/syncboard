import type { Language } from '.'

const LOCALES: Record<Language, string> = { en: 'en-US', ko: 'ko-KR' }

/** "Nov 25, 2026" in English, "2026년 11월 25일" in Korean. */
export function formatDate(iso: string, language: Language): string {
  return new Intl.DateTimeFormat(LOCALES[language], { month: 'short', day: 'numeric', year: 'numeric' }).format(
    new Date(iso),
  )
}

/** Today's date for the dashboard greeting: "Friday, Nov 27, 2026" / "2026년 11월 27일 금요일". */
export function formatToday(language: Language, now = new Date()): string {
  return new Intl.DateTimeFormat(LOCALES[language], {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(now)
}

const sameDay =(a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()

/** A chat message's time: "2:05 PM" / "오후 2:05" today, with the date on other days. */
export function formatMessageTime(iso: string, language: Language, now = new Date()): string {
  const date = new Date(iso)
  const options: Intl.DateTimeFormatOptions = sameDay(date, now)
    ? { hour: 'numeric', minute: '2-digit' }
    : { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }
  return new Intl.DateTimeFormat(LOCALES[language], options).format(date)
}
