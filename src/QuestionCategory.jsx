import { useEffect, useState } from 'react'
import {
  createQuestionCategory,
  deleteQuestionCategory,
  listQuestionCategories,
  renameQuestionCategory,
} from './api'

/**
 * Categories are the Client Admin's own vocabulary for tagging questions. One shared list is
 * fetched lazily and kept in sync across every mounted field/manager, so a rename in the
 * manager is reflected in the question editors without a reload.
 */
let cache = { categories: [], limit: 0, used: 0, loaded: false }
const subscribers = new Set()

function publish() {
  for (const fn of subscribers) fn(cache)
}

async function reload() {
  const res = await listQuestionCategories()
  cache = {
    categories: Array.isArray(res.categories) ? res.categories : [],
    limit: Number(res.limit) || 0,
    used: Number(res.used) || 0,
    loaded: true,
  }
  publish()
  return cache
}

function useCategories() {
  const [state, setState] = useState(cache)
  useEffect(() => {
    subscribers.add(setState)
    setState(cache)
    if (!cache.loaded) reload().catch(() => {})
    return () => {
      subscribers.delete(setState)
    }
  }, [])
  return state
}

async function afterMutation(fn) {
  const res = await fn()
  try {
    await reload()
  } catch {
    /* keep the stale list rather than losing the mutation */
  }
  return res
}

export function addCategory(name) {
  return afterMutation(() => createQuestionCategory(name))
}

export function renameCategory(id, name) {
  return afterMutation(() => renameQuestionCategory(id, name))
}

export function removeCategory(id) {
  return afterMutation(() => deleteQuestionCategory(id))
}

export function CategoryField({ value = '', onChange, onToast, disabled = false }) {
  const { categories, limit, used } = useCategories()
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)

  const names = categories.map((c) => String(c.name))
  const stale = !!value && !names.includes(value)
  const atLimit = limit > 0 && used >= limit

  async function createDraft() {
    const name = draft.replace(/\s+/g, ' ').trim()
    if (!name) return
    setBusy(true)
    try {
      const res = await addCategory(name)
      onChange(String(res.category?.name || name))
      setDraft('')
      setAdding(false)
    } catch (e) {
      onToast?.(e.message || 'Could not create category', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="field">
      <span>Category</span>
      {adding ? (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            autoFocus
            disabled={disabled}
            value={draft}
            maxLength={40}
            placeholder="e.g. Demographics"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void createDraft()
              }
            }}
          />
          <button
            type="button"
            className="btn small"
            disabled={disabled || busy || !draft.trim()}
            onClick={() => void createDraft()}
          >
            {busy ? 'Creating…' : 'Create'}
          </button>
          <button
            type="button"
            className="btn small"
            disabled={disabled}
            onClick={() => {
              setAdding(false)
              setDraft('')
            }}
          >
            Cancel
          </button>
        </div>
      ) : (
        <select
          value={value}
          disabled={disabled}
          onChange={(e) => {
            const next = e.target.value
            if (next === '__new__') {
              setAdding(true)
              return
            }
            onChange(next)
          }}
        >
          <option value="">— Uncategorized —</option>
          {stale && <option value={value}>{value} (deleted or renamed)</option>}
          {names.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
          {!disabled && <option value="__new__">+ New category…</option>}
        </select>
      )}
      <span style={{ fontSize: 11, color: atLimit ? '#dc2626' : '#64748b' }}>
        {limit > 0 ? `${used} of ${limit} categories used` : 'No category limit'}
        {categories.length === 0 ? ' · create one to group questions on the dashboard' : ''}
        {atLimit ? ' · delete an unused one or ask Super Admin to raise the limit' : ''}
      </span>
    </div>
  )
}

/** Rename / delete / create the tenant's categories. */
function CategoryManager({ onToast }) {
  const { categories, limit, used } = useCategories()
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState(null)
  const [editName, setEditName] = useState('')
  const [busy, setBusy] = useState(false)

  async function run(action, okMessage) {
    setBusy(true)
    try {
      await action()
      if (okMessage) onToast?.(okMessage, 'ok')
      return true
    } catch (e) {
      onToast?.(e.message || 'Could not save categories', 'error')
      return false
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <p style={{ margin: '0 0 6px', fontWeight: 700 }}>
        Question categories{' '}
        <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>
          · {limit > 0 ? `${used} of ${limit} used` : 'no limit'} · questions tagged with the same
          category are grouped together on the dashboard
        </span>
      </p>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
        <input
          value={draft}
          maxLength={40}
          placeholder="New category name"
          style={{ flex: 1, minWidth: 0 }}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              const name = draft.replace(/\s+/g, ' ').trim()
              if (!name || busy) return
              void run(() => addCategory(name), `Created “${name}”`).then((ok) => ok && setDraft(''))
            }
          }}
        />
        <button
          type="button"
          className="btn small primary"
          disabled={busy || !draft.trim()}
          onClick={() => {
            const name = draft.replace(/\s+/g, ' ').trim()
            void run(() => addCategory(name), `Created “${name}”`).then((ok) => ok && setDraft(''))
          }}
        >
          Add
        </button>
      </div>

      {!categories.length && (
        <p className="muted" style={{ fontSize: 12, margin: 0 }}>
          No categories yet — add one above, then pick it on each question.
        </p>
      )}

      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 6 }}>
        {categories.map((c) => {
          const id = Number(c.id)
          const name = String(c.name)
          const isInEditor = editing === id
          return (
            <li
              key={id}
              style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}
            >
              {isInEditor ? (
                <>
                  <input
                    autoFocus
                    value={editName}
                    maxLength={40}
                    style={{ flex: 1, minWidth: 140 }}
                    onChange={(e) => setEditName(e.target.value)}
                  />
                  <button
                    type="button"
                    className="btn small"
                    disabled={busy || !editName.trim()}
                    onClick={() =>
                      void run(() => renameCategory(id, editName.trim()), `Renamed to “${editName.trim()}” — saved surveys retag automatically`).then(
                        (ok) => ok && setEditing(null),
                      )
                    }
                  >
                    Save
                  </button>
                  <button type="button" className="btn small" disabled={busy} onClick={() => setEditing(null)}>
                    Cancel
                  </button>
                </>
              ) : (
                <>
                  <strong style={{ minWidth: 140 }}>{name}</strong>
                  <span className="muted" style={{ fontSize: 12 }}>
                    {c.question_count != null
                      ? `${c.question_count} question${c.question_count === 1 ? '' : 's'}`
                      : ''}
                  </span>
                  <button
                    type="button"
                    className="btn small"
                    disabled={busy}
                    onClick={() => {
                      setEditing(id)
                      setEditName(name)
                    }}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    className="btn small danger"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () => removeCategory(id),
                        `Deleted “${name}”`,
                      )
                    }
                  >
                    Delete
                  </button>
                </>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

/** Collapsible Categories panel for the question editors. */
export function CategoryPanel({ onToast }) {
  const [open, setOpen] = useState(false)
  const { categories, limit } = useCategories()
  return (
    <>
      <button
        type="button"
        className="btn small"
        aria-expanded={open}
        style={{ marginBottom: 10 }}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? '▾' : '▸'} Categories ({categories.length}
        {limit > 0 ? ` of ${limit}` : ''})
      </button>
      {open && <CategoryManager onToast={onToast} />}
    </>
  )
}
