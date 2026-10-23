import Constants, { ExecutionEnvironment } from 'expo-constants';
import { getCalendars } from 'expo-localization';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';
import { getSupabase } from './supabase';
import { recallRepository } from './recall';
import { withDeadline } from './capture-network';
const installationKey = 'twinkle.push.installation.v1';
export const deviceTimezone = () =>
  getCalendars()[0]?.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
export async function notificationModule() {
  if (Platform.OS === 'web' || Constants.executionEnvironment === ExecutionEnvironment.StoreClient)
    return null;
  return import('expo-notifications');
}
let creatingInstallation: Promise<string | null> | null = null;
async function installation(create = false): Promise<string | null> {
  if (creatingInstallation) return creatingInstallation;
  if (create) {
    creatingInstallation = readInstallation(true);
    try {
      return await creatingInstallation;
    } finally {
      creatingInstallation = null;
    }
  }
  return readInstallation(false);
}
async function readInstallation(create = false) {
  if (Platform.OS === 'web') return null;
  let id = await SecureStore.getItemAsync(installationKey);
  if (!id && create) {
    id = Crypto.randomUUID();
    await SecureStore.setItemAsync(installationKey, id);
  }
  return id;
}
export async function unregisterRecallDevice() {
  const id = await installation();
  if (!id) return;
  const result = await withDeadline(
    async (signal) =>
      await getSupabase().rpc('unregister_recall_device', { installation: id }).abortSignal(signal),
    15000,
  );
  if (result.error) throw result.error;
}
export async function clearRecallNotifications() {
  try {
    const notifications = await notificationModule();
    await notifications?.dismissAllNotificationsAsync();
  } catch {
    /* Unregistration/session revocation still protects future delivery. */
  }
}
export async function syncRecallDevice(userId: string, ask = false): Promise<string> {
  const repository = recallRepository();
  const saved = await repository.preferences(userId);
  if (!saved || saved.frequency === 'off') {
    await unregisterRecallDevice();
    return 'Flashback push notifications are off. In-app flashbacks stay available.';
  }
  const timezone = deviceTimezone();
  if (saved.timezone !== timezone) {
    const synced = await getSupabase()
      .from('recall_preferences')
      .update({ timezone })
      .eq('user_id', userId)
      .eq('updated_at', saved.updated_at);
    if (synced.error) throw synced.error;
  }
  const notifications = await notificationModule();
  if (!notifications)
    return 'In-app flashbacks are available. Remote push needs an Expo development build on this device.';
  const projectId = Constants.easConfig?.projectId ?? Constants.expoConfig?.extra?.eas?.projectId;
  if (!projectId)
    return 'Push setup needs an EAS project ID and notification credentials. In-app flashbacks are ready.';
  if (Platform.OS === 'android')
    await notifications.setNotificationChannelAsync('flashbacks', {
      name: 'Thoughts to revisit',
      importance: notifications.AndroidImportance.DEFAULT,
      sound: null,
      lockscreenVisibility: notifications.AndroidNotificationVisibility.PRIVATE,
    });
  let permission = await notifications.getPermissionsAsync();
  if (!permission.granted && ask) permission = await notifications.requestPermissionsAsync();
  const channel =
    Platform.OS === 'android' ? await notifications.getNotificationChannelAsync('flashbacks') : null;
  if (!permission.granted || channel?.importance === notifications.AndroidImportance.NONE) {
    await unregisterRecallDevice();
    return 'Notifications are blocked for this device. You can change this in system settings; in-app flashbacks still work.';
  }
  const token = await withDeadline(() => notifications.getExpoPushTokenAsync({ projectId }), 15000);
  const session = await getSupabase().auth.getSession();
  const latest = await repository.preferences(userId);
  if (session.data.session?.user.id !== userId || !latest || latest.frequency === 'off')
    return 'Notifications are off.';
  const result = await getSupabase().rpc('register_recall_device', {
    installation: (await installation(true))!,
    token: token.data,
    device_platform: Platform.OS,
  });
  if (result.error) throw result.error;
  return 'This device is registered. Notifications arrive only when a useful flashback is available.';
}
