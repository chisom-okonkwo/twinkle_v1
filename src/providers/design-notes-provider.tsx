import { createContext, useContext, useRef, useState, type PropsWithChildren } from 'react';

export type DesignNote = {
  id: string;
  title: string;
  body: string;
  date: string;
  kind: 'text' | 'image' | 'audio';
  label?: string;
  photo?: 'books' | 'lake' | 'coffee';
  pinned?: boolean;
  checklist?: { text: string; done: boolean }[];
  audio?: boolean;
  format?: 'body' | 'heading' | 'quote';
  bold?: boolean;
  italic?: boolean;
};
export const photos = {
  books: require('../../assets/design/books.jpg'),
  lake: require('../../assets/design/lake.jpg'),
  coffee: require('../../assets/design/coffee.jpg'),
};
export const sampleNotes: DesignNote[] = [
  { id: 'little-things', title: 'Make room for the little things', body: 'A slow morning. A good book. A conversation that stays with you.\n\nMaybe a full life is just a collection of small moments we remembered to notice.', date: '2026-11-07', kind: 'image', label: 'Personal', photo: 'books', pinned: true },
  { id: 'weekend', title: 'A little reset for the weekend', body: 'Less rushing, more room to breathe.', date: '2026-11-07', kind: 'text', label: 'Life', pinned: true, checklist: [{ text: 'Find a new walking route', done: true }, { text: 'Pick up something to read', done: false }, { text: 'Make a meal from scratch', done: false }] },
  { id: 'voice', title: 'A thought on the way home', body: 'What if I stopped waiting for the perfect moment and just started? A small step is still a step.', date: '2026-11-06', kind: 'audio', audio: true, label: 'Thoughts' },
  { id: 'escape', title: 'Somewhere I want to go', body: 'A cabin by the water. No plans, just a few days of fresh air and a notebook.', date: '2026-11-05', kind: 'image', photo: 'lake', label: 'Someday' },
  { id: 'coffee', title: 'Sunday, slowly', body: 'Coffee with the windows open. Nothing on the agenda until noon. More mornings like this, please.', date: '2026-11-03', kind: 'image', photo: 'coffee', label: 'Personal' },
  { id: 'book', title: 'A line worth keeping', body: 'Pay attention to what you pay attention to.\n\nA reminder to make more space for the things that leave me feeling like myself.', date: '2026-11-02', kind: 'text', label: 'Reading' },
];

type DesignNotesContextValue = {
  notes: DesignNote[];
  save: (note: DesignNote) => void;
  remove: (id: string) => void;
  duplicate: (note: DesignNote) => DesignNote;
  makeId: () => string;
};
const DesignNotesContext = createContext<DesignNotesContextValue | null>(null);
export function DesignNotesProvider({ children }: PropsWithChildren) {
  const [notes, setNotes] = useState(sampleNotes);
  const sequence = useRef(0);
  const makeId = () => `preview-${Date.now()}-${++sequence.current}`;
  function save(note: DesignNote) {
    setNotes(previous => previous.some(item => item.id === note.id)
      ? previous.map(item => item.id === note.id ? note : item) : [note, ...previous]);
  }
  function duplicate(note: DesignNote) {
    const copy = { ...note, id: makeId(), title: `${note.title || 'Untitled'} (copy)`, pinned: false };
    save(copy);
    return copy;
  }
  return <DesignNotesContext.Provider value={{ notes, save, remove: id => setNotes(previous => previous.filter(note => note.id !== id)), duplicate, makeId }}>{children}</DesignNotesContext.Provider>;
}
export function useDesignNotes() {
  const value = useContext(DesignNotesContext);
  if (!value) throw new Error('Design screens require DesignNotesProvider.');
  return value;
}
export function designDate(value: string, full = false) {
  return new Date(`${value}T12:00:00`).toLocaleDateString('en-US', { month: full ? 'long' : 'short', day: 'numeric', ...(full ? { year: 'numeric' } : {}) });
}
// The preview deliberately holds only sample content in memory. No account data or device media is read.
