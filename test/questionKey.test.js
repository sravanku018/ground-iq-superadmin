import { describe, expect, it } from 'vitest'
import {
  LEGACY_QUESTION_ALIASES,
  canTeluguQuestions,
  getQuestionAliases,
  getQuestionDisplayLabel,
  isQuestionVisible,
  labelPatch,
  multiMaxChoices,
  nextQuestionId,
  parseQuestionsArray,
  resolveAnswerValue,
  slugQuestionKey,
  teluguFields,
} from '../src/questionKey.js'

// Question keys are the join between a survey's definition and every answer row
// ever submitted against it, which is why this file's behaviour is worth
// freezing before it drifts.

describe('slugQuestionKey', () => {
  it('slugifies a label into a field id', () => {
    expect(slugQuestionKey('Which party do you prefer?')).toBe('which_party_do_you_prefer')
    expect(slugQuestionKey('  Age  ')).toBe('age')
    expect(slugQuestionKey('A  B')).toBe('a_b')
  })

  it('drops apostrophes instead of turning them into separators', () => {
    expect(slugQuestionKey("What's On?")).toBe('whats_on')
    expect(slugQuestionKey('What’s On?')).toBe('whats_on')
  })

  it('never leaves leading or trailing separators', () => {
    expect(slugQuestionKey('  --Age--  ')).toBe('age')
    expect(slugQuestionKey('???')).toBe('')
  })

  it('is empty for nullish input', () => {
    expect(slugQuestionKey('')).toBe('')
    expect(slugQuestionKey(null)).toBe('')
    expect(slugQuestionKey(undefined)).toBe('')
  })

  it('caps the id at 64 characters', () => {
    expect(slugQuestionKey('a'.repeat(80))).toHaveLength(64)
  })
})

describe('multiMaxChoices', () => {
  it('honours 1..5', () => {
    expect(multiMaxChoices({ max_choices: 1 })).toBe(1)
    expect(multiMaxChoices({ max_choices: 5 })).toBe(5)
    expect(multiMaxChoices({ max_choices: '4' })).toBe(4)
    expect(multiMaxChoices({ max_choices: 2.9 })).toBe(2)
  })

  it('falls back to 2 for absent, blank or out-of-range values', () => {
    expect(multiMaxChoices({})).toBe(2)
    expect(multiMaxChoices({ max_choices: '' })).toBe(2)
    expect(multiMaxChoices({ max_choices: 0 })).toBe(2)
    expect(multiMaxChoices({ max_choices: 6 })).toBe(2)
    expect(multiMaxChoices({ max_choices: 'abc' })).toBe(2)
    expect(multiMaxChoices(null)).toBe(2)
  })
})

describe('parseQuestionsArray', () => {
  const rows = [{ id: 'q_1', label: 'Age' }]

  it('passes an array straight through', () => {
    expect(parseQuestionsArray(rows)).toBe(rows)
  })

  it('parses a JSON string', () => {
    expect(parseQuestionsArray(JSON.stringify(rows))).toEqual(rows)
  })

  it('parses a doubly-encoded JSON string', () => {
    expect(parseQuestionsArray(JSON.stringify(JSON.stringify(rows)))).toEqual(rows)
  })

  it('returns an empty array for anything unusable', () => {
    expect(parseQuestionsArray('not json')).toEqual([])
    expect(parseQuestionsArray('{"a":1}')).toEqual([])
    expect(parseQuestionsArray(42)).toEqual([])
    expect(parseQuestionsArray(null)).toEqual([])
    expect(parseQuestionsArray(undefined)).toEqual([])
  })
})

