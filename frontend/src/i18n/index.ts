import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { en } from './en'
import { ko } from './ko'

export const LANGUAGES = ['en', 'ko'] as const
export type Language = (typeof LANGUAGES)[number]

const STORAGE_KEY = 'syncboard.lang'

function isLanguage(value: unknown): value is Language {
  return LANGUAGES.includes(value as Language)
}

/** The user's explicit choice wins; otherwise Korean browsers get Korean and everyone else English. */
export function detectLanguage(): Language {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (isLanguage(stored)) return stored
  return navigator.languages?.some((l) => l.toLowerCase().startsWith('ko')) ? 'ko' : 'en'
}

export function currentLanguage(): Language {
  return isLanguage(i18n.language) ? i18n.language : 'en'
}

/** Switches the UI language and remembers the choice. */
export async function setLanguage(language: Language) {
  localStorage.setItem(STORAGE_KEY, language)
  await i18n.changeLanguage(language)
}

i18n.on('languageChanged', (language) => {
  document.documentElement.lang = language
})

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, ko: { translation: ko } },
  lng: detectLanguage(),
  fallbackLng: 'en',
  supportedLngs: LANGUAGES,
  interpolation: { escapeValue: false }, // React already escapes
  initAsync: false, // resources are bundled, so init synchronously
})

export { i18n }
