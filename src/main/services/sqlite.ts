import Database from 'better-sqlite3'

export function openSqlite(filename: string): Database.Database {
  return new Database(filename)
}
