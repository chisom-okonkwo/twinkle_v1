import { useEffect } from 'react';
import { AppState } from 'react-native';
import { router } from 'expo-router';
import { notificationModule, syncRecallDevice } from '../lib/recall-notifications';
import { recallRepository } from '../lib/recall';
export function RecallNotificationBridge({ userId }: { userId: string }) {
  useEffect(() => {
    let active = true;
    let syncing = false;
    const cleanups: (() => void)[] = [];
    async function sync() {
      if (syncing) return;
      syncing = true;
      try {
        await syncRecallDevice(userId);
      } catch {
        /* Settings provide explicit retry; note-taking is unaffected. */
      } finally {
        syncing = false;
      }
    }
    void sync();
    const foreground = AppState.addEventListener('change', (state) => {
      if (state === 'active') void sync();
    });
    void notificationModule()
      .then(async (notifications) => {
        if (!notifications || !active) return;
        notifications.setNotificationHandler({
          handleNotification: async () => ({
            shouldShowBanner: false,
            shouldShowList: false,
            shouldPlaySound: false,
            shouldSetBadge: false,
          }),
        });
        async function open(data: Record<string, unknown> = {}) {
          const id = data.flashbackId;
          if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return;
          try {
            const owned = await recallRepository().get(userId, id);
            if (active && owned) router.navigate({ pathname: '/flashback', params: { id: owned.id } });
          } catch {
            /* Never navigate to an unverified owner or arbitrary URL. */
          }
        }
        const taps = notifications.addNotificationResponseReceivedListener((response) => {
          void notifications.clearLastNotificationResponseAsync();
          void open(response.notification.request.content.data);
        });
        const tokens = notifications.addPushTokenListener(() => {
          void sync();
        });
        cleanups.push(
          () => taps.remove(),
          () => tokens.remove(),
        );
        const last = await notifications.getLastNotificationResponseAsync();
        if (active && last) {
          await notifications.clearLastNotificationResponseAsync();
          await open(last.notification.request.content.data);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
      foreground.remove();
      cleanups.forEach((clean) => clean());
    };
  }, [userId]);
  return null;
}
