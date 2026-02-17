use gray_matter::engine::YAML;
use gray_matter::Matter;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::time::UNIX_EPOCH;
use walkdir::WalkDir;

use crate::frontmatter::{with_frontmatter, update_frontmatter_content};

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct VaultEntry {
    pub path: String,
    pub filename: String,
    pub title: String,
    #[serde(rename = "isA")]
    pub is_a: Option<String>,
    pub aliases: Vec<String>,
    #[serde(rename = "belongsTo")]
    pub belongs_to: Vec<String>,
    #[serde(rename = "relatedTo")]
    pub related_to: Vec<String>,
    pub status: Option<String>,
    pub owner: Option<String>,
    pub cadence: Option<String>,
    #[serde(rename = "modifiedAt")]
    pub modified_at: Option<u64>,
    #[serde(rename = "createdAt")]
    pub created_at: Option<u64>,
    #[serde(rename = "fileSize")]
    pub file_size: u64,
}

/// Intermediate struct to capture YAML frontmatter fields.
#[derive(Debug, Deserialize, Default)]
struct Frontmatter {
    #[serde(rename = "Is A")]
    is_a: Option<StringOrList>,
    #[serde(default)]
    aliases: Option<StringOrList>,
    #[serde(rename = "Belongs to")]
    belongs_to: Option<StringOrList>,
    #[serde(rename = "Related to")]
    related_to: Option<StringOrList>,
    #[serde(rename = "Status")]
    status: Option<String>,
    #[serde(rename = "Owner")]
    owner: Option<String>,
    #[serde(rename = "Cadence")]
    cadence: Option<String>,
    #[serde(rename = "Created at")]
    created_at: Option<String>,
    #[serde(rename = "Created time")]
    created_time: Option<String>,
}

/// Handles YAML fields that can be either a single string or a list of strings.
#[derive(Debug, Deserialize, Clone)]
#[serde(untagged)]
enum StringOrList {
    Single(String),
    List(Vec<String>),
}

impl StringOrList {
    fn into_vec(self) -> Vec<String> {
        match self {
            StringOrList::Single(s) => vec![s],
            StringOrList::List(v) => v,
        }
    }
}

/// Extract the title from a markdown file's content.
/// Tries the first H1 heading (`# Title`), falls back to filename without extension.
fn extract_title(content: &str, filename: &str) -> String {
    for line in content.lines() {
        let trimmed = line.trim();
        if let Some(heading) = trimmed.strip_prefix("# ") {
            let title = heading.trim();
            if !title.is_empty() {
                return title.to_string();
            }
        }
    }
    // Fallback: filename without .md extension
    filename.strip_suffix(".md").unwrap_or(filename).to_string()
}

/// Parse frontmatter from raw YAML data extracted by gray_matter.
fn parse_frontmatter(data: &HashMap<String, serde_json::Value>) -> Frontmatter {
    // Convert HashMap to serde_json::Value for deserialization
    let value = serde_json::Value::Object(
        data.iter()
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect(),
    );
    serde_json::from_value(value).unwrap_or_default()
}