describe('teluguFields', () => {
  it('persists Telugu copy only when the author filled it in', () => {
    expect(teluguFields({ label_te: '  వయస్సు  ' })).toEqual({ label_te: 'వయస్సు' })
    expect(teluguFields({})).toEqual({})
    expect(teluguFields({ label_te: '   ' })).toEqual({})
    expect(teluguFields(null)).toEqual({})
  })

  it('prefers the options_te array when any entry is filled', () => {
    expect(teluguFields({ options_te: ['ఎ', ''] })).toEqual({ options_te: ['ఎ', ''] })
  })

  it('splits the comma text field when the array is empty', () => {
    expect(teluguFields({ options_te: ['', ''], options_te_text: 'a, b , ,c' })).toEqual({
      options_te: ['a', 'b', 'c'],
    })
    expect(teluguFields({ options_te_text: 'a,b' })).toEqual({ options_te: ['a', 'b'] })
  })

  it('omits options entirely when neither source has content', () => {
    expect(teluguFields({ options_te: [], options_te_text: ' , ' })).toEqual({})
  })
})

describe('canTeluguQuestions', () => {
  it('is a Super Admin grant, or an explicit per-user flag', () => {
    expect(canTeluguQuestions({ role: 'super_admin' })).toBe(true)
    expect(canTeluguQuestions({ can_translate_telugu: true })).toBe(true)
    expect(canTeluguQuestions({ role: 'admin' })).toBe(false)
    expect(canTeluguQuestions(null)).toBe(false)
  })
})

describe('labelPatch', () => {
  it('keeps the question text exactly as typed', () => {
    expect(labelPatch({}, 'Age')).toEqual({ label: 'Age', speak: 'Age' })
    expect(labelPatch({}, 42)).toEqual({ label: '42', speak: '42' })
  })

  it('follows the label while speak is still the default', () => {
    expect(labelPatch({ label: 'Age', speak: 'Age' }, 'Age in years')).toEqual({
      label: 'Age in years',
      speak: 'Age in years',
    })
  })

  it('never overwrites an edited speak string', () => {
    expect(labelPatch({ label: 'Age', speak: 'How old are you' }, 'Age in years')).toEqual({
      label: 'Age in years',
    })
  })
})

describe('nextQuestionId', () => {
  it('keeps an existing q_N id', () => {
    const used = new Set()
    expect(nextQuestionId('Age', 'q_3', used)).toBe('q_3')
    expect(used.has('q_3')).toBe(true)
  })

  it('lowercases the id it returns', () => {
    expect(nextQuestionId('Age', 'Q_5', new Set())).toBe('q_5')
  })

  it('uses the index when there is no usable id', () => {
    expect(nextQuestionId('Age', 'junk', new Set(), 2)).toBe('q_2')
    expect(nextQuestionId('Age', '', new Set(), 7)).toBe('q_7')
  })

  it('takes the lowest free q_N when the id and index are taken', () => {
    expect(nextQuestionId('Age', 'q_3', new Set(['q_3']), 3)).toBe('q_1')
    expect(nextQuestionId('Age', 'q_1', new Set(['q_1']), 1)).toBe('q_2')
    expect(nextQuestionId('Age', '', new Set(['q_1', 'q_2']), null)).toBe('q_3')
  })

  it('registers the id it hands out, so the next call cannot repeat it', () => {
    const used = new Set()
    expect(nextQuestionId('A', '', used)).toBe('q_1')
    expect(nextQuestionId('B', '', used)).toBe('q_2')
  })
})

describe('isQuestionVisible', () => {
  it('treats an absent flag as visible', () => {
    expect(isQuestionVisible({})).toBe(true)
    expect(isQuestionVisible({ visible: true })).toBe(true)
    expect(isQuestionVisible({ visible: false })).toBe(false)
  })
})

