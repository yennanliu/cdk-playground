// lambda/handler.ts

let items: { [id: string]: any } = {};

export async function main(event: any) {
    const { httpMethod, pathParameters, body } = event;
    const id = pathParameters?.id;

    switch (httpMethod) {
        case 'GET':
            if (id) {
                return respond(items[id] ? 200 : 404, items[id] || { error: 'Not found' });
            }
            return respond(200, Object.values(items));

        case 'POST': {
            const data = JSON.parse(body);
            const newId = Date.now().toString();
            items[newId] = { id: newId, ...data };
            return respond(201, items[newId]);
        }

        case 'PUT': {
            if (!id || !items[id]) return respond(404, { error: 'Item not found' });
            const data = JSON.parse(body);
            items[id] = { id, ...data };
            return respond(200, items[id]);
        }

        case 'DELETE': {
            if (!id || !items[id]) return respond(404, { error: 'Item not found' });
            delete items[id];
            return respond(204, null);
        }

        default:
            return respond(405, { error: 'Method not allowed' });
    }
}

function respond(statusCode: number, body: any) {
    return {
        statusCode,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : '',
    };
}