/// Parse a single markdown file into a VaultEntry.
pub fn parse_md_file(path: &Path) -> Result<VaultEntry, String> {
    let content = fs::read_to_string(path).map_err(|e| format!("Failed to read {}: {}", path.display(), e))?;

    let filename = path
        .file_name()
        .map(|f| f.to_string_lossy().to_string())
        .unwrap_or_default();

    let matter = Matter::<YAML>::new();
    let parsed = matter.parse(&content);

    let frontmatter: Frontmatter = if let Some(data) = parsed.data {
        match data {
            gray_matter::Pod::Hash(map) => {
                // Convert Pod HashMap to serde_json HashMap
                let json_map: HashMap<String, serde_json::Value> = map
                    .into_iter()
                    .map(|(k, v)| (k, pod_to_json(v)))
                    .collect();
                parse_frontmatter(&json_map)
            }
            _ => Frontmatter::default(),
        }
    } else {
        Frontmatter::default()
    };

    let title = extract_title(&parsed.content, &filename);

    let metadata = fs::metadata(path).map_err(|e| format!("Failed to stat {}: {}", path.display(), e))?;
    let modified_at = metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs());
    let file_size = metadata.len();

    // Extract is_a from frontmatter, or infer from parent folder name
    let is_a = frontmatter.is_a
        .map(|a| a.into_vec().into_iter().next())
        .flatten()
        .or_else(|| {
            path.parent()
                .and_then(|p| p.file_name())
                .map(|f| {
                    let folder = f.to_string_lossy().to_string();
                    // Map folder names to entity types
                    match folder.as_str() {
                        "person" => "Person".to_string(),
                        "project" => "Project".to_string(),
                        "procedure" => "Procedure".to_string(),
                        "responsibility" => "Responsibility".to_string(),
                        "event" => "Event".to_string(),
                        "topic" => "Topic".to_string(),
                        "experiment" => "Experiment".to_string(),
                        "note" => "Note".to_string(),
                        "quarter" => "Quarter".to_string(),
                        "measure" => "Measure".to_string(),
                        "target" => "Target".to_string(),
                        "journal" => "Journal".to_string(),
                        "month" => "Month".to_string(),
                        "essay" => "Essay".to_string(),
                        "evergreen" => "Evergreen".to_string(),
                        _ => capitalize_first(&folder),
                    }
                })
        });

    // Parse created_at from frontmatter (prefer "Created at" over "Created time")
    let created_at = frontmatter.created_at
        .as_ref()
        .and_then(|s| parse_iso_date(s))
        .or_else(|| frontmatter.created_time.as_ref().and_then(|s| parse_iso_date(s)));

    Ok(VaultEntry {
        path: path.to_string_lossy().to_string(),
        filename,
        title,
        is_a,
        aliases: frontmatter.aliases.map(|a| a.into_vec()).unwrap_or_default(),
        belongs_to: frontmatter.belongs_to.map(|b| b.into_vec()).unwrap_or_default(),
        related_to: frontmatter.related_to.map(|r| r.into_vec()).unwrap_or_default(),
        status: frontmatter.status,
        owner: frontmatter.owner,
        cadence: frontmatter.cadence,
        modified_at,
        created_at,
        file_size,
    })
}

fn capitalize_first(s: &str) -> String {
    let mut c = s.chars();
    match c.next() {
        None => String::new(),
        Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
    }
}

/// Parse an ISO 8601 date string to Unix timestamp (seconds since epoch).
/// Handles "2025-05-23T14:35:00.000Z" and "2025-05-23" formats.
fn parse_iso_date(date_str: &str) -> Option<u64> {
    use chrono::{NaiveDate, NaiveDateTime};

    let trimmed = date_str.trim().trim_matches('"');

    // Try full datetime with optional fractional seconds and Z suffix
    if let Ok(dt) = NaiveDateTime::parse_from_str(trimmed, "%Y-%m-%dT%H:%M:%S%.fZ") {
        return Some(dt.and_utc().timestamp() as u64);
    }
    if let Ok(dt) = NaiveDateTime::parse_from_str(trimmed, "%Y-%m-%dT%H:%M:%SZ") {
        return Some(dt.and_utc().timestamp() as u64);
    }
    if let Ok(dt) = NaiveDateTime::parse_from_str(trimmed, "%Y-%m-%dT%H:%M:%S") {
        return Some(dt.and_utc().timestamp() as u64);
    }

    // Try date-only
    if let Ok(d) = NaiveDate::parse_from_str(trimmed, "%Y-%m-%d") {
        return Some(d.and_hms_opt(0, 0, 0)?.and_utc().timestamp() as u64);
    }

    None
}

