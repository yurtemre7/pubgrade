import * as vscode from 'vscode';
import * as path from 'path';
import { PubspecParser } from './pubspecParser';
import { PubDevClient } from './pubdevClient';
import { PackageTreeProvider } from './treeProvider';
import { ChangelogView } from './changelogView';
import { Updater } from './updater';
import { PackageInfo, PubspecDependency } from './types';

let treeProvider: PackageTreeProvider;
let statusBarItem: vscode.StatusBarItem;
let treeView: vscode.TreeView<any>;

export function activate(context: vscode.ExtensionContext) {
  console.log('Flutter Pubgrade extension activated');

  // Initialize tree provider
  treeProvider = new PackageTreeProvider();
  treeView = vscode.window.createTreeView('pubgradePackages', {
    treeDataProvider: treeProvider
  });

  // Status bar item
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.command = 'pubgrade.refresh';
  context.subscriptions.push(statusBarItem);

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('pubgrade.refresh', () => refreshPackages())
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('pubgrade.updatePackage', async (item) => {
      if (item && item.packageInfo) {
        const pubspecPath = await findPubspecPath();
        if (pubspecPath) {
          const success = await Updater.updatePackage(
            pubspecPath,
            item.packageInfo.name,
            item.packageInfo.latestVersion
          );
          if (success) {
            treeProvider.updatePackage(item.packageInfo.name, item.packageInfo.latestVersion);
            updateBadge();
            updateStatusBar();
          }
        }
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('pubgrade.showChangelog', async (item) => {
      if (item && item.packageInfo) {
        await showChangelogAsDocument(item.packageInfo);
      }
    })
  );

  // Add click handler for tree items
  context.subscriptions.push(
    vscode.commands.registerCommand('pubgrade.itemClick', async (item) => {
      if (!item.packageInfo.isOutdated) {
        vscode.window.showInformationMessage(`${item.packageInfo.name} is up to date (${item.packageInfo.currentVersion})`);
        return;
      }
      
      // Directly show changelog
      await showChangelogAsDocument(item.packageInfo);
    })
  );

  // Auto-refresh on activation
  refreshPackages();
}

async function findPubspecPath(): Promise<string | null> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) {
    vscode.window.showErrorMessage('No workspace folder open');
    return null;
  }

  const pubspecPath = path.join(workspaceFolders[0].uri.fsPath, 'pubspec.yaml');
  return pubspecPath;
}

// --- 1. Helper function to process a SINGLE package ---
async function fetchPackageInfo(
  dep: PubspecDependency,
  lockVersions: Map<string, string> | null
): Promise<PackageInfo | null> {
  try {
    const latestVersion = await PubDevClient.getLatestVersion(dep.name);
    if (!latestVersion) return null;

    // Use lock file version for caret deps (actual installed version), yaml version otherwise
    const compareVersion = (dep.hasCaret && lockVersions?.has(dep.name))
      ? lockVersions.get(dep.name)!
      : PubspecParser.cleanVersion(dep.version);

    const isOutdated = PubDevClient.isOutdated(compareVersion, latestVersion);
    const updateType = PubDevClient.getUpdateType(compareVersion, latestVersion);

    return {
      name: dep.name,
      currentVersion: compareVersion,
      latestVersion: latestVersion,
      isOutdated,
      updateType
    };
  } catch (e) {
    console.error(`Error fetching ${dep.name}:`, e);
  }
  return null;
}

async function refreshPackages() {
  const pubspecPath = await findPubspecPath();
  if (!pubspecPath) return;

  try {
    treeView.badge = undefined;

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Pubgrade',
        cancellable: false
      },
      async (progress) => {
        const dependencies = PubspecParser.parse(pubspecPath);
        const packages: PackageInfo[] = [];

        // Parse lock file once if any dependency uses caret
        const hasCaretDeps = dependencies.some(d => d.hasCaret);
        const lockVersions = hasCaretDeps ? PubspecParser.parseLockFile(pubspecPath) : null;

        // --- 2. Setup the Worker Pool ---
        const queue = [...dependencies]; // Clone the array to act as a queue
        const totalPackages = dependencies.length;
        let processedCount = 0;
        const concurrencyLimit = 4;

        // This worker function runs in a loop as long as the queue has items
        const worker = async () => {
            while (queue.length > 0) {
                const dep = queue.shift(); // Grab the next item
                if (!dep) break;

                // Fetch data
                const result = await fetchPackageInfo(dep, lockVersions);
                if (result) {
                    packages.push(result);
                }

                // Report progress immediately after THIS item finishes
                processedCount++;
                progress.report({
                    message: `${processedCount} of ${totalPackages} checked`,
                    increment: (1 / totalPackages) * 100
                });
            }
        };

        // Create an array of N promises (workers)
        const workers = Array(Math.min(concurrencyLimit, totalPackages))
            .fill(null)
            .map(() => worker());

        // Wait for all workers to drain the queue
        await Promise.all(workers);

        // Finish up
        treeProvider.setPackages(packages);
        updateBadge();
        updateStatusBar();
      }
    );
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to parse pubspec.yaml: ${error}`);
    treeView.badge = undefined;
  }
}

function updateBadge() {
  const outdatedCount = treeProvider.getOutdatedCount();
  if (outdatedCount > 0) {
    treeView.badge = {
      tooltip: `${outdatedCount} outdated package${outdatedCount > 1 ? 's' : ''}`,
      value: outdatedCount
    };
  } else {
    treeView.badge = undefined;
  }
}

function updateStatusBar() {
  const outdatedCount = treeProvider.getOutdatedCount();
  if (outdatedCount > 0) {
    statusBarItem.text = `$(warning) ${outdatedCount} outdated package${outdatedCount > 1 ? 's' : ''}`;
    statusBarItem.show();
  } else {
    statusBarItem.text = `$(check) All packages up to date`;
    statusBarItem.show();
  }
}

async function showChangelogAsDocument(packageInfo: PackageInfo) {
  try {
    const changelog = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `Fetching changelog for ${packageInfo.name}...`,
        cancellable: false
      },
      async () => {
        return await PubDevClient.getChangelog(
          packageInfo.name,
          packageInfo.currentVersion,
          packageInfo.latestVersion
        );
      }
    );

    ChangelogView.show(
      packageInfo.name, 
      changelog, 
      packageInfo.currentVersion, 
      packageInfo.latestVersion,
      async (packageName: string, version: string) => {
        const pubspecPath = await findPubspecPath();
        if (pubspecPath) {
          const success = await Updater.updatePackage(pubspecPath, packageName, version);
          if (success) {
            treeProvider.updatePackage(packageName, version);
            updateBadge();
            updateStatusBar();
          }
        }
      }
    );
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to fetch changelog: ${error}`);
  }
}

export function deactivate() {}
