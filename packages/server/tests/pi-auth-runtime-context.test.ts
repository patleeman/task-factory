import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authCreate: vi.fn(),
  modelRegistryCtor: vi.fn(),
}));

vi.mock('@mariozechner/pi-coding-agent', () => {
  class AuthStorage {
    static create(path: string) {
      return mocks.authCreate(path);
    }
  }

  class ModelRegistry {
    constructor(authStorage: unknown) {
      mocks.modelRegistryCtor(authStorage);
    }

    getAll(): Array<{ provider: string }> {
      return [];
    }
  }

  return {
    AuthStorage,
    ModelRegistry,
  };
});

afterEach(() => {
  vi.resetModules();
  mocks.authCreate.mockReset();
  mocks.modelRegistryCtor.mockReset();
});

describe('createPiAuthRuntimeContext', () => {
  it('uses AuthStorage.create with the task-factory auth path', async () => {
    const fakeAuthStorage = { marker: 'auth-storage' };
    mocks.authCreate.mockReturnValue(fakeAuthStorage);

    const { createPiAuthRuntimeContext } = await import('../src/pi-auth-service.js');
    const context = await createPiAuthRuntimeContext();

    expect(mocks.authCreate).toHaveBeenCalledTimes(1);

    const authPath = mocks.authCreate.mock.calls[0]?.[0];
    expect(typeof authPath).toBe('string');
    expect(authPath).toMatch(/[\\/]\.taskfactory[\\/]agent[\\/]auth\.json$/);

    expect(mocks.modelRegistryCtor).toHaveBeenCalledWith(fakeAuthStorage);
    expect(context.authStorage).toBe(fakeAuthStorage);
  });
});
