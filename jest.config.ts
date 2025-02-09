/**
 * For a detailed explanation regarding each configuration property, visit:
 * https://jestjs.io/docs/configuration
 */

import type { Config } from 'jest'

const config: Config = {
  transform: {
    '^.+\\.ts$': ['ts-jest', { useESM: true }],
  },
  moduleFileExtensions: ['ts', 'js', 'json', 'node'],
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'], // .js is inferred by package.json "type": "module"
  globals: {
    'ts-jest': {
      useESM: true, // Enable ESM support for ts-jest
    },
  },
  // Ensure that Jest can resolve ES modules correctly
  moduleNameMapper: {
    '^src/(.*)$': '<rootDir>/src/$1',
    '^db/(.*)$': '<rootDir>/dist/db/$1', // Ensure this is correct based on your directory structure
  },
}

export default config
