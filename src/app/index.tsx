import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, AppState, FlatList, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { NoteCard, noteStyles, TextAction } from '../components/note-ui';
import { Action, errorMessage, Message, styles } from '../components/ui';
import { listNotes, NOTES_PAGE_SIZE, type Note } from '../lib/notes';
import { getSupabase } from '../lib/supabase';
import { useAuth } from '../providers/auth-provider';
import { FlashbackCard } from '../components/flashback-card';
import { clearRecallNotifications, unregisterRecallDevice } from '../lib/recall-notifications';
import { ContextPreferences } from '../components/context-preferences';

export default function NotesRoute() {
  const { session } = useAuth();
  return session ? <NotesHome key={session.user.id} userId={session.user.id} /> : null;
}

function NotesHome({ userId }: { userId: string }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const focused = useRef(false);
  const request = useRef(0);
  const inFlight = useRef(false);

  // Focus and foreground refreshes invalidate older requests, including pagination.
  const fetchNotes = useCallback(async (cursor?: Note) => {
    const current = ++request.current;
    inFlight.current = true;
    try {
      const page = await listNotes(userId, cursor);
      if (!focused.current || current !== request.current) return;
      setNotes((previous) => cursor ? [...previous, ...page.filter((note) => !previous.some((item) => item.id === note.id))] : page);
      setHasMore(page.length === NOTES_PAGE_SIZE);
      setError(null);
      setLoaded(true);
    } catch (cause) {
      if (focused.current && current === request.current) setError(errorMessage(cause));
    } finally {
      if (current === request.current) {
        inFlight.current = false;
        if (focused.current) setLoading(false);
      }
    }
  }, [userId]);

  useFocusEffect(useCallback(() => {
    focused.current = true;
    void fetchNotes();
    const listener = AppState.addEventListener('change', (state) => {
      if (state === 'active') { setLoading(true); void fetchNotes(); }
    });
    return () => { focused.current = false; request.current++; inFlight.current = false; listener.remove(); };
  }, [fetchNotes]));

  function refresh() {
    if (inFlight.current) return;
    setLoading(true);
    setError(null);
    void fetchNotes();
  }

  const openNote = useCallback((id: string) => router.navigate({ pathname: '/note', params: { id } }), []);

  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await unregisterRecallDevice();
      await clearRecallNotifications();
      const { error: signOutError } = await getSupabase().auth.signOut({ scope: 'local' });
      if (signOutError) throw signOutError;
    } catch (cause) {
      if (focused.current) { setError(errorMessage(cause)); setSigningOut(false); }
    }
  }

  return <SafeAreaView style={noteStyles.page}>
    <View style={noteStyles.container}>
      <View style={noteStyles.toolbar}>
        <Text style={noteStyles.brand}>Twinkle</Text>
        <TextAction title={signingOut ? 'Signing out…' : 'Sign out'} disabled={signingOut} onPress={signOut} />
      </View>
      <FlatList data={notes} keyExtractor={(note) => note.id} contentContainerStyle={noteStyles.list}
        renderItem={({ item }) => <NoteCard note={item} onOpen={openNote} />}
        ItemSeparatorComponent={() => <View style={noteStyles.separator} />}
        refreshing={loading && loaded} onRefresh={refresh}
        ListHeaderComponent={<View style={noteStyles.hero}>
          <Text style={noteStyles.eyebrow}>A LITTLE SPACE FOR YOU</Text>
          <Text accessibilityRole="header" style={styles.title}>Your notes</Text>
          <Text style={styles.subtitle}>Thoughts, ideas, and things to keep close.</Text>
          <Action title="+ New note" onPress={() => router.navigate('/note')} disabled={signingOut} />
          <ContextPreferences userId={userId} />
          <FlashbackCard userId={userId} />
          {error ? <View style={noteStyles.banner}>
            <Message text={`Couldn’t refresh your notes. ${error}`} error />
            <TextAction title="Try again" disabled={loading} onPress={refresh} />
          </View> : null}
        </View>}
        ListEmptyComponent={loading ? <View style={noteStyles.state}><ActivityIndicator accessibilityLabel="Loading notes" color="#55458d" /></View>
          : !error ? <View style={noteStyles.state}>
            <Text style={noteStyles.heading}>A thought worth keeping?</Text>
            <Text style={noteStyles.stateText}>Start with a few words. Your notes will be saved here, just for you.</Text>
          </View> : undefined}
        ListFooterComponent={<View style={noteStyles.footer}>
          {notes.length > 0 ? <>
            <Text style={noteStyles.meta}>Most recently edited first</Text>
            {hasMore ? <Action title={loading ? 'Loading…' : 'Load more notes'} secondary disabled={loading || signingOut}
              onPress={() => { if (!inFlight.current) { setLoading(true); void fetchNotes(notes[notes.length - 1]); } }} /> : null}
          </> : null}
          <TextAction title={loading ? 'Refreshing…' : 'Refresh notes'} disabled={loading || signingOut} onPress={refresh} />
        </View>} />
    </View>
  </SafeAreaView>;
}
