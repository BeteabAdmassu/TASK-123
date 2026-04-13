module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts'],
  collectCoverageFrom: ['src/**/*.ts', '!src/migrations/**'],
  coverageDirectory: 'coverage',
  moduleFileExtensions: ['ts', 'js', 'json']
};
