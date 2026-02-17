/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts'],
  transform: {},
  // Node 22+ can handle TS natively with --experimental-strip-types
  // We compile first with tsc, then test the dist
};
