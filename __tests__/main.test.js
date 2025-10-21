/**
 * Tests for main.js Azure DevOps Work Item Linker
 *
 * These are basic smoke tests. Full integration testing requires actual
 * Azure DevOps and GitHub credentials which are not available in the test environment.
 */

describe('Azure DevOps Work Item Linker', () => {
  describe('Basic module loading', () => {
    it('should load the module without errors', async () => {
      // Just verify the module can be imported
      const mainModule = await import('../src/main.js');
      expect(mainModule).toBeDefined();
      expect(mainModule.run).toBeDefined();
      expect(typeof mainModule.run).toBe('function');
    });
  });

  describe('Environment variable handling', () => {
    let originalEnv;

    beforeEach(() => {
      originalEnv = { ...process.env };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should have access to environment variables', () => {
      process.env.TEST_VAR = 'test-value';
      expect(process.env.TEST_VAR).toBe('test-value');
    });
  });
});
