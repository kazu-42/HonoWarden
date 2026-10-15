// Official Desktop 2026.9.1 create shape with cipher-key-encryption disabled.
export function desktopOrganizationCipherRequest(
  organizationId: string,
  collectionId: string,
  encryptedFor: string,
) {
  return {
    cipher: {
      type: 1,
      encryptedFor,
      encryptedByKeyId: 'synthetic-organization-key-id',
      organizationId,
      name: '2.synthetic-name',
      notes: null,
      favorite: false,
      lastKnownRevisionDate: '2026-10-01T00:00:00.000Z',
      reprompt: 0,
      login: {
        username: '2.synthetic-username',
        password: '2.synthetic-password',
        uris: [],
      },
      fields: [],
      attachments: {},
      attachments2: {},
    },
    collectionIds: [collectionId],
  }
}
