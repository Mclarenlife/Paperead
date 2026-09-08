import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Check, LoaderCircle, X } from 'lucide-react'

export type ToastAction = { label: string; run: () => void | Promise<void> }
export type ToastItem = { id: number; message: string; error?: boolean; action?: ToastAction }
export const ToastContext = createContext<
  (message: string, error?: boolean, action?: ToastAction) => void
>(() => {})
export const useToast = () => useContext(ToastContext)
export function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string
  children: ReactNode
  onClose: () => void
  wide?: boolean
}) {
  const ref = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    ref.current?.focus()
    const handler = (e: KeyboardEvent) => {
      if (
        Array.from(document.querySelectorAll('.modal-backdrop')).at(-1) !==
        ref.current?.closest('.modal-backdrop')
      )
        return
      if (e.key === 'Escape') closeRef.current()
      if (e.key !== 'Tab') return
      const elements = Array.from(
        ref.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]',
        ) || [],
      ).filter((el) => el.offsetParent !== null)
      const first = elements[0],
        last = elements.at(-1)
      if (
        e.shiftKey &&
        (document.activeElement === first || document.activeElement === ref.current)
      ) {
        e.preventDefault()
        last?.focus()
      } else if (
        !e.shiftKey &&
        (document.activeElement === last || document.activeElement === ref.current)
      ) {
        e.preventDefault()
        first?.focus()
      }
    }
    document.addEventListener('keydown', handler)
    const old = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handler)
      document.body.style.overflow = old
      previous?.focus()
    }
  }, [])
  return (
    <motion.div
      className="modal-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <motion.div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`modal ${wide ? 'modal-wide' : ''}`}
        initial={{ opacity: 0, y: 18, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 8 }}
      >
        <div className="modal-heading">
          <h2>{title}</h2>
          <button className="icon-button" onClick={onClose} aria-label="关闭">
            <X size={20} />
          </button>
        </div>
        {children}
      </motion.div>
    </motion.div>
  )
}
export function Spinner({ text = '正在加载…' }: { text?: string }) {
  return (
    <div className="loading">
      <LoaderCircle className="spin" size={23} />
      <span>{text}</span>
    </div>
  )
}
export function Toasts({ items }: { items: ToastItem[] }) {
  const toast = useToast()
  return (
    <div className="toasts" role="status" aria-live="polite">
      <AnimatePresence>
        {items.map((item) => (
          <motion.div
            key={item.id}
            className={`toast ${item.error ? 'toast-error' : ''}`}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, x: 20 }}
          >
            {item.error ? <X size={17} /> : <Check size={17} />}
            <span>{item.message}</span>
            {item.action && (
              <button
                className="text-button"
                onClick={async (event) => {
                  const button = event.currentTarget
                  button.disabled = true
                  try {
                    await item.action!.run()
                  } catch (error) {
                    toast(String(error), true)
                    button.disabled = false
                  }
                }}
              >
                {item.action.label}
              </button>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
