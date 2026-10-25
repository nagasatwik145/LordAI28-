export type EntityType =
  | "conversation"
  | "message"
  | "memory"
  | "knowledge_chunk"
  | "note"
  | "task"
  | "artifact"
  | "document";

export interface BrainContextOptions {
  userId: string;
  projectId?: string | null;
  query: string;
  maxMemories?: number;
  maxKnowledgeChunks?: number;
  maxRecentChats?: number;
  includePinnedNotes?: boolean;
  includeRecentTasks?: boolean;
  tokenBudget?: number;
}

export interface BrainContextResult {
  systemPromptSnippet: string;
  memories: MemoryContextItem[];
  knowledgeChunks: KnowledgeContextItem[];
  recentChats: ChatContextItem[];
  pinnedNotes: NoteContextItem[];
  recentTasks: TaskContextItem[];
  totalTokens: number;
}

export interface MemoryContextItem {
  id: string;
  content: string;
  category: string;
  source: "auto" | "manual" | "imported";
  importance: number;
  similarity: number;
  pinned: boolean;
}

export interface KnowledgeContextItem {
  id: string;
  content: string;
  summary?: string;
  heading?: string;
  sourceName?: string;
  pageNumber?: number;
  similarity: number;
}

export interface ChatContextItem {
  id: string;
  title: string | null;
  lastMessage: string | null;
  updatedAt: string;
}

export interface NoteContextItem {
  id: string;
  title: string;
  content: string;
  pinned: boolean;
}

export interface TaskContextItem {
  id: string;
  title: string;
  status: string;
  priority: string;
  dueDate?: string;
}

export interface SearchResult {
  id: string;
  entityType: EntityType;
  entityId: string;
  projectId: string | null;
  title: string | null;
  content: string;
  tags: string[];
  similarity: number;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface ProjectNote {
  id: string;
  projectId: string;
  userId: string;
  title: string;
  content: string;
  tags: string[];
  isPinned: boolean;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectTask {
  id: string;
  projectId: string;
  userId: string;
  title: string;
  description?: string;
  status: string;
  priority: string;
  dueDate?: string;
  completedAt?: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeSource {
  id: string;
  projectId: string | null;
  userId: string;
  name: string;
  sourceType: string;
  sourceUrl?: string;
  storagePath?: string;
  contentText?: string;
  mimeType?: string;
  fileSizeBytes: number;
  pageCount?: number;
  wordCount: number;
  language: string;
  processingStatus: string;
  processingError?: string;
  metadata: Record<string, unknown>;
  chunkCount: number;
  isIndexed: boolean;
  lastIndexedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface KnowledgeChunk {
  id: string;
  knowledgeSourceId: string;
  projectId: string | null;
  userId: string;
  chunkIndex: number;
  content: string;
  summary?: string;
  heading?: string;
  section?: string;
  pageNumber?: number;
  tokenCount: number;
  language: string;
  createdAt: string;
}

export interface ActivityItem {
  id: string;
  projectId: string;
  userId: string;
  action: string;
  entityType: string;
  entityId?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}
