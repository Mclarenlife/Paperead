export type ReadingStatus = 'unread' | 'reading' | 'finished'
export type Source = 'original' | 'translation' | 'reflow'
export type Provider = 'compatible' | 'openai' | 'anthropic' | 'gemini'
export interface Paper {
  doi?: string
  metadataStatus?: 'unverified' | 'verified'
  metadataSource?: string
  excerpt?: string
  referenceOnly?: boolean
  bookmarks?: Bookmark[]
  readingPositions?: Record<string, ReadingLocation>
  lastLocation?: ReadingLocation
  deletedAt?: number
  id: string
  hash: string
  title: string
  authors: string
  year: number
  venue: string
  abstract: string
  tags: string[]
  collectionId: string
  starred: boolean
  status: ReadingStatus
  currentPage: number
  pageCount: number
  createdAt: number
  lastReadAt: number
  color: string
  sample: boolean
  size: number
}
export interface Asset {
  paperId: string
  pdf?: Blob
  thumbnail?: string
}
export interface Page {
  id: string
  paperId: string
  number: number
  text: string
  extractionVersion?: 2 | 3
  extractionWarnings?: string[]
  recognition?: {
    engine: 'local' | 'vision'
    confidence?: number
    model?: string
    updatedAt: number
  }
}
export interface Collection {
  id: string
  name: string
  color: string
}
export interface Note {
  folderId?: string
  tags?: string[]
  history?: NoteRevision[]
  deletedAt?: number
  id: string
  paperId?: string
  title: string
  markdown: string
  updatedAt: number
}
export interface NoteRevision {
  id: string
  title: string
  markdown: string
  createdAt: number
}
export interface NoteFolder {
  id: string
  name: string
}
export interface Attachment {
  id: string
  name: string
  mime: string
  blob: Blob
  createdAt: number
}
export interface Snapshot {
  id: string
  name: string
  kind: 'automatic' | 'before-restore' | 'manual'
  createdAt: number
  blob?: Blob
  fileName?: string
  size: number
}
export interface Rect {
  x: number
  y: number
  width: number
  height: number
}
export interface Annotation {
  deletedAt?: number
  id: string
  paperId: string
  source: Source
  page: number
  quote: string
  comment: string
  color: string
  rects: Rect[]
  start?: number
  end?: number
  createdAt: number
  jobId?: string
  scope?: 'document'
}
export interface AISettings {
  thinkingMode?: 'auto' | 'provider' | 'low' | 'high'
  profileId?: string
  provider: Provider
  baseUrl: string
  model: string
  targetLanguage: string
  timeoutSeconds?: number
  stream?: boolean
  concurrency?: number
  chunkSize?: number
  maxOutputTokens?: number
  rememberKey?: boolean
  bilingual?: boolean
  batchSize?: number
}
export interface SourceParagraph {
  id: string
  text: string
  page: number
  endPage: number
}
export interface JobChunk {
  timing?: { queueMs: number; firstTextMs?: number; totalMs: number }
  page: number
  endPage?: number
  input: string
  output?: string
  paragraphs?: SourceParagraph[]
  contextBefore?: string
  contextAfter?: string
}
export interface Job {
  thinkingMode?: AISettings['thinkingMode']
  recognition?: { engine: 'local' | 'vision'; language: 'eng' | 'eng+chi_sim'; keepImages: boolean }
  name?: string
  revisionOf?: string
  editedMarkdown?: string
  inputJobId?: string
  inputName?: string
  id: string
  paperId: string
  kind: 'translation' | 'reflow'
  provider: Provider
  model: string
  baseUrl: string
  language: string
  timeoutSeconds?: number
  stream?: boolean
  concurrency?: number
  chunkSize?: number
  maxOutputTokens?: number
  promptVersion?: number
  documentVersion?: number
  documentTitle?: string
  sourceWarning?: string
  bilingual?: boolean
  batchSize?: number
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  chunks: JobChunk[]
  error?: string
  updatedAt: number
}
export interface ReadingLocation {
  source: Source
  page: number
  jobId?: string
  progress: number
}
export interface Bookmark extends ReadingLocation {
  id: string
  name: string
  createdAt: number
}
export interface AIProfile {
  id: string
  name: string
  settings: AISettings
}
export const statusLabels: Record<ReadingStatus, string> = {
  unread: '待读',
  reading: '阅读中',
  finished: '已读完',
}
