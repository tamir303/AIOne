module.exports = {
  // Stops ESLint's config cascade at this directory. Without this, ESLint
  // walks up past a worktree checked out under .claude/worktrees/<name>
  // (a normal part of this repo's dev-swarm workflow — see
  // .claude/skills/dev-swarm) and picks up the outer checkout's own
  // .eslintrc.js too, which fails with "couldn't determine the plugin
  // '@typescript-eslint' uniquely" because each checkout has its own
  // node_modules copy of the plugin.
  root: true,
  parser: '@typescript-eslint/parser',
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
  ],
  plugins: ['@typescript-eslint'],
  env: {
    node: true,
    es2022: true,
  },
  rules: {
    '@typescript-eslint/no-explicit-any': 'warn',
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
  },
};
