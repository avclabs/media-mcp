// Release metadata gate for the media-mcp monorepo. Fails on any drift among
// the per-package version sources; never modifies files.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(scriptDirectory, '..')

const readJson = (relativePath) =>
  JSON.parse(fs.readFileSync(path.join(projectRoot, relativePath), 'utf8'))

const packages = [
  { dir: 'core', name: '@avclabs.ai/media-mcp-core', hasServer: false },
  { dir: 'video-mcp', name: '@avclabs.ai/video-mcp', hasServer: true },
  { dir: 'image-mcp', name: '@avclabs.ai/image-mcp', hasServer: true },
  { dir: 'sam3-mcp', name: '@avclabs.ai/sam3-mcp', hasServer: true },
  { dir: 'media-mcp', name: '@avclabs.ai/media-mcp', hasServer: true },
]

const errors = []
const fail = (message) => errors.push(message)

const rootPackageJson = readJson('package.json')
const packageLock = readJson('package-lock.json')
const serverJson = readJson('server.json')

if (rootPackageJson.private !== true) fail('root package.json must be private (the publishable units live in packages/)')
if (!rootPackageJson.workspaces?.includes('packages/*')) fail('root package.json workspaces must include "packages/*"')

const packageVersions = new Map()
for (const { dir, name, hasServer } of packages) {
  const manifest = readJson(`packages/${dir}/package.json`)
  if (manifest.name !== name) fail(`packages/${dir}/package.json name is ${manifest.name}, expected ${name}`)
  packageVersions.set(name, manifest.version)

  const lockEntry = packageLock.packages?.[`packages/${dir}`]
  if (lockEntry?.version !== manifest.version) {
    fail(`packages/${dir}: package-lock version is ${lockEntry?.version ?? 'missing'}, expected ${manifest.version} (run npm install)`)
  }

  // The published manifest is gated exactly: the files set matches what
  // docs/RELEASE.md documents (server packages ship a bundled config.json and
  // both READMEs; core does not), and the publish-time build safety net that
  // once went missing in the split cannot silently disappear again.
  const expectedFiles =
    dir === 'core' ? ['dist', 'README.md', 'LICENSE'] : ['dist', 'config.json', 'LICENSE', 'README.md', 'README_CN.md'];
  const filesEntries = manifest.files ?? [];
  for (const entry of expectedFiles) {
    if (!filesEntries.includes(entry)) fail(`packages/${dir}: files must include "${entry}"`)
  }
  for (const entry of filesEntries) {
    if (!expectedFiles.includes(entry)) fail(`packages/${dir}: unexpected files entry "${entry}" (update docs/RELEASE.md if intentional)`)
  }
  if (manifest.scripts?.prepublishOnly !== 'npm run build') {
    fail(`packages/${dir}: scripts.prepublishOnly must be "npm run build"`)
  }
  if (manifest.exports?.['.'] === undefined) {
    fail(`packages/${dir}: must expose a "." export (library surface separate from the bin entry)`)
  }

  for (const [binName, binTarget] of Object.entries(manifest.bin ?? {})) {
    const entryMatch = /^dist\/(.+)\.js$/.exec(binTarget)
    if (!entryMatch) {
      fail(`packages/${dir}: bin ${binName} must point at dist/*.js, got ${binTarget}`)
      continue
    }
    const sourcePath = `packages/${dir}/src/${entryMatch[1]}.ts`
    if (!fs.existsSync(path.join(projectRoot, sourcePath))) {
      fail(`packages/${dir}: bin ${binName} -> ${binTarget} has no matching source at ${sourcePath}`)
    }
    // The declared bin target must exist as a built artifact. npm ci links
    // workspace bins only when dist/ already exists, so the link itself is
    // not a reliable signal; the built entry is.
    if (!fs.existsSync(path.join(projectRoot, 'packages', dir, binTarget))) {
      fail(`packages/${dir}: bin ${binName} -> ${binTarget} has no built artifact (run npm ci or npm run build first)`)
    }
  }

  if (hasServer) {
    const serverSource = fs.readFileSync(path.join(projectRoot, `packages/${dir}/src/server.ts`), 'utf8')
    const sourceVersion = serverSource.match(/SERVER_VERSION = '([^']+)'/)?.[1]
    if (sourceVersion !== manifest.version) {
      fail(`packages/${dir}: src/server.ts SERVER_VERSION is ${sourceVersion ?? 'missing'}, expected ${manifest.version}`)
    }
  }
}

// Every server package must depend on a core version compatible with the one
// present in the workspace, so a fresh consumer install resolves consistently.
const coreVersion = packageVersions.get('@avclabs.ai/media-mcp-core')
const caretOk = (range) => {
  const match = /^\^(\d+)\.(\d+)\.(\d+)$/.exec(range)
  if (!match) return false
  const [, major, minor, patch] = match.map(Number)
  const [coreMajor, coreMinor, corePatch] = coreVersion.split('.').map(Number)
  if (coreMajor !== major) return false
  if (major === 0 && coreMinor !== minor) return false
  return corePatch >= patch
}
for (const { dir, name } of packages.filter((pkg) => pkg.name !== '@avclabs.ai/media-mcp-core')) {
  const manifest = readJson(`packages/${dir}/package.json`)
  const range = manifest.dependencies?.['@avclabs.ai/media-mcp-core']
  if (range === undefined) {
    fail(`packages/${dir}: must declare a dependency on @avclabs.ai/media-mcp-core`)
  } else if (!caretOk(range)) {
    fail(`packages/${dir}: dependency ${range} on core is not satisfied by workspace core ${coreVersion}`)
  }
  const lockEntry = packageLock.packages?.[`packages/${dir}`]
  for (const [depName, depRange] of Object.entries(manifest.dependencies ?? {})) {
    if (!depName.startsWith('@avclabs.ai/')) continue
    if (lockEntry?.dependencies?.[depName] !== depRange) {
      fail(`packages/${dir}: package-lock records ${depName}@${lockEntry?.dependencies?.[depName] ?? 'missing'}, expected ${depRange}`)
    }
  }
  if (!packageVersions.has(name)) fail(`unknown workspace package ${name}`)
}

// The MCP registry file at the repo root keeps describing the legacy
// all-in-one package (one server.json per repository is the registry layout).
const legacyVersion = packageVersions.get('@avclabs.ai/media-mcp')
if (serverJson.version !== legacyVersion) {
  fail(`server.json version is ${serverJson.version}, expected legacy package version ${legacyVersion}`)
}
if (serverJson.packages?.[0]?.version !== legacyVersion) {
  fail(`server.json packages[0].version is ${serverJson.packages?.[0]?.version}, expected ${legacyVersion}`)
}
if (serverJson.packages?.[0]?.identifier !== '@avclabs.ai/media-mcp') {
  fail(`server.json packages[0].identifier must stay on the legacy @avclabs.ai/media-mcp package`)
}
const legacyManifest = readJson('packages/media-mcp/package.json')
if (legacyManifest.mcpName !== serverJson.name) {
  fail(`packages/media-mcp mcpName ${legacyManifest.mcpName} does not match server.json name ${serverJson.name}`)
}

if (errors.length > 0) {
  console.error('Release metadata check failed:')
  for (const error of errors) console.error(`- ${error}`)
  process.exit(1)
}

console.log('Release metadata is consistent across all workspace packages:')
for (const { name } of packages) console.log(`- ${name}@${packageVersions.get(name)}`)
