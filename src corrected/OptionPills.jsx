import { useEffect, useRef, useState } from 'react'

/**
 * Editable + reorderable option pills for question editors.
 * - Drag a pill to reorder (HTML5 drag & drop).
 * - Click a pill's text to edit it inline (Enter/blur saves, Esc cancels).
 * - ✕ removes the pill; the + button appends a new one.
 * Parent owns the source of truth: onChange(nextOptions) is called with the
 * updated string array; addValue may be a string or (count) => string.
 */
export default function OptionPills({
  options = [],
  onChange,
  addLabel = '+ Add Option',
  addValue,
  accent = '#059669',
  fontSize = 12,
}) {
  const [editingIdx, setEditingIdx] = useState(null)
  const [draft, setDraft] = useState('')
  const [dragIdx, setDragIdx] = useState(null)
  const [overIdx, setOverIdx] = useState(null)
  const inputRef = useRef(null)

  useEffect(() => {
    if (editingIdx != null) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editingIdx])

  const commit = (next) => {
    onChange(next.map((s) => String(s).trim()).filter(Boolean))
  }

  const startEdit = (idx, opt) => {
    setEditingIdx(idx)
    setDraft(String(opt))
  }

  const saveEdit = () => {
    if (editingIdx == null) return
    const next = options.map((opt, i) => (i === editingIdx ? draft : opt))
    setEditingIdx(null)
    commit(next)
  }

  const remove = (idx) => {
    commit(options.filter((_, i) => i !== idx))
  }

  const add = () => {
    const base = options.length
    const val =
      typeof addValue === 'function' ? addValue(base) : addValue != null ? addValue : `Option ${base + 1}`
    commit([...options, val])
  }

  const onDragStart = (e, idx) => {
    setDragIdx(idx)
    setEditingIdx(null) // drop any in-progress edit so a reorder can't mis-apply it
    e.dataTransfer.effectAllowed = 'move'
    try {
      e.dataTransfer.setData('text/plain', String(idx))
    } catch {
      /* ignore */
    }
  }

  const onDragOver = (e, idx) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (overIdx !== idx) setOverIdx(idx)
  }

  const onDrop = (e, idx) => {
    e.preventDefault()
    const from = dragIdx
    setDragIdx(null)
    setOverIdx(null)
    if (from == null || from === idx) return
    const next = [...options]
    const [moved] = next.splice(from, 1)
    next.splice(idx, 0, moved)
    commit(next)
  }

  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      {options.map((opt, idx) => {
        const editing = editingIdx === idx
        const dragging = dragIdx === idx
        const hovered = overIdx === idx && dragIdx != null && overIdx !== dragIdx
        return (
          <span
            key={idx}
            draggable
            onDragStart={(e) => onDragStart(e, idx)}
            onDragOver={(e) => onDragOver(e, idx)}
            onDragLeave={() => overIdx === idx && setOverIdx(null)}
            onDrop={(e) => onDrop(e, idx)}
            onDragEnd={() => {
              setDragIdx(null)
              setOverIdx(null)
            }}
            style={{
              background: '#eef2f7',
              border: `1px solid ${accent}`,
              color: '#0f172a',
              borderRadius: 16,
              padding: '4px 10px',
              fontSize,
              fontWeight: 'bold',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              cursor: dragging ? 'grabbing' : 'grab',
              opacity: dragging ? 0.5 : 1,
              boxShadow: hovered ? `0 0 0 2px ${accent}` : 'none',
              userSelect: 'none',
            }}
            title="Drag to reorder · click text to edit"
          >
            {editing ? (
              <input
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={saveEdit}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveEdit()
                  if (e.key === 'Escape') setEditingIdx(null)
                  e.stopPropagation()
                }}
                onClick={(e) => e.stopPropagation()}
                onDragStart={(e) => e.preventDefault()}
                style={{
                  width: Math.max(40, String(draft || '…').length * 8 + 14),
                  border: 0,
                  outline: `1.5px solid ${accent}`,
                  borderRadius: 8,
                  padding: '1px 6px',
                  fontSize,
                  fontWeight: 'bold',
                  background: '#fff',
                  color: '#0f172a',
                }}
              />
            ) : (
              <span
                onDoubleClick={() => startEdit(idx, opt)}
                onClick={() => startEdit(idx, opt)}
                style={{ cursor: 'text' }}
              >
                {opt}
              </span>
            )}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                remove(idx)
              }}
              style={{
                background: 'none',
                border: 0,
                color: '#ff6b6b',
                cursor: 'pointer',
                fontWeight: 'bold',
                fontSize: 13,
                padding: 0,
                lineHeight: 1,
              }}
              title="Remove option"
            >
              ✕
            </button>
          </span>
        )
      })}
      <button
        type="button"
        className="btn small primary"
        style={{ padding: '3px 10px', fontSize: 11 }}
        onClick={add}
      >
        {addLabel}
      </button>
    </div>
  )
}
