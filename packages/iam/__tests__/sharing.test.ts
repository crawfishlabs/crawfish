import { IAMService } from '../src/iam-service';

// ---------------------------------------------------------------------------
// Mocks (simplified)
// ---------------------------------------------------------------------------

const invitationStore: Record<string, any> = {};
const sharedAccessStore: Record<string, any> = {};

const mockDocRef = (store: Record<string, any>, id?: string) => ({
  get: jest.fn().mockImplementation(async () => {
    const data = id ? store[id] : undefined;
    return { exists: !!data, data: () => data };
  }),
  set: jest.fn().mockImplementation(async (data: any) => {
    if (id) store[id] = data;
  }),
  update: jest.fn().mockImplementation(async (updates: any) => {
    if (id && store[id]) Object.assign(store[id], updates);
  }),
  delete: jest.fn().mockImplementation(async () => {
    if (id) delete store[id];
  }),
  listCollections: jest.fn().mockResolvedValue([]),
});

const mockFirestore = {
  collection: jest.fn().mockImplementation((name: string) => ({
    doc: jest.fn().mockImplementation((id: string) => {
      const store = name === 'invitations' ? invitationStore : sharedAccessStore;
      return mockDocRef(store, id);
    }),
    where: jest.fn().mockReturnValue({
      get: jest.fn().mockResolvedValue({ docs: [], forEach: jest.fn() }),
      where: jest.fn().mockReturnValue({
        get: jest.fn().mockResolvedValue({ docs: [], forEach: jest.fn() }),
      }),
    }),
  })),
  doc: jest.fn().mockReturnValue(mockDocRef({})),
  batch: jest.fn().mockReturnValue({
    set: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    commit: jest.fn().mockResolvedValue(undefined),
  }),
};

const mockApp = {
  firestore: () => mockFirestore,
  auth: () => ({ createUser: jest.fn(), verifyIdToken: jest.fn(), deleteUser: jest.fn() }),
  storage: () => ({ bucket: () => ({ file: jest.fn() }) }),
} as any;

let service: IAMService;

beforeEach(() => {
  jest.clearAllMocks();
  Object.keys(invitationStore).forEach((k) => delete invitationStore[k]);
  Object.keys(sharedAccessStore).forEach((k) => delete sharedAccessStore[k]);
  service = new IAMService({ firebaseApp: mockApp, crossAppSecret: 'secret' });
});

describe('Sharing', () => {
  describe('shareResource', () => {
    it('creates an invitation', async () => {
      const inv = await service.shareResource(
        'owner-1', 'friend@example.com', 'budget', 'budget-1', 'editor', 'budget',
      );

      expect(inv.id).toBeDefined();
      expect(inv.fromUid).toBe('owner-1');
      expect(inv.toEmail).toBe('friend@example.com');
      expect(inv.status).toBe('pending');
      expect(inv.appId).toBe('budget');
    });
  });

  describe('acceptInvitation', () => {
    it('accepts a pending invitation', async () => {
      // Pre-populate
      const invId = 'inv-1';
      invitationStore[invId] = {
        id: invId,
        fromUid: 'owner-1',
        toEmail: 'friend@example.com',
        resourceType: 'budget',
        resourceId: 'budget-1',
        role: 'editor',
        appId: 'budget',
        status: 'pending',
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 86400000),
      };

      const access = await service.acceptInvitation(invId, 'friend-uid');

      expect(access.sharedWithUid).toBe('friend-uid');
      expect(access.ownerUid).toBe('owner-1');
      expect(access.role).toBe('editor');
    });

    it('rejects already-accepted invitation', async () => {
      invitationStore['inv-2'] = {
        id: 'inv-2',
        status: 'accepted',
        expiresAt: new Date(Date.now() + 86400000),
      };

      await expect(service.acceptInvitation('inv-2', 'uid')).rejects.toThrow('accepted');
    });
  });

  describe('revokeAccess', () => {
    it('allows owner to revoke', async () => {
      sharedAccessStore['sa-1'] = {
        id: 'sa-1',
        ownerUid: 'owner-1',
        sharedWithUid: 'friend-1',
      };

      // This calls through the mock; just verify no throw
      await expect(service.revokeAccess('sa-1', 'owner-1')).resolves.not.toThrow();
    });

    it('denies revocation by unrelated user', async () => {
      sharedAccessStore['sa-2'] = {
        id: 'sa-2',
        ownerUid: 'owner-1',
        sharedWithUid: 'friend-1',
      };

      await expect(service.revokeAccess('sa-2', 'stranger')).rejects.toThrow('Permission denied');
    });
  });
});
