import axios from 'axios';
import * as semver from 'semver';
import { UpdateType } from './types';

export class PubDevClient {
  private static BASE_URL = 'https://pub.dev/api/packages';

  static async getLatestVersion(packageName: string): Promise<string | null> {
    try {
      const response = await axios.get(`${this.BASE_URL}/${packageName}`);
      return response.data.latest.version;
    } catch (error) {
      console.error(`Failed to fetch ${packageName}:`, error);
      return null;
    }
  }

  static async getVersionPublishedDate(packageName: string, version: string): Promise<Date | null> {
    try {
      const response = await axios.get(`${this.BASE_URL}/${packageName}`);
      const versions = response.data.versions || [];
      const versionInfo = versions.find((v: any) => v.version === version);
      if (versionInfo && versionInfo.published) {
        return new Date(versionInfo.published);
      }
      return null;
    } catch (error) {
      console.error(`Failed to fetch published date for ${packageName}@${version}:`, error);
      return null;
    }
  }

  static formatRelativeTime(date: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSeconds = Math.floor(diffMs / 1000);
    const diffMinutes = Math.floor(diffSeconds / 60);
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);
    const diffMonths = Math.floor(diffDays / 30);
    const diffYears = Math.floor(diffDays / 365);

    if (diffSeconds < 60) return 'just now';
    if (diffMinutes < 60) return `${diffMinutes} minute${diffMinutes !== 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
    if (diffDays < 30) return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
    if (diffMonths < 12) return `${diffMonths} month${diffMonths !== 1 ? 's' : ''} ago`;
    return `${diffYears} year${diffYears !== 1 ? 's' : ''} ago`;
  }

  static async getChangelog(packageName: string, fromVersion: string, toVersion: string): Promise<string> {
    try {
      // Fetch from pub.dev changelog page
      const response = await axios.get(`https://pub.dev/packages/${packageName}/changelog`, {
        headers: {
          'User-Agent': 'Mozilla/5.0'
        }
      });
      const html = response.data;
      
      // Try multiple extraction methods
      let changelog = this.extractChangelogFromHtml(html);
      
      console.log(`[Pubgrade] Extracted changelog length for ${packageName}:`, changelog.length);
      console.log(`[Pubgrade] First 500 chars:`, changelog.substring(0, 500));
      
      if (!changelog || changelog.length < 20) {
        console.log(`[Pubgrade] Changelog too short for ${packageName}`);
        return `# Changelog\n\nChangelog for ${packageName} could not be parsed.\n\nView online: https://pub.dev/packages/${packageName}/changelog`;
      }
      
      // Format and filter relevant versions
      const formatted = this.formatChangelog(changelog, fromVersion, toVersion);
      console.log(`[Pubgrade] Formatted changelog length:`, formatted.length);
      
      return formatted;
    } catch (error) {
      console.error(`[Pubgrade] Error fetching changelog for ${packageName}:`, error);
      return `# Changelog\n\nChangelog for ${packageName} could not be fetched.\n\nView online: https://pub.dev/packages/${packageName}/changelog`;
    }
  }

  private static extractChangelogFromHtml(html: string): string {
    // Method 1: Find the detail-tabs-content section (where changelog lives on pub.dev)
    const tabContentMatch = html.match(/<div[^>]*class="[^"]*detail-tabs-content[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/section>/i);
    if (tabContentMatch) {
      console.log('[Pubgrade] Found detail-tabs-content');
      return this.htmlToText(tabContentMatch[1]);
    }

    // Method 2: Look for markdown-body or markdown div
    const markdownMatch = html.match(/<div[^>]*class="[^"]*markdown[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    if (markdownMatch) {
      console.log('[Pubgrade] Found markdown div');
      return this.htmlToText(markdownMatch[1]);
    }

    // Method 3: Find any section with changelog-like content (has version numbers)
    const sections = html.split(/<(?:section|div)[^>]*>/);
    for (const section of sections) {
      if (section.includes('##') && /\d+\.\d+\.\d+/.test(section) && section.length > 200) {
        console.log('[Pubgrade] Found section with version numbers');
        return this.htmlToText(section);
      }
    }

    // Method 4: Fallback - extract from main tag
    const mainMatch = html.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
    if (mainMatch) {
      console.log('[Pubgrade] Fallback to main content');
      return this.htmlToText(mainMatch[1]);
    }

    console.log('[Pubgrade] No extraction method worked');
    return '';
  }

  private static htmlToText(html: string): string {
    return html
      // Remove scripts and styles
      .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      // Convert common HTML elements
      .replace(/<h1[^>]*>/gi, '\n# ')
      .replace(/<h2[^>]*>/gi, '\n## ')
      .replace(/<h3[^>]*>/gi, '\n### ')
      .replace(/<\/h[1-6]>/gi, '\n')
      .replace(/<li[^>]*>/gi, '\n- ')
      .replace(/<\/li>/gi, '')
      .replace(/<p[^>]*>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<ul[^>]*>/gi, '\n')
      .replace(/<\/ul>/gi, '\n')
      .replace(/<ol[^>]*>/gi, '\n')
      .replace(/<\/ol>/gi, '\n')
      // Remove all other tags
      .replace(/<[^>]*>/g, '')
      // Decode HTML entities
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ')
      // Clean up whitespace
      .replace(/\n\s*\n\s*\n/g, '\n\n')
      .trim();
  }

  private static decodeHtml(text: string): string {
    return text
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/<[^>]*>/g, '');
  }


  private static formatChangelog(changelog: string, fromVersion: string, toVersion: string): string {
    const lines = changelog.split('\n');
    const relevantLines: string[] = [];
    const header = `# Changelog: ${fromVersion} → ${toVersion}\n\n`;
    
    let inRelevantSection = false;
    let foundAnyRelevant = false;
    
    for (const line of lines) {
      // Match version headers in two formats:
      // 1. Markdown headings: ## 1.2.3, # 1.2.3, ## [1.2.3]
      // 2. Plain version lines: v4.5.3 (some authors skip markdown headings entirely)
      const versionMatch = line.match(/^(?:#+ ?\[?v?|v)(\d+\.\d+\.\d+[^\]\s]*)\]?/);
      
      if (versionMatch) {
        const version = versionMatch[1];
        const cleanFrom = semver.clean(fromVersion);
        const cleanTo = semver.clean(toVersion);
        
        if (cleanFrom && cleanTo && semver.valid(semver.coerce(version))) {
          const semVersion = semver.coerce(version)!.version;
          
          // Include versions greater than current, up to and including latest
          if (semver.gt(semVersion, cleanFrom) && semver.lte(semVersion, cleanTo)) {
            inRelevantSection = true;
            foundAnyRelevant = true;
            relevantLines.push('\n' + line);
          } else if (semver.lte(semVersion, cleanFrom)) {
            inRelevantSection = false;
            break; // Stop once we reach or pass the current version
          }
        } else {
          inRelevantSection = false;
        }
      } else if (inRelevantSection) {
        relevantLines.push(line);
      }
    }
    
    if (foundAnyRelevant) {
      return header + relevantLines.join('\n').trim();
    }
    
    // Fallback: return first 100 lines of changelog
    return header + lines.slice(0, 100).join('\n');
  }

  static isOutdated(currentVersion: string, latestVersion: string): boolean {
    const cleanCurrent = semver.clean(currentVersion);
    const cleanLatest = semver.clean(latestVersion);

    if (!cleanCurrent || !cleanLatest) return false;

    return semver.gt(cleanLatest, cleanCurrent);
  }

  static getUpdateType(currentVersion: string, latestVersion: string): UpdateType {
    const cleanCurrent = semver.clean(currentVersion);
    const cleanLatest = semver.clean(latestVersion);

    if (!cleanCurrent || !cleanLatest) return 'none';

    // Check if versions are the same
    if (semver.eq(cleanLatest, cleanCurrent)) {
      return 'none';
    }

    // Parse versions
    const current = semver.parse(cleanCurrent);
    const latest = semver.parse(cleanLatest);

    if (!current || !latest) return 'none';

    // Check major version change
    if (latest.major > current.major) {
      return 'major';
    }

    // Check minor version change
    if (latest.minor > current.minor) {
      return 'minor';
    }

    // Check patch version change
    if (latest.patch > current.patch) {
      return 'patch';
    }

    return 'none';
  }
}

