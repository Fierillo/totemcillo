export interface NostrEvent {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig?: string;
}

export interface Zap {
  id: string;
  postId: string;
  sender?: string;
  msats: number;
  comment: string;
  created_at: number;
  /** Domain of the recipient's LNURL (the one that signed the receipt). */
  domain?: string;
}

export interface Post {
  id: string;
  pubkey: string;
  content: string;
  created_at: number;
}
