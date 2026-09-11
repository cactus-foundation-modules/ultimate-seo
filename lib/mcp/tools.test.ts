import { describe, expect, it } from 'vitest'
import { searchTokens } from './tools'

describe('searchTokens', () => {
  it('keeps the words that carry the question', () => {
    expect(searchTokens('a desk with drawers')).toEqual(['desk', 'drawers'])
  })

  it('drops the filler an agent puts round a request', () => {
    expect(searchTokens('what is the best office chair for me')).toEqual(['office', 'chair'])
  })

  it('keeps numbers and currency, which is how people ask about price', () => {
    expect(searchTokens('office chair under £250')).toEqual(['office', 'chair', 'under', '£250'])
  })

  it('keeps a percentage intact', () => {
    expect(searchTokens('50% off')).toEqual(['50%', 'off'])
  })

  it('drops single characters and repeats', () => {
    expect(searchTokens('desk desk a x chair')).toEqual(['desk', 'chair'])
  })

  it('stops at six words, however long the question', () => {
    expect(searchTokens('black mesh ergonomic executive swivel office chair headrest lumbar')).toHaveLength(6)
  })

  it('is empty when the question is nothing but filler', () => {
    expect(searchTokens('what do you have')).toEqual([])
  })

  it('trims punctuation off the ends of a word', () => {
    expect(searchTokens('desks, chairs.')).toEqual(['desks', 'chairs'])
  })
})
