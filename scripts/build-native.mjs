import { spawnSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { configureNativeEnvironment } from './native-env.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
process.chdir(root)
configureNativeEnvironment(root)
const platform = process.argv[2]
const run = (command, args) => {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    shell: process.platform === 'win32' && /\.(bat|cmd)$|^pnpm$/.test(command),
    windowsHide: true,
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${path.basename(command)} failed (${result.status})`)
}
const node = (script, ...args) => run(process.execPath, [script, ...args])
const tauri = (...args) => node('node_modules/@tauri-apps/cli/tauri.js', ...args)
const version = JSON.parse(readFileSync('package.json', 'utf8')).version
const release = path.join(root, 'release')
const deliver = (source, name) => {
  mkdirSync(release, { recursive: true })
  const destination = path.join(release, name)
  copyFileSync(source, destination)
  const hash = createHash('sha256').update(readFileSync(destination)).digest('hex')
  writeFileSync(`${destination}.sha256`, `${hash}  ${name}\n`)
  console.log(`Installer: ${destination}\nSHA256: ${hash}`)
}
if (!['android', 'macos', 'ios'].includes(platform))
  throw new Error('Usage: node scripts/build-native.mjs android|macos|ios [--skip-tests]')
if (['macos', 'ios'].includes(platform) && process.platform !== 'darwin')
  throw new Error('Apple 原生构建需要 Mac 和 Xcode Command Line Tools；iOS 需要完整 Xcode。')
if (
  platform === 'android' &&
  (!process.env.JAVA_HOME || !process.env.ANDROID_HOME || !process.env.NDK_HOME)
)
  throw new Error(
    'Android 原生构建需要 JDK、Android SDK/NDK，并设置 JAVA_HOME、ANDROID_HOME、NDK_HOME。',
  )
if (!process.argv.includes('--skip-tests')) node('node_modules/vitest/vitest.mjs', 'run')
node('scripts/fetch-reading-assets.mjs')
node('scripts/prepare-pdf.mjs')
if (platform === 'android') {
  if (!existsSync('src-tauri/gen/android/app/build.gradle.kts')) tauri('android', 'init', '--ci')
  node('scripts/build-android.mjs')
  node('scripts/sign-android-test.mjs')
} else if (platform === 'macos') {
  run('rustup', ['target', 'add', 'aarch64-apple-darwin', 'x86_64-apple-darwin'])
  // An ad-hoc signature allows local tests; Developer ID/notarization is a separate release step.
  const signing = process.env.APPLE_SIGNING_IDENTITY
    ? []
    : ['--config', JSON.stringify({ bundle: { macOS: { signingIdentity: '-' } } })]
  tauri(
    'build',
    '--target',
    'universal-apple-darwin',
    '--bundles',
    'dmg',
    '--ci',
    ...signing,
    '--',
    '--locked',
  )
  const directory = 'src-tauri/target/universal-apple-darwin/release/bundle/dmg'
  const matches = readdirSync(directory).filter(
    (name) => name.endsWith('.dmg') && name.includes(`_${version}_`),
  )
  if (matches.length !== 1)
    throw new Error(`Expected one DMG for ${version}, found ${matches.length}`)
  deliver(path.join(directory, matches[0]), `Paperead_${version}_macOS-universal.dmg`)
} else {
  if (!existsSync('src-tauri/gen/apple')) tauri('ios', 'init', '--ci')
  tauri('ios', 'build', '--ci')
}
