import { defineConfig } from 'vitest/config';

export default defineConfig({
    define: {
        // Unit tests that exercise the deterministic harness still require the
        // per-route ?harness=1 carrier; deployed Vite processes do not receive
        // this compile-time-only test flag.
        'import.meta.env.VITE_VIEWER_HARNESS': JSON.stringify('1'),
    },
    test: {
        environment: 'jsdom',
        globals: true,
        include: ['src/**/*.{test,spec}.{ts,tsx}', 'e2e/support/**/*.test.ts'],
    },
});
