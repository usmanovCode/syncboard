const TOKEN_KEY = 'syncboard.accessToken'

export const tokenStorage = {
  get: (): string | null => localStorage.getItem(TOKEN_KEY),
  set: (token: string) => localStorage.setItem(TOKEN_KEY, token),
  clear: () => localStorage.removeItem(TOKEN_KEY),
}

/**
 * Error thrown for any non-2xx response. The backend returns ProblemDetail JSON
 * ({ status, detail, code, errors? }) — see GlobalExceptionHandler.
 */
export class ApiError extends Error {
  readonly status: number
  readonly code: string | undefined
  readonly fieldErrors: Record<string, string>

  constructor(status: number, message: string, code?: string, fieldErrors: Record<string, string> = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.fieldErrors = fieldErrors
  }
}

type ProblemBody = { detail?: string; code?: string; errors?: Record<string, string> }

export async function apiFetch<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (init.body !== undefined) headers['Content-Type'] = 'application/json'
  const token = tokenStorage.get()
  if (token) headers.Authorization = `Bearer ${token}`

  let response: Response
  try {
    response = await fetch(path, {
      method: init.method ?? 'GET',
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    })
  } catch {
    throw new ApiError(0, "Serverga ulanib bo'lmadi. Internet yoki backend ishlayotganini tekshiring.")
  }

  const text = await response.text()
  let data: unknown
  try {
    data = text ? JSON.parse(text) : undefined
  } catch {
    data = undefined // e.g. an HTML 502 page from the dev proxy when the backend is down
  }

  if (!response.ok) {
    const problem = (data ?? {}) as ProblemBody
    const fallback =
      response.status === 401 ? "Avtorizatsiyadan o'tilmagan" : `So'rov bajarilmadi (${response.status})`
    throw new ApiError(response.status, problem.detail ?? fallback, problem.code, problem.errors)
  }
  return data as T
}
