import { describe, expect, it } from 'vitest'
import { envToText, textToEnv } from './env'

describe('textToEnv', () => {
  it('parses KEY=VALUE lines', () => {
    expect(textToEnv('A=1\nB=two')).toEqual({ A: '1', B: 'two' })
  })
  it('skips blank lines and comments', () => {
    expect(textToEnv('\n# note\nA=1\n\n')).toEqual({ A: '1' })
  })
  it('keeps = inside values and trims around the first =', () => {
    expect(textToEnv(' URL = http://x?a=b ')).toEqual({ URL: 'http://x?a=b' })
  })
  it('ignores lines without a key', () => {
    expect(textToEnv('=oops\nnoequals\nA=1')).toEqual({ A: '1' })
  })
  it('returns undefined when nothing is set', () => {
    expect(textToEnv('')).toBeUndefined()
    expect(textToEnv('# only a comment')).toBeUndefined()
  })
  it('accepts Windows line endings', () => {
    expect(textToEnv('A=1\r\nB=2')).toEqual({ A: '1', B: '2' })
  })
})

describe('envToText', () => {
  it('round-trips through textToEnv', () => {
    const env = { NODE_ENV: 'development', PORT: '3000' }
    expect(textToEnv(envToText(env))).toEqual(env)
  })
  it('renders an empty map as an empty string', () => {
    expect(envToText(undefined)).toBe('')
  })
})
