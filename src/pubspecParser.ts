import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import * as vscode from 'vscode';
import { PubspecDependency } from './types';

const EXCLUDED_DIRS = ['build', '.dart_tool', '.symlinks', '.plugin_symlinks', 'ios', 'android', 'web', 'macos', 'linux', 'windows', '.fvm'];

export class PubspecParser {
  static parse(filePath: string): PubspecDependency[] {
    const content = fs.readFileSync(filePath, 'utf8');
    const doc = yaml.load(content) as any;
    const dependencies: PubspecDependency[] = [];

    const parseDeps = (deps: Record<string, any>, isDev: boolean) => {
      for (const name of Object.keys(deps)) {
        if (name === 'flutter' || name === 'flutter_test') continue;
        const version = deps[name];
        if (typeof version === 'string') {
          const hasCaret = version.trimStart().startsWith('^');
          dependencies.push({ name, version, isDev, hasCaret });
        }
      }
    };

    if (doc.dependencies) parseDeps(doc.dependencies, false);
    if (doc.dev_dependencies) parseDeps(doc.dev_dependencies, true);

    return dependencies;
  }

  // Extracts the "name:" field from pubspec.yaml (the project/package name)
  static getProjectName(filePath: string): string {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const doc = yaml.load(content) as any;
      if (doc?.name) return doc.name;
    } catch {}
    // Fallback to directory name
    return path.basename(path.dirname(filePath));
  }

  // Finds all pubspec.yaml files in the workspace, skipping generated/platform dirs
  static async findAllPubspecs(workspaceRoot: string): Promise<string[]> {
    const pattern = new vscode.RelativePattern(workspaceRoot, '**/pubspec.yaml');
    const uris = await vscode.workspace.findFiles(pattern, `{${EXCLUDED_DIRS.map(d => `**/${d}/**`).join(',')}}`);
    return uris.map(u => u.fsPath).sort();
  }

  static parseLockFile(pubspecPath: string): Map<string, string> | null {
    const lockPath = path.join(path.dirname(pubspecPath), 'pubspec.lock');
    if (!fs.existsSync(lockPath)) return null;

    const doc = yaml.load(fs.readFileSync(lockPath, 'utf8')) as any;
    const versions = new Map<string, string>();

    if (doc?.packages) {
      for (const [name, info] of Object.entries<any>(doc.packages)) {
        if (info?.version) {
          versions.set(name, info.version);
        }
      }
    }

    return versions;
  }

  static cleanVersion(version: string): string {
    return version.replace(/^[\^>=<]+/, '').trim();
  }
}