/// Convert gray_matter::Pod to serde_json::Value
fn pod_to_json(pod: gray_matter::Pod) -> serde_json::Value {
    match pod {
        gray_matter::Pod::String(s) => serde_json::Value::String(s),
        gray_matter::Pod::Integer(i) => serde_json::json!(i),
        gray_matter::Pod::Float(f) => serde_json::json!(f),
        gray_matter::Pod::Boolean(b) => serde_json::Value::Bool(b),
        gray_matter::Pod::Array(arr) => {
            serde_json::Value::Array(arr.into_iter().map(pod_to_json).collect())
        }
        gray_matter::Pod::Hash(map) => {
            let obj: serde_json::Map<String, serde_json::Value> = map
                .into_iter()
                .map(|(k, v)| (k, pod_to_json(v)))
                .collect();
            serde_json::Value::Object(obj)
        }
        gray_matter::Pod::Null => serde_json::Value::Null,
    }
}

/// Read the content of a single note file.
pub fn get_note_content(path: &str) -> Result<String, String> {
    let file_path = Path::new(path);
    if !file_path.exists() {
        return Err(format!("File does not exist: {}", path));
    }
    if !file_path.is_file() {
        return Err(format!("Path is not a file: {}", path));
    }
    fs::read_to_string(file_path)
        .map_err(|e| format!("Failed to read {}: {}", path, e))
}

/// Scan a directory recursively for .md files and return VaultEntry for each.
pub fn scan_vault(vault_path: &str) -> Result<Vec<VaultEntry>, String> {
    let path = Path::new(vault_path);
    if !path.exists() {
        return Err(format!("Vault path does not exist: {}", vault_path));
    }
    if !path.is_dir() {
        return Err(format!("Vault path is not a directory: {}", vault_path));
    }

    let mut entries = Vec::new();
    for entry in WalkDir::new(path)
        .follow_links(true)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let entry_path = entry.path();
        if entry_path.is_file()
            && entry_path
                .extension()
                .map(|ext| ext == "md")
                .unwrap_or(false)
        {
            match parse_md_file(entry_path) {
                Ok(vault_entry) => entries.push(vault_entry),
                Err(e) => {
                    log::warn!("Skipping file: {}", e);
                }
            }
        }
    }

    // Sort by modified date descending (newest first)
    entries.sort_by(|a, b| b.modified_at.cmp(&a.modified_at));

    Ok(entries)
}

// Re-export for external consumers
pub use crate::frontmatter::FrontmatterValue;

/// Update a single frontmatter property in a markdown file
pub fn update_frontmatter(path: &str, key: &str, value: FrontmatterValue) -> Result<String, String> {
    with_frontmatter(path, |content| update_frontmatter_content(content, key, Some(value.clone())))
}

