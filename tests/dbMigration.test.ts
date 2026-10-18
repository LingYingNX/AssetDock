import { describe, expect, it } from 'vitest'
import { openSqlite } from '../src/main/services/sqlite'
import { migrateSchema } from '../src/main/services/db'

describe('database schema migration', () => {
  it('replays a version-1 database whose codec column was already added', () => {
    const db = openSqlite(':memory:')
    try {
      db.exec('CREATE TABLE assets (id INTEGER PRIMARY KEY, codec TEXT)')
      db.pragma('user_version = 1')

      expect(() => migrateSchema(db)).not.toThrow()
      const columns = (db.pragma('table_info(assets)') as { name: string }[]).map((column) => column.name)
      expect(columns).toContain('codec')
      expect(columns).toContain('fps')
      expect(columns).toContain('source_index_id')
      expect(columns).toContain('folder_path')
      expect(db.pragma('user_version', { simple: true })).toBe(5)
    } finally {
      db.close()
    }
  })
})
