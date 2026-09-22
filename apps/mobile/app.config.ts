import type { ConfigContext, ExpoConfig } from 'expo/config';

/** Build identities belong to Zana's release environment, never BB's project. */
export default function mobileConfig({ config }: ConfigContext): ExpoConfig {
  const projectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID?.trim();
  const owner = process.env.EXPO_OWNER?.trim();
  const googleServicesFile = process.env.GOOGLE_SERVICES_JSON?.trim();
  if (projectId && !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(projectId)) {
    throw new Error('EXPO_PUBLIC_EAS_PROJECT_ID must be the UUID of your Zana EAS project.');
  }
  return {
    ...config,
    name: config.name ?? 'Zana',
    slug: config.slug ?? 'zana-mobile',
    ...(owner ? { owner } : {}),
    ...(projectId ? { extra: { ...config.extra, eas: { ...config.extra?.eas, projectId } } } : {}),
    ...(googleServicesFile ? { android: { ...config.android, googleServicesFile } } : {})
  };
}
