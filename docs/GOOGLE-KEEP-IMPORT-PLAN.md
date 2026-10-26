# Google Keep import scope

The media-in-notes feature was completed and pushed first in `8f70548`. The original archive-based import proposal was recorded in `c2b944c`.

The user subsequently narrowed the implementation to **15–20 selected Google Keep JSON/HTML files within the existing Import notes screen**. That scope supersedes the original ZIP proposal. See [the import guide](IMPORT.md) for implementation, migration, limits and Android verification.

The delivered extension uses **Choose files → Review → Confirm → Results**. JSON preserves original dates and supplies the canonical note when its paired HTML is selected. HTML-only notes use safe, inert text extraction. Unsupported attachments are explicitly flagged. It reuses the unified notes table, exact-content duplicate detection, search, ownership policies and deferred AI consent behavior.

ZIP ingestion, incoming-share receivers, Google account integration and synchronization remain unimplemented and are not authorized by this file. FR-19 and later requirements remain out of scope.
