import * as vscode from 'vscode';
import { PackageInfo } from './types';
import { PubDevClient } from './pubdevClient';

export class PackageTreeItem extends vscode.TreeItem {
  constructor(
    public readonly packageInfo: PackageInfo,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(packageInfo.name, collapsibleState);

    if (packageInfo.isOutdated) {
      this.description = `${packageInfo.currentVersion} → ${packageInfo.latestVersion}`;

      // Set icon and tooltip based on update type
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
    
    // Add click command
    this.command = {
      command: 'pubgrade.itemClick',
      title: 'Package Actions',
      arguments: [this]
    };
  }
}

export class PackageTreeProvider implements vscode.TreeDataProvider<PackageTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<PackageTreeItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;
  
  private packages: PackageInfo[] = [];

  setPackages(packages: PackageInfo[]) {
    this.packages = packages;
    this._onDidChangeTreeData.fire();
  }

  updatePackage(name: string, newVersion: string) {
    const pkg = this.packages.find(p => p.name === name);
    if (!pkg) return;

    pkg.currentVersion = newVersion;
    pkg.isOutdated = PubDevClient.isOutdated(newVersion, pkg.latestVersion);
    pkg.updateType = PubDevClient.getUpdateType(newVersion, pkg.latestVersion);
    this._onDidChangeTreeData.fire();
  }

  getOutdatedCount(): number {
    return this.packages.filter(p => p.isOutdated).length;
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: PackageTreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: PackageTreeItem): Thenable<PackageTreeItem[]> {
    if (!element) {
      // Sort: outdated packages first, then up-to-date packages
      const sorted = [...this.packages].sort((a, b) => {
        if (a.isOutdated && !b.isOutdated) return -1;
        if (!a.isOutdated && b.isOutdated) return 1;
        return a.name.localeCompare(b.name); // Alphabetical within each group
      });
      
      return Promise.resolve(
        sorted.map(pkg => new PackageTreeItem(pkg, vscode.TreeItemCollapsibleState.None))
      );
    }
    return Promise.resolve([]);
  }
}

