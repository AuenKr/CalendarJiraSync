import { existsSync, mkdirSync } from 'node:fs'
import { execSync } from 'node:child_process'

const RELEASE_DIR = 'release'
const DIST_DIR = 'dist'
const VERIFY_ONLY = process.argv.includes('--verify')

function run(command, options = {}) {
  return execSync(command, {
    stdio: options.capture ? 'pipe' : 'inherit',
    encoding: 'utf-8',
  })
}

function parseVersion(tag) {
  const match = tag.trim().match(/^v(\d+)\.(\d+)\.(\d+)$/)
  if (!match) return null

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  }
}

function getLatestTag() {
  try {
    const tag = run('gh release view --json tagName --jq .tagName', {
      capture: true,
    }).trim()
    if (tag) return tag
  } catch (_) {
    // Fallback to git tags when releases don't exist yet
  }

  try {
    const tag = run('git tag --list "v*" --sort=-v:refname | head -n 1', {
      capture: true,
    }).trim()
    if (tag) return tag
  } catch (_) {
    // No tags yet
  }

  return 'v1.0.0'
}

function bumpPatch(tag) {
  const parsed = parseVersion(tag)
  if (!parsed) {
    throw new Error(`Unsupported tag format: "${tag}". Expected v<major>.<minor>.<patch>`)
  }

  return `v${parsed.major}.${parsed.minor}.${parsed.patch + 1}`
}

function ensurePrerequisites() {
  try {
    run('gh auth status')
  } catch (_) {
    throw new Error('GitHub CLI is not authenticated. Run: gh auth login')
  }
}

function getRepoNameWithOwner() {
  try {
    return run('gh repo view --json nameWithOwner --jq .nameWithOwner', {
      capture: true,
    }).trim()
  } catch (_) {
    throw new Error('Unable to detect GitHub repository. Ensure this git remote is connected to GitHub.')
  }
}

function releaseTagExists(nameWithOwner, tag) {
  try {
    run(`gh api -X GET "repos/${nameWithOwner}/releases/tags/${tag}" --jq .tag_name`, {
      capture: true,
    })
    return true
  } catch (_) {
    return false
  }
}

function getCommitMessagesSinceTag(tag) {
  try {
    const output = run(`git log "${tag}..HEAD" --pretty=format:%s`, {
      capture: true,
    }).trim()

    if (!output) return []

    return output
      .split('\n')
      .map((message) => message.trim())
      .filter(Boolean)
  } catch (_) {
    return []
  }
}

function main() {
  ensurePrerequisites()

  const latestTag = getLatestTag()
  const nextTag = bumpPatch(latestTag)
  const nameWithOwner = getRepoNameWithOwner()
  const version = nextTag.slice(1)
  const zipFile = `${RELEASE_DIR}/calendar-jira-sync-v${version}.zip`
  const commitMessages = getCommitMessagesSinceTag(latestTag)
  const commitsSection = commitMessages.length
    ? commitMessages.map((message) => `- ${message}`).join('\n')
    : '- No commits found since previous release'
  const notes = `Automated release ${nextTag}\n\nCommits since ${latestTag}:\n${commitsSection}`

  console.log(`[release] Latest tag: ${latestTag}`)
  console.log(`[release] Next tag: ${nextTag}`)
  console.log(`[release] Verifying tag availability via GET /repos/${nameWithOwner}/releases/tags/${nextTag}`)

  const exists = releaseTagExists(nameWithOwner, nextTag)
  if (exists) {
    throw new Error(`Release tag already exists: ${nextTag}`)
  }
  console.log(`[release] Tag available: ${nextTag}`)

  if (VERIFY_ONLY) {
    console.log('[release] Verify-only mode enabled. Skipping build, tag push, and release publish.')
    return
  }

  run('bun run build')

  if (!existsSync(DIST_DIR)) {
    throw new Error(`Build output "${DIST_DIR}" not found`)
  }

  if (!existsSync(RELEASE_DIR)) {
    mkdirSync(RELEASE_DIR, { recursive: true })
  }

  run(`rm -f "${zipFile}"`)
  run(`zip -r "${zipFile}" "${DIST_DIR}"`)

  run(`git tag "${nextTag}"`)
  run(`git push origin "${nextTag}"`)
  run(`gh release create "${nextTag}" "${zipFile}" --title "${nextTag}" --notes ${JSON.stringify(notes)}`)

  console.log(`[release] Published ${nextTag} with asset ${zipFile}`)
}

main()
