import type { ConfigContext, ExpoConfig } from 'expo/config';
// Public application identifiers and a build-time file path, never server credentials.
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: config.name ?? 'Twinkle',
  slug: config.slug ?? 'twinkle_v1',
  android: {
    ...config.android,
    ...(process.env.TWINKLE_ANDROID_PACKAGE ? { package: process.env.TWINKLE_ANDROID_PACKAGE } : {}),
    ...(process.env.GOOGLE_SERVICES_JSON ? { googleServicesFile: process.env.GOOGLE_SERVICES_JSON } : {}),
  },
  ios: {
    ...config.ios,
    ...(process.env.TWINKLE_IOS_BUNDLE_ID ? { bundleIdentifier: process.env.TWINKLE_IOS_BUNDLE_ID } : {}),
  },
  extra: {
    ...config.extra,
    ...(process.env.EXPO_PUBLIC_EAS_PROJECT_ID
      ? { eas: { ...config.extra?.eas, projectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID } }
      : {}),
  },
});
