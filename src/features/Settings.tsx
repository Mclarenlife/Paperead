import { useEffect, useRef, useState } from 'react'
import {
  Check,
  ExternalLink,
  KeyRound,
  LoaderCircle,
  Monitor,
  Moon,
  ShieldCheck,
  Sparkles,
  Sun,
} from 'lucide-react'
import { Modal, useToast } from '../components/UI'
import {
  defaultSettings,
  hasSessionKey,
  providerPresets,
  requestAI,
  normalizeConfig,
  validateEndpoint,
} from '../lib/ai'
import {
  clearCredential,
  hasSavedCredential,
  saveCredential,
  supportsSecureCredentials,
} from '../lib/credentials'
import { BackupPanel } from '../components/BackupPanel'
import { isDeepSeekV4 } from '../lib/model-capabilities'
import { errorMessage } from '../lib/utils'
import { readProfiles, storeProfile, deleteProfile, profileSettings } from '../lib/profiles'
import type { AISettings, Provider, AIProfile } from '../types'

export function Settings({
  config,
  onSave,
  onClose,
  theme,
  onTheme,
}: {
  config: AISettings
  onSave: (config: AISettings) => Promise<void>
  onClose: () => void
  theme: string
  onTheme: (theme: string) => void
}) {
  const [tab, setTab] = useState('ai'),
    [form, setForm] = useState(() => normalizeConfig(config)),
    [key, setKey] = useState(''),
    [busy, setBusy] = useState('')
  const toast = useToast()
  const [profiles, setProfiles] = useState<AIProfile[]>([]),
    [profilesReady, setProfilesReady] = useState(false)
  const [profileName, setProfileName] = useState('默认配置'),
    [switchTo, setSwitchTo] = useState<AIProfile | null>(null),
    [deleteOpen, setDeleteOpen] = useState(false)
  useEffect(() => {
    let live = true
    void (async () => {
      try {
        let entries = await readProfiles()
        let current = config
        if (!entries.length && config.model) {
          current = await storeProfile('默认配置', config)
          await onSave(current)
          entries = await readProfiles()
        }
        if (live) {
          setProfiles(entries)
          setForm(normalizeConfig(current))
          setProfileName(entries.find((p) => p.id === current.profileId)?.name || '默认配置')
        }
      } catch (e) {
        if (live) toast(errorMessage(e), true)
      } finally {
        if (live) setProfilesReady(true)
      }
    })()
    return () => {
      live = false
    }
  }, [])
  async function applyProfile(profile: AIProfile) {
    setBusy('profile')
    try {
      await onSave(profile.settings)
      setForm(normalizeConfig(profile.settings))
      setProfileName(profile.name)
      setRemember(profile.settings.rememberKey !== false)
      setKey('')
      setSwitchTo(null)
      toast(`已切换到「${profile.name}」`)
    } catch (e) {
      toast(errorMessage(e), true)
    } finally {
      setBusy('')
    }
  }
  function chooseProfile(id: string) {
    const profile = profiles.find((p) => p.id === id)
    if (!profile) return
    let dirty =
      !!key ||
      profileName !== (profiles.find((p) => p.id === form.profileId)?.name || '') ||
      remember !== (config.rememberKey !== false)
    try {
      dirty ||= JSON.stringify(profileSettings(form)) !== JSON.stringify(profileSettings(config))
    } catch {
      dirty = true
    }
    if (dirty) setSwitchTo(profile)
    else void applyProfile(profile)
  }
  const [secure, setSecure] = useState(false),
    [remember, setRemember] = useState(config.rememberKey !== false),
    [savedKey, setSavedKey] = useState(false),
    [keyNotice, setKeyNotice] = useState(''),
    [testProgress, setTestProgress] = useState(''),
    [elapsed, setElapsed] = useState(0)
  const testing = useRef<AbortController | null>(null)
  useEffect(() => {
    let live = true
    setSavedKey(false)
    void (async () => {
      try {
        const supported = await supportsSecureCredentials()
        if (live) setSecure(supported)
        const saved = await hasSavedCredential(form)
        if (live) {
          setSavedKey(saved)
          setKeyNotice('')
        }
      } catch {
        if (live) setKeyNotice('当前地址的凭据状态无法读取；请检查地址，或重新填写密钥。')
      }
    })()
    return () => {
      live = false
    }
  }, [form.provider, form.baseUrl, busy])
  useEffect(() => () => testing.current?.abort(), [])
  useEffect(() => {
    if (busy !== 'test') return
    setElapsed(0)
    const timer = setInterval(() => setElapsed((value) => value + 1), 1000)
    return () => clearInterval(timer)
  }, [busy])
  async function save(test = false) {
    setBusy(test ? 'test' : 'save')
    try {
      let settings: AISettings = { ...normalizeConfig(form), rememberKey: remember }
      if (!profileName.trim()) throw new Error('请输入配置名称。')
      validateEndpoint(settings.baseUrl)
      if (!settings.model) throw new Error('请填写服务商提供的模型 ID。')
      await saveCredential(settings, key, remember)
      settings = await storeProfile(profileName, settings)
      await onSave(settings)
      setProfiles(await readProfiles())
      setForm(settings)
      setKey('')
      if (test) {
        testing.current = new AbortController()
        setTestProgress('正在连接，等待模型响应')
        await requestAI(
          settings,
          'This is an API connection test. Reply only with OK.',
          'Reply only with OK. Do not explain.',
          testing.current.signal,
          (_text, phase) =>
            setTestProgress(
              phase === 'queued'
                ? '等待其他请求完成'
                : phase === 'connecting'
                  ? '正在连接，等待模型响应'
                  : '连接已建立，正在接收模型响应',
            ),
        )
        toast('连接成功，模型返回了有效响应。')
      } else
        toast(
          secure && remember
            ? 'AI 配置已保存，已启用 API Key 本机安全保存。'
            : 'AI 配置已保存，API Key 仅保留在当前会话。',
        )
    } catch (error) {
      toast(errorMessage(error), true)
    } finally {
      testing.current = null
      setBusy('')
    }
  }
  return (
    <Modal title="偏好设置" onClose={onClose} wide>
      {switchTo && (
        <Modal
          title="切换配置"
          onClose={() => {
            if (!busy) setSwitchTo(null)
          }}
        >
          <p>当前配置有未保存的更改。放弃这些更改并切换到「{switchTo.name}」？</p>
          <div className="modal-actions">
            <button className="button" disabled={!!busy} onClick={() => setSwitchTo(null)}>
              返回编辑配置
            </button>
            <button
              className="button primary"
              disabled={!!busy}
              onClick={() => void applyProfile(switchTo)}
            >
              放弃更改并切换
            </button>
          </div>
        </Modal>
      )}
      {deleteOpen && (
        <Modal
          title="删除 API 配置档案"
          onClose={() => {
            if (!busy) setDeleteOpen(false)
          }}
        >
          <p>
            删除此配置档案？已有 AI
            任务保留自己的配置快照；系统中按服务地址保存的密钥继续保留，可通过「清除已保存密钥」单独处理。
          </p>
          <div className="modal-actions">
            <button className="button" disabled={!!busy} onClick={() => setDeleteOpen(false)}>
              取消
            </button>
            <button
              className="button danger"
              disabled={!!busy}
              onClick={async () => {
                setBusy('profile')
                try {
                  await deleteProfile(form.profileId!)
                  const remaining = await readProfiles()
                  setProfiles(remaining)
                  const settings = remaining[0]?.settings || defaultSettings
                  await onSave(settings)
                  setForm(normalizeConfig(settings))
                  setRemember(settings.rememberKey !== false)
                  setKey('')
                  setProfileName(remaining[0]?.name || '默认配置')
                  setDeleteOpen(false)
                  toast('配置档案已删除')
                } catch (e) {
                  toast(errorMessage(e), true)
                } finally {
                  setBusy('')
                }
              }}
            >
              确认删除配置
            </button>
          </div>
        </Modal>
      )}
      <div className="settings-tabs">
        {[
          ['ai', 'AI 服务'],
          ['appearance', '外观'],
          ['data', '数据与备份'],
        ].map(([k, t]) => (
          <button className={tab === k ? 'active' : ''} onClick={() => setTab(k)} key={k}>
            {t}
          </button>
        ))}
      </div>
      <div className="settings-content">
        {tab === 'ai' && (
          <fieldset className="ai-settings-form" disabled={!!busy || !profilesReady}>
            <div className="settings-intro">
              <span className="feature-icon">
                <Sparkles size={22} />
              </span>
              <div>
                <h3>让 AI 成为你的阅读伙伴</h3>
                <p>连接你喜欢的模型，翻译、重排，读懂每一个想法。</p>
              </div>
            </div>
            <div className="profile-manager">
              <label className="field">
                服务配置档案
                <select
                  aria-label="服务配置档案"
                  value={form.profileId || ''}
                  onChange={(e) => chooseProfile(e.target.value)}
                >
                  <option value="" disabled>
                    尚未保存的新配置
                  </option>
                  {profiles.map((profile) => (
                    <option value={profile.id} key={profile.id}>
                      {profile.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="profile-actions">
                <button
                  className="button small"
                  onClick={() => {
                    setForm({ ...form, profileId: undefined })
                    setProfileName(`新配置 ${profiles.length + 1}`)
                    setKey('')
                  }}
                >
                  新建配置
                </button>
                <button
                  className="text-button danger-text"
                  disabled={!form.profileId}
                  onClick={() => setDeleteOpen(true)}
                >
                  删除配置
                </button>
              </div>
              <label className="field">
                配置名称
                <input
                  aria-label="配置名称"
                  maxLength={100}
                  value={profileName}
                  onChange={(e) => setProfileName(e.target.value)}
                />
              </label>
              <p className="field-hint">
                选择档案立即切换地址、模型和参数。同协议、同地址的配置共用该地址的密钥；不同地址独立保存。
              </p>
            </div>
            <label className="field">
              服务商
              <div className="provider-options">
                {Object.entries(providerPresets).map(([value, p]) => (
                  <button
                    className={form.provider === value ? 'active' : ''}
                    key={value}
                    onClick={() => {
                      setKey('')
                      setForm({
                        ...form,
                        provider: value as Provider,
                        baseUrl: p.baseUrl,
                        model: '',
                      })
                    }}
                  >
                    {p.name}
                    {form.provider === value && <Check size={14} />}
                  </button>
                ))}
              </div>
            </label>
            <p className="field-hint">{providerPresets[form.provider].hint}</p>
            <label className="field">
              API 地址
              <input
                value={form.baseUrl}
                onChange={(e) => {
                  setKey('')
                  setForm({ ...form, baseUrl: e.target.value })
                }}
                placeholder={defaultSettings.baseUrl}
              />
            </label>
            <div className="form-two">
              <label className="field">
                模型 ID
                <input
                  value={form.model}
                  onChange={(e) => setForm({ ...form, model: e.target.value })}
                  placeholder="输入服务商提供的模型名称"
                />
              </label>
              <label className="field">
                翻译目标语言
                <select
                  value={form.targetLanguage}
                  onChange={(e) => setForm({ ...form, targetLanguage: e.target.value })}
                >
                  {[
                    '简体中文',
                    '繁體中文',
                    'English',
                    '日本語',
                    '한국어',
                    'Deutsch',
                    'Français',
                  ].map((l) => (
                    <option key={l}>{l}</option>
                  ))}
                </select>
              </label>
            </div>
            <label className="field">
              API Key{' '}
              <span className="subtle-text">
                {secure
                  ? savedKey
                    ? '已保存在系统凭据存储'
                    : '可安全保存到本机'
                  : '浏览器 / 此平台仅当前会话'}
              </span>
              <div className="input-with-icon">
                <KeyRound size={16} />
                <input
                  type="password"
                  autoComplete="off"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder={
                    savedKey ||
                    (() => {
                      try {
                        return hasSessionKey(form)
                      } catch {
                        return false
                      }
                    })()
                      ? '此地址已有密钥，留空保持；填写可替换'
                      : '粘贴你的 API Key；本机服务可留空'
                  }
                />
              </div>
            </label>
            {secure && (
              <label className="credential-option">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                />
                安全保存 API Key，重启后自动使用
              </label>
            )}
            {keyNotice && <p className="job-error">{keyNotice}</p>}
            <details className="ai-advanced">
              <summary>请求与性能设置</summary>
              <label className="credential-option">
                <input
                  type="checkbox"
                  checked={form.bilingual === true}
                  onChange={(e) => setForm({ ...form, bilingual: e.target.checked })}
                />
                翻译默认启用原文对照
              </label>
              <label className="credential-option">
                <input
                  type="checkbox"
                  checked={form.stream !== false}
                  onChange={(e) => setForm({ ...form, stream: e.target.checked })}
                />
                流式输出，实时显示进度
              </label>
              <div className="form-two">
                {isDeepSeekV4(form) && (
                  <label className="field">
                    DeepSeek 思考模式
                    <select
                      value={form.thinkingMode || 'auto'}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          thinkingMode: e.target.value as AISettings['thinkingMode'],
                        })
                      }
                    >
                      <option value="auto">关闭思考 · 翻译与排版推荐</option>
                      <option value="low">低强度思考</option>
                      <option value="high">高强度思考 · 等待较长</option>
                      <option value="provider">服务商默认 · 不发送思考参数</option>
                    </select>
                  </label>
                )}
                <label className="field">
                  单批次超时（秒）
                  <input
                    type="number"
                    min={30}
                    max={900}
                    value={form.timeoutSeconds}
                    onChange={(e) => setForm({ ...form, timeoutSeconds: Number(e.target.value) })}
                  />
                </label>
                <label className="field">
                  并行请求数
                  <select
                    value={form.concurrency}
                    onChange={(e) => setForm({ ...form, concurrency: Number(e.target.value) })}
                  >
                    <option value={1}>1 · 适合限流服务</option>
                    <option value={2}>2 · 推荐</option>
                    <option value={3}>3 · 较高吞吐</option>
                  </select>
                </label>
                <label className="field">
                  批次大小（字符）
                  <input
                    type="number"
                    min={1000}
                    max={16000}
                    step={500}
                    value={form.batchSize}
                    onChange={(e) => setForm({ ...form, batchSize: Number(e.target.value) })}
                  />
                </label>
                <label className="field">
                  输出 Token 上限
                  <input
                    type="number"
                    min={1024}
                    max={32768}
                    step={1024}
                    value={form.maxOutputTokens}
                    onChange={(e) => setForm({ ...form, maxOutputTokens: Number(e.target.value) })}
                  />
                </label>
              </div>
              <p className="field-hint">
                DeepSeek V4 默认关闭思考以减少首字等待；第三方网关不支持该参数时可选服务商默认。
                长文使用较短首批，后续按段落跨页合并，默认每批最多 6000 字符；公式和表格保持完整。
                出现 429 时降低并行数。批次大小对新任务生效，对照原文由本机插入。
              </p>
            </details>
            <div className="privacy-note">
              <ShieldCheck size={17} />
              <p>
                文献默认留在本地。运行 AI
                任务时，相关文本或你选择解析的页面图片发送至配置的服务。API Key
                {secure
                  ? '由系统凭据存储保护，不写入资料库或备份。'
                  : '仅留在当前会话，不写入数据库或备份。'}
              </p>
            </div>
            <p className="field-hint">
              浏览器预览需要服务商允许跨域请求；原生应用使用 Tauri HTTP。服务商可能按调用量计费。
            </p>
            <div className="modal-actions">
              <button
                className="text-button"
                onClick={() => {
                  setBusy('clear')
                  void clearCredential(form)
                    .then(() => {
                      setKey('')
                      toast('此地址的已保存密钥和会话密钥已清除')
                    })
                    .catch((error) => toast(errorMessage(error), true))
                    .finally(() => setBusy(''))
                }}
              >
                清除密钥
              </button>
              <button className="button" disabled={!!busy} onClick={() => void save(true)}>
                {busy === 'test' ? (
                  <LoaderCircle size={15} className="spin" />
                ) : (
                  <ExternalLink size={15} />
                )}
                测试连接
              </button>
              <button className="button primary" disabled={!!busy} onClick={() => void save()}>
                保存配置
              </button>
            </div>
          </fieldset>
        )}
        {busy === 'test' && (
          <div className="connection-progress" role="status">
            <span>
              {testProgress} · {elapsed} 秒
            </span>
            <button className="text-button" onClick={() => testing.current?.abort()}>
              取消测试
            </button>
          </div>
        )}
        {tab === 'appearance' && (
          <>
            <h3>适合你的阅读氛围</h3>
            <p className="muted">选择舒适的配色。动画会遵循系统的减少动态效果设置。</p>
            <div className="theme-options">
              {[
                ['light', '纸白', Sun],
                ['dark', '夜读', Moon],
                ['system', '跟随系统', Monitor],
              ].map(([value, label, Icon]) => {
                const ThemeIcon = Icon as typeof Sun
                return (
                  <button
                    key={value as string}
                    className={theme === value ? 'active' : ''}
                    onClick={() => onTheme(value as string)}
                  >
                    <ThemeIcon size={26} />
                    <span>{label as string}</span>
                    {theme === value && <Check size={15} />}
                  </button>
                )
              })}
            </div>
            <div className="privacy-note">
              <BookLogo />
              <p>
                Paperead 0.1.6 · 本地优先的论文阅读工作台
                <br />
                快捷键：Ctrl / ⌘ K 搜索 · Ctrl / ⌘ O 导入 · Esc 关闭面板
              </p>
            </div>
          </>
        )}
        {tab === 'data' && <BackupPanel />}
      </div>
    </Modal>
  )
}
function BookLogo() {
  return <span className="tiny-logo">p.</span>
}
