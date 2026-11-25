import { useId, useState, type FormEvent, type KeyboardEvent } from 'react'
import { BOARD_NAME_MAX, validateBoardName } from '../api/boards'
import { ApiError } from '../api/client'

type Props = {
  label: string
  initialName?: string
  submitLabel: string
  /** Receives the trimmed name. Throw an ApiError to show the server's message. */
  onSubmit: (name: string) => Promise<void>
  onCancel: () => void
}

/** Inline name editor used for both creating and renaming a board. Enter saves, Escape cancels. */
export function BoardNameForm({ label, initialName = '', submitLabel, onSubmit, onCancel }: Props) {
  const id = useId()
  const [name, setName] = useState(initialName)
  const [error, setError] = useState<string>()
  const [saving, setSaving] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const found = validateBoardName(name)
    setError(found)
    if (found) return

    setSaving(true)
    try {
      await onSubmit(name.trim())
    } catch (err) {
      setError(err instanceof ApiError ? (err.fieldErrors.name ?? err.message) : 'Kutilmagan xatolik yuz berdi')
      setSaving(false)
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') onCancel()
  }

  return (
    <form onSubmit={handleSubmit} noValidate>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <input
        id={id}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={handleKeyDown}
        maxLength={BOARD_NAME_MAX + 20}
        placeholder="Doska nomi"
        autoFocus
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={`block w-full rounded-lg border px-3 py-2 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:ring-2 ${
          error
            ? 'border-red-400 focus:border-red-500 focus:ring-red-100'
            : 'border-slate-300 focus:border-indigo-500 focus:ring-indigo-100'
        }`}
      />
      {error && (
        <p id={`${id}-error`} className="mt-1 text-xs text-red-600">
          {error}
        </p>
      )}
      <div className="mt-3 flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-60"
        >
          {saving ? 'Saqlanmoqda…' : submitLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="rounded-lg px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
        >
          Bekor qilish
        </button>
      </div>
    </form>
  )
}
