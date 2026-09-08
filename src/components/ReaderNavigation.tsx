import { useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { BookmarkPlus, ChevronLeft, ChevronRight, Search, Trash2 } from 'lucide-react'
import { addBookmark, findMatches, removeBookmark } from '../lib/reading'
import { errorMessage } from '../lib/utils'
import { useToast } from './UI'
import type { Paper, Page, ReadingLocation } from '../types'

export interface OutlineEntry {
  title: string
  depth: number
  page?: number
  query?: string
}
export interface SearchTarget {
  query: string
  page: number
  occurrence: number
  token: number
}
export function ReaderNavigation({
  paper,
  pages,
  location,
  text,
  outline,
  getLocation,
  onJump,
  onSearch,
  findTrigger,
}: {
  paper: Paper
  pages: Page[]
  location: ReadingLocation
  text: string
  outline: OutlineEntry[]
  getLocation: () => ReadingLocation
  onJump: (location: ReadingLocation) => void
  onSearch: (target: SearchTarget) => void
  findTrigger: number
}) {
  const [tab, setTab] = useState('search'),
    [query, setQuery] = useState(''),
    [name, setName] = useState(''),
    [index, setIndex] = useState(-1)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!findTrigger) return
    setTab('search')
  }, [findTrigger])
  useLayoutEffect(() => {
    if (findTrigger && tab === 'search') input.current?.focus()
  }, [findTrigger, tab])
  const deferred = useDeferredValue(query),
    toast = useToast()
  const matches = useMemo(() => {
    let remaining = 5000
    const content = location.source === 'original' ? pages : [{ number: 1, text }]
    return content.flatMap((page) => {
      const found = findMatches(page.text, deferred, remaining).map((match, occurrence) => ({
        ...match,
        page: page.number,
        occurrence,
      }))
      remaining -= found.length
      return found
    })
  }, [pages, text, deferred, location.source])
  const jumpMatch = (next: number) => {
    if (!matches.length) return
    const normalized = (next + matches.length) % matches.length
    setIndex(normalized)
    const match = matches[normalized]
    onSearch({ query: deferred, page: match.page, occurrence: match.occurrence, token: Date.now() })
  }
  return (
    <div className="reader-navigation">
      <div className="navigation-tabs">
        {[
          ['search', '全文查找'],
          ['outline', '目录'],
          ['bookmarks', '书签'],
        ].map(([key, label]) => (
          <button className={tab === key ? 'active' : ''} key={key} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'search' && (
        <>
          <label className="field">
            查找当前原文或结果
            <div className="reader-search-input">
              <Search size={15} />
              <input
                ref={input}
                aria-label="文献内全文查找"
                placeholder="输入文字，跨页查找"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setIndex(-1)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    jumpMatch(e.shiftKey ? index - 1 : index + 1)
                  }
                }}
              />
            </div>
          </label>
          <div className="search-summary">
            <span>
              {matches.length >= 5000 ? '前 5000' : matches.length} 处匹配
              {index >= 0 && ` · 当前 ${index + 1}`}
            </span>
            <button
              className="icon-button"
              disabled={!matches.length}
              aria-label="上一个匹配"
              onClick={() => jumpMatch(index - 1)}
            >
              <ChevronLeft size={16} />
            </button>
            <button
              className="icon-button"
              disabled={!matches.length}
              aria-label="下一个匹配"
              onClick={() => jumpMatch(index + 1)}
            >
              <ChevronRight size={16} />
            </button>
          </div>
          <div className="navigation-results">
            {matches.slice(Math.max(0, index - 50), Math.max(100, index + 50)).map((match, i) => {
              const at = Math.max(0, index - 50) + i
              return (
                <button
                  className={`search-match ${index === at ? 'active' : ''}`}
                  key={`${match.page}:${match.start}`}
                  onClick={() => jumpMatch(at)}
                >
                  <small>
                    {location.source === 'original' ? `第 ${match.page} 页` : '完整文档'}
                  </small>
                  <span>{match.excerpt}</span>
                </button>
              )
            })}
          </div>
          {!matches.length && query && (
            <p className="field-hint">没有匹配文字。扫描图像需要先获得文本。</p>
          )}
        </>
      )}
      {tab === 'outline' && (
        <div className="navigation-results">
          {outline.length ? (
            outline.map((entry, i) => (
              <button
                className="outline-entry"
                key={i}
                style={{ paddingLeft: 12 + Math.min(entry.depth, 5) * 12 }}
                disabled={!entry.page && !entry.query}
                onClick={() => {
                  if (entry.query)
                    onSearch({
                      query: entry.query,
                      page: entry.page || 1,
                      occurrence: 0,
                      token: Date.now(),
                    })
                  else if (entry.page) onJump({ ...location, page: entry.page, progress: 0 })
                }}
              >
                {entry.title}
                {entry.page && <small>{entry.page}</small>}
              </button>
            ))
          ) : (
            <p className="field-hint">此文档未提供目录，可使用全文查找或添加书签。</p>
          )}
        </div>
      )}
      {tab === 'bookmarks' && (
        <>
          <label className="field">
            书签名称
            <input
              aria-label="书签名称"
              value={name}
              maxLength={200}
              onChange={(e) => setName(e.target.value)}
              placeholder={
                location.source === 'original' ? `第 ${location.page} 页` : '当前阅读位置'
              }
            />
          </label>
          <button
            className="button full-width"
            onClick={async () => {
              try {
                const at = getLocation()
                await addBookmark(
                  paper.id,
                  name ||
                    (at.source === 'original'
                      ? `第 ${at.page} 页`
                      : `${at.source === 'translation' ? '译文' : '重排'} · ${Math.round(at.progress * 100)}%`),
                  at,
                )
                setName('')
                toast('书签已保存')
              } catch (e) {
                toast(errorMessage(e), true)
              }
            }}
          >
            <BookmarkPlus size={15} />
            添加当前位置书签
          </button>
          <div className="navigation-results">
            {(paper.bookmarks || []).map((bookmark) => (
              <div className="bookmark-row" key={bookmark.id}>
                <button onClick={() => onJump(bookmark)}>
                  <b>{bookmark.name}</b>
                  <small>
                    {bookmark.source === 'original'
                      ? `原文 · 第 ${bookmark.page} 页`
                      : bookmark.source === 'translation'
                        ? '译文版本'
                        : '重排版本'}
                  </small>
                </button>
                <button
                  className="icon-button"
                  aria-label={`删除书签 ${bookmark.name}`}
                  onClick={() =>
                    void removeBookmark(paper.id, bookmark.id).catch((e) =>
                      toast(errorMessage(e), true),
                    )
                  }
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
