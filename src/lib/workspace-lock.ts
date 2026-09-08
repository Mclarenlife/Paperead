let ownership: Promise<boolean> | undefined
export function acquireWorkspace(): Promise<boolean> {
  if (ownership) return ownership
  ownership = new Promise((resolve, reject) => {
    if (!navigator.locks) {
      reject(new Error('当前运行环境不支持安全的资料库锁，请更新浏览器或 WebView2。'))
      return
    }
    void navigator.locks
      .request('paperead-workspace-v1', { ifAvailable: true }, async (lock) => {
        if (!lock) {
          resolve(false)
          return
        }
        resolve(true)
        await new Promise<void>((release) =>
          window.addEventListener('pagehide', () => release(), { once: true }),
        )
      })
      .catch(reject)
  })
  return ownership
}
