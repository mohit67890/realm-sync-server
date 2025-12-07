/\*\*

- CallbackProcessor Hook - README
-
- The callbackProcessor hook allows plugins to intercept and transform
- callback responses before they are sent back to clients.
-
- Use Cases:
- - Add metadata to responses (timestamps, versions, etc.)
- - Transform error responses to a consistent format
- - Audit/log callback responses
- - Filter or redact sensitive information
- - Add user-specific data to responses
-
- Hook Signature:
- ```typescript

  ```
- callbackProcessor?: (
- socket: Socket, // The socket making the request
- eventName: string, // The event name (e.g., "sync:change", "mongoUpsert")
- response: any, // The response about to be sent
- originalData?: any // The original request data (if available)
- ) => Promise<any> | any;
- ```

  ```
-
- Example Usage:
-
- 1.  Error Transformation:
- ```typescript

  ```
- callbackProcessor: (socket, eventName, response) => {
- if (response === "error") {
-     return {
-       success: false,
-       error: { code: "OPERATION_FAILED", message: `${eventName} failed` }
-     };
- }
- return response;
- }
- ```

  ```
-
- 2.  Add Metadata:
- ```typescript

  ```
- callbackProcessor: (socket, eventName, response) => {
- if (typeof response === "object") {
-     return { ...response, _meta: { timestamp: Date.now(), version: "1.0" } };
- }
- return response;
- }
- ```

  ```
-
- 3.  Audit Logging:
- ```typescript

  ```
- callbackProcessor: async (socket, eventName, response, originalData) => {
- await auditLog.write({
-     userId: socket.data.userId,
-     event: eventName,
-     response,
-     data: originalData
- });
- return response; // Don't modify, just log
- }
- ```

  ```
-
- Implementation:
-
- To use callbackProcessor in sync-server handlers, replace:
- ```typescript

  ```
- if (callback) callback(response);
- ```

  ```
-
- With:
- ```typescript

  ```
- if (callback) {
- const processed = await this.processCallback(socket, "eventName", response, originalData);
- callback(processed);
- }
- ```

  ```
-
- The processCallback helper method:
- - Runs all registered callbackProcessor hooks in sequence
- - Each plugin can transform the response
- - Returns the final transformed response
- - Handles errors gracefully (continues with current response if plugin fails)
-
- See examples/plugins/broadcast-processor-examples.ts for complete examples.
  \*/

export {};
