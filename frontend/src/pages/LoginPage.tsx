import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { ApiError } from '../api/client'
import { useAuth } from '../auth/authContext'
import { AuthLayout, FormAlert, SubmitButton } from '../components/AuthLayout'
import { TextField } from '../components/TextField'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type Errors = Partial<Record<'email' | 'password', string>>

function validate(email: string, password: string): Errors {
  const errors: Errors = {}
  if (!email.trim()) errors.email = 'Email kiritilishi shart'
  else if (!EMAIL_RE.test(email.trim())) errors.email = "Email formati noto'g'ri"
  if (!password) errors.password = 'Parol kiritilishi shart'
  return errors
}

export function LoginPage() {
  const { login } = useAuth()
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
    const found = validate(email, password)
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
        setFormError("Kutilmagan xatolik yuz berdi")
      }
      setLoading(false)
    }
  }

  return (
    <AuthLayout title="Tizimga kirish" subtitle="Hisobingizga kirish uchun ma'lumotlaringizni kiriting">
      <FormAlert message={formError} />
      <form onSubmit={handleSubmit} noValidate>
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          placeholder="siz@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={errors.email}
          autoFocus
        />
        <TextField
          label="Parol"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
        />
        <SubmitButton loading={loading}>Kirish</SubmitButton>
      </form>
      <p className="mt-6 text-center text-sm text-slate-500">
        Hisobingiz yo'qmi?{' '}
        <Link to="/register" className="font-medium text-indigo-600 hover:text-indigo-500">
          Ro'yxatdan o'ting
        </Link>
      </p>
    </AuthLayout>
  )
}
