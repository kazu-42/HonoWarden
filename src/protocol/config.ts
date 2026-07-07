import { serviceVersion } from '../version'

export type UpstreamServerConfig = {
  version: string
  gitHash: string
  server: null
  environment: {
    cloudRegion: 'self-hosted'
    vault: string
    api: string
    identity: string
    notifications: string
    icons: string
    sso: string
  }
  push: {
    pushTechnology: 0
    vapidPublicKey: null
  }
  communication: null
  settings: {
    disableUserRegistration: boolean
  }
  featureStates: Record<string, boolean>
  object: 'config'
}

export function buildServerConfig(origin: string): UpstreamServerConfig {
  const normalizedOrigin = origin.replace(/\/+$/, '')

  return {
    version: serviceVersion,
    gitHash: 'honowarden',
    server: null,
    environment: {
      cloudRegion: 'self-hosted',
      vault: normalizedOrigin,
      api: `${normalizedOrigin}/api`,
      identity: `${normalizedOrigin}/identity`,
      notifications: `${normalizedOrigin}/notifications`,
      icons: '',
      sso: '',
    },
    push: {
      pushTechnology: 0,
      vapidPublicKey: null,
    },
    communication: null,
    settings: {
      disableUserRegistration: true,
    },
    featureStates: {
      'cipher-key-encryption': false,
      'duo-redirect': false,
      'email-verification': false,
      'send-enabled': false,
      'web-push': false,
    },
    object: 'config',
  }
}
