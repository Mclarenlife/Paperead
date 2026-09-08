import { useState } from 'react'
import { Modal, useToast } from './UI'
import { errorMessage } from '../lib/utils'
import { createRecognition } from '../lib/recognition'
import { runJob } from '../lib/ai'
import type { Paper, AISettings, Job } from '../types'
export function RecognitionPanel({
  paper,
  config,
  onClose,
  onStart,
}: {
  paper: Paper
  config: AISettings
  onClose: () => void
  onStart: (job: Job) => void
}) {
  const [engine, setEngine] = useState<'local' | 'vision'>('local'),
    [language, setLanguage] = useState<'eng' | 'eng+chi_sim'>('eng+chi_sim'),
    [first, setFirst] = useState(1),
    [last, setLast] = useState(paper.pageCount),
    [missing, setMissing] = useState(true),
    [images, setImages] = useState(true),
    [busy, setBusy] = useState(false),
    toast = useToast()
  return (
    <Modal
      title="扫描件与版面识别"
      onClose={() => {
        if (!busy) onClose()
      }}
    >
      <p className="muted">
        生成一份可校对、批注和导出的连续 Markdown。成功识别的正文也用于后续全文翻译，原始 PDF 保留。
      </p>
      <label className="field">
        识别方式
        <select
          value={engine}
          onChange={(e) => {
            setEngine(e.target.value as typeof engine)
            setMissing(e.target.value === 'local')
          }}
        >
          <option value="local">本地 OCR · 中英文文字</option>
          <option value="vision">视觉模型 · 表格、公式与复杂版面</option>
        </select>
      </label>
      {engine === 'local' ? (
        <>
          <label className="field">
            识别语言
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value as typeof language)}
            >
              <option value="eng+chi_sim">简体中文 + 英文</option>
              <option value="eng">英文（更快）</option>
            </select>
          </label>
          <p className="field-hint">
            识别引擎和语言包随安装包提供，可离线使用。表格和公式建议改用视觉模型并校对。
          </p>
        </>
      ) : (
        <p className="privacy-note">
          将页面图片发送至当前配置 {config.model || '（尚未填写模型）'} · {config.baseUrl}
          。请选用支持图片输入的模型，服务商可能计费。deepseek-v4-flash
          是文字模型；复杂公式需使用视觉型号。
        </p>
      )}
      <div className="form-two">
        <label className="field">
          起始页
          <input
            type="number"
            min={1}
            max={paper.pageCount}
            value={first}
            onChange={(e) => setFirst(Number(e.target.value))}
          />
        </label>
        <label className="field">
          结束页
          <input
            type="number"
            min={first}
            max={paper.pageCount}
            value={last}
            onChange={(e) => setLast(Number(e.target.value))}
          />
        </label>
      </div>
      <label className="bilingual-option">
        <input type="checkbox" checked={missing} onChange={(e) => setMissing(e.target.checked)} />
        仅识别缺少文字的页面
      </label>
      {engine === 'vision' && (
        <p className="field-hint">
          修复公式时应识别含文字的页面；视觉结果将作为后续翻译的输入。完成识别后，可切回文字模型翻译。
        </p>
      )}
      <label className="bilingual-option">
        <input type="checkbox" checked={images} onChange={(e) => setImages(e.target.checked)} />
        在结果中保留页面图，便于核对图表与公式
      </label>
      <p className="field-hint">
        识别逐页保存进度，可在任务卡片暂停 / 继续。重新识别会新增结果版本；已有翻译及批注保留。
      </p>
      <div className="modal-actions">
        <button
          className="button primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            try {
              const job = await createRecognition(
                paper.id,
                config,
                { engine, language, keepImages: images },
                first,
                last,
                missing,
              )
              onStart(job)
              onClose()
              void runJob(job.id)
            } catch (e) {
              toast(errorMessage(e), true)
            } finally {
              setBusy(false)
            }
          }}
        >
          {busy ? '正在准备…' : '开始识别'}
        </button>
      </div>
    </Modal>
  )
}
