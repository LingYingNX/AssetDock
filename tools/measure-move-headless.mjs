const bridge = 'http://127.0.0.1:9223/'
const budgetMs = Number(process.env.MOVE_BUDGET_MS ?? 500)

async function evaluate(expression) {
  const response = await fetch(`${bridge}${encodeURIComponent(expression)}`)
  const result = await response.json()
  if (!result.ok) throw new Error(result.error)
  return result.value
}

import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

const setup = await evaluate(`(() => {
  const state = window.__ui.getState()
  const tab = state.tabs.find((item) => item.id === state.activeTabId)
  const asset = state.assets.find((item) => item.sourceIndexId != null && item.dbId != null && item.folders.length > 0 && !item.missing && !item.deletedAt)
  if (!tab?.libraryId || !asset) throw new Error('no indexed asset with a folder')
  const target = state.folderPaths.find((folder) => !asset.folders.includes(folder))
  if (!target) throw new Error('no alternate folder for round-trip move')
  const sourceFolder = asset.folders[asset.folders.length - 1]
  const prefix = '@index:' + asset.sourceIndexId + '/'
  const sourceRel = asset.relPath?.startsWith(prefix) ? asset.relPath.slice(prefix.length) : null
  if (!sourceRel) throw new Error('indexed asset path is invalid')
  const library = state.libraries.find((item) => item.id === tab.libraryId)
  if (!library) throw new Error('library not found')
  return { assetId: asset.id, dbId: asset.dbId, libraryId: tab.libraryId, sourceFolder, targetFolder: target, libraryPath: library.path, sourceRel }
})()`)

const shortcutPath = `${join(setup.libraryPath, setup.sourceRel)}.lnk`
const sidecarPath = `${join(setup.libraryPath, setup.sourceRel)}.json`
const shortcutBefore = await stat(shortcutPath).then((value) => value.mtimeMs, () => null)

async function move(folder) {
  const result = await evaluate(`(async () => {
    const started = performance.now()
    const response = await window.windowApi.assets.move(${setup.libraryId}, [${setup.dbId}], ${JSON.stringify(folder)})
    return { elapsedMs: Math.round(performance.now() - started), response }
  })()`)
  if (result.response?.error) throw new Error(result.response.error)
  if (result.elapsedMs > budgetMs) throw new Error(`move exceeded ${budgetMs}ms: ${result.elapsedMs}ms`)

  const deadline = Date.now() + 5000
  let state
  while (Date.now() < deadline) {
    state = await evaluate(`(() => {
      const asset = window.__ui.getState().assets.find((item) => item.id === ${JSON.stringify(setup.assetId)})
      return asset ? asset.folders : null
    })()`)
    if (Array.isArray(state) && state.includes(folder)) break
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  if (!Array.isArray(state) || !state.includes(folder)) throw new Error(`UI did not refresh folder: ${folder}`)

  const sidecarDeadline = Date.now() + 5000
  let sidecar
  while (Date.now() < sidecarDeadline) {
    sidecar = JSON.parse(await readFile(sidecarPath, 'utf8'))
    if (sidecar.asset?.folderPath === folder) break
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  if (sidecar?.asset?.folderPath !== folder) throw new Error(`sidecar folder mismatch: ${sidecar?.asset?.folderPath} !== ${folder}`)
  return { folder, ...result, uiFolders: state, sidecarFolder: sidecar.asset.folderPath }
}

let result
try {
  const moved = await move(setup.targetFolder)
  const restored = await move(setup.sourceFolder)
  result = { setup, moved, restored }
} finally {
  const current = await evaluate(`(() => {
    const asset = window.__ui.getState().assets.find((item) => item.id === ${JSON.stringify(setup.assetId)})
    return asset?.folders ?? []
  })()`).catch(() => [])
  if (!current.includes(setup.sourceFolder)) await move(setup.sourceFolder)
}

const shortcutAfter = await stat(shortcutPath).then((value) => value.mtimeMs, () => null)
if (shortcutBefore != null && shortcutAfter !== shortcutBefore) throw new Error('shortcut was rewritten during classification move')
console.log(JSON.stringify({ ...result, shortcutBefore, shortcutAfter }, null, 2))
