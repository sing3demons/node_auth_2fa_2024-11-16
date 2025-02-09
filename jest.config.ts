/**
 * For a detailed explanation regarding each configuration property, visit:
 * https://jestjs.io/docs/configuration
 */

/** @type {import('jest').Config} */
const config = {
  testEnvironment: 'node',
  transform: {
    '^.+.tsx?$': ['ts-jest', {}],
  },
  preset: 'ts-jest',
  coveragePathIgnorePatterns: ['/node_modules/', 'dist'],
  coverageReporters: ['text', 'lcov', 'clover', 'html'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '/.git/'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
  }
}

module.exports = config