import ReactMarkdown, { defaultUrlTransform } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import { memo, useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../lib/db'

function LocalImage({ id, alt }: { id: string; alt?: string }) {
  const attachment = useLiveQuery(() => db.attachments.get(id), [id]),
    [url, setUrl] = useState('')
  useEffect(() => {
    if (!attachment) return
    const value = URL.createObjectURL(attachment.blob)
    setUrl(value)
    return () => URL.revokeObjectURL(value)
  }, [attachment])
  return url ? (
    <img src={url} alt={alt || attachment?.name || '笔记图片'} loading="lazy" />
  ) : (
    <span className="image-placeholder">[图片：{alt || '附件加载中'}]</span>
  )
}

export const Markdown = memo(function Markdown({
  text,
  embeddedImages = true,
}: {
  text: string
  embeddedImages?: boolean
}) {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        urlTransform={(url) =>
          /^paperead-attachment:[\w-]+$/.test(url) ||
          (embeddedImages && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(url))
            ? url
            : defaultUrlTransform(url)
        }
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
          img: ({ alt, src }) =>
            /^paperead-attachment:([\w-]+)$/.test(src || '') ? (
              <LocalImage id={src!.split(':')[1]} alt={alt} />
            ) : embeddedImages && src?.startsWith('data:image/') ? (
              <img src={src} alt={alt || ''} />
            ) : (
              <span className="image-placeholder">[图片：{alt || '远程图片未加载'}]</span>
            ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
})
