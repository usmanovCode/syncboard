import type { TFunction } from 'i18next'
import { useState, type ChangeEvent, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router'
import { ApiError } from '../api/client'
import { useAuth } from '../auth/authContext'
import { AuthLayout, FormAlert, SubmitButton } from '../components/AuthLayout'
import { TextField } from '../components/TextField'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type Field = 'fullName' | 'email' | 'password' | 'confirmPassword'
type Values = Record<Field, string>
type Errors = Partial<Record<Field, string>>

// Mirrors the backend RegisterRequest constraints so most mistakes are caught before a round trip.
function validate(v: Values, t: TFunction): Errors {
  const errors: Errors = {}
  if (!v.fullName.trim()) errors.fullName = t('validation.fullNameRequired')
  else if (v.fullName.trim().length > 100) errors.fullName = t('validation.fullNameTooLong')
  if (!v.email.trim()) errors.email = t('validation.emailRequired')
  else if (!EMAIL_RE.test(v.email.trim())) errors.email = t('validation.emailInvalid')
  if (v.password.length < 8 || v.password.length > 72)
    errors.password = t('validation.passwordLength', { min: 8, max: 72 })
  if (v.confirmPassword !== v.password) errors.confirmPassword = t('validation.passwordsMismatch')
  return errors
}

export function RegisterPage() {
  const { register } = useAuth()
  const { t } = useTranslation()
  const navigate = useNavigate()

  const [values, setValues] = useState<Values>({ fullName: '', email: '', password: '', confirmPassword: '' })
  const [errors, setErrors] = useState<Errors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const bind = (field: Field) => ({
    value: values[field],
    onChange: (e: ChangeEvent<HTMLInputElement>) => setValues((prev) => ({ ...prev, [field]: e.target.value })),
    error: errors[field],
  })

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const found = validate(values, t)
    setErrors(found)
    setFormError(null)
    if (Object.keys(found).length > 0) return

    setLoading(true)
    try {
      await register({ fullName: values.fullName.trim(), email: values.email.trim(), password: values.password })
      navigate('/', { replace: true })
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
    <AuthLayout title={t('auth.register.title')} subtitle={t('auth.register.subtitle')}>
      <FormAlert message={formError} />
      <form onSubmit={handleSubmit} noValidate>
        <TextField
          label={t('auth.register.fullName')}
          autoComplete="name"
          placeholder={t('auth.register.fullNamePlaceholder')}
          autoFocus
          {...bind('fullName')}
        />
        <TextField
          label={t('auth.email')}
          type="email"
          autoComplete="email"
          placeholder={t('auth.emailPlaceholder')}
          {...bind('email')}
        />
        <TextField label={t('auth.password')} type="password" autoComplete="new-password" {...bind('password')} />
        <TextField
          label={t('auth.register.confirmPassword')}
          type="password"
          autoComplete="new-password"
          {...bind('confirmPassword')}
        />
        <SubmitButton loading={loading}>{t('auth.register.submit')}</SubmitButton>
      </form>
      <p className="mt-6 text-center text-sm text-slate-500">
        {t('auth.register.hasAccount')}{' '}
        <Link to="/login" className="font-semibold text-blue-600 hover:text-violet-600">
          {t('auth.register.toLogin')}
        </Link>
      </p>
    </AuthLayout>
  )
}
