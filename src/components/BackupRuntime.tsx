import { useEffect } from 'react'
import { db } from '../lib/db'
import { automaticBackupTick, backupSettings } from '../lib/snapshots'
import { errorMessage } from '../lib/utils'
export function BackupRuntime({ notify }: { notify: (message: string, error?: boolean) => void }) {
  useEffect(() => {
    let live = true,
      lastError = '',
      running = false
    const tick = async () => {
      if (running) return
      running = true
      try {
        if (await automaticBackupTick()) {
          lastError = ''
          if (live) notify('自动备份已完成')
        }
      } catch (e) {
        const message = errorMessage(e)
        if (!/草稿/.test(message) && message !== lastError && live)
          notify(`自动备份未完成：${message}`, true)
        lastError = message
      } finally {
        running = false
      }
    }
    void (async () => {
      const settings = await backupSettings(),
        last = Number((await db.meta.get('lastBackupAt'))?.value || 0),
        first = await db.papers.orderBy('createdAt').first()
      if (
        live &&
        Date.now() - (last || first?.createdAt || Date.now()) > settings.remindDays * 86400_000
      )
        notify('已较长时间没有备份，请在偏好设置中导出完整资料库。')
      if (live) void tick()
    })().catch((e) => {
      if (live) notify(`备份状态读取失败：${errorMessage(e)}`, true)
    })
    const timer = setInterval(() => void tick(), 60_000)
    return () => {
      live = false
      clearInterval(timer)
    }
  }, [notify])
  return null
}
