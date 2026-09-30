// Last-write-wins acceptance for chat-sync pushes. `clientStamp` and
// `serverStamp` share the client clock domain (stored row.clientStamp);
// `responseStamp` is the server-clock committed cursor — it must NEVER be
// compared against client stamps as authority, only as a cheap 'already
// echoed' short-circuit:
//
//   - strictly older than the stored row's stamp  → reject (loses LWW)
//   - no stored row / stamp beats the stored row  → accept unconditionally
//     (a slow-clock client's stamp can legitimately sit below the server
//     cursor; rejecting it leaves the entity syncDirty forever — divergence)
//   - equal stamps                                → accept only past the
//     cursor, i.e. skip redundant rewrites the server already holds
export function acceptClientEntityStamp(
  clientStamp: number,
  responseStamp: number,
  serverStamp: number | null | undefined,
) {
  if (serverStamp != null && clientStamp < serverStamp) return false;
  if (serverStamp == null || clientStamp > serverStamp) return true;
  return clientStamp > responseStamp;
}
