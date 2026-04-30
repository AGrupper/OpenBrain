# OpenBrain PRD: Personal AI Knowledge Vault

## Summary

OpenBrain is a private, cloud-accessible second brain for dumping, reading, organizing, searching, and connecting personal knowledge. It should feel similar to Obsidian in its folder/list and graph mental model, but with stronger AI assistance and without relying on Obsidian sync or storage constraints.

The product center is a knowledge vault, not a generic cloud drive. Users should be able to add notes and files, browse them like a deliberate file system, view relationships in a graph, and rely on an AI librarian to suggest summaries, tags, links, folders, and project-relevant actions. The AI suggests; the user approves important structure changes.

## Product Principles

- Deliberate structure over dumping chaos.
- User-owned projects and folders are the main structure.
- Text notes should become Markdown-readable knowledge documents.
- Non-text files should remain originals, with extracted text or metadata added where feasible.
- Private by default: user data should be protected, exportable, deletable, and not unnecessarily exposed.
- Solo first; sharing and collaboration are future concerns.

## Core Requirements

- Manual local file import must work without starting folder sync.
- Folder/List mode must let users browse, read, and inspect connected files.
- Graph mode must show meaningful approved connections, not noisy speculative links.
- AI suggestions must go through a review workflow before shaping the vault.
- Related-file context should be visible while reading.
- Editing Markdown notes and page comments are future workspace capabilities, not the first priority.
- Notion, Apple Notes, and other connectors are long-term goals after the vault experience is useful.

## AI Behavior

- The AI acts as a careful librarian, not an unchecked operator.
- Suggestions should explain why a folder, tag, link, summary, or action is useful.
- New files should be connected to projects/folders first, then tags/topics, then specific related files.
- The AI should avoid creating new structure unless there is a clear reason.
- Proactive notifications should wait until suggestion quality is trusted.

## Non-Goals

- Do not build a generic Dropbox or Google Drive clone.
- Do not make sync the only way to add files.
- Do not silently reorganize the user's vault.
- Do not prioritize teams, sharing, or collaboration before the personal vault is excellent.
- Do not deeply support every file type from the start.
- Do not overbuild a rich editor before browsing, search, graph, and AI organization are worth using.

## Success Criteria

- Files can be added quickly from the local computer.
- The vault can be browsed in a clear folder/list structure.
- A file can be opened, read, and inspected with connected context.
- The graph shows meaningful approved relationships.
- AI suggestions are deliberate, reviewable, and explainable.
- The vault gets easier to search and navigate as more files are added.
