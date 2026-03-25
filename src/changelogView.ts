import * as vscode from 'vscode';
import { PubDevClient } from './pubdevClient';

export class ChangelogView {
  private static currentPanel: vscode.WebviewPanel | undefined;
  private static updateCallback?: (packageName: string, version: string) => void;
  private static versionDates: Map<string, Date> = new Map();

  static show(
    packageName: string, 
    changelog: string, 
    fromVersion: string, 
    toVersion: string,
    onUpdate?: (packageName: string, version: string) => void
  ) {
    this.updateCallback = onUpdate;

    if (this.currentPanel) {
      // Reuse existing panel
      this.currentPanel.reveal(vscode.ViewColumn.Beside);
    } else {
      // Create new panel
      this.currentPanel = vscode.window.createWebviewPanel(
        'changelogView',
        'Package Changelog',
        vscode.ViewColumn.Beside,
        {
          enableScripts: true,
          retainContextWhenHidden: true
        }
      );

      // Handle messages from webview
      this.currentPanel.webview.onDidReceiveMessage(
        message => {
          if (message.command === 'update' && this.updateCallback) {
            this.updateCallback(message.packageName, message.version);
          }
        }
      );

      this.currentPanel.onDidDispose(() => {
        this.currentPanel = undefined;
        this.updateCallback = undefined;
        this.versionDates.clear();
      });
    }

    // Fetch version dates and update content
    this.fetchVersionDatesAndUpdateContent(packageName, changelog, fromVersion, toVersion);
  }

  private static async fetchVersionDatesAndUpdateContent(
    packageName: string,
    changelog: string,
    fromVersion: string,
    toVersion: string
  ) {
    if (!this.currentPanel) return;

    // Parse versions from changelog
    const sections = this.parseChangelogSections(changelog);
    
    // Fetch dates for all versions
    const datePromises = sections.map(async (section) => {
      const date = await PubDevClient.getVersionPublishedDate(packageName, section.version);
      if (date) {
        this.versionDates.set(section.version, date);
      }
    });

    await Promise.all(datePromises);

    // Update content with dates
    this.currentPanel.title = `${packageName} Changelog`;
    this.currentPanel.webview.html = this.getWebviewContent(packageName, changelog, fromVersion, toVersion);
  }

