import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  DeleteCommand,
  ScanCommand,
} from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({});
const ddb = DynamoDBDocumentClient.from(client);

export async function putItem(table: string, item: Record<string, unknown>) {
  await ddb.send(new PutCommand({ TableName: table, Item: item }));
}

export async function getItem(table: string, key: Record<string, string>) {
  const res = await ddb.send(new GetCommand({ TableName: table, Key: key }));
  return res.Item;
}

export async function queryByPk(table: string, pk: string, indexName?: string, keyName: string = 'PK') {
  const res = await ddb.send(
    new QueryCommand({
      TableName: table,
      IndexName: indexName,
      KeyConditionExpression: `#key = :pk`,
      ExpressionAttributeNames: { '#key': keyName },
      ExpressionAttributeValues: { ':pk': pk },
    })
  );
  return res.Items ?? [];
}

export async function queryByPkSk(table: string, pk: string, skPrefix: string) {
  const res = await ddb.send(
    new QueryCommand({
      TableName: table,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :sk)',
      ExpressionAttributeValues: { ':pk': pk, ':sk': skPrefix },
    })
  );
  return res.Items ?? [];
}

export async function deleteItem(table: string, key: Record<string, string>) {
  await ddb.send(new DeleteCommand({ TableName: table, Key: key }));
}

export async function scanAll(table: string): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = [];
  let lastKey: Record<string, unknown> | undefined;
  do {
    const res = await ddb.send(new ScanCommand({
      TableName: table,
      ExclusiveStartKey: lastKey,
    }));
    items.push(...(res.Items ?? []));
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);
  return items;
}
