import { describe, expect, it } from 'vitest'
import { parseCompanySettings } from '../src/company-settings'
import { parseCompanyTestMailRequest } from '../src/company-test-mail'
import app from '../src/app'

const valid = {
  name: 'Company',
  defaultEmailDomain: 'example.test',
  expectedMemberCount: 20,
  mailTestRecipient: 'operator@example.test',
  revision: null,
}
describe('company setup input', () => {
  it('keeps test mail default-off and accepts only a saved settings revision', async () => {
    expect(
      (
        await app.request(
          '/api/organizations/org/admin-settings/test-mail',
          { method: 'POST' },
          {},
        )
      ).status,
    ).toBe(404)
    expect(parseCompanyTestMailRequest({ revision: 'saved-revision' })).toEqual(
      { revision: 'saved-revision' },
    )
    for (const body of [
      {},
      null,
      { revision: null },
      { revision: '' },
      { revision: 'saved', recipientEmail: 'injected@example.test' },
    ])
      expect(parseCompanyTestMailRequest(body)).toBeNull()
  })
  it('keeps the settings endpoint default-off before touching authentication or D1', async () => {
    for (const method of ['GET', 'PUT']) {
      expect(
        (
          await app.request(
            '/api/organizations/org/admin-settings',
            { method },
            {},
          )
        ).status,
      ).toBe(404)
    }
  })
  it('normalizes display inputs without granting domain ownership or membership', () => {
    expect(
      parseCompanySettings({
        ...valid,
        name: ' Company ',
        defaultEmailDomain: ' EXAMPLE.TEST ',
        mailTestRecipient: ' OPERATOR@EXAMPLE.TEST ',
      }),
    ).toEqual(valid)
    expect(
      parseCompanySettings({
        ...valid,
        defaultEmailDomain: '',
        expectedMemberCount: null,
        mailTestRecipient: '',
      }),
    ).toEqual({
      ...valid,
      defaultEmailDomain: null,
      expectedMemberCount: null,
      mailTestRecipient: null,
    })
  })
  it.each([
    { defaultEmailDomain: '*.example.test' },
    { defaultEmailDomain: 'https://example.test' },
    { defaultEmailDomain: 'example.test/path' },
    { defaultEmailDomain: 'a'.repeat(64) + '.test' },
    { mailTestRecipient: 'one@example.test,two@example.test' },
    { mailTestRecipient: 'x\r\n@example.test' },
    { expectedMemberCount: 0 },
    { expectedMemberCount: 1.5 },
    { expectedMemberCount: 100001 },
    { name: '' },
    { name: 'x'.repeat(101) },
    { revision: '' },
    { role: 0 },
  ])('rejects invalid or authority-bearing input %j', (change) =>
    expect(parseCompanySettings({ ...valid, ...change })).toBeNull(),
  )
})
