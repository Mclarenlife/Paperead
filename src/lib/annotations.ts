import { db } from './db'
import { resultName } from './results'
import type { Annotation, Job } from '../types'

export async function editAnnotation(id: string, comment: string, color: string) {
  if (!['yellow', 'green', 'purple'].includes(color)) throw new Error('批注颜色无效。')
  await db.transaction('rw', db.annotations, async () => {
    const current = await db.annotations.get(id)
    if (!current || current.deletedAt) throw new Error('批注已删除，请先恢复。')
    await db.annotations.update(id, { comment, color })
  })
}
export function annotationsMarkdown(title: string, annotations: Annotation[], jobs: Job[]) {
  return (
    `# ${title} · 批注汇总\n\n共 ${annotations.length} 条批注\n\n` +
    annotations
      .map((a, i) => {
        const job = jobs.find((j) => j.id === a.jobId)
        const origin =
          a.source === 'original'
            ? `原文 · 第 ${a.page} 页`
            : `${a.source === 'translation' ? '译文' : '重排'} · ${job ? resultName(job) : '历史结果'}${a.scope === 'document' ? '' : ` · 第 ${a.page} 页`}`
        return `## ${i + 1}. ${origin}\n\n> ${a.quote.replace(/\n/g, '\n> ')}\n\n${a.comment}\n\n*颜色：${{ yellow: '黄色', green: '绿色', purple: '紫色' }[a.color]} · ${new Date(a.createdAt).toLocaleString()}*`
      })
      .join('\n\n---\n\n')
  )
}
