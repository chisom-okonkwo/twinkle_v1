# Twinkle screen preview

A screen-first direction based on the three reference image files supplied on November 7, 2026.

Open `/preview` in the Expo app, or choose **Explore the new design** from the existing notes home or sign-in screen. For the running local web preview, visit [Twinkle preview](http://localhost:8082/preview). To start it again at this address, run `npm run web -- --port 8082`.

The preview uses sample notes held in memory. Reloading resets them. It does not read or write account notes, request media permissions, record sound, or run discovery services. Calendar opens to November 2026 so its example dates match the sample notes. The original application routes and backend remain available.

## Screens and flow

| Screen | Route | What to try |
| --- | --- | --- |
| Home | `/preview` | Search, switch between grid and list, filter note types, open a card, pin, copy, or remove a sample note. |
| Add menu | Home, Calendar, or Vibe → + | Choose Text, Capture, or Audio. |
| Editor | `/preview/editor` | Type a title and body, add sample media, add and tick checklist items, change text style, or open the options sheet. The check and back buttons save to the preview session. |
| Calendar | `/preview/calendar` | Change months, choose a day, open its notes, or create a note on an empty day. |
| Vibe | `/preview/vibe` | Revisit a sample note or shuffle to another one. This demonstrates the proposed discovery screen. |
| Capture | `/preview/capture?mode=image` | Continue with a sample photo into the editor. |
| Audio | `/preview/capture?mode=audio` | Try the recording timer and waveform, then continue with sample audio. Playback in the editor is a silent waveform demonstration. |

## Reference choices

- Home carries over the two uneven card columns, image thumbnails, short previews, pin markers, labels, dates, and per-note menus.
- The editor uses white, borderless text fields, small metadata, inline media, checklist rows, a bottom toolbar, and a rounded options sheet.
- The floating navigation contains Home, Calendar, and Vibe, with a separate adjacent plus button. The plus menu has exactly Text, Capture, and Audio.
- Charcoal, white, and a small pale green accent form this preview's visual direction. Labels stay optional.

View the [screenshot gallery](gallery.html) or [overview](overview.png). The editor screenshots include sample audio added through the toolbar to demonstrate mixed note types.

## Verification

- Expo lint and TypeScript checks passed.
- Existing suite: 128 passed, 5 live-service tests skipped, 0 failed.
- Browser review at 320 × 740, 393 × 852, and 1280 × 900.
- Checked text creation and save, search, grid/list switching, checklist state, capture-to-editor flows, calendar empty states, Vibe shuffle, and the editor's options and formatting sheets.
- No browser warnings or errors observed in the final review.
- A native simulator/device build was not run. The preview uses React Native components and existing dependencies only.

Implementation lives in `src/app/preview`, `src/components/design`, and `src/providers/design-notes-provider.tsx`.
