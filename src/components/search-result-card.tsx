import { memo } from 'react';
import { Pressable, Text } from 'react-native';
import type { SearchResult } from '../lib/search';
import { formatNoteDate, noteStyles } from './note-ui';

export const SearchResultCard = memo(function SearchResultCard({ note, onOpen }: {
  note: SearchResult; onOpen: (id: string) => void;
}) {
  return <Pressable onPress={() => onOpen(note.id)} accessibilityRole="button"
    accessibilityLabel={`Open note: ${note.title.slice(0, 100)}`}
    style={({ pressed }) => [noteStyles.card, pressed && noteStyles.cardPressed]}>
    <Text style={noteStyles.noteTitle} numberOfLines={2}>{note.title}</Text>
    <Text style={noteStyles.preview} numberOfLines={4}>
      {note.matched_context ? 'Context: ' : ''}{note.preview}
    </Text>
    <Text style={noteStyles.meta}>
      {note.capture_method === 'image' ? 'Photo · ' : note.capture_method === 'audio' ? 'Audio · ' : ''}
      Edited {formatNoteDate(note.updated_at)}
    </Text>
  </Pressable>;
});
