import * as vscode from 'vscode';
import { PackageInfo, ProjectPackages } from './types';
import { PubDevClient } from './pubdevClient';

// Parent node in monorepo mode — represents one pubspec.yaml project
export class ProjectTreeItem extends vscode.TreeItem {
  constructor(
    public readonly project: ProjectPackages,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(project.projectName, collapsibleState);

    const outdated = project.packages.filter(p => p.isOutdated).length;
    this.iconPath = new vscode.ThemeIcon('folder');
    this.description = outdated > 0 ? `${outdated} outdated` : 'all up to date';

    this.contextValue = 'project';
  }
}

// Leaf node — represents a single dependency
export class PackageTreeItem extends vscode.TreeItem {
  constructor(
    public readonly packageInfo: PackageInfo,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(packageInfo.name, collapsibleState);

    if (packageInfo.isOutdated) {
      this.description = `${packageInfo.currentVersion} → ${packageInfo.latestVersion}`;

      switch (packageInfo.updateType) {
        case 'major':
          this.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('errorForeground'));
          this.tooltip = `Major update available: ${packageInfo.latestVersion} (Breaking changes possible)`;
          break;
        case 'minor':
          this.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('editorWarning.foreground'));
          this.tooltip = `Minor update available: ${packageInfo.latestVersion} (New features)`;
          break;
        case 'patch':
          this.iconPath = new vscode.ThemeIcon('info', new vscode.ThemeColor('editorInfo.foreground'));
          this.tooltip = `Patch update available: ${packageInfo.latestVersion} (Bug fixes)`;
          break;
        default:
          this.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('editorWarning.foreground'));
          this.tooltip = `Update available: ${packageInfo.latestVersion}`;
      }
    } else {
      this.description = packageInfo.currentVersion;
      this.iconPath = new vscode.ThemeIcon('pass', new vscode.ThemeColor('testing.iconPassed'));
      this.tooltip = 'Up to date';
    }

    this.contextValue = packageInfo.isOutdated ? 'outdatedPackage' : 'upToDatePackage';

    this.command = {
      command: 'pubgrade.itemClick',
      title: 'Package Actions',
      arguments: [this]
    };
  }
}

type TreeItem = ProjectTreeItem | PackageTreeItem;

export class PackageTreeProvider implements vscode.TreeDataProvider<TreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<TreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private projects: ProjectPackages[] = [];

  // Single project = flat list (backwards compatible), multiple = grouped
  private get isMonorepo(): boolean {
    return this.projects.length > 1;
  }

  setProjects(projects: ProjectPackages[]) {
    this.projects = projects;
    this._onDidChangeTreeData.fire();
  }

  // Convenience for single-project usage
  setPackages(packages: PackageInfo[]) {
    this.projects = [{ projectName: '', pubspecPath: '', packages }];
    this._onDidChangeTreeData.fire();
  }

  updatePackage(name: string, newVersion: string, pubspecPath?: string) {
    for (const project of this.projects) {
      // If pubspecPath given, target that project; otherwise search all
      if (pubspecPath && project.pubspecPath !== pubspecPath) continue;

      const pkg = project.packages.find(p => p.name === name);
      if (!pkg) continue;

      pkg.currentVersion = newVersion;
      pkg.isOutdated = PubDevClient.isOutdated(newVersion, pkg.latestVersion);
      pkg.updateType = PubDevClient.getUpdateType(newVersion, pkg.latestVersion);
      this._onDidChangeTreeData.fire();
      return;
    }
  }

  getOutdatedCount(): number {
    return this.projects.reduce(
      (sum, p) => sum + p.packages.filter(pkg => pkg.isOutdated).length, 0
    );
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: TreeItem): Thenable<TreeItem[]> {
    if (!element) {
      if (this.isMonorepo) {
        // Top level: project nodes, sorted by outdated count desc
        const sorted = [...this.projects].sort((a, b) => {
          const aOut = a.packages.filter(p => p.isOutdated).length;
          const bOut = b.packages.filter(p => p.isOutdated).length;
          if (aOut !== bOut) return bOut - aOut;
          return a.projectName.localeCompare(b.projectName);
        });
        return Promise.resolve(
          sorted.map(p => new ProjectTreeItem(p, vscode.TreeItemCollapsibleState.Collapsed))
        );
      } else {
        // Single project: flat list (same behavior as before)
        return Promise.resolve(this.sortedPackageItems(this.projects[0]?.packages || []));
      }
    }

    // Children of a project node
    if (element instanceof ProjectTreeItem) {
      return Promise.resolve(this.sortedPackageItems(element.project.packages));
    }

    return Promise.resolve([]);
  }

  private sortedPackageItems(packages: PackageInfo[]): PackageTreeItem[] {
    const sorted = [...packages].sort((a, b) => {
      if (a.isOutdated && !b.isOutdated) return -1;
      if (!a.isOutdated && b.isOutdated) return 1;
      return a.name.localeCompare(b.name);
    });
    return sorted.map(pkg => new PackageTreeItem(pkg, vscode.TreeItemCollapsibleState.None));
  }
}
