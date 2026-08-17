import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runCli, CliIo } from '../src/cli.js'

const NOW = new Date(2026, 7, 17, 12, 0, 0)
const CLI_PATH = fileURLToPath(new URL('../src/cli.js', import.meta.url))

function makeIo(dir: string) {
  const out: string[] = []
  const err: string[] = []
  const io: CliIo = {
    out: (s: string) => out.push(s),
    err: (s: string) => err.push(s),
    dataDir: dir,
    now: () => NOW,
  }
  return { io, out, err }
}

describe('runCli', () => {
  let dir: string

  before(() => {
    dir = mkdtempSync(join(tmpdir(), 'dsh-bk-cli-'))
  })
  after(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('adds an entry and lists it', () => {
    const { io, out, err } = makeIo(dir)
    const code = runCli(['add', '35', '午饭'], io)
    assert.equal(code, 0)
    assert.equal(err.length, 0)
    assert.ok(out.some((l) => l.includes('¥35.00') && l.includes('餐饮')))

    const { io: io2, out: out2 } = makeIo(dir)
    assert.equal(runCli(['list'], io2), 0)
    assert.ok(out2.some((l) => l.includes('午饭')))
  })

  it('rejects invalid amounts with a clear error and exit code 1', () => {
    const { io, err } = makeIo(dir)
    const code = runCli(['add', 'abc', 'x'], io)
    assert.equal(code, 1)
    assert.ok(err.some((l) => /amount/i.test(l)))
  })

  it('rejects unknown commands with usage and exit code 2', () => {
    const { io, out, err } = makeIo(dir)
    const code = runCli(['frobnicate'], io)
    assert.equal(code, 2)
    // Usage errors go to stderr.
    assert.ok(err.some((l) => l.includes('Usage')))
    assert.equal(out.length, 0)
  })

  it('reports summaries', () => {
    const { io, out } = makeIo(dir)
    assert.equal(runCli(['add', '10', '地铁'], io), 0)
    assert.equal(runCli(['report', 'monthly'], io), 0)
    assert.ok(out.some((l) => l.includes('2026-08')))
    assert.equal(runCli(['report', 'category'], io), 0)
    assert.ok(out.some((l) => l.includes('交通')))
    assert.equal(runCli(['report', 'trend', '--months', '3'], io), 0)
  })

  it('manages budgets', () => {
    const { io, out } = makeIo(dir)
    assert.equal(runCli(['budget', 'set', '500'], io), 0)
    assert.equal(runCli(['budget', 'list'], io), 0)
    assert.ok(out.some((l) => l.includes('¥500.00') || l.includes('500.00')))
    assert.equal(runCli(['budget', 'check'], io), 0)
    assert.equal(runCli(['budget', 'set', 'abc'], io), 1)
  })

  it('manages custom rules', () => {
    const { io, out } = makeIo(dir)
    assert.equal(runCli(['rules', 'add', '咖啡豆', '购物'], io), 0)
    assert.equal(runCli(['rules', 'list'], io), 0)
    assert.ok(out.some((l) => l.includes('咖啡豆')))
    assert.equal(runCli(['rules', 'remove', '咖啡豆'], io), 0)
  })

  it('categorizes text and lists categories', () => {
    const { io, out } = makeIo(dir)
    assert.equal(runCli(['categorize', '打车去机场'], io), 0)
    assert.ok(out.some((l) => l.includes('交通')))
    assert.equal(runCli(['categories'], io), 0)
    assert.ok(out.some((l) => l.includes('餐饮')))
  })

  it('exports csv and html files', () => {
    const { io, out } = makeIo(dir)
    const outDir = join(dir, 'cli-exports')
    assert.equal(runCli(['export', 'csv', '--out', outDir], io), 0)
    const csvPath = out.map((l) => l.match(/(?:[A-Za-z]:)?[^\s]*\.csv/)?.[0]).find(Boolean)
    assert.ok(csvPath && existsSync(csvPath))
    assert.equal(runCli(['export', 'html', '--out', outDir], io), 0)
  })

  it('removes entries by id', () => {
    const { io } = makeIo(dir)
    assert.equal(runCli(['add', '1', 'delete-me'], io), 0)
    const { io: io2, out } = makeIo(dir)
    const list = runCli(['list', '--limit', '1'], io2)
    assert.equal(list, 0)
    const idLine = out.find((l) => l.includes('delete-me'))
    const id = Number((idLine?.match(/#(\d+)/) ?? [])[1])
    assert.ok(Number.isInteger(id))
    assert.equal(runCli(['remove', String(id)], io2), 0)
  })

  it('prints version and usage', () => {
    const { io, out } = makeIo(dir)
    assert.equal(runCli(['--version'], io), 0)
    assert.ok(out.some((l) => /^\d+\.\d+\.\d+/.test(l)))
    const { io: io2, out: out2 } = makeIo(dir)
    assert.equal(runCli(['--help'], io2), 0)
    assert.ok(out2.some((l) => l.includes('Usage')))
  })

  it('honors the --data-dir flag', () => {
    const flagDir = join(dir, 'flag-dir')
    const { io } = makeIo(dir) // io.dataDir points elsewhere; the flag must win
    const code = runCli(['--data-dir', flagDir, 'add', '10', 'x'], io)
    assert.equal(code, 0)
    assert.ok(existsSync(join(flagDir, 'ledger.db')))
  })

  it('rejects invalid numeric flags as usage errors', () => {
    for (const args of [
      ['list', '--limit', 'abc'],
      ['report', 'trend', '--months', 'x'],
      ['list', '--limit', '-5'],
      ['list', '--limit', '0'],
    ]) {
      const { io, out, err } = makeIo(dir)
      assert.equal(runCli(args, io), 2, `expected usage error for ${args.join(' ')}`)
      // Usage errors print the offending message plus the usage text, to stderr.
      assert.ok(err.some((l) => l.includes('invalid number') || l.includes('ambiguous')), `output for ${args.join(' ')}`)
      assert.ok(err.some((l) => l.includes('Usage')), `usage shown for ${args.join(' ')}`)
      assert.equal(out.length, 0)
    }
  })

  it('rejects unknown report kinds and export formats as usage errors', () => {
    const { io, out, err } = makeIo(dir)
    assert.equal(runCli(['report', 'bogus'], io), 2)
    assert.ok(err.some((l) => l.includes('unknown report kind')))
    const { io: io2, err: err2 } = makeIo(dir)
    assert.equal(runCli(['export', 'json'], io2), 2)
    assert.ok(err2.some((l) => l.includes('unknown export format')))
    assert.equal(out.length, 0)
  })

  it('rejects non-safe-integer entry ids', () => {
    const { io, err } = makeIo(dir)
    assert.equal(runCli(['remove', '99999999999999999999'], io), 2)
    assert.ok(err.some((l) => l.includes('remove requires')))
  })

  it('runs as a real process through the entry point', () => {
    const version = spawnSync(process.execPath, [CLI_PATH, '--version'], { encoding: 'utf8' })
    assert.equal(version.status, 0)
    assert.match(version.stdout.trim(), /^\d+\.\d+\.\d+$/)

    const flagDir = join(dir, 'spawn-dir')
    const add = spawnSync(process.execPath, [CLI_PATH, '--data-dir', flagDir, 'add', '35', '午饭'], { encoding: 'utf8' })
    assert.equal(add.status, 0, add.stderr)
    assert.match(add.stdout, /¥35\.00/)
    assert.ok(existsSync(join(flagDir, 'ledger.db')))
  })

  it('runs when invoked through a directory junction (symlinked bin)', () => {
    // npm link / pnpm .bin shims reach the CLI through a symlink; argv[1]
    // then differs from the module URL, and the entry guard must still fire.
    const junction = join(dir, 'cli-link')
    try {
      symlinkSync(dirname(CLI_PATH), junction, 'junction')
    } catch {
      return // junction creation unsupported on this system (e.g. no rights)
    }
    const res = spawnSync(process.execPath, [join(junction, basename(CLI_PATH)), '--version'], { encoding: 'utf8' })
    assert.equal(res.status, 0, res.stderr)
    assert.match(res.stdout.trim(), /^\d+\.\d+\.\d+$/)
  })

  it('honors the DSH_BOOKKEEPING_DATA_DIR environment variable', () => {
    const envDir = join(dir, 'env-dir')
    process.env.DSH_BOOKKEEPING_DATA_DIR = envDir
    try {
      const io: CliIo = { out() {}, err() {}, now: () => NOW }
      assert.equal(runCli(['add', '1', 'x'], io), 0)
      assert.ok(existsSync(join(envDir, 'ledger.db')))
    } finally {
      delete process.env.DSH_BOOKKEEPING_DATA_DIR
    }
  })
})
