import { shouldRetryPoll } from './pollHelpers';

describe('shouldRetryPoll', () => {
    it('returns true when retryCount is below max', () => {
        expect(shouldRetryPoll(35, 36)).toBe(true);
    });

    it('returns false when retryCount reaches max', () => {
        expect(shouldRetryPoll(36, 36)).toBe(false);
    });
});