describe('getQuestionAliases', () => {
  it('is empty without a question', () => {
    expect(getQuestionAliases(null)).toEqual([])
  })

  it('covers the canonical id, its q_N spellings and the label slug', () => {
    const aliases = getQuestionAliases({ id: 'q_11', label: "What's On?" }, 11)
    expect(aliases).toContain('q_11')
    expect(aliases).toContain('q11')
    expect(aliases).toContain('whats_on')
  })

  // The legacy table is keyed by the slugged question text, so the aliases are
  // reachable once the question's own id/key/slug matches one of those keys.
  it('expands the known legacy keys when the question matches a legacy slug', () => {
    const id = 'are_you_eligible_for_any_present_state_govt_schemes'
    const aliases = getQuestionAliases({ id })
    for (const legacy of LEGACY_QUESTION_ALIASES[id]) {
      expect(aliases).toContain(legacy)
    }
  })

  // Characterization, not endorsement: a question known only as q_11 does not
  // reach the legacy table, so an old submission stored under one of those
  // aliases is only found when the slug matches.
  it('does not reach the legacy table from a q_N id alone', () => {
    const aliases = getQuestionAliases({ id: 'q_11' })
    expect(aliases).toContain('q11')
    expect(aliases).not.toContain('2_whats_on')
  })

  it('uses the index when the question has no id yet', () => {
    expect(getQuestionAliases({ label: 'Age' }, 3)).toEqual(expect.arrayContaining(['q_3', 'q3', 'age']))
  })

  it('includes an explicit key', () => {
    expect(getQuestionAliases({ key: 'CUSTOM' })).toEqual(expect.arrayContaining(['CUSTOM', 'custom']))
  })
})

describe('resolveAnswerValue', () => {
  const label = "What's On?"

  it('reads the canonical id first', () => {
    expect(resolveAnswerValue({ q_1: 'A' }, { id: 'q_1' })).toBe('A')
  })

  it('falls back through q_N spellings and the label slug', () => {
    expect(resolveAnswerValue({ q1: 'B' }, { id: 'q_1' }, 1)).toBe('B')
    expect(resolveAnswerValue({ whats_on: 'X' }, { label })).toBe('X')
  })

  it('finds an answer stored under a legacy alias', () => {
    const id = 'are_you_eligible_for_any_present_state_govt_schemes'
    expect(resolveAnswerValue({ '2_whats_on': 'Y' }, { id })).toBe('Y')
    expect(resolveAnswerValue({ q_mtpkyf2o: 'Z' }, { id })).toBe('Z')
  })

  it('derives the key from the label when the question has no id', () => {
    expect(resolveAnswerValue({ which_party: 'BJP' }, { label: 'Which party?' })).toBe('BJP')
  })

  it('keeps falsy-but-real answers', () => {
    expect(resolveAnswerValue({ q_1: 0 }, { id: 'q_1' })).toBe(0)
    expect(resolveAnswerValue({ q_1: false }, { id: 'q_1' })).toBe(false)
  })

  it('treats empty strings and null as unanswered', () => {
    expect(resolveAnswerValue({ q_1: '' }, { id: 'q_1' })).toBe('')
    expect(resolveAnswerValue({ q_1: null }, { id: 'q_1' })).toBe('')
  })

  it('returns an empty string instead of throwing on bad input', () => {
    expect(resolveAnswerValue(null, { id: 'q_1' })).toBe('')
    expect(resolveAnswerValue({ q_1: 'A' }, null)).toBe('')
    expect(resolveAnswerValue('nonsense', { id: 'q_1' })).toBe('')
  })
})

describe('getQuestionDisplayLabel', () => {
  it('numbers the label for Client Admin views', () => {
    expect(getQuestionDisplayLabel({ label: 'Age' }, 3)).toBe('Q3. Age')
    expect(getQuestionDisplayLabel({ label_te: 'వయస్సు' }, 2)).toBe('Q2. వయస్సు')
  })

  it('does not double-prefix a label that already carries its number', () => {
    expect(getQuestionDisplayLabel({ label: 'Q3. Age' }, 3)).toBe('Q3. Age')
    expect(getQuestionDisplayLabel({ label: 'q_3 something' }, 3)).toBe('q_3 something')
  })

  it('falls back through label, tamil copy, id, then a placeholder', () => {
    expect(getQuestionDisplayLabel({ id: 'q_9' }, undefined)).toBe('q_9')
    expect(getQuestionDisplayLabel(null, 5)).toBe('Question 5')
    expect(getQuestionDisplayLabel(null)).toBe('Question')
  })
})
