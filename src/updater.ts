import * as fs from 'fs';
import * as vscode from 'vscode';

export class Updater {
  static async updatePackage(pubspecPath: string, packageName: string, newVersion: string): Promise<boolean> {
    try {
      const content = fs.readFileSync(pubspecPath, 'utf8');
      
      // Match only indented entries (under dependencies/dev_dependencies), not root-level config sections
      const regex = new RegExp(`([ \\t]+${packageName}:\\s*)(\\^?)(\\d[^\\n]*)`, 'm');
      const updatedContent = content.replace(regex, (match, prefix, caret) => {
        // Preserve caret if it was there, otherwise no caret
        return `${prefix}${caret}${newVersion}`;
      });
      
      if (content === updatedContent) {
        vscode.window.showWarningMessage(`Could not update ${packageName}`);
        return false;
      }
      
      fs.writeFileSync(pubspecPath, updatedContent, 'utf8');
      
      // Run flutter pub get
      const terminal = vscode.window.createTerminal('Flutter Pub Get');
      terminal.sendText('flutter pub get');
      terminal.show();
      
      vscode.window.showInformationMessage(`Updated ${packageName} to ${newVersion}`);
      return true;
    } catch (error) {
      vscode.window.showErrorMessage(`Failed to update ${packageName}: ${error}`);
      return false;
    }
  }
}

