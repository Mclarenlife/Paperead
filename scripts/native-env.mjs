import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'

// Generated mobile build tasks must call the CLI, not recursively call build:android.
export const tauriCliEnvironment = () => ({
  ...process.env,
  npm_execpath: 'pnpm',
  npm_lifecycle_event: 'tauri',
})

// Portable tools stay inside this project; system environment variables take precedence.
export function configureNativeEnvironment(root) {
  const env = process.env
  const local = (...parts) => path.join(root, '.tools', ...parts)
  const cargo = local('cargo')
  if (!env.CARGO_HOME && existsSync(path.join(cargo, 'bin', 'cargo.exe'))) {
    env.CARGO_HOME = cargo
    env.RUSTUP_HOME ||= local('rustup')
  }
  if (!env.JAVA_HOME && existsSync(local('java'))) {
    const jdk = readdirSync(local('java')).find((name) =>
      existsSync(local('java', name, 'bin', process.platform === 'win32' ? 'java.exe' : 'java')),
    )
    if (jdk) env.JAVA_HOME = local('java', jdk)
  }
  if (!env.ANDROID_HOME && env.ANDROID_SDK_ROOT) env.ANDROID_HOME = env.ANDROID_SDK_ROOT
  if (!env.ANDROID_HOME && existsSync(local('android-sdk'))) env.ANDROID_HOME = local('android-sdk')
  if (!env.NDK_HOME && env.ANDROID_HOME) {
    const ndk = path.join(env.ANDROID_HOME, 'ndk', '28.2.13676358')
    if (existsSync(ndk)) env.NDK_HOME = ndk
  }
  env.GRADLE_USER_HOME ||= local('gradle')
  const additions = [
    env.CARGO_HOME && path.join(env.CARGO_HOME, 'bin'),
    env.JAVA_HOME && path.join(env.JAVA_HOME, 'bin'),
  ].filter(Boolean)
  env.PATH = [...additions, env.PATH].join(path.delimiter)
}
