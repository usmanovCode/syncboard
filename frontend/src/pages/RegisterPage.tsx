import { useState, type ChangeEvent, type FormEvent } from 'react'
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
function validate(v: Values): Errors {
  const errors: Errors = {}
  if (!v.fullName.trim()) errors.fullName = 'Ism kiritilishi shart'
  else if (v.fullName.trim().length > 100) errors.fullName = 'Ism juda uzun'
  if (!v.email.trim()) errors.email = 'Email kiritilishi shart'
  else if (!EMAIL_RE.test(v.email.trim())) errors.email = "Email formati noto'g'ri"
  if (v.password.length < 8 || v.password.length > 72)
    errors.password = "Parol 8 dan 72 gacha belgidan iborat bo'lishi kerak"
  if (v.confirmPassword !== v.password) errors.confirmPassword = 'Parollar mos kelmadi'
  return errors
}

export function RegisterPage() {
  const { register } = useAuth()
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
    const found = validate(values)
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
        setFormError('Kutilmagan xatolik yuz berdi')
      }
      setLoading(false)
    }
  }

  return (
    <AuthLayout title="Ro'yxatdan o'tish" subtitle="SyncBoard'da yangi hisob yarating">
      <FormAlert message={formError} />
      <form onSubmit={handleSubmit} noValidate>
        <TextField label="To'liq ism" autoComplete="name" placeholder="Ali Valiyev" autoFocus {...bind('fullName')} />
        <TextField label="Email" type="email" autoComplete="email" placeholder="siz@example.com" {...bind('email')} />
        <TextField label="Parol" type="password" autoComplete="new-password" {...bind('password')} />
        <TextField label="Parolni tasdiqlang" type="password" autoComplete="new-password" {...bind('confirmPassword')} />
        <SubmitButton loading={loading}>Ro'yxatdan o'tish</SubmitButton>
      </form>
      <p className="mt-6 text-center text-sm text-slate-500">
        Hisobingiz bormi?{' '}
        <Link to="/login" className="font-medium text-indigo-600 hover:text-indigo-500">
          Kirish
        </Link>
      </p>
    </AuthLayout>
  )
}
