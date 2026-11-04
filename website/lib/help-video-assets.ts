export const HELP_VIDEO_ORIGIN = 'https://raw.githubusercontent.com/salesforce/zana/main/';

export function helpVideoAssetUrl(asset: { path: string }): string {
  return `${HELP_VIDEO_ORIGIN}${asset.path}`;
}
