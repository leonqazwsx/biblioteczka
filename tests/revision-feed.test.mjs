import test from 'node:test';
import assert from 'node:assert/strict';
import { createRevisionFeed } from '../public/manager/revision-feed.mjs';
test('accepted local response satisfies its SSE notification without fetching full state again', () => {
  let state = { revision: 1 },
    refreshes = 0;
  const feed = createRevisionFeed({ getState: () => state, onRefresh: () => refreshes++ }),
    ticket = feed.start();
  feed.receive(2);
  assert.equal(refreshes, 0);
  state = { revision: 2 };
  feed.finish(ticket);
  assert.equal(refreshes, 0);
  feed.receive(2);
  assert.equal(refreshes, 0);
});
test('a newer external revision waits for local writes then refreshes exactly once', () => {
  let state = { revision: 1 },
    refreshes = 0;
  const feed = createRevisionFeed({ getState: () => state, onRefresh: () => refreshes++ }),
    first = feed.start(),
    second = feed.start();
  feed.receive(3);
  feed.receive(4);
  state = { revision: 2 };
  feed.finish(first);
  assert.equal(refreshes, 0);
  feed.finish(second);
  assert.equal(refreshes, 1);
});
test('session change invalidates pending responses and clears old revision notifications', () => {
  let state = { revision: 4 },
    refreshes = 0;
  const feed = createRevisionFeed({ getState: () => state, onRefresh: () => refreshes++ }),
    ticket = feed.start();
  feed.receive(6);
  feed.sessionChanged();
  state = { revision: 1 };
  assert.equal(feed.isCurrent(ticket), false);
  feed.finish(ticket);
  assert.equal(refreshes, 0);
  feed.receive(2);
  assert.equal(refreshes, 1);
  feed.receive(0);
  assert.equal(refreshes, 1);
});
