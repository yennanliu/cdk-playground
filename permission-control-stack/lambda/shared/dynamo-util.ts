import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  DeleteCommand,
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

export async function queryByPk(table: string, pk: string, indexName?: string) {
  const res = await ddb.send(
    new QueryCommand({
      TableName: table,
      IndexName: indexName,
      KeyConditionExpression: 'PK = :pk',
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
