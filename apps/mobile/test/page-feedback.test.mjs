import test from 'node:test';
import assert from 'node:assert/strict';
import { createPageFeedback } from '../features/workspace/pageFeedback.ts';

test('feedback belongs to the focused visit and stale work stays silent after returning', () => {
  const feedback = createPageFeedback('');
  feedback.activate('zh');
  const oldVisit = feedback.capture();
  feedback.set('已完成');
  assert.equal(feedback.snapshot(), '已完成');
  feedback.deactivate();
  feedback.set('hidden result');
  assert.equal(feedback.snapshot(), '');
  assert.equal(oldVisit(), false);
  feedback.activate('zh');
  assert.equal(oldVisit(), false);
  assert.equal(feedback.capture()(), true);
});

test('changing language clears translated feedback and invalidates old-language work', () => {
  const feedback = createPageFeedback(null);
  feedback.activate('zh');
  const chineseOperation = feedback.capture();
  feedback.set({ message: '提交失败' });
  feedback.changeLanguage('en');
  assert.equal(feedback.snapshot(), null);
  assert.equal(chineseOperation(), false);
  const englishOperation = feedback.capture();
  feedback.changeLanguage('en');
  assert.equal(englishOperation(), true);
  feedback.set({ message: 'Could not submit' });
  assert.deepEqual(feedback.snapshot(), { message: 'Could not submit' });
});

test('a retained section rejects feedback as soon as it becomes hidden, including before focus cleanup', () => {
  const feedback = createPageFeedback('');
  let visible = true;
  feedback.activate('en');
  const operation = feedback.capture(() => visible);
  assert.equal(operation(), true);
  visible = false;
  assert.equal(operation(), false);
  feedback.deactivate();
  visible = true; feedback.activate('en');
  assert.equal(operation(), false);
  assert.equal(feedback.capture(() => visible)(), true);
});
