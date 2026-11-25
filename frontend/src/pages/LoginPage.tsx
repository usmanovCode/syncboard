import type { TFunction } from 'i18next'
import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useLocation, useNavigate } from 'react-router'
import { ApiError } from '../api/client'
import { useAuth } from '../auth/authContext'
import { AuthLayout, FormAlert, SubmitButton } from '../components/AuthLayout'
import { TextField } from '../components/TextField'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type Errors = Partial<Record<'email' | 'password', string>>

function validate(email: string, password: string, t: TFunction): Errors {
  const errors: Errors = {}
  if (!email.trim()) errors.email = t('validation.emailRequired')
  else if (!EMAIL_RE.test(email.trim())) errors.email = t('validation.emailInvalid')
  if (!password) errors.password = t('validation.passwordRequired')
  return errors
}

export function LoginPage() {
  const { login } = useAuth()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? '/'

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<Errors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const found = validate(email, password, t)
    setErrors(found)
    setFormError(null)
    if (Object.keys(found).length > 0) return

    setLoading(true)
    try {
      await login(email.trim(), password)
      navigate(from, { replace: true })
    } catch (error) {
      if (error instanceof ApiError) {
        setErrors(error.fieldErrors)
        setFormError(error.message)
      } else {
        setFormError(t('errors.unexpected'))
      }
      setLoading(false)
    }
  }

  return (
    <AuthLayout title={t('auth.login.title')} subtitle={t('auth.login.subtitle')}>
      <FormAlert message={formError} />
      <form onSubmit={handleSubmit} noValidate>
        <TextField
          label={t('auth.email')}
          type="email"
          autoComplete="email"
          placeholder={t('auth.emailPlaceholder')}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={errors.email}
          autoFocus
        />
        <TextField
          label={t('auth.password')}
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
        />
        <SubmitButton loading={loading}>{t('auth.login.submit')}</SubmitButton>
      </form>
      <p className="mt-6 text-center text-sm text-slate-500">
        {t('auth.login.noAccount')}{' '}
        <Link to="/register" className="font-medium text-indigo-600 hover:text-indigo-500">
          {t('auth.login.toRegister')}
        </Link>
      </p>
    </AuthLayout>
  )
}
