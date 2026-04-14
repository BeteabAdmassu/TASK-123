const path = require('path');

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: [path.resolve(__dirname, '..', 'tests', 'backend')],
  testMatch: ['**/*.test.ts'],
  collectCoverageFrom: ['src/**/*.ts', '!src/migrations/**'],
  coverageDirectory: 'coverage',
  moduleFileExtensions: ['ts', 'js', 'json'],
  moduleDirectories: ['node_modules', path.resolve(__dirname, 'node_modules')],
  globals: {
    'ts-jest': {
      tsconfig: path.resolve(__dirname, '..', 'tests', 'tsconfig.test.json')
    }
  }
};
