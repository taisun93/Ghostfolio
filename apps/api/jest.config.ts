/* eslint-disable */
export default {
  displayName: 'api',
  maxWorkers: 2,

  globals: {},
  setupFiles: ['<rootDir>/src/test-setup.ts'],
  transform: {
    '^.+\\.[tj]s$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.spec.json'
      }
    ]
  },
  moduleFileExtensions: ['ts', 'js', 'html'],
  coverageDirectory: '../../coverage/apps/api',
  testEnvironment: 'node',
  preset: '../../jest.preset.js'
};
