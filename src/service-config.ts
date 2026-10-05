export function resolveImageBaseUrl(imageBaseUrl: string | undefined, videoBaseUrl: string): string {
  const configuredImageBaseUrl = imageBaseUrl?.trim();
  return configuredImageBaseUrl || videoBaseUrl;
}
