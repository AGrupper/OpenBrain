# OpenBrain PRD: Personal AI Knowledge Vault

## Summary

OpenBrain is a private, cloud-accessible second brain for dumping, reading, organizing, searching,
and connecting personal knowledge. It should feel like a calm daily note-taking workspace with an
Obsidian-like knowledge layer, Apple Notes-style navigation, and stronger AI assistance than a
plain file browser.

The product center is a knowledge vault, not a generic cloud drive. Users should be able to add notes and files, browse them like a deliberate file system, view relationships in a graph, and rely on an AI librarian to suggest summaries, tags, links, folders, and project-relevant actions. The AI suggests; the user approves important structure changes.

## Product Principles

- Deliberate structure over dumping chaos.
- User-owned projects and folders are the main structure.
- Text notes should become Markdown-readable knowledge documents.
- Non-text files should remain originals, with extracted text or metadata added where feasible.
- Private by default: user data should be protected, exportable, deletable, and not unnecessarily exposed.
- Solo first; sharing and collaboration are future concerns.

## Core Requirements

- Manual local file import, Markdown notes, URL import, Notion sync, and Apple Notes export-folder
  sync are core ingestion paths.
- Notes/List mode must let users browse, read, edit Markdown, inspect connected files, and manage
  soft-deleted notes.
- Graph mode must show the Architect understanding layer: one useful wiki digest node per processed
  source by default, not noisy raw file clutter.
- AI suggestions must go through a review workflow before shaping the vault.
- The Architect chat must answer only from retrieved vault context and cite sources, prioritizing
  the current note when opened from the reader.
- Related-file context should be visible while reading.
- Generated wiki digests should be readable, cited, and reversible through history/provenance.
- Export and deletion must be trustworthy enough for daily use.

## AI Behavior

- The AI acts as The Architect of the vault: careful, scoped, and not an unchecked operator.
- Suggestions should explain why a folder, tag, link, summary, or action is useful.
- New files should be connected to projects/folders first, then tags/topics, then specific related files.
- The AI should avoid creating new structure unless there is a clear reason.
- Proactive notifications should wait until suggestion quality is trusted.

## Non-Goals

- Do not build a generic Dropbox or Google Drive clone.
- Do not include folder sync in v1.
- Do not silently reorganize the user's vault.
- Do not prioritize teams, sharing, or collaboration before the personal vault is excellent.
- Do not deeply support every file type from the start.
- Do not overbuild a rich editor before browsing, search, graph, and AI organization are worth using.
- Do not treat generated wiki pages as user-authored notes.
- Do not expose provider or sync secrets in the desktop app.

## Success Criteria

- Files can be added quickly from the local computer.
- The vault can be browsed in a clear folder/list structure.
- A file can be opened, read, and inspected with connected context.
- The graph shows useful digest nodes and source-backed relationships.
- AI suggestions are deliberate, reviewable, and explainable.
- The Architect can answer about the current note with relevant citations.
- The vault can be exported locally with readable originals and a manifest.
- The vault gets easier to search and navigate as more notes, files, URLs, and synced pages are
  added.
