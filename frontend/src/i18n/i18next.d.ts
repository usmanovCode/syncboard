import 'i18next'
import type { en } from './en'

// Makes t('...') keys type-checked against en.ts.
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation'
    resources: { translation: typeof en }
  }
}
