module.exports = {
  testEnvironment: "node",
  testMatch: ["**/__tests__/**/*.test.js"],
  collectCoverageFrom: ["main.js", "validateWorkItem.js", "!**/node_modules/**", "!**/dist/**", "!**/dist-validate/**"],
  coverageThreshold: {
    global: {
      branches: 50,
      functions: 50,
      lines: 50,
      statements: 50,
    },
  },
  clearMocks: true,
  resetMocks: true,
  restoreMocks: true,
  testTimeout: 10000,
  // Detect open handles
  detectOpenHandles: true,
  forceExit: true,
  // Ignore dist directories
  modulePathIgnorePatterns: ["<rootDir>/dist/", "<rootDir>/dist-validate/"],
};
