const ROLES = new Set(['MARKET', 'OPERATIONS', 'FINANCE', 'POLICY', 'SUPERVISOR']);

function assertGenerateRequest(request) {
  if (request == null || typeof request !== 'object' || Array.isArray(request)) {
    throw new TypeError('Model gateway request must be an object');
  }
  const allowed = new Set(['requestId', 'role', 'prompt']);
  const unknown = Object.keys(request).find((key) => !allowed.has(key));
  if (unknown) throw new TypeError(`Model gateway request has unknown field: ${unknown}`);
  if (typeof request.requestId !== 'string' || request.requestId.length === 0) {
    throw new TypeError('Model gateway requestId must be a non-empty string');
  }
  if (!ROLES.has(request.role)) throw new TypeError(`Unknown model gateway role: ${String(request.role)}`);
  if (request.prompt == null || typeof request.prompt !== 'object' || Array.isArray(request.prompt)) {
    throw new TypeError('Model gateway prompt must be an object');
  }
}

function assertGenerateResponse(response, requestId) {
  if (response == null || typeof response !== 'object' || Array.isArray(response)) {
    throw new TypeError('Model gateway response must be an object');
  }
  const keys = Object.keys(response);
  if (keys.length !== 2 || !keys.includes('requestId') || !keys.includes('output')) {
    throw new TypeError('Model gateway response must contain only requestId and output');
  }
  if (response.requestId !== requestId) throw new TypeError('Model gateway response requestId must match');
  if (response.output == null || typeof response.output !== 'object' || Array.isArray(response.output)) {
    throw new TypeError('Model gateway response output must be an object');
  }
}

export function defineModelGateway(candidate) {
  if (candidate == null || typeof candidate !== 'object' || Array.isArray(candidate)) {
    throw new TypeError('Model gateway must be an object');
  }
  if (typeof candidate.name !== 'string' || candidate.name.length === 0) {
    throw new TypeError('Model gateway name must be a non-empty string');
  }
  if (typeof candidate.generate !== 'function') {
    throw new TypeError('Model gateway must implement generate(request)');
  }

  return Object.freeze({
    name: candidate.name,
    async generate(request) {
      assertGenerateRequest(request);
      const response = await candidate.generate(structuredClone(request));
      assertGenerateResponse(response, request.requestId);
      return response;
    },
  });
}
