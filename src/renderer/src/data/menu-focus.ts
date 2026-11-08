/** 菜单方向键的落点:越界循环,当前项不在菜单内时从头/尾进入。 */
export function nextMenuIndex(key: string, current: number, count: number): number | null {
  if (count <= 0) return null
  if (key === 'Home') return 0
  if (key === 'End') return count - 1
  if (key !== 'ArrowDown' && key !== 'ArrowUp') return null
  if (current < 0 || current >= count) return key === 'ArrowDown' ? 0 : count - 1
  return key === 'ArrowDown' ? (current + 1) % count : (current - 1 + count) % count
}
