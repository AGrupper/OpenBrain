export type FileStatus = "stored" | "pending_upload" | "processing" | "error";
export type ArchitectJobStatus = "pending" | "processing" | "suggestions_created" | "failed";
export type ArchitectSuggestionStatus = "pending" | "approved" | "rejected";
export type ArchitectSuggestionType = "summary" | "tags" | "folder" | "link" | "action" | "cleanup";

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

export interface SearchResult {
  file: VaultFile;
  score: number;
  snippet: string;
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
