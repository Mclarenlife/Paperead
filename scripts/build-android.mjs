import { spawn, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { configureNativeEnvironment } from './native-env.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
process.chdir(root)
configureNativeEnvironment(root)
let tail = ''
const build = spawn(
  process.execPath,
  [
    'node_modules/@tauri-apps/cli/tauri.js',
    'android',
    'build',
    '--apk',
    '--target',
    'aarch64',
    '--ci',
    '--',
    '--locked',
  ],
  { windowsHide: true, stdio: ['inherit', 'pipe', 'pipe'] },
)
for (const stream of [build.stdout, build.stderr])
  stream.on('data', (chunk) => {
    process.stdout.write(chunk)
    tail = (tail + chunk.toString()).slice(-128_000)
  })
const status = await new Promise((resolve, reject) => {
  build.on('error', reject)
  build.on('close', resolve)
})
if (status === 0) process.exit(0)
// Tauri has already compiled/embedded the frontend before trying to link jniLibs.
// Only this specific Windows permission failure may use the copy fallback.
if (
  process.platform !== 'win32' ||
  !tail.includes('Creation symbolic link is not allowed') ||
  !/Finished `release` profile/.test(tail)
)
  throw new Error(`Android build failed (${status}); no packaging fallback was applied.`)
const library = path.join(root, 'src-tauri/target/aarch64-linux-android/release/libpaperead_lib.so')
if (!existsSync(library)) throw new Error('Compiled ARM64 library is missing')
const android = path.join(root, 'src-tauri/gen/android')
const jni = path.join(android, 'app/src/main/jniLibs/arm64-v8a')
mkdirSync(jni, { recursive: true })
copyFileSync(library, path.join(jni, 'libpaperead_lib.so'))
console.log(
  'Windows symlink permission unavailable; packaging the freshly compiled library by copy.',
)
const result = spawnSync(
  path.join(process.env.JAVA_HOME, 'bin/java.exe'),
  [
    '-classpath',
    'gradle/wrapper/gradle-wrapper.jar',
    'org.gradle.wrapper.GradleWrapperMain',
    ':app:assembleUniversalRelease',
    '-PabiList=arm64-v8a',
    '-ParchList=arm64',
    '-PtargetList=aarch64',
    '-x',
    ':app:rustBuildArm64Release',
    '--no-daemon',
  ],
  { cwd: android, windowsHide: true, stdio: 'inherit' },
)
if (result.error) throw result.error
if (result.status !== 0) throw new Error(`Gradle APK packaging failed (${result.status})`)
