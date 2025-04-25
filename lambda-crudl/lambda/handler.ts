// AWS Lambda function to handle CRUD operations
/** NOTE !!! 
     *  
     * AWS CDK expects `lambda code` written in javascript (instead of typescript)
     * so we need to compile the typescript code to javascript first
     * then we are able to refer to the compiled javascript code
     * as below
     * 
     *  1) add `lambda-crudl/tsconfig.lambda.json` 
     *  2) compile the typescript code to javascript : npx tsc -p tsconfig.lambda.json
     *  3) cdk deploy
     */

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
