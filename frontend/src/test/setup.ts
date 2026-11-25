import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
import { afterEach, vi } from 'vitest'
import { i18n } from '../i18n'

// findBy*/waitFor default to 1 s, which a fully loaded parallel run can exceed (seen as a flaky
// dashboard test). A longer ceiling costs nothing when things are fast.
configure({ asyncUtilTimeout: 3000 })

// Tests run in English (jsdom's navigator is en-US); tests that switch language are reset here.
afterEach(async () => {
  cleanup()
  localStorage.clear()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  await i18n.changeLanguage('en')
})
