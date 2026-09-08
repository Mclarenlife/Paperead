import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { motion } from 'motion/react'
import {
  ArrowDownWideNarrow,
  ArrowRight,
  BookOpen,
  Check,
  ChevronDown,
  FileText,
  FolderOpen,
  Grid2X2,
  List,
  Plus,
  Search,
  SlidersHorizontal,
  Sparkles,
  Star,
  X,
  MoreHorizontal,
  Pencil,
  Trash2,
  Download,
  Tag,
} from 'lucide-react'
import { db } from '../lib/db'
import type { Collection, Paper } from '../types'
import { statusLabels } from '../types'
import { errorMessage, formatDate } from '../lib/utils'
import { Modal, useToast } from '../components/UI'
import { PaperEditor } from '../components/PaperEditor'
import { moveToTrash, restoreFromTrash, updatePapers } from '../lib/trash'
import { exportPapers } from '../lib/library-export'
import { BibliographyTools } from '../components/BibliographyTools'

function PaperArtwork({ paper, index }: { paper: Paper; index: number }) {
  const asset = useLiveQuery(() => db.assets.get(paper.id), [paper.id])
  return (
    <div className={`paper-art art-${paper.color}`}>
      <div className="cover-grid" />
      <div className="paper-sheet">
        {asset?.thumbnail ? (
          <img src={asset.thumbnail} alt={`${paper.title} 首页`} loading="lazy" />
        ) : (
          <>
            <div className="sheet-kicker">
              {paper.venue || 'RESEARCH PAPER'} <span>{paper.year || '年份待核验'}</span>
            </div>
            <div className="sheet-title">{paper.title}</div>
            <div className="sheet-authors">{paper.authors}</div>
            <div className="sheet-rule" />
            <div className="mini-columns">
              <div>
                <b>Abstract</b>
                {Array.from({ length: 5 }, (_, i) => (
                  <i key={i} style={{ width: `${100 - (i % 3) * 11}%` }} />
                ))}
              </div>
              <div>
                {Array.from({ length: 7 }, (_, i) => (
                  <i key={i} style={{ width: `${100 - (i % 2) * 9}%` }} />
                ))}
              </div>
            </div>
            <svg viewBox="0 0 190 60" className="sheet-diagram" aria-hidden="true">
              {index % 3 === 0 ? (
                <>
                  {[0, 1, 2].map((i) => (
                    <g key={i}>
                      <rect x={20 + i * 55} y="8" width="35" height="15" rx="3" />
                      <path d={`M${37 + i * 55} 23v14`} />
                      <rect x={20 + i * 55} y="37" width="35" height="15" rx="3" />
                    </g>
                  ))}
                  <path d="M55 15h20m35 0h20M55 44h20m35 0h20" />
                </>
              ) : index % 3 === 1 ? (
                <>
                  <path d="M12 5v48h169M20 46C49 49 41 14 75 27S109 3 137 14S166 12 180 4" />
                  <path d="M20 46C53 42 51 30 79 33S129 20 179 18" strokeDasharray="3 3" />
                </>
              ) : (
                <>
                  {[0, 1, 2, 3, 4].map((i) => (
                    <rect
                      key={i}
                      x={24 + i * 31}
                      y={40 - i * 7}
                      width="17"
                      height={10 + i * 7}
                      rx="2"
                    />
                  ))}
                  <path d="M15 53h166" />
                </>
              )}
            </svg>
            <div className="mini-columns">
              <div>
                {[0, 1, 2].map((i) => (
                  <i key={i} />
                ))}
              </div>
              <div>
                {[0, 1, 2].map((i) => (
                  <i key={i} />
                ))}
              </div>
            </div>
          </>
        )}
      </div>
      <span className="pdf-label">
        <FileText size={11} />
        {paper.sample ? '演示导读' : paper.referenceOnly ? '引用记录' : 'PDF'}
      </span>
    </div>
  )
}

