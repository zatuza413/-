import { defineConfig } from 'vitest/config';

export default defineConfig({
  // 相対パスにしておくと、GitHub Pages（/-/ 配下）でもローカルでもそのまま動く
  base: './',
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
