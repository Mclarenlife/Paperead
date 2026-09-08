import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { configureNativeEnvironment } from './native-env.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
process.chdir(root)
configureNativeEnvironment(root)
const windows = process.platform === 'win32'
const run = (command, args) => {
  const result = spawnSync(command, args, { stdio: 'inherit', windowsHide: true })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${path.basename(command)} failed (${result.status})`)
}
const version = JSON.parse(readFileSync('package.json', 'utf8')).version
const sdk = process.env.ANDROID_HOME
const java = path.join(process.env.JAVA_HOME, 'bin', windows ? 'java.exe' : 'java')
const buildTools = path.join(sdk, 'build-tools', '36.0.0')
const unsigned =
  'src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release-unsigned.apk'
if (!existsSync(unsigned)) throw new Error(`Unsigned APK missing: ${unsigned}`)
const signingDir = path.join(root, '.tools', 'android-signing')
mkdirSync(signingDir, { recursive: true })
const keystore = path.join(signingDir, 'paperead-test.keystore')
// A persistent, project-local development key keeps test updates installable.
// This conventional test password is public; this key must never sign a store release.
if (!existsSync(keystore))
  run(path.join(process.env.JAVA_HOME, 'bin', windows ? 'keytool.exe' : 'keytool'), [
    '-genkeypair',
    '-keystore',
    keystore,
    '-storepass',
    'android',
    '-keypass',
    'android',
    '-alias',
    'paperead-test',
    '-keyalg',
    'RSA',
    '-keysize',
    '3072',
    '-validity',
    '10000',
    '-dname',
    'CN=Paperead Test, O=Paperead, C=CN',
  ])
mkdirSync('release', { recursive: true })
const name = `Paperead_${version}_Android-arm64-test.apk`
const destination = path.join(root, 'release', name)
const signer = ['-jar', path.join(buildTools, 'lib', 'apksigner.jar')]
run(java, [
  ...signer,
  'sign',
  '--ks',
  keystore,
  '--ks-key-alias',
  'paperead-test',
  '--ks-pass',
  'pass:android',
  '--key-pass',
  'pass:android',
  '--out',
  destination,
  unsigned,
])
run(java, [...signer, 'verify', '--verbose', '--print-certs', destination])
run(path.join(buildTools, windows ? 'zipalign.exe' : 'zipalign'), [
  '-c',
  '-P',
  '16',
  '4',
  destination,
])
const hash = createHash('sha256').update(readFileSync(destination)).digest('hex')
writeFileSync(`${destination}.sha256`, `${hash}  ${name}\n`)
console.log(`Installer (development signature): ${destination}\nSHA256: ${hash}`)
