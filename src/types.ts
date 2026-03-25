export type UpdateType = 'major' | 'minor' | 'patch' | 'none';

export interface PackageInfo {
  name: string;
  currentVersion: string;
  latestVersion: string;
  isOutdated: boolean;
  updateType: UpdateType;
  changelog?: string;
  publishedDate?: Date;
}

export interface PubspecDependency {
  name: string;
  version: string;
  isDev: boolean;
  hasCaret: boolean;
}