  private static getWebviewContent(packageName: string, changelog: string, fromVersion: string, toVersion: string): string {
    // Parse changelog into version sections
    const sections = this.parseChangelogSections(changelog);
    const sectionsHtml = sections.map(section => {
      const date = this.versionDates.get(section.version);
      const dateHtml = date 
        ? `<span class="version-date">${PubDevClient.formatRelativeTime(date)}</span>`
        : '';
      
      return `
      <div class="version-section">
        <div class="version-header">
          <div class="version-info-line">
            <span class="version-badge">${section.version}</span>
            ${dateHtml}
          </div>
          <button class="update-btn" onclick="updateToVersion('${this.escapeHtml(packageName)}', '${section.version}')">
            Update to ${section.version}
          </button>
        </div>
        <div class="version-content">
          ${this.formatContent(section.content)}
        </div>
      </div>
    `;
    }).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${packageName} Changelog</title>
  <style>
    body {
      font-family: var(--vscode-font-family);
      padding: 20px;
      line-height: 1.6;
      color: var(--vscode-foreground);
      font-size: 13px;
    }
    .header {
      margin-bottom: 30px;
    }
    h1 {
      color: var(--vscode-foreground);
      margin: 0 0 10px 0;
      font-size: 24px;
    }
    .version-info {
      background: var(--vscode-textBlockQuote-background);
      padding: 12px 16px;
      border-radius: 6px;
      border-left: 3px solid var(--vscode-textLink-foreground);
      font-size: 14px;
    }
    .version-section {
      margin-bottom: 24px;
      padding-bottom: 20px;
      border-bottom: 1px solid var(--vscode-panel-border);
    }
    .version-section:last-child {
      border-bottom: none;
    }
    .version-header {
      margin-bottom: 12px;
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .version-info-line {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .version-badge {
      background: var(--vscode-badge-background);
      color: var(--vscode-badge-foreground);
      padding: 4px 12px;
      border-radius: 12px;
      font-weight: 600;
      font-size: 14px;
      display: inline-block;
    }
    .version-date {
      color: var(--vscode-descriptionForeground);
      font-size: 12px;
    }
    .update-btn {
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      border: none;
      padding: 6px 12px;
      border-radius: 4px;
      font-size: 12px;
      cursor: pointer;
      font-family: var(--vscode-font-family);
      transition: background 0.2s;
    }
    .update-btn:hover {
      background: var(--vscode-button-hoverBackground);
    }
    .update-btn:active {
      transform: scale(0.98);
    }
    .version-content {
      padding-left: 8px;
    }
    .version-content ul {
      margin: 8px 0;
      padding-left: 20px;
    }
    .version-content li {
      margin: 6px 0;
      line-height: 1.5;
    }
    .version-content p {
      margin: 8px 0;
    }
    .link-section {
      margin-top: 30px;
      padding-top: 20px;
      border-top: 2px solid var(--vscode-panel-border);
      text-align: center;
    }
    .link-section a {
      color: var(--vscode-textLink-foreground);
      text-decoration: none;
    }
    .link-section a:hover {
      text-decoration: underline;
    }
    .empty-state {
      padding: 40px;
      text-align: center;
      color: var(--vscode-descriptionForeground);
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>${this.escapeHtml(packageName)}</h1>
    <div class="version-info">
      📦 Update: ${this.escapeHtml(fromVersion)} → ${this.escapeHtml(toVersion)}
    </div>
  </div>
  
  ${sectionsHtml || '<div class="empty-state">No changelog entries found for this version range.</div>'}
  
  <div class="link-section">
    <a href="https://pub.dev/packages/${packageName}/changelog" target="_blank">
      View full changelog on pub.dev →
    </a>
  </div>
  
  <script>
    const vscode = acquireVsCodeApi();
    
    function updateToVersion(packageName, version) {
      vscode.postMessage({
        command: 'update',
        packageName: packageName,
        version: version
      });
    }
  </script>
</body>
</html>`;
  }

  private static parseChangelogSections(changelog: string): Array<{version: string, content: string}> {
    const sections: Array<{version: string, content: string}> = [];
    const lines = changelog.split('\n');
    let currentVersion = '';
    let currentContent: string[] = [];

    for (const line of lines) {
      // Match version headers in two formats:
      // 1. Markdown headings: ## 1.2.3, # 1.2.3, ## [1.2.3]
      // 2. Plain version lines: v4.5.3 (some authors skip markdown headings entirely)
      const versionMatch = line.match(/^(?:#+\s*\[?v?|v)(\d+\.\d+\.\d+[^\]\s]*)\]?\s*$/);
      
      if (versionMatch) {
        // Save previous section
        if (currentVersion && currentContent.length > 0) {
          sections.push({
            version: currentVersion,
            content: currentContent.join('\n').trim()
          });
        }
        // Start new section
        currentVersion = versionMatch[1];
        currentContent = [];
      } else if (currentVersion) {
        // Add content to current section (skip empty lines at start)
        if (line.trim() || currentContent.length > 0) {
          currentContent.push(line);
        }
      }
    }

    // Add last section
    if (currentVersion && currentContent.length > 0) {
      sections.push({
        version: currentVersion,
        content: currentContent.join('\n').trim()
      });
    }

    return sections;
  }

  private static formatContent(content: string): string {
    // Convert markdown-style lists to HTML
    const lines = content.split('\n');
    let html = '';
    let inList = false;

    for (let line of lines) {
      line = this.escapeHtml(line);
      
      // Check if it's a list item
      if (line.match(/^\s*[-*•]\s/)) {
        if (!inList) {
          html += '<ul>';
          inList = true;
        }
        const item = line.replace(/^\s*[-*•]\s/, '');
        html += `<li>${item}</li>`;
      } else {
        if (inList) {
          html += '</ul>';
          inList = false;
        }
        if (line.trim()) {
          html += `<p>${line}</p>`;
        }
      }
    }

    if (inList) {
      html += '</ul>';
    }

    return html || '<p><em>No details available</em></p>';
  }

  private static escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}

