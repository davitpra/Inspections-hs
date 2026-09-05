## Context

See `proposal.md` for motivation. Action reads expose immutable evidence metadata and object keys,
but the S3-compatible bucket is private and the API currently signs only uploads. The lifecycle UI
supports repeated verification passes and multiple actions, so accepted evidence must be selected
from each action's event order rather than from the finding state alone.

This change reads existing immutable tables but does not alter them or add a migration. ADR-002 and
ADR-004 continue to govern their immutability and RLS. Object access follows ADR-006.

## Goals / Non-Goals

**Goals:**

- Authorize every evidence read through the evidence row under the HTTP session's database scope.
- Show only evidence from the completion declaration immediately preceding a closure.
- Keep temporary object URLs out of persisted action data and query caches longer than necessary.

**Non-Goals:**

- Showing finding intake photographs or evidence from rejected passes in Closed.
- Adding, replacing, or deleting evidence after its event was recorded.
- Making the bucket or object prefixes public.

## Decisions

### D1: Sign reads by evidence id

The client sends an evidence `id`, never an `object_key`. The upload module reads the evidence row
inside `DbService.withSessionClient`; RLS determines visibility and the returned row supplies the
only key that may be signed. This avoids treating a prefix comparison in the endpoint as
authorization.

Alternative: place the key directly in an image URL. Rejected because the bucket is private and a
key is not authorization.

### D2: Return short-lived presigned GET URLs

`ObjectStorageService` signs `GetObjectCommand` with the same configured TTL used for uploads. The
application credential gains `GetObject` and retains no `DeleteObject`. The API never proxies image
bytes.

Alternative: stream bytes through NestJS. Rejected because it adds API bandwidth and duplicates
object-storage delivery without improving authorization.

### D3: Pair closure with the nearest preceding completion declaration

For each `closed` event, the UI walks backward in `position` order to the nearest
`to_state: awaiting_verification` event. A send-back necessarily ends the earlier pass, so this
pairing selects the accepted declaration and excludes rejected evidence without another state
machine or server field.

### D4: Load each photograph independently

Each image owns a TanStack query keyed by evidence id. A failed or expired URL affects one tile and
can be retried without hiding the action record. URLs are rendered only in Closed; Verification
keeps its compact evidence counts.

The gallery is a comparison rather than a fluid image grid: Before and After occupy two equal
columns, while each column keeps bounded 4:3 thumbnails instead of stretching a single photograph
to the record width. Narrow screens stack the two groups. Every loaded thumbnail links to its
signed object URL so the reader can inspect the full photograph without making the lifecycle card
itself oversized.

## Risks / Trade-offs

- [Many photographs produce one signing request each] → Evidence is capped per transition and
  queries are cached for less than the signature TTL.
- [A signed URL can expire while the page remains open] → Configure query staleness below the TTL
  and provide a per-image retry state.
- [The browser test environment does not load bucket images] → Assert generated `img` sources and
  accessible labels without fetching their bytes.

## Migration Plan

Deploy the object-storage policy with `GetObject` before the API and web changes. Rollback removes
the UI and signing route first; the additional read-only bucket permission can then be removed.
