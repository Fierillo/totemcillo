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
  id: string;          // id del receipt 9735
  postId: string;      // evento zapeado ('e' tag)
  sender?: string;     // pubkey del que zapea (de la zap request)
  msats: number;
  comment: string;
  created_at: number;
}

export interface Post {
  id: string;
  pubkey: string;
  content: string;
  created_at: number;
}
