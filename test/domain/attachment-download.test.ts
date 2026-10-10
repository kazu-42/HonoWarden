import { describe, expect, it } from 'vitest'
import {
  signAttachmentDownload,
  verifyAttachmentDownload,
} from '../../src/domain/attachment-download'

const scope = {
  userId: 'user',
  deviceIdentifier: 'device',
  sessionId: 'session',
  securityStamp: 'stamp',
  cipherId: 'cipher',
  attachmentId: 'attachment',
  revisionDate: 'revision',
  origin: 'https://vault.example.test',
}
describe('attachment download capabilities', () => {
  it('expires at the fixed boundary and rejects future issuance', async () => {
    const token = await signAttachmentDownload('secret', scope, 100)
    expect(await verifyAttachmentDownload('secret', token, 219)).toMatchObject(
      scope,
    )
    expect(await verifyAttachmentDownload('secret', token, 220)).toBeNull()
    expect(await verifyAttachmentDownload('secret', token, 99)).toBeNull()
    expect(
      await verifyAttachmentDownload('other-secret', token, 100),
    ).toBeNull()
  })
  it('supports bounded key rotation without accepting an unknown key id', async () => {
    const old = { id: 'old', secret: 'old-secret' }
    const active = { id: 'active', secret: 'new-secret' }
    const token = await signAttachmentDownload(old, scope, 100)
    expect(
      await verifyAttachmentDownload({ active, previous: [old] }, token, 100),
    ).toMatchObject(scope)
    expect(await verifyAttachmentDownload({ active }, token, 100)).toBeNull()
    const legacy = await signAttachmentDownload('legacy', scope, 100)
    expect(
      await verifyAttachmentDownload(
        { active, legacySecrets: ['legacy'] },
        legacy,
        100,
      ),
    ).toMatchObject(scope)
    expect(await verifyAttachmentDownload({ active }, legacy, 100)).toBeNull()
  })
  it('authenticates every scope field and rejects malformed capabilities', async () => {
    const token = await signAttachmentDownload('secret', scope, 100)
    const [payload, signature] = token.split('.')
    const original = JSON.parse(Buffer.from(payload!, 'base64url').toString())
    for (const field of Object.keys(scope)) {
      const changed = Buffer.from(
        JSON.stringify({ ...original, [field]: 'other' }),
      ).toString('base64url')
      expect(
        await verifyAttachmentDownload(
          'secret',
          `${changed}.${signature}`,
          100,
        ),
      ).toBeNull()
    }
    for (const invalid of [
      '',
      'x'.repeat(8193),
      token + '.',
      token + '=',
      `!${token}`,
      'e30.e30',
    ]) {
      expect(await verifyAttachmentDownload('secret', invalid, 100)).toBeNull()
    }
  })
})
