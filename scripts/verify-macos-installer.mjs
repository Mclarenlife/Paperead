import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, readdirSync, rmdirSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

if (process.platform !== 'darwin') throw new Error('DMG verification must run on macOS')
const run = (command, args) => {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command}: ${result.stderr || result.stdout}`)
  return `${result.stdout}${result.stderr}`.trim()
}
const version = JSON.parse(readFileSync('package.json', 'utf8')).version
const name = `Paperead_${version}_macOS-universal.dmg`
if (!readdirSync('release').includes(name)) throw new Error(`Missing ${name}`)
const dmg = path.resolve('release', name)
const sha256 = createHash('sha256').update(readFileSync(dmg)).digest('hex')
if (readFileSync(`${dmg}.sha256`, 'utf8').split(/\s+/)[0] !== sha256)
  throw new Error('DMG checksum mismatch')
run('hdiutil', ['verify', dmg])
const mount = mkdtempSync(path.join(os.tmpdir(), 'paperead-dmg-'))
let attached = false
try {
  run('hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', mount, dmg])
  attached = true
  const app = path.join(mount, 'Paperead.app')
  const executable = path.join(app, 'Contents/MacOS/paperead')
  run('lipo', ['-verify_arch', 'arm64', 'x86_64', executable])
  run('codesign', ['--verify', '--deep', '--strict', app])
  const info = path.join(app, 'Contents/Info.plist')
  const bundleVersion = run('/usr/libexec/PlistBuddy', [
    '-c',
    'Print :CFBundleShortVersionString',
    info,
  ])
  const identifier = run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier', info])
  if (bundleVersion !== version || identifier !== 'app.paperead.reader')
    throw new Error('Unexpected app identity/version')
  const report = {
    file: name,
    sha256,
    version,
    identifier,
    architectures: ['arm64', 'x86_64'],
    diskImageVerified: true,
    signatureVerified: true,
    signature: run('codesign', ['-dv', app]),
    notarized: false,
    interactiveDeviceTest: false,
  }
  writeFileSync('release/macos-verification.json', `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify(report, null, 2))
} finally {
  if (attached) run('hdiutil', ['detach', mount])
  rmdirSync(mount)
}
