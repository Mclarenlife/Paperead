import { beforeEach, expect, it, vi } from 'vitest'
import JSZip from 'jszip'
import { db, seedDatabase } from '../src/lib/db'
import { createBackup, restoreBackup, type RestorePreview } from '../src/lib/backup'
import {
  createSnapshot,
  saveBackupSettings,
  automaticBackupTick,
  snapshotBlob,
} from '../src/lib/snapshots'
import { withNoteHistory, restoreNoteVersion } from '../src/lib/note-library'
import {
  parseReferences,
  importReferences,
  bibliography,
  normalizeDoi,
  abstractFromText,
  lookupDoi,
} from '../src/lib/metadata'
import { buildVisionRequest, defaultSettings } from '../src/lib/ai'
import { platformFetch } from '../src/lib/platform'
vi.mock('../src/lib/platform', () => ({ platformFetch: vi.fn() }))
beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()))
  await seedDatabase()
})

it('imports BibTeX and RIS without inventing PDFs and round trips citation fields', async () => {
  const entries = await parseReferences(
    '@article{test,title={Research Evidence},author={Smith, Jane},year={2023},journal={Journal of Tests},doi={10.1234/example}}',
  )
  expect(entries[0]).toMatchObject({
    title: 'Research Evidence',
    year: 2023,
    doi: '10.1234/example',
    authors: 'Jane Smith',
  })
  expect(await importReferences(entries)).toEqual({ added: 1, skipped: 0 })
  expect(await importReferences(entries)).toEqual({ added: 0, skipped: 1 })
  const paper = await db.papers.where('doi').equals('10.1234/example').first()
  expect(paper?.referenceOnly).toBe(true)
  expect(await db.assets.get(paper!.id)).toBeUndefined()
  for (const format of ['bibtex', 'ris'] as const) {
    const restored = await parseReferences(await bibliography([paper!], format))
    expect(restored[0]).toMatchObject({
      title: 'Research Evidence',
      year: 2023,
      doi: '10.1234/example',
    })
  }
  await restoreBackup(await createBackup())
  expect((await db.papers.get(paper!.id))?.referenceOnly).toBe(true)
})
it('normalizes DOI and separates real abstract headings from a body excerpt', () => {
  expect(normalizeDoi('https://doi.org/10.1234/TEST.')).toBe('10.1234/test')
  expect(() => normalizeDoi('random')).toThrow('DOI')
  expect(abstractFromText('A title\nThis paragraph only begins the paper.')).toBe('')
  expect(
    abstractFromText(
      'Abstract\nThis is a sufficiently long abstract containing results and evidence.\nKeywords: paper\n1 Introduction',
    ),
  ).toContain('sufficiently long abstract')
})
it('DOI lookup uses publication metadata and remains an explicit preview result', async () => {
  vi.mocked(platformFetch).mockResolvedValue(
    new Response(
      JSON.stringify({
        message: {
          title: ['Verified Title'],
          author: [{ given: 'Jane', family: 'Smith' }],
          'published-print': { 'date-parts': [[2020]] },
          'container-title': ['Journal'],
          abstract: '<jats:p>Abstract</jats:p>',
        },
      }),
      { status: 200 },
    ),
  )
  const result = await lookupDoi('10.1234/test')
  expect(result).toMatchObject({
    year: 2020,
    title: 'Verified Title',
    authors: 'Jane Smith',
    abstract: 'Abstract',
  })
  expect(await db.papers.where('doi').equals('10.1234/test').count()).toBe(0)
})
it('backup preview changes no records and restoration first creates an independent rollback', async () => {
  const backup = await createBackup()
  await db.papers.update('sample-0', { title: 'Before restore' })
  const preview = (await restoreBackup(backup, { preview: true })) as RestorePreview
  expect(preview.papers.find((p) => p.id === 'sample-0')?.overwrite).toBe(true)
  expect((await db.papers.get('sample-0'))?.title).toBe('Before restore')
  expect(await db.snapshots.count()).toBe(0)
  await restoreBackup(backup)
  const snapshot = (await db.snapshots.toArray())[0]
  expect(snapshot.kind).toBe('before-restore')
  const zip = await JSZip.loadAsync(await (await snapshotBlob(snapshot)).arrayBuffer()),
    manifest = JSON.parse(await zip.file('manifest.json')!.async('string'))
  expect(manifest.papers.find((p: any) => p.id === 'sample-0').title).toBe('Before restore')
  expect(manifest).not.toHaveProperty('snapshots')
})
it('rotates snapshots within their kind and defers automatic backups during jobs', async () => {
  await saveBackupSettings({ automatic: true, keep: 1, intervalHours: 1, remindDays: 7 })
  await createSnapshot('before-restore')
  await createSnapshot('manual')
  await createSnapshot('manual')
  expect(await db.snapshots.count()).toBe(2)
  expect(await automaticBackupTick(Date.now())).toBe(false)
  await db.jobs.add({
    id: 'busy',
    paperId: 'sample-0',
    kind: 'reflow',
    provider: 'compatible',
    model: 'm',
    baseUrl: 'https://example.test',
    language: 'en',
    status: 'running',
    chunks: [{ page: 1, input: 'text' }],
    updatedAt: 1,
  })
  expect(await automaticBackupTick(Date.now() + 7200_000)).toBe(false)
  await db.jobs.delete('busy')
  expect(await automaticBackupTick(Date.now() + 7200_000)).toBe(true)
})
it('refuses restoration when the protective snapshot cannot be saved', async () => {
  const backup = await createBackup()
  await db.papers.update('sample-0', { title: 'Keep current' })
  const fail = vi.spyOn(db.snapshots, 'add').mockRejectedValueOnce(new Error('Storage full'))
  await expect(restoreBackup(backup)).rejects.toThrow('Storage full')
  fail.mockRestore()
  expect((await db.papers.get('sample-0'))?.title).toBe('Keep current')
})
it('preserves folder, tags, image bytes and note history through backup and rejects altered attachments', async () => {
  await db.noteFolders.add({ id: 'folder', name: 'Evidence' })
  const blob = new Blob([new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4])], { type: 'image/png' })
  await db.attachments.add({
    id: 'image',
    name: 'image.png',
    mime: 'image/png',
    blob,
    createdAt: 1,
  })
  await db.notes.add({
    id: 'pictured',
    title: 'Pictured',
    markdown: '![test](paperead-attachment:image)',
    folderId: 'folder',
    tags: ['test'],
    history: [{ id: 'old', title: 'Old', markdown: 'Evidence', createdAt: 1 }],
    updatedAt: 2,
  })
  const backup = await createBackup()
  await db.notes.delete('pictured')
  await restoreBackup(backup)
  expect((await db.notes.get('pictured'))?.history?.[0].markdown).toBe('Evidence')
  expect(await (await db.attachments.get('image'))!.blob.arrayBuffer()).toEqual(
    await blob.arrayBuffer(),
  )
  const zip = await JSZip.loadAsync(await backup.arrayBuffer())
  zip.file('attachments/image', 'tampered')
  await expect(
    restoreBackup(await zip.generateAsync({ type: 'blob' }), { preview: true }),
  ).rejects.toThrow('校验')
})
it('coalesces rapid autosaves and restores history while retaining the overwritten content', async () => {
  const note = { id: 'history', title: 'First', markdown: 'Original text', updatedAt: 1 }
  const history = withNoteHistory(note, 1000)
  expect(withNoteHistory({ ...note, history }, 2000)).toHaveLength(1)
  await db.notes.add({ ...note, markdown: 'Edited text', history })
  await restoreNoteVersion(note.id, history[0].id)
  const restored = await db.notes.get(note.id)
  expect(restored?.markdown).toBe('Original text')
  expect(restored?.history?.at(-1)?.markdown).toBe('Edited text')
})
it('sends vision images using each provider protocol with task constraints intact', () => {
  for (const provider of ['compatible', 'openai', 'anthropic', 'gemini'] as const) {
    const request = buildVisionRequest(
      { ...defaultSettings, provider, model: 'vision' },
      'key',
      'Transcribe only',
      'No conversation',
      'data:image/png;base64,YWJj',
    )
    const body: any = request.body
    expect(JSON.stringify(body)).toContain('YWJj')
    expect(JSON.stringify(body)).toContain('Transcribe only')
    expect(JSON.stringify(body)).toContain('No conversation')
    if (provider === 'openai') expect(body.input[0].content[1].type).toBe('input_image')
    if (provider === 'gemini')
      expect(body.contents[0].parts[1].inlineData.mimeType).toBe('image/png')
  }
})
