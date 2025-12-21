"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
const client_s3_1 = require("@aws-sdk/client-s3");
const s3_request_presigner_1 = require("@aws-sdk/s3-request-presigner");
const s3Client = new client_s3_1.S3Client({ region: process.env.AWS_REGION || 'ap-northeast-1' });
/**
 * Lambda handler for generating presigned S3 upload URLs
 */
const handler = async (event) => {
    console.log('Received upload request:', JSON.stringify(event, null, 2));
    try {
        // Parse request body
        if (!event.body) {
            return {
                statusCode: 400,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ error: 'Request body is required' })
            };
        }
        const request = JSON.parse(event.body);
        // Validate input
        if (!request.fileName) {
            return {
                statusCode: 400,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ error: 'fileName is required' })
            };
        }
        // Sanitize file name and generate S3 key
        const timestamp = Date.now();
        const sanitizedFileName = request.fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
        const key = `uploads/${timestamp}-${sanitizedFileName}`;
        // Determine content type
        const contentType = request.contentType || getContentType(request.fileName);
        // Generate presigned URL for upload (valid for 5 minutes)
        const command = new client_s3_1.PutObjectCommand({
            Bucket: process.env.RESUME_BUCKET,
            Key: key,
            ContentType: contentType
        });
        const expiresIn = 300; // 5 minutes
        const uploadUrl = await (0, s3_request_presigner_1.getSignedUrl)(s3Client, command, { expiresIn });
        console.log('Generated presigned URL for key:', key);
        const response = {
            uploadUrl,
            key,
            expiresIn
        };
        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify(response)
        };
    }
    catch (error) {
        console.error('Error generating presigned URL:', error);
        return {
            statusCode: 500,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                error: 'Failed to generate upload URL',
                message: error instanceof Error ? error.message : 'Unknown error'
            })
        };
    }
};
exports.handler = handler;
/**
 * Determine content type from file extension
 */
