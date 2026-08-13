import { digits10, toE164In } from './phoneIn'

/** Locked +91 prefix + 10-digit mobile. onChange receives +91XXXXXXXXXX or ''. */
export default function PhoneIndiaField({ value, onChange, disabled, placeholder = '10-digit mobile' }) {
  const d = digits10(value)
  return (
    <div className={`phone-in${disabled ? ' is-disabled' : ''}`}>
      <span className="phone-in-cc">+91</span>
      <input
        type="tel"
        inputMode="numeric"
        autoComplete="tel-national"
        maxLength={10}
        value={d}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => {
          const next = digits10(e.target.value)
          onChange?.(next ? toE164In(next) : '')
        }}
      />
    </div>
  )
}