export function Library({
  papers,
  collections,
  scope,
  search,
  onOpen,
  onImport,
  onScope,
  onCreateCollection,
  onClearSearch,
}: {
  papers: Paper[]
  collections: Collection[]
  scope: string
  search: string
  onOpen: (id: string) => void
  onImport: () => void
  onScope: (scope: string) => void
  onCreateCollection: () => void
  onClearSearch: () => void
}) {
  const [filter, setFilter] = useState('all'),
    [layout, setLayout] = useState('grid'),
    [sort, setSort] = useState('newest'),
    [tag, setTag] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [editingCollection, setEditingCollection] = useState<Collection | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [menu, setMenu] = useState(''),
    [editingPaper, setEditingPaper] = useState<Paper | null>(null)
  const [selected, setSelected] = useState<string[]>([]),
    [busy, setBusy] = useState(false)
  const [bulk, setBulk] = useState<{
    mode: 'collection' | 'tags' | 'delete'
    ids: string[]
  } | null>(null)
  const [collectionId, setCollectionId] = useState(''),
    [tagMode, setTagMode] = useState<'add' | 'remove' | 'replace'>('add'),
    [tagText, setTagText] = useState('')
  const toast = useToast()
  const notes = useLiveQuery(() => db.notes.filter((note) => !note.deletedAt).count(), [], 0)
  const annotations = useLiveQuery(
    () =>
      db.annotations.filter((a) => !a.deletedAt && papers.some((p) => p.id === a.paperId)).count(),
    [papers.map((p) => p.id).join(',')],
    0,
  )
  useEffect(() => {
    setSelected([])
    setMenu('')
  }, [scope, search, filter, tag])
  useEffect(() => {
    if (!menu) return
    const close = (event: Event) => {
      if (
        event instanceof KeyboardEvent
          ? event.key === 'Escape'
          : !(event.target as HTMLElement).closest('.paper-actions')
      )
        setMenu('')
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', close)
    }
  }, [menu])
  async function perform(action: () => Promise<unknown>, message: string) {
    setBusy(true)
    try {
      const result = await action()
      if (result !== false) toast(message)
    } catch (e) {
      toast(errorMessage(e), true)
    } finally {
      setBusy(false)
    }
  }
  function openBulk(mode: 'collection' | 'tags' | 'delete', ids: string[]) {
    setMenu('')
    setCollectionId('')
    setTagText('')
    setTagMode('add')
    setBulk({ mode, ids })
  }
  const scoped = papers.filter((p) =>
    scope === 'favorites'
      ? p.starred
      : scope === 'recent'
        ? p.lastReadAt > 0
        : scope.startsWith('collection:')
          ? p.collectionId === scope.slice(11)
          : true,
  )
  const filtered = scoped
    .filter(
      (p) =>
        (filter === 'all' || p.status === filter) &&
        (!tag || p.tags.includes(tag)) &&
        `${p.title} ${p.authors} ${p.tags.join(' ')} ${p.abstract}`
          .toLowerCase()
          .includes(search.trim().toLowerCase()),
    )
    .sort((a, b) =>
      sort === 'title'
        ? a.title.localeCompare(b.title)
        : sort === 'year'
          ? b.year - a.year
          : scope === 'recent'
            ? b.lastReadAt - a.lastReadAt
            : b.createdAt - a.createdAt,
    )
  const title =
    scope === 'favorites'
      ? '我的收藏'
      : scope === 'recent'
        ? '最近阅读'
        : scope.startsWith('collection:')
          ? collections.find((c) => c.id === scope.slice(11))?.name || '文献集'
          : '全部文献'
  const selectedIds = selected.filter((id) => filtered.some((paper) => paper.id === id))
  const recent = [...papers]
    .filter((p) => p.status === 'reading')
    .sort((a, b) => b.lastReadAt - a.lastReadAt)[0]
  return (
    <motion.div className="library-page" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      {scope === 'library' && !search && (
        <>
          <section className="welcome">
            <div>
              <div className="eyebrow">
                <span /> YOUR SPACE TO THINK
              </div>
              <h1>
                让阅读，<span>沉淀为知识。</span>
              </h1>
              <p>收藏值得读的论文，连接每一个值得记下的想法。</p>
              <div className="welcome-actions">
                <button className="button primary" onClick={onImport}>
                  <Plus size={16} />
                  导入文献
                </button>
                <span>留一点时间，给新的发现。</span>
              </div>
            </div>
            <div className="hero-illustration" aria-hidden="true">
              <div className="orbit orbit-one" />
              <div className="orbit orbit-two" />
              <div className="hero-dot" />
              <div className="floating-note">
                <Sparkles size={16} />
                <span>
                  A little clarity,
                  <br />a new perspective.
                </span>
              </div>
              <div className="hero-book book-back" />
              <div className="hero-book book-front">
                <div className="book-spine" />
                <span className="book-mark">p.</span>
                <span className="book-label">
                  READ.
                  <br />
                  REFLECT.
                  <br />
                  CONNECT.
                </span>
                <div className="book-line" />
                <span className="book-bottom">A SPACE FOR YOUR IDEAS</span>
              </div>
              <span className="hero-plus">+</span>
            </div>
          </section>
          <div className="overview-row">
            <div className="overview-stat">
              <div className="stat-icon">
                <BookOpen size={18} />
              </div>
              <div>
                <strong>{papers.length}</strong>
                <span>篇文献</span>
              </div>
            </div>
            <div className="overview-stat">
              <div className="stat-icon lilac">
                <FileText size={18} />
              </div>
              <div>
                <strong>{notes}</strong>
                <span>篇阅读笔记</span>
              </div>
            </div>
            <div className="overview-stat">
              <div className="stat-icon amber">
                <Sparkles size={18} />
              </div>
              <div>
                <strong>{annotations}</strong>
                <span>条灵感批注</span>
              </div>
            </div>
            <div className="continue-reading">
              {recent ? (
                <button onClick={() => onOpen(recent.id)}>
                  <span className="continue-icon">
                    <BookOpen size={17} />
                  </span>
                  <span>
                    <small>接着上次的思考</small>
                    <b>{recent.title}</b>
                  </span>
                  <ArrowRight size={17} />
                </button>
              ) : (
                <span className="muted">从一篇好论文开始</span>
              )}
            </div>
          </div>
        </>
      )}
      <section className="library-content">
        <div className="section-heading">
          <div>
            <h2>
              {search ? '搜索结果' : title}
              <span className="count-badge">{filtered.length}</span>
              {scope.startsWith('collection:') && (
                <button
                  className="icon-button"
                  aria-label="管理文献集"
                  onClick={() => {
                    setEditingCollection(collections.find((c) => c.id === scope.slice(11)) || null)
                    setConfirmRemove(false)
                  }}
                >
                  <SlidersHorizontal size={16} />
                </button>
              )}
            </h2>
            <p>{search ? `与「${search}」相关的文献` : '每一篇收藏，都是下一次灵感的起点。'}</p>
          </div>
          {scope !== 'library' && (
            <button className="button primary" onClick={onImport}>
              <Plus size={16} />
              导入文献
            </button>
          )}
        </div>
        <div className="library-toolbar">
          <BibliographyTools
            papers={
              selectedIds.length ? filtered.filter((p) => selectedIds.includes(p.id)) : filtered
            }
          />
          <div className="filter-tabs">
            {[
              ['all', '全部'],
              ['unread', '待读'],
              ['reading', '阅读中'],
              ['finished', '已读完'],
            ].map(([key, label]) => (
              <button
                className={filter === key ? 'active' : ''}
                onClick={() => setFilter(key)}
                key={key}
              >
                {label}
                {key === 'all' && <span>{scoped.length}</span>}
              </button>
            ))}
          </div>
          <div className="toolbar-actions">
            <button
              className={`button subtle filter-button ${showFilters ? 'selected' : ''}`}
              onClick={() => setShowFilters(!showFilters)}
            >
              <SlidersHorizontal size={15} />
              <span>筛选</span>
              {tag && <i />}
            </button>
            <label className="sort-select">
              <ArrowDownWideNarrow size={15} />
              <select aria-label="文献排序" value={sort} onChange={(e) => setSort(e.target.value)}>
                <option value="newest">最近添加</option>
                <option value="year">发表年份</option>
                <option value="title">标题排序</option>
              </select>
              <ChevronDown size={12} />
            </label>
            <div className="view-switch">
              <button
                className={layout === 'grid' ? 'active' : ''}
                onClick={() => setLayout('grid')}
                aria-label="网格视图"
              >
                <Grid2X2 size={16} />
              </button>
              <button
                className={layout === 'list' ? 'active' : ''}
                onClick={() => setLayout('list')}
                aria-label="列表视图"
              >
                <List size={17} />
              </button>
            </div>
          </div>
        </div>
        <div className={`bulk-toolbar ${selectedIds.length ? 'has-selection' : ''}`}>
          <label>
            <input
              type="checkbox"
              aria-label="全选当前结果"
              checked={filtered.length > 0 && selectedIds.length === filtered.length}
              disabled={!filtered.length || busy}
              onChange={(e) =>
                setSelected(e.target.checked ? filtered.map((paper) => paper.id) : [])
              }
            />
            {selectedIds.length ? `已选择 ${selectedIds.length} 篇` : '选择文献'}
          </label>
          {selectedIds.length > 0 ? (
            <div className="bulk-actions">
              <button
                className="button small"
                disabled={busy}
                onClick={() => openBulk('collection', selectedIds)}
              >
                <FolderOpen size={14} />
                移动到文献集
              </button>
              <button
                className="button small"
                disabled={busy}
                onClick={() => openBulk('tags', selectedIds)}
              >
                <Tag size={14} />
                修改标签
              </button>
              <label className="bulk-status">
                <span>阅读状态</span>
                <select
                  aria-label="批量阅读状态"
                  disabled={busy}
                  value=""
                  onChange={(e) => {
                    if (e.target.value)
                      void perform(
                        () =>
                          updatePapers(selectedIds, { status: e.target.value as Paper['status'] }),
                        '阅读状态已更新',
                      )
                  }}
                >
                  <option value="">修改状态</option>
                  {Object.entries(statusLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="button small"
                disabled={busy}
                title="导出所选文献的原始 PDF 与文献信息（ZIP）"
                onClick={() => void perform(() => exportPapers(selectedIds), '所选文献已导出 ZIP')}
              >
                <Download size={14} />
                批量导出
              </button>
              <button
                className="button small danger"
                disabled={busy}
                onClick={() => openBulk('delete', selectedIds)}
              >
                <Trash2 size={14} />
                移入回收站
              </button>
              <button className="icon-button" aria-label="取消选择" onClick={() => setSelected([])}>
                <X size={15} />
              </button>
            </div>
          ) : (
            <span className="field-hint">勾选后可批量整理、导出或删除</span>
          )}
        </div>
        {showFilters && (
          <motion.div
            className="tag-filter"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
          >
            <span>研究标签</span>
            {Array.from(new Set(papers.flatMap((p) => p.tags))).map((t) => (
              <button
                key={t}
                className={`tag ${tag === t ? 'tag-active' : ''}`}
                onClick={() => setTag(tag === t ? '' : t)}
              >
                {tag === t && <Check size={11} />} {t}
              </button>
            ))}
            {tag && (
              <button className="icon-button" onClick={() => setTag('')} aria-label="清除标签筛选">
                <X size={14} />
              </button>
            )}
          </motion.div>
        )}
        {filtered.length ? (
          <div className={`papers ${layout === 'list' ? 'papers-list' : ''}`}>
            {filtered.map((paper, i) => (
              <motion.article
                layout
                key={paper.id}
                className={`paper-card ${selectedIds.includes(paper.id) ? 'paper-selected' : ''}`}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: Math.min(i * 0.045, 0.25) }}
              >
                <div className="paper-card-controls">
                  <label className="paper-checkbox">
                    <input
                      type="checkbox"
                      aria-label={`选择 ${paper.title}`}
                      checked={selectedIds.includes(paper.id)}
                      disabled={busy}
                      onChange={(e) =>
                        setSelected((prev) =>
                          e.target.checked
                            ? [...prev, paper.id]
                            : prev.filter((id) => id !== paper.id),
                        )
                      }
                    />
                  </label>
                  <div className="paper-actions">
                    <button
                      className="icon-button"
                      aria-label={`更多操作 ${paper.title}`}
                      aria-expanded={menu === paper.id}
                      disabled={busy}
                      onClick={() => setMenu(menu === paper.id ? '' : paper.id)}
                    >
                      <MoreHorizontal size={19} />
                    </button>
                    {menu === paper.id && (
                      <div className="paper-menu" role="menu" aria-label="文献操作">
                        <button
                          role="menuitem"
                          onClick={() => {
                            setMenu('')
                            setEditingPaper(paper)
                          }}
                        >
                          <Pencil size={14} />
                          编辑文献信息
                        </button>
                        <button role="menuitem" onClick={() => openBulk('collection', [paper.id])}>
                          <FolderOpen size={14} />
                          移动到文献集
                        </button>
                        <button role="menuitem" onClick={() => openBulk('tags', [paper.id])}>
                          <Tag size={14} />
                          修改标签
                        </button>
                        {Object.entries(statusLabels).map(([status, label]) => (
                          <button
                            role="menuitem"
                            key={status}
                            onClick={() => {
                              setMenu('')
                              void perform(
                                () =>
                                  updatePapers([paper.id], { status: status as Paper['status'] }),
                                '阅读状态已更新',
                              )
                            }}
                          >
                            <Check size={14} style={{ opacity: paper.status === status ? 1 : 0 }} />
                            标记为{label}
                          </button>
                        ))}
                        <button
                          role="menuitem"
                          className="danger-text"
                          onClick={() => openBulk('delete', [paper.id])}
                        >
                          <Trash2 size={14} />
                          移入回收站
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                <button
                  className="paper-cover-button"
                  onClick={() => onOpen(paper.id)}
                  aria-label={`阅读 ${paper.title}`}
                >
                  <PaperArtwork paper={paper} index={i} />
                </button>
                <div className="paper-info">
                  <div className="paper-meta">
                    <span className={`status status-${paper.status}`}>
                      <i />
                      {statusLabels[paper.status]}
                    </span>
                    <button
                      className={`star-button ${paper.starred ? 'starred' : ''}`}
                      onClick={() => void db.papers.update(paper.id, { starred: !paper.starred })}
                      aria-label={`${paper.starred ? '取消收藏' : '收藏'} ${paper.title}`}
                    >
                      <Star size={16} fill={paper.starred ? 'currentColor' : 'none'} />
                    </button>
                  </div>
                  <button className="paper-title" onClick={() => onOpen(paper.id)}>
                    {paper.title}
                  </button>
                  <p className="paper-authors">{paper.authors}</p>
                  <div className="paper-tags">
                    {paper.tags.slice(0, 2).map((t) => (
                      <button
                        className="tag"
                        key={t}
                        onClick={() => {
                          setTag(t)
                          setShowFilters(true)
                        }}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                  <div className="paper-footer">
                    <span>
                      {paper.year || '年份待核验'}
                      <i /> {paper.venue || '本地文献'}
                    </span>
                    <span>{paper.sample ? '示例' : `${paper.pageCount} 页`}</span>
                  </div>
                </div>
              </motion.article>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <Search size={32} />
            <h3>
              {search || filter !== 'all' || tag ? '还没有找到这篇文献' : '留一个位置，给新的发现'}
            </h3>
            <p>
              {search || filter !== 'all' || tag
                ? '试试其他关键词，或调整筛选条件。'
                : '导入 PDF，开始建立你的研究文献库。'}
            </p>
            <button
              className="button"
              onClick={
                search || filter !== 'all' || tag
                  ? () => {
                      setFilter('all')
                      setTag('')
                      onClearSearch()
                    }
                  : onImport
              }
            >
              {search || filter !== 'all' || tag ? '重置筛选' : '导入第一篇文献'}
            </button>
          </div>
        )}
        <div className="library-bottom">
          <span>
            已显示 {filtered.length} 篇文献{papers.some((p) => p.sample) && ' · 示例内容为原创导读'}
          </span>
          <span>
            <span className="online-dot" /> 所有更改已存储在本地
          </span>
        </div>
      </section>
      {scope === 'library' && !search && (
        <section className="collections-section">
          <div className="section-heading compact">
            <h2>
              我的文献集 <span className="subtle-text">COLLECTIONS</span>
            </h2>
            <button className="text-button" onClick={onCreateCollection}>
              新建文献集 <Plus size={14} />
            </button>
          </div>
          <div className="collection-cards">
            {collections.map((c) => (
              <button
                className="collection-card"
                key={c.id}
                onClick={() => onScope(`collection:${c.id}`)}
              >
                <span className="folder-icon" style={{ color: c.color }}>
                  <FolderOpen size={23} />
                </span>
                <span>
                  <b>{c.name}</b>
                  <small>{papers.filter((p) => p.collectionId === c.id).length} 篇文献</small>
                </span>
                <ArrowRight size={16} />
              </button>
            ))}
          </div>
        </section>
      )}
      <footer className="page-footer">
        <span className="small-brand">paperead</span>
        <span>保持好奇，让知识发生连接。</span>
        <span>{formatDate(Date.now())}</span>
      </footer>
      {editingPaper && (
        <PaperEditor
          paper={editingPaper}
          onClose={() => setEditingPaper(null)}
          onDelete={() => {
            openBulk('delete', [editingPaper.id])
            setEditingPaper(null)
          }}
        />
      )}
      {bulk && (
        <Modal
          title={
            bulk.mode === 'delete'
              ? '移入回收站'
              : bulk.mode === 'tags'
                ? '修改标签'
                : '移动到文献集'
          }
          onClose={() => {
            if (!busy) setBulk(null)
          }}
        >
          <p>已选择 {bulk.ids.length} 篇文献。</p>
          {bulk.mode === 'delete' ? (
            <p className="muted">
              PDF、批注和 AI
              结果将一起保留在回收站，正在运行的任务会暂停。笔记独立保留，可以随时恢复文献。
            </p>
          ) : bulk.mode === 'collection' ? (
            <label className="field">
              目标文献集
              <select value={collectionId} onChange={(e) => setCollectionId(e.target.value)}>
                <option value="">未分类</option>
                {collections.map((collection) => (
                  <option key={collection.id} value={collection.id}>
                    {collection.name}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <>
              <label className="field">
                标签操作
                <select
                  value={tagMode}
                  onChange={(e) => setTagMode(e.target.value as typeof tagMode)}
                >
                  <option value="add">添加标签</option>
                  <option value="remove">移除标签</option>
                  <option value="replace">替换全部标签</option>
                </select>
              </label>
              <label className="field">
                标签（逗号分隔）
                <input
                  value={tagText}
                  maxLength={1000}
                  onChange={(e) => setTagText(e.target.value)}
                />
              </label>
              {tagMode === 'replace' && (
                <p className="field-hint">会替换所选文献的全部标签；留空将清空标签。</p>
              )}
            </>
          )}
          <div className="modal-actions">
            <button className="button" disabled={busy} onClick={() => setBulk(null)}>
              取消
            </button>
            <button
              className={`button ${bulk.mode === 'delete' ? 'danger' : 'primary'}`}
              disabled={busy || (bulk.mode === 'tags' && tagMode !== 'replace' && !tagText.trim())}
              onClick={async () => {
                setBusy(true)
                try {
                  if (bulk.mode === 'delete') {
                    const items = bulk.ids.map((id) => ({ kind: 'paper' as const, id }))
                    await moveToTrash(items)
                    setSelected([])
                    toast(`已将 ${items.length} 篇文献移入回收站`, false, {
                      label: '撤销',
                      run: async () => {
                        await restoreFromTrash(items)
                        toast('文献已恢复')
                      },
                    })
                  } else {
                    const values = tagText
                      .split(/[,，]/)
                      .map((tag) => tag.trim())
                      .filter(Boolean)
                    if (values.some((tag) => tag.length > 200) || values.length > 100)
                      throw new Error('最多 100 个标签，每个不超过 200 字符。')
                    await updatePapers(
                      bulk.ids,
                      bulk.mode === 'collection' ? { collectionId } : {},
                      bulk.mode === 'tags' ? { mode: tagMode, values } : undefined,
                    )
                    toast('文献已更新')
                  }
                  setBulk(null)
                } catch (e) {
                  toast(errorMessage(e), true)
                } finally {
                  setBusy(false)
                }
              }}
            >
              {bulk.mode === 'delete' ? '确认移入回收站' : '应用到所选文献'}
            </button>
          </div>
        </Modal>
      )}
      {editingCollection && (
        <Modal title="管理文献集" onClose={() => setEditingCollection(null)}>
          <label className="field">
            文献集名称
            <input
              maxLength={80}
              value={editingCollection.name}
              onChange={(e) => setEditingCollection({ ...editingCollection, name: e.target.value })}
            />
          </label>
          <label className="field">
            标记颜色
            <input
              type="color"
              value={editingCollection.color}
              onChange={(e) =>
                setEditingCollection({ ...editingCollection, color: e.target.value })
              }
            />
          </label>
          {confirmRemove && <p className="muted">删除此文献集？其中的论文会保留在全部文献中。</p>}
          <div className="modal-actions">
            <button
              className="text-button danger-text"
              onClick={async () => {
                if (!confirmRemove) {
                  setConfirmRemove(true)
                  return
                }
                try {
                  await db.transaction('rw', [db.collections, db.papers], async () => {
                    await db.papers
                      .where('collectionId')
                      .equals(editingCollection.id)
                      .modify({ collectionId: '' })
                    await db.collections.delete(editingCollection.id)
                  })
                  setEditingCollection(null)
                  onScope('library')
                  toast('文献集已删除，其中的论文已保留')
                } catch (e) {
                  toast(errorMessage(e), true)
                }
              }}
            >
              {confirmRemove ? '确认删除文献集' : '删除文献集'}
            </button>
            <button
              className="button primary"
              disabled={!editingCollection.name.trim()}
              onClick={async () => {
                const name = editingCollection.name.trim()
                if (collections.some((c) => c.name === name && c.id !== editingCollection.id)) {
                  toast('已存在同名文献集', true)
                  return
                }
                try {
                  await db.collections.put({ ...editingCollection, name })
                  setEditingCollection(null)
                  toast('文献集已更新')
                } catch (e) {
                  toast(errorMessage(e), true)
                }
              }}
            >
              保存更改
            </button>
          </div>
        </Modal>
      )}
    </motion.div>
  )
}
