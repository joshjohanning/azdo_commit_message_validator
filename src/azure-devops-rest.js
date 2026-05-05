/**
 * Azure DevOps REST API helpers
 *
 * Shared utilities for making authenticated requests to the Azure DevOps
 * REST API using a Personal Access Token (PAT).
 *
 * @module azure-devops-rest
 */

/**
 * Build the standard Authorization header for Azure DevOps PAT auth.
 *
 * @param {string} azToken - Azure DevOps personal access token
 * @returns {Record<string, string>} Headers object
 */
export function azureDevOpsHeaders(azToken) {
  return {
    Authorization: `Basic ${Buffer.from(`:${azToken}`).toString('base64')}`,
    'Content-Type': 'application/json',
    Accept: 'application/json'
  };
}

/**
 * Make a request to the Azure DevOps REST API and return the parsed JSON.
 * Throws an error with `statusCode` and `status` on non-2xx responses so
 * callers can inspect the HTTP status for auth-error detection.
 *
 * @param {string} url - Full request URL
 * @param {string} azToken - Azure DevOps PAT
 * @param {RequestInit} [options] - Additional fetch options (method, body, headers, etc.)
 * @returns {Promise<any>} Parsed JSON response
 */
export async function azureDevOpsRequest(url, azToken, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { ...azureDevOpsHeaders(azToken), ...options.headers }
  });

  if (!res.ok) {
    let body;
    try {
      body = await res.text();
    } catch {
      body = res.statusText;
    }
    const err = new Error(body);
    err.statusCode = res.status;
    err.status = res.status;
    throw err;
  }

  return res.json();
}
