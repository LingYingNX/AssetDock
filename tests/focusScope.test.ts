import { describe, expect, it } from 'vitest'
import { isEditableTarget } from '../src/renderer/src/data/focus-scope'

/* 测试环境是 node(仓库没有 jsdom),所以这里只造出被用到的三个属性 */
const el = (tag: string, attrs: Record<string, string> = {}, parent: Element | null = null): Element =>
  ({
    tagName: tag.toUpperCase(),
    parentElement: parent,
    getAttribute: (name: string): string | null => attrs[name] ?? null
  }) as unknown as Element

describe('keyboard focus scope', () => {
  it('treats an input as editable', () => {
    expect(isEditableTarget(el('input'))).toBe(true)
  })

  it('treats a textarea as editable', () => {
    expect(isEditableTarget(el('textarea'))).toBe(true)
  })

  it('treats a contenteditable element as editable', () => {
    expect(isEditableTarget(el('div', { contenteditable: 'true' }))).toBe(true)
  })

  it('treats a descendant of a contenteditable element as editable', () => {
    expect(isEditableTarget(el('span', {}, el('div', { contenteditable: 'true' })))).toBe(true)
  })

  it('treats a plain element as not editable', () => {
    expect(isEditableTarget(el('div', { class: 'card' }))).toBe(false)
  })

  it('treats null as not editable', () => {
    expect(isEditableTarget(null)).toBe(false)
  })

  /* 合成事件与 window 级监听会把 target 设成非元素对象,那里连 getAttribute 都没有 */
  it('treats a non-element target such as window as not editable', () => {
    expect(isEditableTarget({ tagName: undefined, parentElement: null } as unknown as Element)).toBe(false)
  })

  it('stops at contenteditable="false" instead of inheriting the ancestor', () => {
    const inner = el('span', {}, el('div', { contenteditable: 'false' }, el('div', { contenteditable: 'true' })))
    expect(isEditableTarget(inner)).toBe(false)
  })

  it('covers a modal dialog but not the non-modal lightbox', () => {
    expect(isEditableTarget(el('button', {}, el('section', { 'aria-modal': 'true' })))).toBe(true)
    expect(isEditableTarget(el('button', {}, el('section', { 'aria-modal': 'false' })))).toBe(false)
  })
})
