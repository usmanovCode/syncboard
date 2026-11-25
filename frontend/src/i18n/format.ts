import type { Language } from '.'

const LOCALES: Record<Language, string> = { en: 'en-US', ko: 'ko-KR' }

/** "Nov 25, 2026" in English, "2026년 11월 25일" in Korean. */
export function formatDate(iso: string, language: Language): string {
  return new Intl.DateTimeFormat(LOCALES[language], { month: 'short', day: 'numeric', year: 'numeric' }).format(
    new Date(iso),
  )
}
