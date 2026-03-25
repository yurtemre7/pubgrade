export type UpdateType = 'major' | 'minor' | 'patch' | 'none';

export interface PackageInfo {
  name: string;
  currentVersion: string;
  latestVersion: string;
  isOutdated: boolean;
  updateType: UpdateType;
  changelog?: string;
  publishedDate?: Date;
  // Which pubspec.yaml this package belongs to (for monorepo update targeting)
  pubspecPath?: string;
}

export interface PubspecDependency {
  name: string;
  version: string;
  isDev: boolean;
  hasCaret: boolean;
}

// Groups packages by their project (each pubspec.yaml = one project)
export interface ProjectPackages {
  projectName: string;
  pubspecPath: string;
  packages: PackageInfo[];
}

