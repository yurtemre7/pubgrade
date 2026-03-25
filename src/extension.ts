import * as vscode from 'vscode';
import { PubspecParser } from './pubspecParser';
import { PubDevClient } from './pubdevClient';
import { PackageTreeProvider } from './treeProvider';
import { ChangelogView } from './changelogView';
import { Updater } from './updater';
import { PackageInfo, PubspecDependency, ProjectPackages } from './types';

let treeProvider: PackageTreeProvider;
let statusBarItem: vscode.StatusBarItem;
let treeView: vscode.TreeView<any>;

export function activate(context: vscode.ExtensionContext) {
  console.log('Flutter Pubgrade extension activated');

  treeProvider = new PackageTreeProvider();
  treeView = vscode.window.createTreeView('pubgradePackages', {
    treeDataProvider: treeProvider
  });

  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.command = 'pubgrade.refresh';
  context.subscriptions.push(statusBarItem);

  context.subscriptions.push(
    vscode.commands.registerCommand('pubgrade.refresh', () => refreshPackages())
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('pubgrade.updatePackage', async (item) => {
      if (!item?.packageInfo) return;
      const pubspecPath = item.packageInfo.pubspecPath || await findSinglePubspecPath();
      if (!pubspecPath) return;

      const success = await Updater.updatePackage(
        pubspecPath,
        item.packageInfo.name,
        item.packageInfo.latestVersion
      );
      if (success) {
        treeProvider.updatePackage(item.packageInfo.name, item.packageInfo.latestVersion, pubspecPath);
        updateBadge();
        updateStatusBar();
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('pubgrade.showChangelog', async (item) => {
      if (item?.packageInfo) {
        await showChangelogAsDocument(item.packageInfo);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('pubgrade.itemClick', async (item) => {
      if (!item.packageInfo.isOutdated) {
        vscode.window.showInformationMessage(`${item.packageInfo.name} is up to date (${item.packageInfo.currentVersion})`);
        return;
      }
      await showChangelogAsDocument(item.packageInfo);
    })
  );

  refreshPackages();
}

// Fallback for single-project workspaces
async function findSinglePubspecPath(): Promise<string | null> {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) return null;

  const pubspecs = await PubspecParser.findAllPubspecs(workspaceFolders[0].uri.fsPath);
  return pubspecs[0] || null;
}

async function fetchPackageInfo(
  dep: PubspecDependency,
  lockVersions: Map<string, string> | null,
  pubspecPath: string
): Promise<PackageInfo | null> {
  try {
    const latestVersion = await PubDevClient.getLatestVersion(dep.name);
    if (!latestVersion) return null;

    // Use lock file version for caret deps (actual installed version), yaml version otherwise
    const compareVersion = (dep.hasCaret && lockVersions?.has(dep.name))
      ? lockVersions.get(dep.name)!
      : PubspecParser.cleanVersion(dep.version);

    return {
      name: dep.name,
      currentVersion: compareVersion,
      latestVersion,
      isOutdated: PubDevClient.isOutdated(compareVersion, latestVersion),
      updateType: PubDevClient.getUpdateType(compareVersion, latestVersion),
      pubspecPath
    };
  } catch (e) {
    console.error(`Error fetching ${dep.name}:`, e);
  }
  return null;
}

// Process one pubspec.yaml: parse deps, fetch latest versions concurrently
async function processProject(
  pubspecPath: string,
  progress: vscode.Progress<{ message?: string; increment?: number }>,
  processedRef: { count: number },
  totalPackages: number
): Promise<ProjectPackages> {
  const projectName = PubspecParser.getProjectName(pubspecPath);
  const dependencies = PubspecParser.parse(pubspecPath);
  const packages: PackageInfo[] = [];

  const hasCaretDeps = dependencies.some(d => d.hasCaret);
  const lockVersions = hasCaretDeps ? PubspecParser.parseLockFile(pubspecPath) : null;

  const queue = [...dependencies];
  const concurrencyLimit = 4;

  const worker = async () => {
    while (queue.length > 0) {
      const dep = queue.shift();
      if (!dep) break;

      const result = await fetchPackageInfo(dep, lockVersions, pubspecPath);
      if (result) packages.push(result);

      processedRef.count++;
      progress.report({
        message: `${processedRef.count} of ${totalPackages} checked`,
        increment: (1 / totalPackages) * 100
      });
    }
  };

  const workers = Array(Math.min(concurrencyLimit, dependencies.length))
    .fill(null)
    .map(() => worker());
  await Promise.all(workers);

  return { projectName, pubspecPath, packages };
}

async function refreshPackages() {
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders) return;

  try {
    treeView.badge = undefined;

    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'Pubgrade',
        cancellable: false
      },
      async (progress) => {
        const pubspecPaths = await PubspecParser.findAllPubspecs(workspaceFolders[0].uri.fsPath);
        if (pubspecPaths.length === 0) return;

        // Count total deps across all projects for accurate progress
        const allDeps = pubspecPaths.map(p => PubspecParser.parse(p));
        const totalPackages = allDeps.reduce((sum, deps) => sum + deps.length, 0);
        const processedRef = { count: 0 };

        // Process all projects
        const projects: ProjectPackages[] = [];
        for (const pubspecPath of pubspecPaths) {
          const project = await processProject(pubspecPath, progress, processedRef, totalPackages);
          // Only include projects that have dependencies
          if (project.packages.length > 0) {
            projects.push(project);
          }
        }

        treeProvider.setProjects(projects);
        updateBadge();
        updateStatusBar();
      }
    );
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to refresh packages: ${error}`);
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
        const pubspecPath = packageInfo.pubspecPath || await findSinglePubspecPath();
        if (!pubspecPath) return;

        const success = await Updater.updatePackage(pubspecPath, packageName, version);
        if (success) {
          treeProvider.updatePackage(packageName, version, pubspecPath);
          updateBadge();
          updateStatusBar();
        }
      }
    );
  } catch (error) {
    vscode.window.showErrorMessage(`Failed to fetch changelog: ${error}`);
  }
}

export function deactivate() {}
