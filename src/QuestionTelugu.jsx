/**
 * Optional Telugu copy typed by the author. English is never auto-translated.
 */
export default function QuestionTelugu({ q, onChange }) {
  const options = Array.isArray(q.options) ? q.options : []
  const teOpts = Array.isArray(q.options_te) ? q.options_te : []
  const teText =
    q.options_te_text != null ? q.options_te_text : teOpts.join(', ')

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
      <div style={{ marginBottom: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#047857' }}>తెలుగు · Telugu (optional)</span>
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
