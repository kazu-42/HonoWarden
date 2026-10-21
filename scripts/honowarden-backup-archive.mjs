import fs from 'node:fs'
import { Buffer } from 'node:buffer'
import { open, link, rm } from 'node:fs/promises'
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from 'node:crypto'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import process from 'node:process'

const magic = Buffer.from('HWBKUP01')
const [mode, input, output] = process.argv.slice(2)
const secret = process.env.HONOWARDEN_BACKUP_ARCHIVE_KEY
const temp = output ? `${output}.partial-${randomUUID()}` : null
try {
  if (
    !['encrypt', 'decrypt'].includes(mode) ||
    !input ||
    !output ||
    process.argv.length !== 5
  )
    throw new Error('arguments')
  if (!/^[A-Za-z0-9_-]{43}$/.test(secret ?? '')) throw new Error('key')
  const key = Buffer.from(secret, 'base64url')
  if (key.length !== 32 || key.toString('base64url') !== secret)
    throw new Error('key')
  if (fs.existsSync(output)) throw new Error('destination_exists')
  const stat = fs.lstatSync(input)
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('input')
  let transform, header
  if (mode === 'encrypt') {
    header = Buffer.concat([magic, randomBytes(12)])
    transform = createCipheriv('aes-256-gcm', key, header.subarray(8))
    transform.setAAD(header)
    fs.writeFileSync(temp, header, { flag: 'wx', mode: 0o600 })
    await pipeline(
      fs.createReadStream(input),
      transform,
      fs.createWriteStream(temp, { flags: 'a' }),
    )
    fs.appendFileSync(temp, transform.getAuthTag())
  } else {
    if (stat.size < 36) throw new Error('archive_size')
    const handle = await open(input, 'r')
    header = Buffer.alloc(20)
    const tag = Buffer.alloc(16)
    try {
      await handle.read(header, 0, 20, 0)
      await handle.read(tag, 0, 16, stat.size - 16)
    } finally {
      await handle.close()
    }
    if (!header.subarray(0, 8).equals(magic)) throw new Error('archive_version')
    transform = createDecipheriv('aes-256-gcm', key, header.subarray(8))
    transform.setAAD(header)
    transform.setAuthTag(tag)
    await pipeline(
      stat.size === 36
        ? Readable.from([])
        : fs.createReadStream(input, { start: 20, end: stat.size - 17 }),
      transform,
      fs.createWriteStream(temp, { flags: 'wx', mode: 0o600 }),
    )
  }
  const handle = await open(temp, 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
  // Publish only after authentication completes, without replacing any file.
  await link(temp, output)
  await rm(temp)
  process.stdout.write(
    JSON.stringify({ operation: mode, success: true }) + '\n',
  )
} catch {
  if (temp) await rm(temp, { force: true })
  process.stderr.write(
    'Backup archive operation failed; no completed output was published.\n',
  )
  process.exitCode = 1
}
