module.exports = {
  testEnvironment: 'node',
  roots: ['<rootDir>/lib/lambda/__tests__'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': 'ts-jest'
  },
  moduleNameMapper: {
    '^@aws-sdk/client-(.+)$': '@aws-sdk/client-$1/dist-cjs/index.js',
  }
};
