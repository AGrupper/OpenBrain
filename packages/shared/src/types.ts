export type FileStatus = "stored" | "pending_upload" | "processing" | "error";
export type FileSourceType = "file" | "webpage" | "pdf" | "youtube" | "notion" | "apple_notes";
export type FileExtractionStatus = "stored" | "extracted" | "no_text" | "failed";
export type ArchitectJobStatus = "pending" | "processing" | "suggestions_created" | "failed";
export type ArchitectSuggestionStatus = "pending" | "approved" | "rejected";
export type ArchitectSuggestionType = "summary" | "tags" | "folder" | "link" | "action" | "cleanup";
export type WikiNodeStatus = "draft" | "published" | "archived";
export type WikiNodeKind =
  | "source"
  | "topic"
  | "person"
  | "project"
  | "area"
  | "resource"
  | "claim"
  | "question"
  | "synthesis"
  | "contradiction";
export type WikiEdgeType =
  | "derived_from"
  | "supports"
  | "contradicts"
  | "mentions"
  | "summarizes"
  | "related_to"
  | "part_of"
  | "answers";

export interface VaultFile {
  id: string;
  path: string;
  size: number;
  sha256: string;
  mime: string;
  updated_at: string;
  status?: FileStatus;
  tags?: string[];
  folder?: string;
  summary?: string | null;
  text_content?: string | null;
  source_type?: FileSourceType;
  source_url?: string | null;
  extraction_status?: FileExtractionStatus;
  extraction_error?: string | null;
  deleted_at?: string | null;
  deleted_reason?: string | null;
  needs_embedding?: boolean;
  needs_linking?: boolean;
  needs_tagging?: boolean;
  needs_wiki?: boolean;
}

export type SyncSourceType = "notion" | "apple_notes";
export type SyncSourceStatus = "active" | "paused" | "error";
export type SyncItemStatus = "synced" | "skipped" | "failed";

export interface SyncSource {
  id: string;
  type: SyncSourceType;
  name: string;
  config: Record<string, unknown>;
  status: SyncSourceStatus;
  last_synced_at?: string | null;
  last_error?: string | null;
  created_at: string;
  updated_at: string;
}

export interface SyncItem {
  id: string;
  source_id: string;
  external_id: string;
  file_id?: string | null;
  external_url?: string | null;
  content_hash?: string | null;
  status: SyncItemStatus;
  metadata: Record<string, unknown>;
  last_seen_at: string;
  last_synced_at?: string | null;
  last_error?: string | null;
  created_at: string;
  updated_at: string;
}

export interface SyncFailure {
  external_id: string;
  error: string;
}

export interface SyncSummary {
  imported: number;
  skipped: number;
  failed: number;
  failures?: SyncFailure[];
}

export interface VaultFolder {
  path: string;
  name: string;
  parent_path?: string | null;
  created_at: string;
  updated_at: string;
}

export interface FileEmbedding {
  file_id: string;
  embedding: number[];
  text_preview: string;
  embedded_at: string;
}

export interface Link {
  id: string;
  file_a_id: string;
  file_b_id: string;
  confidence: number;
  reason: string;
  status: "pending" | "approved" | "rejected" | "auto_approved";
  created_at: string;
}

export interface LinkProposal {
  file_a: VaultFile;
  file_b: VaultFile;
  confidence: number;
  reason: string;
}

export interface ArchitectJob {
  id: string;
  file_id: string;
  status: ArchitectJobStatus;
  error?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ArchitectSuggestion {
  id: string;
  file_id?: string | null;
  type: ArchitectSuggestionType;
  title: string;
  reason: string;
  payload: Record<string, unknown>;
  confidence?: number | null;
  status: ArchitectSuggestionStatus;
  created_at: string;
  updated_at: string;
}

export interface ArchitectChatSource {
  file_id: string;
  path: string;
  snippet: string;
  score?: number;
  source_kind?: "file" | "wiki";
  evidence_scope?: "current_file" | "current_folder" | "wiki_digest" | "vault_file";
  title?: string;
  wiki_node_id?: string | null;
  wiki_node_kind?: WikiNodeKind;
}

export interface ArchitectChatContext {
  current_file_id?: string;
  current_path?: string;
  current_folder?: string | null;
  surface?: "reader" | "chat";
}

export interface ArchitectChatMessage {
  id?: string;
  session_id: string;
  role: "user" | "architect";
  content: string;
  sources?: ArchitectChatSource[];
  created_at?: string;
}

export interface ArchitectChatResponse {
  session_id: string;
  answer: string;
  sources: ArchitectChatSource[];
}

export interface SourceChunk {
  id: string;
  file_id: string;
  source_sha256: string;
  chunk_index: number;
  content: string;
  char_start: number;
  char_end: number;
  created_at: string;
}

export interface WikiNode {
  id: string;
  kind: WikiNodeKind;
  title: string;
  slug: string;
  status: WikiNodeStatus;
  summary?: string | null;
  source_file_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface WikiPage {
  id: string;
  node_id: string;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
}

export interface WikiRevision {
  id: string;
  page_id: string;
  source_file_id?: string | null;
  revision_number: number;
  title: string;
  content: string;
  reason: string;
  created_at: string;
}

export interface WikiEdge {
  id: string;
  source_node_id: string;
  target_node_id: string;
  type: WikiEdgeType;
  status: WikiNodeStatus;
  confidence?: number | null;
  reason?: string | null;
  source_file_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface WikiCitation {
  id: string;
  node_id?: string | null;
  revision_id?: string | null;
  chunk_id: string;
  quote?: string | null;
  created_at: string;
  chunk?: SourceChunk;
}

export interface WikiGraphResponse {
  nodes: WikiNode[];
  edges: WikiEdge[];
}

export interface WikiNodeDetailResponse {
  node: WikiNode;
  page: WikiPage | null;
  citations: WikiCitation[];
  backlinks: WikiEdge[];
  outgoing: WikiEdge[];
  revisions: WikiRevision[];
}

export interface SearchResult {
  file: VaultFile;
  score: number;
  snippet: string;
  result_kind?: "file" | "wiki";
  title?: string;
  wiki_node_id?: string | null;
  wiki_node_kind?: WikiNodeKind;
}

export interface Correction {
  id: string;
  file_id: string;
  field: "folder" | "tags";
  old_value: string;
  new_value: string;
  created_at: string;
}

// API request/response shapes
export interface SearchRequest {
  query: string;
  limit?: number;
}

export interface SearchResponse {
  results: SearchResult[];
  total: number;
}

export interface TelegramApprovalPayload {
  link_id: string;
  file_a_title: string;
  file_b_title: string;
  reason: string;
  confidence: number;
}
