import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDirectory, '..')

const readJson = (relativePath) =>
  JSON.parse(fs.readFileSync(path.join(projectRoot, relativePath), 'utf8'))

const packageJson = readJson('package.json')
const packageLock = readJson('package-lock.json')
const serverJson = readJson('server.json')
const serverSource = fs.readFileSync(path.join(projectRoot, 'src/server.ts'), 'utf8')
const sourceVersion = serverSource.match(/version:\s*['"]([^'"]+)['"]/)?.[1]

const versions = new Map([
  ['package.json', packageJson.version],
  ['package-lock.json', packageLock.version],
  ['package-lock.json packages[""]', packageLock.packages?.['']?.version],
  ['server.json', serverJson.version],
  ['server.json packages[0]', serverJson.packages?.[0]?.version],
  ['src/server.ts', sourceVersion],
])

const expectedVersion = packageJson.version
const mismatches = [...versions].filter(([, version]) => version !== expectedVersion)

if (mismatches.length > 0) {
  console.error(`Release version mismatch; expected ${expectedVersion}:`)
  for (const [file, version] of mismatches) {
    console.error(`- ${file}: ${version ?? 'missing'}`)
  }
  process.exit(1)
}

if (packageJson.bin?.['media-mcp'] !== 'dist/server.js') {
  console.error('package.json must expose the media-mcp binary at dist/server.js')
  process.exit(1)
}

console.log(`Release metadata is consistent for ${packageJson.name}@${expectedVersion}.`)