function getContentType(fileName) {
    const ext = fileName.toLowerCase().split('.').pop();
    const contentTypes = {
        'pdf': 'application/pdf',
        'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'doc': 'application/msword',
        'txt': 'text/plain'
    };
    return contentTypes[ext || ''] || 'application/octet-stream';
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoidXBsb2FkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsidXBsb2FkLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7OztBQUFBLGtEQUFnRTtBQUNoRSx3RUFBNkQ7QUFHN0QsTUFBTSxRQUFRLEdBQUcsSUFBSSxvQkFBUSxDQUFDLEVBQUUsTUFBTSxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsVUFBVSxJQUFJLGdCQUFnQixFQUFFLENBQUMsQ0FBQztBQWF0Rjs7R0FFRztBQUNJLE1BQU0sT0FBTyxHQUFHLEtBQUssRUFBRSxLQUEyQixFQUFrQyxFQUFFO0lBQzNGLE9BQU8sQ0FBQyxHQUFHLENBQUMsMEJBQTBCLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQyxLQUFLLEVBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQyxDQUFDLENBQUM7SUFFeEUsSUFBSSxDQUFDO1FBQ0gscUJBQXFCO1FBQ3JCLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxFQUFFLENBQUM7WUFDaEIsT0FBTztnQkFDTCxVQUFVLEVBQUUsR0FBRztnQkFDZixPQUFPLEVBQUUsRUFBRSxjQUFjLEVBQUUsa0JBQWtCLEVBQUU7Z0JBQy9DLElBQUksRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLEVBQUUsS0FBSyxFQUFFLDBCQUEwQixFQUFFLENBQUM7YUFDNUQsQ0FBQztRQUNKLENBQUM7UUFFRCxNQUFNLE9BQU8sR0FBa0IsSUFBSSxDQUFDLEtBQUssQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLENBQUM7UUFFdEQsaUJBQWlCO1FBQ2pCLElBQUksQ0FBQyxPQUFPLENBQUMsUUFBUSxFQUFFLENBQUM7WUFDdEIsT0FBTztnQkFDTCxVQUFVLEVBQUUsR0FBRztnQkFDZixPQUFPLEVBQUUsRUFBRSxjQUFjLEVBQUUsa0JBQWtCLEVBQUU7Z0JBQy9DLElBQUksRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLEVBQUUsS0FBSyxFQUFFLHNCQUFzQixFQUFFLENBQUM7YUFDeEQsQ0FBQztRQUNKLENBQUM7UUFFRCx5Q0FBeUM7UUFDekMsTUFBTSxTQUFTLEdBQUcsSUFBSSxDQUFDLEdBQUcsRUFBRSxDQUFDO1FBQzdCLE1BQU0saUJBQWlCLEdBQUcsT0FBTyxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUMsa0JBQWtCLEVBQUUsR0FBRyxDQUFDLENBQUM7UUFDNUUsTUFBTSxHQUFHLEdBQUcsV0FBVyxTQUFTLElBQUksaUJBQWlCLEVBQUUsQ0FBQztRQUV4RCx5QkFBeUI7UUFDekIsTUFBTSxXQUFXLEdBQUcsT0FBTyxDQUFDLFdBQVcsSUFBSSxjQUFjLENBQUMsT0FBTyxDQUFDLFFBQVEsQ0FBQyxDQUFDO1FBRTVFLDBEQUEwRDtRQUMxRCxNQUFNLE9BQU8sR0FBRyxJQUFJLDRCQUFnQixDQUFDO1lBQ25DLE1BQU0sRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLGFBQWM7WUFDbEMsR0FBRyxFQUFFLEdBQUc7WUFDUixXQUFXLEVBQUUsV0FBVztTQUN6QixDQUFDLENBQUM7UUFFSCxNQUFNLFNBQVMsR0FBRyxHQUFHLENBQUMsQ0FBQyxZQUFZO1FBQ25DLE1BQU0sU0FBUyxHQUFHLE1BQU0sSUFBQSxtQ0FBWSxFQUFDLFFBQVEsRUFBRSxPQUFPLEVBQUUsRUFBRSxTQUFTLEVBQUUsQ0FBQyxDQUFDO1FBRXZFLE9BQU8sQ0FBQyxHQUFHLENBQUMsa0NBQWtDLEVBQUUsR0FBRyxDQUFDLENBQUM7UUFFckQsTUFBTSxRQUFRLEdBQW1CO1lBQy9CLFNBQVM7WUFDVCxHQUFHO1lBQ0gsU0FBUztTQUNWLENBQUM7UUFFRixPQUFPO1lBQ0wsVUFBVSxFQUFFLEdBQUc7WUFDZixPQUFPLEVBQUU7Z0JBQ1AsY0FBYyxFQUFFLGtCQUFrQjtnQkFDbEMsNkJBQTZCLEVBQUUsR0FBRzthQUNuQztZQUNELElBQUksRUFBRSxJQUFJLENBQUMsU0FBUyxDQUFDLFFBQVEsQ0FBQztTQUMvQixDQUFDO0lBRUosQ0FBQztJQUFDLE9BQU8sS0FBSyxFQUFFLENBQUM7UUFDZixPQUFPLENBQUMsS0FBSyxDQUFDLGlDQUFpQyxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBRXhELE9BQU87WUFDTCxVQUFVLEVBQUUsR0FBRztZQUNmLE9BQU8sRUFBRSxFQUFFLGNBQWMsRUFBRSxrQkFBa0IsRUFBRTtZQUMvQyxJQUFJLEVBQUUsSUFBSSxDQUFDLFNBQVMsQ0FBQztnQkFDbkIsS0FBSyxFQUFFLCtCQUErQjtnQkFDdEMsT0FBTyxFQUFFLEtBQUssWUFBWSxLQUFLLENBQUMsQ0FBQyxDQUFDLEtBQUssQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLGVBQWU7YUFDbEUsQ0FBQztTQUNILENBQUM7SUFDSixDQUFDO0FBQ0gsQ0FBQyxDQUFDO0FBdkVXLFFBQUEsT0FBTyxXQXVFbEI7QUFFRjs7R0FFRztBQUNILFNBQVMsY0FBYyxDQUFDLFFBQWdCO0lBQ3RDLE1BQU0sR0FBRyxHQUFHLFFBQVEsQ0FBQyxXQUFXLEVBQUUsQ0FBQyxLQUFLLENBQUMsR0FBRyxDQUFDLENBQUMsR0FBRyxFQUFFLENBQUM7SUFFcEQsTUFBTSxZQUFZLEdBQTJCO1FBQzNDLEtBQUssRUFBRSxpQkFBaUI7UUFDeEIsTUFBTSxFQUFFLHlFQUF5RTtRQUNqRixLQUFLLEVBQUUsb0JBQW9CO1FBQzNCLEtBQUssRUFBRSxZQUFZO0tBQ3BCLENBQUM7SUFFRixPQUFPLFlBQVksQ0FBQyxHQUFHLElBQUksRUFBRSxDQUFDLElBQUksMEJBQTBCLENBQUM7QUFDL0QsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCB7IFMzQ2xpZW50LCBQdXRPYmplY3RDb21tYW5kIH0gZnJvbSAnQGF3cy1zZGsvY2xpZW50LXMzJztcbmltcG9ydCB7IGdldFNpZ25lZFVybCB9IGZyb20gJ0Bhd3Mtc2RrL3MzLXJlcXVlc3QtcHJlc2lnbmVyJztcbmltcG9ydCB7IEFQSUdhdGV3YXlQcm94eUV2ZW50LCBBUElHYXRld2F5UHJveHlSZXN1bHQgfSBmcm9tICdhd3MtbGFtYmRhJztcblxuY29uc3QgczNDbGllbnQgPSBuZXcgUzNDbGllbnQoeyByZWdpb246IHByb2Nlc3MuZW52LkFXU19SRUdJT04gfHwgJ2FwLW5vcnRoZWFzdC0xJyB9KTtcblxuaW50ZXJmYWNlIFVwbG9hZFJlcXVlc3Qge1xuICBmaWxlTmFtZTogc3RyaW5nO1xuICBjb250ZW50VHlwZT86IHN0cmluZztcbn1cblxuaW50ZXJmYWNlIFVwbG9hZFJlc3BvbnNlIHtcbiAgdXBsb2FkVXJsOiBzdHJpbmc7XG4gIGtleTogc3RyaW5nO1xuICBleHBpcmVzSW46IG51bWJlcjtcbn1cblxuLyoqXG4gKiBMYW1iZGEgaGFuZGxlciBmb3IgZ2VuZXJhdGluZyBwcmVzaWduZWQgUzMgdXBsb2FkIFVSTHNcbiAqL1xuZXhwb3J0IGNvbnN0IGhhbmRsZXIgPSBhc3luYyAoZXZlbnQ6IEFQSUdhdGV3YXlQcm94eUV2ZW50KTogUHJvbWlzZTxBUElHYXRld2F5UHJveHlSZXN1bHQ+ID0+IHtcbiAgY29uc29sZS5sb2coJ1JlY2VpdmVkIHVwbG9hZCByZXF1ZXN0OicsIEpTT04uc3RyaW5naWZ5KGV2ZW50LCBudWxsLCAyKSk7XG5cbiAgdHJ5IHtcbiAgICAvLyBQYXJzZSByZXF1ZXN0IGJvZHlcbiAgICBpZiAoIWV2ZW50LmJvZHkpIHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIHN0YXR1c0NvZGU6IDQwMCxcbiAgICAgICAgaGVhZGVyczogeyAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nIH0sXG4gICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgZXJyb3I6ICdSZXF1ZXN0IGJvZHkgaXMgcmVxdWlyZWQnIH0pXG4gICAgICB9O1xuICAgIH1cblxuICAgIGNvbnN0IHJlcXVlc3Q6IFVwbG9hZFJlcXVlc3QgPSBKU09OLnBhcnNlKGV2ZW50LmJvZHkpO1xuXG4gICAgLy8gVmFsaWRhdGUgaW5wdXRcbiAgICBpZiAoIXJlcXVlc3QuZmlsZU5hbWUpIHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIHN0YXR1c0NvZGU6IDQwMCxcbiAgICAgICAgaGVhZGVyczogeyAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nIH0sXG4gICAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgZXJyb3I6ICdmaWxlTmFtZSBpcyByZXF1aXJlZCcgfSlcbiAgICAgIH07XG4gICAgfVxuXG4gICAgLy8gU2FuaXRpemUgZmlsZSBuYW1lIGFuZCBnZW5lcmF0ZSBTMyBrZXlcbiAgICBjb25zdCB0aW1lc3RhbXAgPSBEYXRlLm5vdygpO1xuICAgIGNvbnN0IHNhbml0aXplZEZpbGVOYW1lID0gcmVxdWVzdC5maWxlTmFtZS5yZXBsYWNlKC9bXmEtekEtWjAtOS5fLV0vZywgJ18nKTtcbiAgICBjb25zdCBrZXkgPSBgdXBsb2Fkcy8ke3RpbWVzdGFtcH0tJHtzYW5pdGl6ZWRGaWxlTmFtZX1gO1xuXG4gICAgLy8gRGV0ZXJtaW5lIGNvbnRlbnQgdHlwZVxuICAgIGNvbnN0IGNvbnRlbnRUeXBlID0gcmVxdWVzdC5jb250ZW50VHlwZSB8fCBnZXRDb250ZW50VHlwZShyZXF1ZXN0LmZpbGVOYW1lKTtcblxuICAgIC8vIEdlbmVyYXRlIHByZXNpZ25lZCBVUkwgZm9yIHVwbG9hZCAodmFsaWQgZm9yIDUgbWludXRlcylcbiAgICBjb25zdCBjb21tYW5kID0gbmV3IFB1dE9iamVjdENvbW1hbmQoe1xuICAgICAgQnVja2V0OiBwcm9jZXNzLmVudi5SRVNVTUVfQlVDS0VUISxcbiAgICAgIEtleToga2V5LFxuICAgICAgQ29udGVudFR5cGU6IGNvbnRlbnRUeXBlXG4gICAgfSk7XG5cbiAgICBjb25zdCBleHBpcmVzSW4gPSAzMDA7IC8vIDUgbWludXRlc1xuICAgIGNvbnN0IHVwbG9hZFVybCA9IGF3YWl0IGdldFNpZ25lZFVybChzM0NsaWVudCwgY29tbWFuZCwgeyBleHBpcmVzSW4gfSk7XG5cbiAgICBjb25zb2xlLmxvZygnR2VuZXJhdGVkIHByZXNpZ25lZCBVUkwgZm9yIGtleTonLCBrZXkpO1xuXG4gICAgY29uc3QgcmVzcG9uc2U6IFVwbG9hZFJlc3BvbnNlID0ge1xuICAgICAgdXBsb2FkVXJsLFxuICAgICAga2V5LFxuICAgICAgZXhwaXJlc0luXG4gICAgfTtcblxuICAgIHJldHVybiB7XG4gICAgICBzdGF0dXNDb2RlOiAyMDAsXG4gICAgICBoZWFkZXJzOiB7XG4gICAgICAgICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsXG4gICAgICAgICdBY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nOiAnKidcbiAgICAgIH0sXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeShyZXNwb25zZSlcbiAgICB9O1xuXG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgY29uc29sZS5lcnJvcignRXJyb3IgZ2VuZXJhdGluZyBwcmVzaWduZWQgVVJMOicsIGVycm9yKTtcblxuICAgIHJldHVybiB7XG4gICAgICBzdGF0dXNDb2RlOiA1MDAsXG4gICAgICBoZWFkZXJzOiB7ICdDb250ZW50LVR5cGUnOiAnYXBwbGljYXRpb24vanNvbicgfSxcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgZXJyb3I6ICdGYWlsZWQgdG8gZ2VuZXJhdGUgdXBsb2FkIFVSTCcsXG4gICAgICAgIG1lc3NhZ2U6IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogJ1Vua25vd24gZXJyb3InXG4gICAgICB9KVxuICAgIH07XG4gIH1cbn07XG5cbi8qKlxuICogRGV0ZXJtaW5lIGNvbnRlbnQgdHlwZSBmcm9tIGZpbGUgZXh0ZW5zaW9uXG4gKi9cbmZ1bmN0aW9uIGdldENvbnRlbnRUeXBlKGZpbGVOYW1lOiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCBleHQgPSBmaWxlTmFtZS50b0xvd2VyQ2FzZSgpLnNwbGl0KCcuJykucG9wKCk7XG5cbiAgY29uc3QgY29udGVudFR5cGVzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge1xuICAgICdwZGYnOiAnYXBwbGljYXRpb24vcGRmJyxcbiAgICAnZG9jeCc6ICdhcHBsaWNhdGlvbi92bmQub3BlbnhtbGZvcm1hdHMtb2ZmaWNlZG9jdW1lbnQud29yZHByb2Nlc3NpbmdtbC5kb2N1bWVudCcsXG4gICAgJ2RvYyc6ICdhcHBsaWNhdGlvbi9tc3dvcmQnLFxuICAgICd0eHQnOiAndGV4dC9wbGFpbidcbiAgfTtcblxuICByZXR1cm4gY29udGVudFR5cGVzW2V4dCB8fCAnJ10gfHwgJ2FwcGxpY2F0aW9uL29jdGV0LXN0cmVhbSc7XG59XG4iXX0=