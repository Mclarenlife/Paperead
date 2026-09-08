import { isTauri } from '@tauri-apps/api/core'
import { db } from './db'
import { createBackup } from './backup'
import { uid } from './utils'
import type { Snapshot } from '../types'
export interface BackupSettings {
  automatic: boolean
  intervalHours: number
  keep: number
  remindDays: number
}
export const backupDefaults: BackupSettings = {
  automatic: false,
  intervalHours: 24,
  keep: 5,
  remindDays: 7,
}
export async function backupSettings(): Promise<BackupSettings> {
  return { ...backupDefaults, ...JSON.parse((await db.meta.get('backupSettings'))?.value || '{}') }
}
export async function saveBackupSettings(settings: BackupSettings) {
  const safe = {
    automatic: !!settings.automatic,
    intervalHours: Math.max(1, Math.min(168, settings.intervalHours || 24)),
    keep: Math.max(1, Math.min(20, settings.keep || 5)),
    remindDays: Math.max(1, Math.min(90, settings.remindDays || 7)),
  }
  await db.meta.put({ key: 'backupSettings', value: JSON.stringify(safe) })
}
let active: Promise<Snapshot> | undefined
export function createSnapshot(kind: Snapshot['kind']): Promise<Snapshot> {
  if (active) return active.then(() => createSnapshot(kind))
  const work = (async () => {
    const blob = await createBackup(),
      id = uid(),
      createdAt = Date.now()
    const snapshot: Snapshot = {
      id,
      createdAt,
      kind,
      name: `${kind === 'before-restore' ? '恢复前' : kind === 'automatic' ? '自动' : '手动'}快照 ${new Date(createdAt).toLocaleString()}`,
      size: blob.size,
    }
    if (isTauri()) {
      const fs = await import('@tauri-apps/plugin-fs'),
        baseDir = fs.BaseDirectory.AppLocalData
      await fs.mkdir('backups', { baseDir, recursive: true })
      const fileName = `snapshot-${createdAt}-${id}.zip`,
        temporary = `backups/${fileName}.tmp`
      await fs.writeFile(temporary, new Uint8Array(await blob.arrayBuffer()), { baseDir })
      await fs.rename(temporary, `backups/${fileName}`, {
        oldPathBaseDir: baseDir,
        newPathBaseDir: baseDir,
      })
      snapshot.fileName = fileName
    } else snapshot.blob = blob
    await db.snapshots.add(snapshot)
    await db.meta.put({ key: 'lastBackupAt', value: String(createdAt) })
    const settings = await backupSettings(),
      previous = await db.snapshots.orderBy('createdAt').reverse().toArray()
    // Restore safeguards are retained separately from the automatic rotation.
    const old = previous.filter((s) => s.kind === kind).slice(settings.keep)
    for (const row of old) await deleteSnapshot(row.id)
    return snapshot
  })()
  active = work
  void work
    .finally(() => {
      if (active === work) active = undefined
    })
    .catch(() => {})
  return work
}
export async function snapshotBlob(snapshot: Snapshot): Promise<Blob> {
  if (snapshot.blob) return snapshot.blob
  if (!snapshot.fileName || !/^snapshot-[\w-]+\.zip$/.test(snapshot.fileName))
    throw new Error('快照文件信息无效。')
  const fs = await import('@tauri-apps/plugin-fs')
  return new Blob(
    [await fs.readFile(`backups/${snapshot.fileName}`, { baseDir: fs.BaseDirectory.AppLocalData })],
    { type: 'application/zip' },
  )
}
export async function deleteSnapshot(id: string) {
  const snapshot = await db.snapshots.get(id)
  if (snapshot?.fileName && isTauri()) {
    if (!/^snapshot-[\w-]+\.zip$/.test(snapshot.fileName)) throw new Error('快照路径无效。')
    const fs = await import('@tauri-apps/plugin-fs')
    await fs.remove(`backups/${snapshot.fileName}`, { baseDir: fs.BaseDirectory.AppLocalData })
  }
  await db.snapshots.delete(id)
}
export async function discoverSnapshots() {
  if (!isTauri()) return
  const fs = await import('@tauri-apps/plugin-fs'),
    baseDir = fs.BaseDirectory.AppLocalData
  await fs.mkdir('backups', { baseDir, recursive: true })
  const known = new Set((await db.snapshots.toArray()).map((s) => s.fileName))
  for (const entry of await fs.readDir('backups', { baseDir })) {
    const match = entry.name.match(/^snapshot-(\d+)-([\w-]+)\.zip$/)
    if (entry.isFile && match && !known.has(entry.name)) {
      const size = (await fs.stat(`backups/${entry.name}`, { baseDir })).size
      await db.snapshots.put({
        id: match[2],
        createdAt: Number(match[1]),
        name: `发现本机快照 ${new Date(Number(match[1])).toLocaleString()}`,
        kind: 'manual',
        fileName: entry.name,
        size,
      })
    }
  }
}
export async function automaticBackupTick(now = Date.now()) {
  const settings = await backupSettings(),
    last = Number((await db.meta.get('lastBackupAt'))?.value || 0)
  if (
    !settings.automatic ||
    now - last < settings.intervalHours * 3600_000 ||
    active ||
    (await db.jobs.where('status').equals('running').count())
  )
    return false
  await createSnapshot('automatic')
  return true
}
