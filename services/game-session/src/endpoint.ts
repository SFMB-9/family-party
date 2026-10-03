/**
 * The URL the Lambda uses to push messages back to clients (API Gateway's
 * "management" endpoint). Built from the event, so it works for any stage or domain.
 */
export function managementEndpoint(domainName: string, stage: string): string {
  return `https://${domainName}/${stage}`;
}
