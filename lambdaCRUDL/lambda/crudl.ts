import { APIGatewayEvent, Context, Callback } from 'aws-lambda';

const items: Record<string, any> = {};

export const handler = async (event: APIGatewayEvent, context: Context, callback: Callback) => {
  const { httpMethod, pathParameters, body } = event;
  const id = pathParameters?.id;

  switch (httpMethod) {
    case 'GET':
      if (id) {
        // Read a single item
        callback(null, {
          statusCode: 200,
          body: JSON.stringify(items[id] || {}),
        });
      } else {
        // List all items
        callback(null, {
          statusCode: 200,
          body: JSON.stringify(items),
        });
      }
      break;

    case 'POST':
      // Create a new item
      const newItem = JSON.parse(body || '{}');
      const newId = `item-${Date.now()}`;
      items[newId] = newItem;
      callback(null, {
        statusCode: 201,
        body: JSON.stringify({ id: newId, ...newItem }),
      });
      break;

    case 'PUT':
      if (id) {
        // Update an existing item
        const updatedItem = JSON.parse(body || '{}');
        items[id] = updatedItem;
        callback(null, {
          statusCode: 200,
          body: JSON.stringify({ id, ...updatedItem }),
        });
      } else {
        callback(null, {
          statusCode: 400,
          body: 'Missing item ID',
        });
      }
      break;

    case 'DELETE':
      if (id) {
        // Delete an item
        delete items[id];
        callback(null, {
          statusCode: 200,
          body: `Item ${id} deleted`,
        });
      } else {
        callback(null, {
          statusCode: 400,
          body: 'Missing item ID',
        });
      }
      break;

    default:
      callback(null, {
        statusCode: 405,
        body: 'Method Not Allowed',
      });
  }
};