/// Delete a frontmatter property from a markdown file
pub fn delete_frontmatter_property(path: &str, key: &str) -> Result<String, String> {
    with_frontmatter(path, |content| update_frontmatter_content(content, key, None))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::io::Write;
    use tempfile::TempDir;

    fn create_test_file(dir: &Path, name: &str, content: &str) {
        let file_path = dir.join(name);
        if let Some(parent) = file_path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        let mut file = fs::File::create(file_path).unwrap();
        file.write_all(content.as_bytes()).unwrap();
    }

    #[test]
    fn test_extract_title_from_h1() {
        let content = "---\nIs A: Note\n---\n# My Great Note\n\nSome content here.";
        assert_eq!(extract_title(content, "my-great-note.md"), "My Great Note");
    }

    #[test]
    fn test_extract_title_fallback_to_filename() {
        let content = "Just some content without a heading.";
        assert_eq!(extract_title(content, "fallback-title.md"), "fallback-title");
    }

    #[test]
    fn test_extract_title_empty_h1_falls_back() {
        let content = "# \n\nSome content.";
        assert_eq!(extract_title(content, "empty-h1.md"), "empty-h1");
    }

    #[test]
    fn test_parse_full_frontmatter() {
        let dir = TempDir::new().unwrap();
        let content = r#"---
Is A: Project
aliases:
  - Laputa
  - Castle in the Sky
Belongs to:
  - Studio Ghibli
Related to:
  - Miyazaki
Status: Active
Owner: Luca
Cadence: Weekly
---
# Laputa Project

This is a project note.
"#;
        create_test_file(dir.path(), "laputa.md", content);

        let entry = parse_md_file(&dir.path().join("laputa.md")).unwrap();
        assert_eq!(entry.title, "Laputa Project");
        assert_eq!(entry.is_a, Some("Project".to_string()));
        assert_eq!(entry.aliases, vec!["Laputa", "Castle in the Sky"]);
        assert_eq!(entry.belongs_to, vec!["Studio Ghibli"]);
        assert_eq!(entry.related_to, vec!["Miyazaki"]);
        assert_eq!(entry.status, Some("Active".to_string()));
        assert_eq!(entry.owner, Some("Luca".to_string()));
        assert_eq!(entry.cadence, Some("Weekly".to_string()));
        assert_eq!(entry.filename, "laputa.md");
    }

    #[test]
    fn test_parse_empty_frontmatter() {
        let dir = TempDir::new().unwrap();
        let content = "---\n---\n# Just a Title\n\nNo frontmatter fields.";
        create_test_file(dir.path(), "empty-fm.md", content);

        let entry = parse_md_file(&dir.path().join("empty-fm.md")).unwrap();
        assert_eq!(entry.title, "Just a Title");
        // is_a is inferred from parent folder name (temp dir), so just check it's not from frontmatter
        assert!(entry.aliases.is_empty());
        assert!(entry.belongs_to.is_empty());
        assert!(entry.related_to.is_empty());
        assert_eq!(entry.status, None);
    }

    #[test]
    fn test_parse_no_frontmatter() {
        let dir = TempDir::new().unwrap();
        let content = "# A Note Without Frontmatter\n\nJust markdown.";
        create_test_file(dir.path(), "no-fm.md", content);

        let entry = parse_md_file(&dir.path().join("no-fm.md")).unwrap();
        assert_eq!(entry.title, "A Note Without Frontmatter");
        // is_a is inferred from parent folder name (temp dir), not None
    }

    #[test]
    fn test_parse_single_string_aliases() {
        let dir = TempDir::new().unwrap();
        let content = "---\naliases: SingleAlias\n---\n# Test\n";
        create_test_file(dir.path(), "single-alias.md", content);

        let entry = parse_md_file(&dir.path().join("single-alias.md")).unwrap();
        assert_eq!(entry.aliases, vec!["SingleAlias"]);
    }

    #[test]
    fn test_scan_vault_recursive() {
        let dir = TempDir::new().unwrap();
        create_test_file(dir.path(), "root.md", "# Root Note\n");
        create_test_file(dir.path(), "sub/nested.md", "---\nIs A: Task\n---\n# Nested\n");
        create_test_file(dir.path(), "not-markdown.txt", "This should be ignored");

        let entries = scan_vault(dir.path().to_str().unwrap()).unwrap();
        assert_eq!(entries.len(), 2);

        let filenames: Vec<&str> = entries.iter().map(|e| e.filename.as_str()).collect();
        assert!(filenames.contains(&"root.md"));
        assert!(filenames.contains(&"nested.md"));
    }

    #[test]
    fn test_scan_vault_nonexistent_path() {
        let result = scan_vault("/nonexistent/path/that/does/not/exist");
        assert!(result.is_err());
    }

    #[test]
    fn test_parse_malformed_yaml() {
        let dir = TempDir::new().unwrap();
        // Malformed YAML — gray_matter should handle this gracefully
        let content = "---\nIs A: [unclosed bracket\n---\n# Malformed\n";
        create_test_file(dir.path(), "malformed.md", content);

        let entry = parse_md_file(&dir.path().join("malformed.md"));
        // Should still succeed — gray_matter may parse partially or skip
        assert!(entry.is_ok());
    }

    #[test]
    fn test_get_note_content() {
        let dir = TempDir::new().unwrap();
        let content = "---\nIs A: Note\n---\n# Test Note\n\nHello, world!";
        create_test_file(dir.path(), "test.md", content);

        let path = dir.path().join("test.md");
        let result = get_note_content(path.to_str().unwrap());
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), content);
    }

    #[test]
    fn test_get_note_content_nonexistent() {
        let result = get_note_content("/nonexistent/path/file.md");
        assert!(result.is_err());
    }

    // Frontmatter update/delete tests are in frontmatter.rs
}
