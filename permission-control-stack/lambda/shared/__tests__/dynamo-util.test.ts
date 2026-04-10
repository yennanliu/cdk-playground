// Mock DynamoDB BEFORE importing the module
const mockSend = jest.fn();

jest.mock('@aws-sdk/client-dynamodb');
jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn(() => ({
      send: mockSend,
    })),
  },
  GetCommand: jest.fn((input) => ({ input })),
  PutCommand: jest.fn((input) => ({ input })),
  QueryCommand: jest.fn((input) => ({ input })),
  DeleteCommand: jest.fn((input) => ({ input })),
}));

import { putItem, getItem, queryByPk, queryByPkSk, deleteItem } from '../dynamo-util';

beforeEach(() => {
  jest.clearAllMocks();
  mockSend.mockClear();
});

describe('dynamo-util', () => {
  describe('putItem', () => {
    it('should send PutCommand with correct parameters', async () => {
      const item = { PK: 'DEPT#eng', SK: 'DEPT#eng', name: 'Engineering' };
      mockSend.mockResolvedValue({});

      await putItem('TestTable', item);

      expect(mockSend).toHaveBeenCalledTimes(1);
      const command = mockSend.mock.calls[0][0];
      expect(command.input.TableName).toBe('TestTable');
      expect(command.input.Item).toEqual(item);
    });
  });

  describe('getItem', () => {
    it('should return item from DynamoDB', async () => {
      const item = { PK: 'DEPT#eng', SK: 'DEPT#eng', name: 'Engineering' };
      mockSend.mockResolvedValue({ Item: item });

      const result = await getItem('TestTable', { PK: 'DEPT#eng', SK: 'DEPT#eng' });

      expect(result).toEqual(item);
      expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('should return undefined if item not found', async () => {
      mockSend.mockResolvedValue({});

      const result = await getItem('TestTable', { PK: 'NONEXISTENT', SK: 'NONEXISTENT' });

      expect(result).toBeUndefined();
    });
  });

  describe('queryByPk', () => {
    it('should query items by partition key', async () => {
      const items = [
        { PK: 'DEPT#eng', SK: 'TEAM#backend', name: 'Backend Team' },
        { PK: 'DEPT#eng', SK: 'TEAM#frontend', name: 'Frontend Team' },
      ];
      mockSend.mockResolvedValue({ Items: items });

      const result = await queryByPk('TestTable', 'DEPT#eng');

      expect(result).toEqual(items);
      expect(mockSend).toHaveBeenCalledTimes(1);
      const command = mockSend.mock.calls[0][0];
      expect(command.input.KeyConditionExpression).toBe('PK = :pk');
    });

    it('should support querying by GSI', async () => {
      const items = [{ phone: '555-1234', name: 'Alice' }];
      mockSend.mockResolvedValue({ Items: items });

      const result = await queryByPk('TestTable', '555-1234', 'phone-index');

      expect(result).toEqual(items);
      const command = mockSend.mock.calls[0][0];
      expect(command.input.IndexName).toBe('phone-index');
    });

    it('should return empty array if no items found', async () => {
      mockSend.mockResolvedValue({});

      const result = await queryByPk('TestTable', 'NONEXISTENT');

      expect(result).toEqual([]);
    });
  });

  describe('queryByPkSk', () => {
    it('should query items by PK and SK prefix', async () => {
      const items = [
        { PK: 'DEPT#eng', SK: 'TEAM#backend', name: 'Backend' },
        { PK: 'DEPT#eng', SK: 'TEAM#frontend', name: 'Frontend' },
      ];
      mockSend.mockResolvedValue({ Items: items });

      const result = await queryByPkSk('TestTable', 'DEPT#eng', 'TEAM#');

      expect(result).toEqual(items);
      const command = mockSend.mock.calls[0][0];
      expect(command.input.KeyConditionExpression).toContain('begins_with(SK, :sk)');
    });

    it('should return empty array if no items match', async () => {
      mockSend.mockResolvedValue({});

      const result = await queryByPkSk('TestTable', 'DEPT#eng', 'TEAM#');

      expect(result).toEqual([]);
    });
  });

  describe('deleteItem', () => {
    it('should send DeleteCommand with correct key', async () => {
      mockSend.mockResolvedValue({});

      await deleteItem('TestTable', { PK: 'DEPT#eng', SK: 'TEAM#backend' });

      expect(mockSend).toHaveBeenCalledTimes(1);
      const command = mockSend.mock.calls[0][0];
      expect(command.input.TableName).toBe('TestTable');
      expect(command.input.Key).toEqual({ PK: 'DEPT#eng', SK: 'TEAM#backend' });
    });
  });
});
