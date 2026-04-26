export type FileStatus = "synced" | "pending_upload" | "pending_download" | "conflict";

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

export interface SyncState {
  last_sync_at: string;
  device_id: string;
  vault_path: string;
}

// API request/response shapes
export interface UploadUrlRequest {
  path: string;
  sha256: string;
  size: number;
  mime: string;
}

export interface UploadUrlResponse {
  upload_url: string;
  file_id: string;
}

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
