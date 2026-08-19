import { useState } from 'react'
import { translateQuestion } from './api'

/**
 * Telugu label + options. Shown only when Super Admin granted
 * can_manage_questions or can_crud_questionnaire (or the caller is Super Admin).
 */
export default function QuestionTelugu({ q, onChange, onToast }) {
  const [busy, setBusy] = useState(false)
  const options = Array.isArray(q.options) ? q.options : []
  const teOpts = Array.isArray(q.options_te) ? q.options_te : []
  const teText =
    q.options_te_text != null ? q.options_te_text : teOpts.join(', ')

  async function autoTranslate() {
    const text = String(q.label || '').trim()
    if (!text) {
      onToast?.('Enter the English question first', 'error')
      return
    }
    setBusy(true)
    try {
      const res = await translateQuestion({ text, options })
      onChange({
        label_te: res.text_te || '',
        options_te: Array.isArray(res.options_te) ? res.options_te : [],
        options_te_text: Array.isArray(res.options_te) ? res.options_te.join(', ') : '',
      })
      onToast?.('Telugu filled from English', 'ok')
    } catch (e) {
      onToast?.(e.message || 'Translate failed', 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      style={{
        marginTop: 10,
        background: 'rgba(5, 150, 105, 0.06)',
        border: '1px solid #a7f3d0',
        borderRadius: 8,
        padding: 12,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#047857' }}>తెలుగు · Telugu</span>
        <button type="button" className="btn small" disabled={busy} onClick={() => void autoTranslate()}>
          {busy ? 'Translating…' : 'Auto-translate'}
        </button>
      </div>
      <label className="field">
        <span>Telugu question text</span>
        <input
          value={q.label_te || ''}
          onChange={(e) => onChange({ label_te: e.target.value })}
          placeholder="ప్రశ్నను ఇక్కడ టైప్ చేయండి"
        />
      </label>
      {options.length > 0 && (
        <label className="field" style={{ marginTop: 8 }}>
          <span>Telugu options (same order, comma-separated)</span>
          <input
            value={teText}
            onChange={(e) => {
              const val = e.target.value
              onChange({
                options_te_text: val,
                options_te: val.split(',').map((s) => s.trim()).filter(Boolean),
              })
            }}
            placeholder="అవును, కాదు"
          />
        </label>
      )}
    </div>
  )
}
