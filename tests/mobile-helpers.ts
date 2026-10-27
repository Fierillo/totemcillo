import { ZapStore } from '../src/nostr/store';
import { profiles } from '../src/nostr/profiles';

export const hex = (n: number) => n.toString(16).padStart(64, '0');
export const store = () => {
  const s = new ZapStore();
  for (let i = 1; i <= 3; i++) s.addPost({ id: hex(i), pubkey: 'a'.repeat(64), content: `post <i>${i}</i>`, created_at: Math.floor(Date.now() / 1000) - i * 60 });
  s.addZap({ id: 'z', postId: hex(1), sender: 'b'.repeat(64), msats: 21000, comment: 'genial', created_at: Math.floor(Date.now() / 1000) });
  s.setReady();
  profiles.set('a'.repeat(64), null);
  return s;
};
