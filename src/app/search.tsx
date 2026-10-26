import { router, useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, AppState, FlatList, KeyboardAvoidingView, Platform, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { noteStyles, TextAction } from '../components/note-ui';
import { SearchResultCard } from '../components/search-result-card';
import { Action, Message, styles } from '../components/ui';
import { MAX_SEARCH_LENGTH, MAX_SEARCH_RESULTS, normalizeSearch, searchNotes, type SearchResult } from '../lib/search';
import { useAuth } from '../providers/auth-provider';

export default function SearchRoute() {
  const { session } = useAuth();
  return session ? <SearchNotes key={session.user.id} /> : null;
}

function SearchNotes() {
  const [text, setText] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);
  const focused = useRef(false);
  const currentText = useRef('');
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const busy = useRef(false);
  const nextOffset = useRef(0);

  const cancel = useCallback(() => {
    generation.current++;
    controller.current?.abort();
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    busy.current = false;
  }, []);

  const run = useCallback(async (query: string, offset = 0) => {
    cancel();
    const request = generation.current;
    if (!query) {
      nextOffset.current = 0;
      setResults([]); setHasMore(false); setFinished(false); setLoading(false); setError(null);
      return;
    }
    const abort = new AbortController();
    controller.current = abort;
    busy.current = true;
    setLoading(true); setError(null);
    try {
      const page = await searchNotes(query, offset, abort.signal);
      if (!focused.current || request !== generation.current) return;
      setResults((previous) => offset
        ? [...previous, ...page.results.filter((note) => !previous.some((item) => item.id === note.id))]
        : page.results);
      setHasMore(page.hasMore); setFinished(true);
      nextOffset.current = page.nextOffset;
    } catch {
      if (focused.current && request === generation.current) {
        setError('Couldn’t search your notes. Check your connection and try again.');
        setFinished(true);
      }
    } finally {
      if (focused.current && request === generation.current) { busy.current = false; setLoading(false); }
    }
  }, [cancel]);

  useFocusEffect(useCallback(() => {
    focused.current = true;
    void run(normalizeSearch(currentText.current));
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void run(normalizeSearch(currentText.current));
    });
    return () => { focused.current = false; cancel(); subscription.remove(); };
  }, [run, cancel]));

  function change(value: string) {
    currentText.current = value;
    nextOffset.current = 0;
    setText(value); cancel();
    setResults([]); setHasMore(false); setError(null); setFinished(false);
    const query = normalizeSearch(value);
    setLoading(Boolean(query));
    if (query) timer.current = setTimeout(() => void run(query), 350);
  }
  const open = useCallback((id: string) => router.navigate({ pathname: '/note', params: { id } }), []);
  const query = normalizeSearch(text);

  return <SafeAreaView style={noteStyles.page}>
    <KeyboardAvoidingView style={noteStyles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <View style={{ padding: 20, gap: 12 }}>
        <TextAction title="‹ Notes" onPress={() => router.back()} />
        <Text accessibilityRole="header" style={styles.title}>Find a thought</Text>
        <TextInput testID="note-search-input" accessibilityLabel="Search your notes" placeholder="Search your notes"
          placeholderTextColor="#6d637f" value={text} onChangeText={change}
          maxLength={MAX_SEARCH_LENGTH} autoFocus autoCorrect={false} autoCapitalize="none"
          returnKeyType="search" onSubmitEditing={() => void run(normalizeSearch(currentText.current))}
          style={styles.input} />
        {text ? <TextAction title="Clear search" onPress={() => change('')} /> : null}
        <Message text={error} error />
        {error ? <TextAction title="Try again" onPress={() => void run(query)} /> : null}
      </View>
      <FlatList data={results} keyExtractor={(note) => note.id} keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag" contentContainerStyle={noteStyles.list}
        renderItem={({ item }) => <SearchResultCard note={item} onOpen={open} />}
        ItemSeparatorComponent={() => <View style={noteStyles.separator} />}
        ListHeaderComponent={results.length ? <Text style={[noteStyles.meta, { marginBottom: 12 }]}>Closest matches first</Text> : undefined}
        ListEmptyComponent={<View style={noteStyles.state}>
          {loading ? <ActivityIndicator accessibilityLabel="Searching notes" color="#55458d" />
            : !query ? <Text style={noteStyles.stateText}>A word, a phrase, or a detail you remember.</Text>
              : finished && !error ? <>
                <Text style={noteStyles.heading}>No matching notes</Text>
                <Text style={noteStyles.stateText}>Try another word or a little less detail.</Text>
              </> : null}
        </View>}
        ListFooterComponent={results.length ? <View style={noteStyles.footer}>
          {hasMore ? <Action title={loading ? 'Searching…' : 'More matches'} secondary disabled={loading}
            onPress={() => { if (!busy.current) void run(query, nextOffset.current); }} /> : null}
          {results.length >= MAX_SEARCH_RESULTS ? <Text style={noteStyles.stateText}>Add another word to narrow these matches.</Text> : null}
        </View> : undefined} />
    </KeyboardAvoidingView>
  </SafeAreaView>;
}
