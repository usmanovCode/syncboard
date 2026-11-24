import { apiFetch } from './client'

export type User = {
  id: number
  email: string
  fullName: string
  createdAt: string
}

export type LoginResponse = {
  accessToken: string
  tokenType: 'Bearer'
  expiresIn: number
}

export type RegisterInput = {
  email: string
  password: string
  fullName: string
}

export const authApi = {
  login: (email: string, password: string) =>
    apiFetch<LoginResponse>('/api/auth/login', { method: 'POST', body: { email, password } }),
  register: (input: RegisterInput) => apiFetch<User>('/api/auth/register', { method: 'POST', body: input }),
  me: () => apiFetch<User>('/api/auth/me'),
}
