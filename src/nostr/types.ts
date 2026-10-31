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
  /** Paid invoice (receipt `bolt11` tag): matches the receipt to the invoice shown in the zap modal. */
  bolt11?: string;
}

export interface Post {
  id: string;
  pubkey: string;
  content: string;
  created_at: number;
  /** NIP-92 imeta images (validated again when shown). */
  images?: { url: string; alt?: string }[];
}
