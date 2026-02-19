/**
 * Document System Types
 *
 * Extends the Gateway's knowledge base with persistent documents.
 * Documents are organized by project and injected into personality
 * context when relevant.
 */

export interface Document {
  id: string;
  project: ProjectId;
  filename: string;
  content: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: number;
  tags: string[];
  version: number;
  parentId: string | null;
  metadata: DocumentMetadata;
}

export interface DocumentMetadata {
  author?: string;
  description?: string;
  [key: string]: unknown;
}

export type ProjectId = 'citizenproof' | 'research' | 'gateway' | 'general';

export const VALID_PROJECTS: ProjectId[] = ['citizenproof', 'research', 'gateway', 'general'];

export interface DocumentSummary {
  id: string;
  project: ProjectId;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: number;
  tags: string[];
  version: number;
  description?: string;
}

export interface UploadOptions {
  project: ProjectId;
  tags?: string[];
  description?: string;
  parentId?: string;
}

export const SUPPORTED_MIME_TYPES: Record<string, string> = {
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.html': 'text/html',
  '.htm': 'text/html',
};

export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
