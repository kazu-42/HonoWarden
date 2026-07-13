export function isPremiumFeaturesEnabled(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === 'true'
}
